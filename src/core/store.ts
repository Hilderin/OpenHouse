import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

export function atomicWrite(file: string, content: string): void {
  ensureDir(dirname(file))
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, content)
  renameSync(tmp, file)
}

/** JSON file store with atomic writes. Reads are safe against missing/corrupt files. */
export class JsonStore<T> {
  constructor(
    private file: string,
    private fallback: () => T,
  ) {}

  read(): T {
    try {
      if (!existsSync(this.file)) return this.fallback()
      const raw = readFileSync(this.file, "utf8").trim()
      if (!raw) return this.fallback()
      return JSON.parse(raw) as T
    } catch {
      return this.fallback()
    }
  }

  write(value: T): T {
    atomicWrite(this.file, JSON.stringify(value, null, 2))
    return value
  }

  update(fn: (current: T) => T): T {
    return this.write(fn(this.read()))
  }
}

/**
 * Cross-process advisory lock using an exclusive lock file. Used by the scheduler
 * so the Electron app and a headless daemon cannot double-run a schedule.
 */
export async function withFileLock<T>(
  file: string,
  fn: () => T | Promise<T>,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 5000
  const pollMs = opts.pollMs ?? 50
  const lock = `${file}.lock`
  ensureDir(dirname(lock))
  const start = Date.now()
  for (;;) {
    try {
      closeSync(openSync(lock, "wx"))
      break
    } catch {
      if (Date.now() - start > timeoutMs) {
        try {
          if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 30_000) unlinkSync(lock)
        } catch {
          /* ignore */
        }
        if (Date.now() - start > timeoutMs * 2) throw new Error(`lock timeout: ${lock}`)
      }
      await new Promise((r) => setTimeout(r, pollMs))
    }
  }
  try {
    return await fn()
  } finally {
    try {
      unlinkSync(lock)
    } catch {
      /* ignore */
    }
  }
}
