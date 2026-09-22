import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

export const OPENCODE_PIN = process.env.OPENHOUSE_OPENCODE_PIN || "2.0.11"

export function dataDir(): string {
  return resolve(process.env.OPENHOUSE_DATA_DIR || join(homedir(), ".config", "openhouse"))
}

export function ohPaths() {
  const root = dataDir()
  return {
    root,
    projects: join(root, "projects.json"),
    schedules: join(root, "schedules.json"),
    sessionsMeta: join(root, "sessions-meta.json"),
    goalsDir: join(root, "goals"),
    audit: join(root, "autoaccept-audit.jsonl"),
    daemon: join(root, "daemon.json"),
    binDir: join(root, "bin"),
    managedConfig: join(root, "opencode.managed.json"),
    logFile: join(root, "openhouse.log"),
  }
}

export function repoRoot(): string {
  const env = process.env.OPENHOUSE_REPO_ROOT
  if (env) return resolve(env)
  const candidates = [
    resolve(process.cwd()),
    resolve(process.cwd(), ".."),
    resolve(process.cwd(), "..", ".."),
  ]
  for (const c of candidates) {
    if (existsSync(join(c, "package.json")) && existsSync(join(c, "docs", "analyse-mvp1.md"))) return c
  }
  return process.cwd()
}

function firstFile(candidates: (string | undefined)[]): string | undefined {
  for (const c of candidates) {
    if (!c) continue
    try {
      if (existsSync(c) && statSync(c).isFile()) return c
    } catch {
      /* ignore */
    }
  }
  return undefined
}

export function resolveOpencodeBin(): string | undefined {
  const p = ohPaths()
  const platformArch = `${process.platform}-${process.arch}`
  return firstFile([
    process.env.OPENHOUSE_OPENCODE_BIN,
    join(p.binDir, `opencode-${OPENCODE_PIN}-${platformArch}`),
    join(p.binDir, `opencode-${OPENCODE_PIN}`),
    join(p.binDir, "opencode"),
    join(repoRoot(), "resources", `opencode-${platformArch}`),
  ])
}

export function resolveUiDist(): string | undefined {
  const dir = join(repoRoot(), "ui", "dist")
  return existsSync(join(dir, "index.html")) ? dir : undefined
}
