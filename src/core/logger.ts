import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

type Level = "debug" | "info" | "warn" | "error"

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface Logger {
  debug(msg: string, meta?: unknown): void
  info(msg: string, meta?: unknown): void
  warn(msg: string, meta?: unknown): void
  error(msg: string, meta?: unknown): void
  child(prefix: string): Logger
}

export function createLogger(opts: { level?: Level; file?: string; prefix?: string } = {}): Logger {
  const min = ORDER[opts.level ?? "info"] ?? 20
  const prefix = opts.prefix ? `[${opts.prefix}] ` : ""
  if (opts.file) {
    try {
      mkdirSync(dirname(opts.file), { recursive: true })
    } catch {
      /* ignore */
    }
  }
  const write = (level: Level, msg: string, meta?: unknown) => {
    if (ORDER[level] < min) return
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${prefix}${msg}${
      meta === undefined ? "" : " " + safeMeta(meta)
    }`
    if (level === "error") console.error(line)
    else if (level === "warn") console.warn(line)
    else console.log(line)
    if (opts.file) {
      try {
        appendFileSync(opts.file, line + "\n")
      } catch {
        /* ignore */
      }
    }
  }
  return {
    debug: (m, x) => write("debug", m, x),
    info: (m, x) => write("info", m, x),
    warn: (m, x) => write("warn", m, x),
    error: (m, x) => write("error", m, x),
    child: (p) => createLogger({ ...opts, prefix: opts.prefix ? `${opts.prefix}:${p}` : p }),
  }
}

function safeMeta(meta: unknown): string {
  if (meta instanceof Error) return meta.stack || meta.message
  try {
    return JSON.stringify(meta)
  } catch {
    return String(meta)
  }
}
