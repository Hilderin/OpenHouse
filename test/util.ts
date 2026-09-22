import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Logger } from "../src/core/logger"

/** Creates a unique temporary directory suitable for an isolated OPENHOUSE_DATA_DIR. */
export function makeTempDir(prefix = "oh-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Polls `fn` until it returns a truthy value or the timeout elapses. */
export async function waitFor<T>(
  fn: () => T | Promise<T>,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 5000
  const intervalMs = opts.intervalMs ?? 50
  const start = Date.now()
  let lastError: unknown
  let lastValue: T | undefined
  for (;;) {
    try {
      const value = await fn()
      lastValue = value
      if (value) return value
    } catch (err) {
      lastError = err
    }
    if (Date.now() - start > timeoutMs) {
      const detail = lastError instanceof Error ? `: ${lastError.message}` : ""
      throw new Error(`waitFor timeout (${opts.label ?? "condition"}, last=${String(lastValue)})${detail}`)
    }
    await delay(intervalMs)
  }
}

/** Minimal no-op logger for service fakes. */
export function noopLogger(): Logger {
  const logger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child() {
      return logger
    },
  }
  return logger
}
