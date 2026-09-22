import { describe, expect, test } from "bun:test"
import { computeUsed } from "../src/sessions/service"
import type { TokenUsage } from "../src/shared/types"

describe("computeUsed", () => {
  test("returns 0 for undefined", () => {
    expect(computeUsed(undefined)).toBe(0)
  })

  test("returns 0 for an empty token object", () => {
    expect(computeUsed({})).toBe(0)
  })

  test("prefers tokens.total when present", () => {
    const tokens: TokenUsage = {
      total: 100,
      input: 10,
      output: 5,
      cache: { read: 20, write: 30 },
    }
    expect(computeUsed(tokens)).toBe(100)
  })

  test("sums input + cache.read + cache.write when total is absent", () => {
    expect(computeUsed({ input: 10, cache: { read: 5, write: 2 } })).toBe(17)
  })

  test("handles a missing cache object", () => {
    expect(computeUsed({ input: 7 })).toBe(7)
    expect(computeUsed({ input: 7, output: 999 })).toBe(7)
  })

  test("handles a partially defined cache object", () => {
    const tokens: TokenUsage = { input: 3, cache: { read: undefined, write: 4 } }
    expect(computeUsed(tokens)).toBe(7)
  })
})
