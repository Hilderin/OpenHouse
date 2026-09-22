import { randomUUID } from "node:crypto"
import { Cron } from "croner"
import { ohPaths } from "../core/paths"
import { JsonStore, withFileLock } from "../core/store"
import type { GetServices, SchedulerService as IScheduler } from "../server/contracts"
import type { Schedule } from "../shared/types"

interface ScheduleFile {
  schedules: Schedule[]
}

/** Validates a cron expression with croner and computes the next run (ms). Throws on invalid patterns. */
export function computeNextRun(cron: string, from?: Date): number | undefined {
  let job: Cron
  try {
    job = new Cron(cron)
  } catch (err) {
    throw new Error(`invalid cron expression "${cron}": ${err instanceof Error ? err.message : err}`)
  }
  try {
    const next = from ? job.nextRun(new Date(from.getTime() + 1000)) : job.nextRun()
    return next ? next.getTime() : undefined
  } catch (err) {
    throw new Error(`invalid cron expression "${cron}": ${err instanceof Error ? err.message : err}`)
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * In-daemon cron scheduler backed by `schedules.json`.
 * Cross-process claiming is done with `withFileLock` so an Electron app and a
 * headless daemon never double-run the same schedule.
 */
export class SchedulerService implements IScheduler {
  private store = new JsonStore<ScheduleFile>(ohPaths().schedules, () => ({ schedules: [] }))
  private timer?: NodeJS.Timeout
  private initial?: NodeJS.Timeout
  private stopped = true

  constructor(private deps: GetServices) {}

  async list(projectId?: string): Promise<Schedule[]> {
    const all = this.store.read().schedules
    return projectId ? all.filter((s) => s.projectId === projectId) : all
  }

  async create(input: {
    projectId: string
    name: string
    cron: string
    enabled?: boolean
    prompt: string
    model?: Schedule["model"]
    agent?: string
    goal?: Schedule["goal"]
  }): Promise<Schedule> {
    if (!input?.projectId || typeof input.projectId !== "string") throw new Error("projectId is required")
    if (!this.deps().projects.get(input.projectId)) throw new Error(`project not found: ${input.projectId}`)
    if (!input?.cron || typeof input.cron !== "string") throw new Error("cron is required")
    if (!input?.prompt || typeof input.prompt !== "string") throw new Error("prompt is required")
    const nextRun = computeNextRun(input.cron)

    const schedule: Schedule = {
      id: `sch_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      projectId: input.projectId,
      name: (input.name || "schedule").trim(),
      cron: input.cron,
      enabled: input.enabled !== false,
      prompt: input.prompt,
      model: input.model,
      agent: input.agent,
      goal: input.goal,
      nextRun,
      createdAt: Date.now(),
    }
    const file = this.store.read()
    file.schedules.push(schedule)
    this.store.write(file)
    return schedule
  }

  async update(id: string, patch: Partial<Schedule>): Promise<Schedule> {
    const file = this.store.read()
    const idx = file.schedules.findIndex((s) => s.id === id)
    if (idx === -1) throw new Error("schedule not found")
    const current = file.schedules[idx]
    const cron = patch.cron ?? current.cron
    const nextRun = patch.cron ? computeNextRun(cron) : current.nextRun
    file.schedules[idx] = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.cron !== undefined ? { cron: patch.cron } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.agent !== undefined ? { agent: patch.agent } : {}),
      ...(patch.goal !== undefined ? { goal: patch.goal } : {}),
      nextRun,
    }
    const updated = file.schedules[idx]
    if (patch.enabled === true && (!updated.nextRun || updated.nextRun <= Date.now())) {
      updated.nextRun = computeNextRun(updated.cron)
    }
    this.store.write(file)
    return updated
  }

  async remove(id: string): Promise<void> {
    const file = this.store.read()
    file.schedules = file.schedules.filter((s) => s.id !== id)
    this.store.write(file)
  }

  async toggle(id: string): Promise<Schedule> {
    const file = this.store.read()
    const idx = file.schedules.findIndex((s) => s.id === id)
    if (idx === -1) throw new Error("schedule not found")
    const schedule = file.schedules[idx]
    schedule.enabled = !schedule.enabled
    if (schedule.enabled && (!schedule.nextRun || schedule.nextRun <= Date.now())) {
      schedule.nextRun = computeNextRun(schedule.cron)
    }
    this.store.write(file)
    return schedule
  }

  async run(id: string): Promise<{ sessionId: string }> {
    return withFileLock(ohPaths().schedules, async () => {
      const schedule = this.store.read().schedules.find((s) => s.id === id)
      if (!schedule) throw new Error("schedule not found")
      return this.execute(schedule)
    })
  }

  private async execute(schedule: Schedule): Promise<{ sessionId: string }> {
    let sessionId: string | undefined
    try {
      const session = await this.deps().sessions.create({
        projectId: schedule.projectId,
        title: `⏰ ${schedule.name}`,
        agent: schedule.agent,
        model: schedule.model,
      })
      sessionId = session.id
      this.patchRecord(schedule.id, {
        lastRun: Date.now(),
        lastSessionId: sessionId,
        lastError: undefined,
      })
      this.emit(schedule, "started", sessionId)

      await this.deps().sessions.prompt(sessionId, { text: schedule.prompt })
      if (schedule.goal) await this.deps().goals.set(sessionId, schedule.goal)

      this.patchRecord(schedule.id, {
        lastStatus: "ok",
        lastError: undefined,
        nextRun: computeNextRun(schedule.cron, new Date()),
      })
      this.emit(schedule, "ok", sessionId)
      return { sessionId }
    } catch (err) {
      const message = errorMessage(err)
      this.patchRecord(schedule.id, {
        lastStatus: "error",
        lastError: message,
        nextRun: computeNextRun(schedule.cron, new Date()),
      })
      this.emit(schedule, "error", sessionId, message)
      throw err
    }
  }

  private patchRecord(id: string, patch: Partial<Schedule>): void {
    const file = this.store.read()
    const idx = file.schedules.findIndex((s) => s.id === id)
    if (idx === -1) return
    file.schedules[idx] = { ...file.schedules[idx], ...patch }
    this.store.write(file)
  }

  private emit(
    schedule: Schedule,
    status: "started" | "ok" | "error",
    sessionId?: string,
    error?: string,
  ): void {
    this.deps().bus.emit({
      type: "schedule.run",
      projectId: schedule.projectId,
      sessionId,
      data: { scheduleId: schedule.id, projectId: schedule.projectId, sessionId, status, error },
    })
  }

  start(): void {
    if (this.timer) return
    this.stopped = false
    this.timer = setInterval(() => {
      void this.tick().catch((err) => this.deps().logger.warn(`scheduler tick failed: ${errorMessage(err)}`))
    }, 30_000)
    this.timer.unref?.()
    this.initial = setTimeout(() => {
      void this.tick().catch((err) => this.deps().logger.warn(`scheduler init failed: ${errorMessage(err)}`))
    }, 1000)
    this.initial.unref?.()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    if (this.initial) clearTimeout(this.initial)
    this.timer = undefined
    this.initial = undefined
  }

  private async tick(): Promise<void> {
    if (this.stopped) return
    const now = Date.now()
    const schedules = this.store.read().schedules
    for (const schedule of schedules) {
      if (!schedule.enabled) continue
      if (schedule.nextRun === undefined) {
        this.patchRecord(schedule.id, { nextRun: computeNextRun(schedule.cron) })
        continue
      }
      if (schedule.nextRun > now) continue
      await this.runDue(schedule.id)
    }
  }

  private async runDue(id: string): Promise<void> {
    try {
      await withFileLock(ohPaths().schedules, async () => {
        const schedule = this.store.read().schedules.find((s) => s.id === id)
        if (!schedule || !schedule.enabled) return
        if (schedule.nextRun !== undefined && schedule.nextRun > Date.now()) return
        await this.execute(schedule)
      })
    } catch (err) {
      this.deps().logger.warn(`schedule ${id} run failed: ${errorMessage(err)}`)
    }
  }
}
