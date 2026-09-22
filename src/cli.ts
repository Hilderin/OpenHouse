#!/usr/bin/env bun
import { loadConfig } from "./core/config"
import { startCore } from "./server/start"

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith("--")) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith("--")) {
      out[key] = next
      i++
    } else {
      out[key] = true
    }
  }
  return out
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const cmd = argv[0] && !argv[0].startsWith("--") ? argv[0] : "serve"
  const flags = parseArgs(argv)

  if (cmd === "serve") {
    const cfg = loadConfig({
      port: flags.port ? Number(flags.port) : undefined,
      host: typeof flags.host === "string" ? flags.host : undefined,
      uiDist: typeof flags["ui-dist"] === "string" ? flags["ui-dist"] : undefined,
      logLevel: typeof flags["log-level"] === "string" ? (flags["log-level"] as never) : undefined,
    })
    const core = await startCore(cfg)
    console.log(`OpenHouse running at ${core.url}`)
    const shutdown = async () => {
      await core.stop()
      process.exit(0)
    }
    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)
    return
  }

  if (cmd === "status") {
    const cfg = loadConfig()
    try {
      const res = await fetch(`http://127.0.0.1:${cfg.port}/api/oh/health`)
      console.log(JSON.stringify(await res.json(), null, 2))
    } catch (e) {
      console.error(`OpenHouse is not reachable on port ${cfg.port}: ${e instanceof Error ? e.message : e}`)
      process.exitCode = 1
    }
    return
  }

  console.log("Usage: openhouse [serve|status] [--port 7800] [--host 127.0.0.1] [--ui-dist path]")
}

void main()
