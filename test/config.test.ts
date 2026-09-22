import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { loadConfig } from "../src/core/config"
import { resolveOpencodeBin } from "../src/core/paths"
import { makeTempDir, removeTempDir } from "./util"

const KEYS = [
  "OPENHOUSE_PORT",
  "OPENHOUSE_HOST",
  "OPENHOUSE_DATA_DIR",
  "OPENHOUSE_OPENCODE_BIN",
  "OPENHOUSE_LOG_LEVEL",
  "OPENHOUSE_GOAL_QUIET_MS",
] as const

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {}
  for (const key of KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe("loadConfig", () => {
  test("applies defaults when no env/overrides are set", () => {
    const cfg = loadConfig()
    expect(cfg.host).toBe("127.0.0.1")
    expect(cfg.port).toBe(7800)
    expect(cfg.logLevel).toBe("info")
    expect(cfg.opencodePin).toBe("2.0.11")
    expect(cfg.goalQuietMs).toBe(8000)
    expect(cfg.goalDefaultMaxTurns).toBe(20)
    expect(cfg.dataDir).toBe(resolve(join(homedir(), ".config", "openhouse")))
  })

  test("honours OPENHOUSE_PORT, OPENHOUSE_HOST and OPENHOUSE_DATA_DIR", () => {
    const dir = makeTempDir("oh-config-")
    try {
      process.env.OPENHOUSE_PORT = "9999"
      process.env.OPENHOUSE_HOST = "0.0.0.0"
      process.env.OPENHOUSE_DATA_DIR = dir
      const cfg = loadConfig()
      expect(cfg.port).toBe(9999)
      expect(cfg.host).toBe("0.0.0.0")
      expect(cfg.dataDir).toBe(resolve(dir))
    } finally {
      removeTempDir(dir)
    }
  })

  test("explicit overrides win over env", () => {
    process.env.OPENHOUSE_PORT = "9999"
    const cfg = loadConfig({ port: 1234, host: "10.0.0.1", dataDir: "/tmp/overridden" })
    expect(cfg.port).toBe(1234)
    expect(cfg.host).toBe("10.0.0.1")
    expect(cfg.dataDir).toBe("/tmp/overridden")
  })
})

describe("resolveOpencodeBin", () => {
  test("honours OPENHOUSE_OPENCODE_BIN", () => {
    const dir = makeTempDir("oh-bin-")
    try {
      const bin = join(dir, "my-opencode")
      writeFileSync(bin, "#!/bin/sh\n")
      process.env.OPENHOUSE_OPENCODE_BIN = bin
      expect(resolveOpencodeBin()).toBe(bin)
    } finally {
      removeTempDir(dir)
    }
  })
})
