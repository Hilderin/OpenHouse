import { dataDir, ohPaths, OPENCODE_PIN, resolveOpencodeBin } from "./paths"
import { createLogger, type Logger } from "./logger"

export interface Config {
  host: string
  port: number
  dataDir: string
  opencodePin: string
  opencodeBin?: string
  logLevel: "debug" | "info" | "warn" | "error"
  uiDist?: string
  /** Goal loop quiet window after an execution succeeds before auditing. */
  goalQuietMs: number
  goalDefaultBudgetTokens?: number
  goalDefaultMaxTurns: number
  /** Extra env forwarded to the managed opencode process (after sanitization). */
  opencodeEnv: Record<string, string>
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  if (overrides.dataDir && overrides.dataDir !== process.env.OPENHOUSE_DATA_DIR) {
    process.env.OPENHOUSE_DATA_DIR = overrides.dataDir
  }
  const host = overrides.host ?? process.env.OPENHOUSE_HOST ?? "127.0.0.1"
  const port = overrides.port ?? Number(process.env.OPENHOUSE_PORT ?? 7800)
  const logLevel = (overrides.logLevel ?? (process.env.OPENHOUSE_LOG_LEVEL as Config["logLevel"]) ?? "info") as Config["logLevel"]
  return {
    host,
    port,
    dataDir: overrides.dataDir ?? dataDir(),
    opencodePin: overrides.opencodePin ?? OPENCODE_PIN,
    opencodeBin: overrides.opencodeBin ?? resolveOpencodeBin(),
    logLevel,
    uiDist: overrides.uiDist,
    goalQuietMs: overrides.goalQuietMs ?? Number(process.env.OPENHOUSE_GOAL_QUIET_MS ?? 8000),
    goalDefaultBudgetTokens: overrides.goalDefaultBudgetTokens,
    goalDefaultMaxTurns: overrides.goalDefaultMaxTurns ?? 20,
    opencodeEnv: overrides.opencodeEnv ?? {},
    ...{},
  } satisfies Config & { dataDir: string }
}

export function createConfigLogger(cfg: Config): Logger {
  const p = ohPaths()
  return createLogger({ level: cfg.logLevel, file: p.logFile })
}
