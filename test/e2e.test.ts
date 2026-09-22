import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { loadConfig } from "../src/core/config"
import { startCore, type CoreHandle } from "../src/server/start"
import type { Project, Session, SessionMessage, SessionStatusInfo } from "../src/shared/types"
import { makeTempDir, removeTempDir, waitFor } from "./util"

const RUN = process.env.OPENHOUSE_E2E === "1"
const OPENCODE_BIN =
  process.env.OPENHOUSE_OPENCODE_BIN || "/home/guillaume/.local/share/openhouse/opencode/2.0.11/opencode"
const PROJECT_DIR = "/tmp/opencode/oh-testproj"

describe.skipIf(!RUN)("OpenHouse core e2e", () => {
  let core: CoreHandle | undefined
  let base = ""
  let dataDir = ""
  let sessionId = ""
  let scheduleSessionId = ""

  async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(base + path, init)
    const text = await res.text()
    let body: unknown
    try {
      body = text ? JSON.parse(text) : undefined
    } catch {
      body = text
    }
    if (!res.ok) {
      throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 300)}`)
    }
    return body as T
  }

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

  test(
    "exercises the full core lifecycle against a managed opencode",
    async () => {
      try {
        await runLifecycle()
      } finally {
        await cleanup()
      }
    },
    180_000,
  )

  async function runLifecycle(): Promise<void> {
    {
      expect(existsSync(OPENCODE_BIN)).toBe(true)
      dataDir = makeTempDir("oh-e2e-data-")
      process.env.OPENHOUSE_DATA_DIR = dataDir
      if (!existsSync(PROJECT_DIR)) mkdirSync(PROJECT_DIR, { recursive: true })

      const port = 20000 + Math.floor(Math.random() * 20000)
      const cfg = loadConfig({ host: "127.0.0.1", port, dataDir, opencodeBin: OPENCODE_BIN, logLevel: "warn" })
      core = await startCore(cfg)
      base = core.url

      // health
      const health = await api<{ ok: boolean; opencode: { status: string; version?: string } }>("/api/oh/health")
      expect(health.ok).toBe(true)
      expect(health.opencode.version).toBe("2.0.11")

      // project
      const added = await api<{ project: Project }>("/api/oh/projects", json("POST", { path: PROJECT_DIR }))
      const projectId = added.project.id
      expect(projectId).toBeTruthy()
      expect(added.project.available).toBe(true)

      // catalog (opencode loads providers lazily, so poll until the model list is warm)
      let modelCount = 0
      await waitFor(
        async () => {
          const res = await api<{ models: unknown[] }>(`/api/oh/projects/${projectId}/models`)
          modelCount = res.models.length
          return modelCount >= 1
        },
        { timeoutMs: 30_000, intervalMs: 500, label: "models list" },
      )
      expect(modelCount).toBeGreaterThanOrEqual(1)
      const agents = await api<{ agents: unknown[] }>(`/api/oh/projects/${projectId}/agents`)
      expect(Array.isArray(agents.agents)).toBe(true)

      // session + prompt
      const created = await api<{ session: Session }>(
        "/api/oh/sessions",
        json("POST", { projectId, title: "E2E pong" }),
      )
      sessionId = created.session.id
      expect(sessionId).toBeTruthy()

      await api(`/api/oh/sessions/${sessionId}/prompt`, json("POST", { text: "Reply with the single word: pong" }))

      let status: SessionStatusInfo | undefined
      let messages: SessionMessage[] = []
      await waitFor(
        async () => {
          status = await api<SessionStatusInfo>(`/api/oh/sessions/${sessionId}/status`)
          const page = await api<{ messages: SessionMessage[] }>(
            `/api/oh/sessions/${sessionId}/messages?limit=50&order=asc`,
          )
          messages = page.messages
          const hasAssistant = messages.some((m) => m.type === "assistant")
          return status.status === "idle" && hasAssistant
        },
        { timeoutMs: 90_000, intervalMs: 1000, label: "assistant message + idle" },
      )

      expect(messages.some((m) => m.type === "assistant")).toBe(true)
      expect(status!.context.used).toBeGreaterThan(0)

      // schedules
      const schedule = await api<{ schedule: { id: string } }>(
        "/api/oh/schedules",
        json("POST", { projectId, name: "e2e schedule", cron: "*/5 * * * *", prompt: "Reply with: ok" }),
      )
      const scheduleId = schedule.schedule.id
      const run = await api<{ ok: boolean; sessionId: string }>(
        `/api/oh/schedules/${scheduleId}/run`,
        json("POST", {}),
      )
      expect(run.ok).toBe(true)
      scheduleSessionId = run.sessionId
      await api(`/api/oh/schedules/${scheduleId}`, { method: "DELETE" })
      const list = await api<{ schedules: { id: string }[] }>("/api/oh/schedules")
      expect(list.schedules.some((s) => s.id === scheduleId)).toBe(false)

      // goal
      const goal = await api<{ goal: { objective: string } }>(
        `/api/oh/sessions/${sessionId}/goal`,
        json("PUT", { objective: "Reply DONE", maxTurns: 2 }),
      )
      expect(goal.goal.objective).toBe("Reply DONE")
      const fetched = await api<{ goal: { objective: string } | null }>(`/api/oh/sessions/${sessionId}/goal`)
      expect(fetched.goal?.objective).toBe("Reply DONE")
      await api(`/api/oh/sessions/${sessionId}/goal`, { method: "DELETE" })
      const cleared = await api<{ goal: unknown }>(`/api/oh/sessions/${sessionId}/goal`)
      expect(cleared.goal).toBeNull()

      // control contract
      const control = await api<{ ok: boolean; data: { opencode: { status: string } } }>(
        "/api/oh/control",
        json("POST", { action: "health" }),
      )
      expect(control.ok).toBe(true)
      expect(control.data.opencode.status).toBe("ready")
    }
  }

  async function cleanup(): Promise<void> {
    for (const id of [sessionId, scheduleSessionId]) {
      if (!id) continue
      try {
        await api(`/api/oh/sessions/${id}`, { method: "DELETE" })
      } catch {
        /* best effort */
      }
    }
    delete process.env.OPENHOUSE_DATA_DIR
    try {
      await core?.stop()
    } catch {
      /* best effort */
    } finally {
      core = undefined
      base = ""
      sessionId = ""
      scheduleSessionId = ""
      if (dataDir) removeTempDir(dataDir)
      dataDir = ""
    }
  }
})
