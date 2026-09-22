import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import type { EventBus } from "../core/events"
import type { Logger } from "../core/logger"
import { OpencodeClient } from "./client"

export type OpencodeStatus = "stopped" | "starting" | "ready" | "error"

export interface OpencodeManagerOptions {
  bin?: string
  pin: string
  host: string
  logger: Logger
  bus: EventBus
  extraEnv?: Record<string, string>
  warmupDirs?: () => string[]
}

const CATALOG_ENV_PREFIX = /^(OPENCODE|OPENCHAMBER)/

/** Removes inherited OpenChamber/OpenCode environment so the managed server is fully ours. */
export function sanitizeOpencodeEnv(base: NodeJS.ProcessEnv, password: string, extra: Record<string, string> = {}) {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue
    if (CATALOG_ENV_PREFIX.test(k)) continue
    env[k] = v
  }
  env.OPENCODE_SERVER_PASSWORD = password
  for (const [k, v] of Object.entries(extra)) env[k] = v
  return env
}

export class OpencodeManager {
  status: OpencodeStatus = "stopped"
  version?: string
  url?: string
  error?: string
  readonly client: OpencodeClient

  private proc?: ChildProcess
  private password: string = randomBytes(24).toString("base64url")
  private healthTimer?: NodeJS.Timeout
  private restarts = 0
  private failures = 0
  private stopping = false
  private log: Logger

  constructor(private opts: OpencodeManagerOptions) {
    this.log = opts.logger
    this.client = new OpencodeClient({ baseUrl: "http://127.0.0.1:0", password: this.password }, opts.logger.child("opencode"))
  }

  get passwordValue(): string {
    return this.password
  }

  setExtraEnv(env: Record<string, string>): void {
    this.opts.extraEnv = { ...(this.opts.extraEnv ?? {}), ...env }
  }

  async start(): Promise<void> {
    if (this.status === "ready" || this.status === "starting") return
    if (!this.opts.bin) {
      this.setStatus("error", `opencode ${this.opts.pin} binary not found. Set OPENHOUSE_OPENCODE_BIN or place it at ~/.config/openhouse/bin/opencode-${this.opts.pin}`)
      throw new Error(this.error)
    }
    this.stopping = false
    this.password = randomBytes(24).toString("base64url")
    this.client.setConnection({ baseUrl: "http://127.0.0.1:0", password: this.password })
    this.setStatus("starting")
    const env = sanitizeOpencodeEnv(process.env, this.password, this.opts.extraEnv)
    const proc = spawn(this.opts.bin, ["serve", "--hostname", this.opts.host, "--port", "0"], {
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    })
    this.proc = proc
    this.log.info(`spawned opencode (pid ${proc.pid})`)

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("opencode did not report a listening URL within 30s")), 30_000)
      let buf = ""
      proc.stdout?.on("data", (chunk: Buffer) => {
        buf += chunk.toString()
        let nl: number
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          this.log.debug(`stdout: ${line}`)
          const urlMatch = line.match(/server listening on (https?:\/\/\S+)/)
          if (urlMatch) {
            this.url = urlMatch[1].replace(/\/$/, "")
            this.client.setConnection({ baseUrl: this.url, password: this.password })
            clearTimeout(timer)
            resolve()
          }
          const pwMatch = line.match(/server password (\S+)/)
          if (pwMatch && !this.extraEnvHasPassword()) this.password = pwMatch[1]
        }
      })
      proc.stderr?.on("data", (chunk: Buffer) => this.log.debug(`stderr: ${chunk.toString().trim()}`))
      proc.once("exit", (code, signal) => {
        this.log.warn(`opencode exited code=${code} signal=${signal}`)
        this.proc = undefined
        if (this.healthTimer) clearInterval(this.healthTimer)
        if (!this.stopping) {
          this.setStatus("error", `opencode exited (code ${code ?? signal})`)
          void this.maybeRestart()
        } else {
          this.setStatus("stopped")
        }
      })
      proc.once("error", (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })

    try {
      await ready
    } catch (err) {
      this.setStatus("error", err instanceof Error ? err.message : String(err))
      await this.stopProcess()
      throw err
    }

    try {
      const info = await this.client.info()
      this.version = info.version
    } catch (err) {
      this.log.warn(`cannot read /api/info: ${err instanceof Error ? err.message : err}`)
    }
    this.failures = 0
    this.restarts = 0
    this.setStatus("ready")
    this.startHealthLoop()
    void this.warmup()
  }

  private extraEnvHasPassword(): boolean {
    return Boolean(this.opts.extraEnv?.OPENCODE_SERVER_PASSWORD)
  }

  private startHealthLoop(): void {
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.healthTimer = setInterval(() => {
      void this.client
        .info()
        .then(() => {
          this.failures = 0
          if (this.status !== "ready") this.setStatus("ready")
        })
        .catch((err) => {
          this.failures++
          this.log.warn(`health check failed (${this.failures}): ${err instanceof Error ? err.message : err}`)
          if (this.failures >= 3) {
            this.setStatus("error", "opencode unresponsive")
            void this.maybeRestart()
          }
        })
    }, 15_000)
    this.healthTimer.unref?.()
  }

  private async warmup(): Promise<void> {
    const dirs = this.opts.warmupDirs?.() ?? []
    for (const dir of dirs) {
      try {
        await this.client.location(dir)
      } catch {
        /* best effort */
      }
    }
    if (dirs.length) this.log.debug(`warmed up ${dirs.length} project directories`)
  }

  private async maybeRestart(): Promise<void> {
    if (this.stopping) return
    if (this.restarts >= 3) {
      this.log.error("giving up restarting opencode after 3 attempts")
      return
    }
    this.restarts++
    const delay = Math.min(1000 * 2 ** (this.restarts - 1), 10_000)
    this.log.info(`restarting opencode in ${delay}ms (attempt ${this.restarts})`)
    await new Promise((r) => setTimeout(r, delay))
    if (this.stopping || this.status === "ready") return
    try {
      await this.start()
    } catch (err) {
      this.log.error(`restart failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  async restart(): Promise<void> {
    await this.stop()
    this.restarts = 0
    await this.start()
  }

  private setStatus(status: OpencodeStatus, error?: string): void {
    this.status = status
    this.error = error
    this.opts.bus.emit({
      type: "opencode.status",
      data: { status, version: this.version, url: this.url, error },
    })
  }

  private async stopProcess(): Promise<void> {
    const proc = this.proc
    this.proc = undefined
    if (!proc?.pid) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          if (process.platform !== "win32") process.kill(-proc.pid!, "SIGKILL")
          else proc.kill("SIGKILL")
        } catch {
          /* ignore */
        }
        resolve()
      }, 4000)
      proc.once("exit", () => {
        clearTimeout(timer)
        resolve()
      })
      try {
        if (process.platform !== "win32") process.kill(-proc.pid!, "SIGTERM")
        else proc.kill("SIGTERM")
      } catch {
        clearTimeout(timer)
        resolve()
      }
    })
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.healthTimer = undefined
    await this.stopProcess()
    this.setStatus("stopped")
  }
}
