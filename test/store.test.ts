import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { JsonStore, withFileLock } from "../src/core/store"
import { delay, makeTempDir, removeTempDir } from "./util"

const dir = makeTempDir("oh-store-")
afterAll(() => removeTempDir(dir))

describe("JsonStore", () => {
  test("missing file returns the fallback", () => {
    const store = new JsonStore<{ v: number }>(join(dir, "missing.json"), () => ({ v: 0 }))
    expect(store.read()).toEqual({ v: 0 })
  })

  test("empty file returns the fallback", () => {
    const file = join(dir, "empty.json")
    writeFileSync(file, "   \n")
    const store = new JsonStore<{ v: number }>(file, () => ({ v: 7 }))
    expect(store.read()).toEqual({ v: 7 })
  })

  test("corrupt JSON returns the fallback", () => {
    const file = join(dir, "corrupt.json")
    writeFileSync(file, "{ not: valid json ]")
    const store = new JsonStore<{ v: number }>(file, () => ({ v: 42 }))
    expect(store.read()).toEqual({ v: 42 })
  })

  test("write/read round-trip leaves no temp artifacts", () => {
    const file = join(dir, "data.json")
    const store = new JsonStore<{ n: number }>(file, () => ({ n: 0 }))
    store.write({ n: 5 })
    expect(store.read()).toEqual({ n: 5 })
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ n: 5 })
    const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp"))
    expect(leftovers).toEqual([])
  })

  test("update receives current value and persists the result", () => {
    const file = join(dir, "counter.json")
    const store = new JsonStore<{ n: number }>(file, () => ({ n: 0 }))
    expect(store.update((c) => ({ n: c.n + 1 }))).toEqual({ n: 1 })
    expect(store.update((c) => ({ n: c.n + 10 }))).toEqual({ n: 11 })
    expect(store.read()).toEqual({ n: 11 })
  })
})

describe("withFileLock", () => {
  test("serializes concurrent blocks (max concurrency 1)", async () => {
    const lockFile = join(dir, "mutex.lock")
    let active = 0
    let maxActive = 0
    const block = (ms: number) =>
      withFileLock(lockFile, async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await delay(ms)
        active--
        return "done"
      })
    const results = await Promise.all([block(60), block(40), block(20)])
    expect(maxActive).toBe(1)
    expect(results).toEqual(["done", "done", "done"])
  })

  test("two concurrent blocks do not interleave", async () => {
    const lockFile = join(dir, "order.lock")
    const order: string[] = []
    await Promise.all([
      withFileLock(lockFile, async () => {
        order.push("a:start")
        await delay(50)
        order.push("a:end")
      }),
      withFileLock(lockFile, async () => {
        order.push("b:start")
        await delay(5)
        order.push("b:end")
      }),
    ])
    const sequence = order.join(",")
    expect(sequence === "a:start,a:end,b:start,b:end" || sequence === "b:start,b:end,a:start,a:end").toBe(true)
  })

  test("releases the lock when the block throws", async () => {
    const lockFile = join(dir, "error.lock")
    await expect(
      withFileLock(lockFile, () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    expect(existsSync(`${lockFile}.lock`)).toBe(false)
    const value = await withFileLock(lockFile, () => 42)
    expect(value).toBe(42)
  })
})
