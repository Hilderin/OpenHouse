import { describe, expect, test } from "bun:test"
import { LEVELS, levelByName } from "../src/core/levels"

describe("levels", () => {
  test("exposes the three levels with expected names", () => {
    expect(LEVELS.map((l) => l.name)).toEqual(["read-only", "standard", "full"])
  })

  test("read-only denies shell and edit", () => {
    const level = levelByName("read-only")
    expect(level).toBeDefined()
    const denies = (action: string) =>
      level!.rules.some((r) => r.action === action && r.effect === "deny" && r.resource === "*")
    expect(denies("shell")).toBe(true)
    expect(denies("edit")).toBe(true)
  })

  test("full allows everything with a wildcard rule", () => {
    const level = levelByName("full")
    expect(level).toBeDefined()
    expect(level!.rules.some((r) => r.action === "*" && r.resource === "*" && r.effect === "allow")).toBe(true)
  })

  test("levelByName returns undefined for unknown/empty names", () => {
    expect(levelByName("does-not-exist")).toBeUndefined()
    expect(levelByName(undefined)).toBeUndefined()
  })
})
