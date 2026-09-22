import { existsSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { ohPaths } from "../core/paths"
import { atomicWrite, ensureDir, JsonStore } from "../core/store"
import type { RawOpencodeEvent } from "../opencode/events"
import type { GetServices, GoalService as IGoal } from "../server/contracts"
import type { Goal, GoalState } from "../shared/types"

type StoredGoal = Goal & { objectiveSent?: boolean }

interface GoalsFile {
  goals: StoredGoal[]
}

const TERMINAL: GoalState[] = ["complete", "blocked", "aborted"]
const CONTINUE_PROMPT = "Continue toward the goal. If fully done, reply exactly GOAL_COMPLETE."

function isTerminal(state: GoalState): boolean {
  return TERMINAL.includes(state)
}

/** Defensive verdict parser: strips code fences and reads the first JSON object. */
export function parseVerdict(text: string | undefined): { verdict: "continue" | "complete" | "blocked"; note: string } | undefined {
  if (!text) return undefined
  let body = text.trim()
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence && fence[1]) body = fence[1].trim()
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>
      const verdict = obj.verdict
      if (verdict === "continue" || verdict === "complete" || verdict === "blocked") {
        return { verdict, note: typeof obj.note === "string" ? obj.note : "" }
      }
    } catch {
      /* fall through to regex */
    }
  }
  const match = body.match(/"verdict"\s*:\s*"(continue|complete|blocked)"/)
  if (match && match[1]) return { verdict: match[1] as "continue" | "complete" | "blocked", note: "" }
  return undefined
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Daemon-side goal loop. Survives the UI closing, works headless.
 * State lives in `${dataDir}/goals.json`; the objective is also mirrored to
 * `${dataDir}/goals/<sessionId>.md`. Termination authority is a small-model audit
 * (`POST /api/session/:id/generate`) with hard stops on budget/turns.
 */
export class GoalService implements IGoal {
  private store = new JsonStore<GoalsFile>(join(ohPaths().root, "goals.json"), () => ({ goals: [] }))
  private auditTimers = new Map<string, NodeJS.Timeout>()
  private delivering = new Set<string>()
  private stopped = true

  constructor(private deps: GetServices) {}

  async set(sessionId: string, input: { objective: string; budgetTokens?: number; maxTurns?: number }): Promise<Goal> {
    if (!sessionId) throw new Error("sessionId is required")
    if (!input?.objective || typeof input.objective !== "string" || !input.objective.trim()) {
      throw new Error("objective is required")
    }
    const session = await this.deps().sessions.get(sessionId).catch(() => undefined)
    if (!session) throw new Error("session not found")

    this.cancelAudit(sessionId)
    const now = Date.now()
    const goal: StoredGoal = {
      sessionId,
      objective: input.objective.trim(),
      budgetTokens: typeof input.budgetTokens === "number" ? input.budgetTokens : undefined,
      maxTurns: typeof input.maxTurns === "number" ? input.maxTurns : undefined,
      turns: 0,
      usedTokens: 0,
      state: "armed",
      lastVerdict: undefined,
      note: undefined,
      updatedAt: now,
      objectiveSent: false,
    }
    const file = this.store.read()
    file.goals = file.goals.filter((g) => g.sessionId !== sessionId)
    file.goals.push(goal)
    this.store.write(file)
    this.writeObjectiveFile(sessionId, goal.objective)
    this.emit(goal)

    void this.kick(sessionId)
    return this.strip(goal)
  }

  get(sessionId: string): Goal | null {
    const goal = this.readGoal(sessionId)
    return goal ? this.strip(goal) : null
  }

  list(): Goal[] {
    return this.store.read().goals.map((g) => this.strip(g))
  }

  async clear(sessionId: string): Promise<void> {
    this.cancelAudit(sessionId)
    this.delivering.delete(sessionId)
    const file = this.store.read()
    file.goals = file.goals.filter((g) => g.sessionId !== sessionId)
    this.store.write(file)
    this.removeObjectiveFile(sessionId)
    this.deps().bus.emit({
      type: "goal.updated",
      projectId: this.projectOf(sessionId),
      sessionId,
      data: { goal: null },
    })
  }

  async pause(sessionId: string): Promise<Goal> {
    const goal = this.readGoal(sessionId)
    if (!goal) throw new Error("goal not found")
    if (isTerminal(goal.state)) return this.strip(goal)
    this.cancelAudit(sessionId)
    this.setState(sessionId, "paused", "paused by user")
    return this.strip(this.readGoal(sessionId)!)
  }

  async resume(sessionId: string): Promise<Goal> {
    const goal = this.readGoal(sessionId)
    if (!goal) throw new Error("goal not found")
    if (isTerminal(goal.state)) return this.strip(goal)
    this.setState(sessionId, "running", "resumed by user")
    if (!goal.objectiveSent) {
      void this.kick(sessionId)
      return this.strip(this.readGoal(sessionId)!)
    }
    try {
      await this.deps().sessions.prompt(sessionId, { text: CONTINUE_PROMPT })
    } catch (err) {
      this.deps().logger.warn(`goal resume prompt failed for ${sessionId}: ${errorMessage(err)}`)
    }
    this.scheduleAudit(sessionId)
    return this.strip(this.readGoal(sessionId)!)
  }

  start(): void {
    this.stopped = false
  }

  stop(): void {
    this.stopped = true
    for (const timer of this.auditTimers.values()) clearTimeout(timer)
    this.auditTimers.clear()
  }

  onOpencodeEvent(event: RawOpencodeEvent): void {
    const data = (event.data ?? {}) as Record<string, unknown>
    const sessionId = typeof data.sessionID === "string" ? data.sessionID : undefined
    if (!sessionId) return
    const goal = this.readGoal(sessionId)
    if (!goal) return
    if (isTerminal(goal.state)) return
    if (goal.state === "paused") return

    switch (event.type) {
      case "session.execution.succeeded": {
        if (!goal.objectiveSent) {
          void this.kick(sessionId)
          return
        }
        this.scheduleAudit(sessionId)
        break
      }
      case "session.execution.interrupted": {
        this.cancelAudit(sessionId)
        this.setState(sessionId, "paused", "interrupted")
        break
      }
      case "session.execution.failed": {
        this.cancelAudit(sessionId)
        this.setState(sessionId, "aborted", "execution failed")
        break
      }
      default:
        break
    }
  }

  // ---------- loop ----------

  private async kick(sessionId: string): Promise<void> {
    const goal = this.readGoal(sessionId)
    if (!goal || this.stopped) return
    if (isTerminal(goal.state) || goal.state === "paused") return
    if (goal.objectiveSent) return
    let busy = false
    try {
      busy = (await this.deps().sessions.status(sessionId)).status === "busy"
    } catch {
      /* assume idle so the objective is delivered */
    }
    if (busy) {
      if (goal.state !== "armed") this.setState(sessionId, "armed")
      return
    }
    await this.deliverObjective(sessionId)
  }

  private async deliverObjective(sessionId: string): Promise<void> {
    if (this.delivering.has(sessionId)) return
    const goal = this.readGoal(sessionId)
    if (!goal || goal.objectiveSent || isTerminal(goal.state)) return
    this.delivering.add(sessionId)
    const claimed = this.mutate(sessionId, (g) => ({
      ...g,
      objectiveSent: true,
      state: "running",
      updatedAt: Date.now(),
    }))
    if (claimed) this.emit(claimed)
    try {
      await this.deps().sessions.prompt(sessionId, { text: goal.objective })
    } catch (err) {
      this.deps().logger.warn(`goal objective prompt failed for ${sessionId}: ${errorMessage(err)}`)
      // Allow a later idle event to retry delivery.
      this.mutate(sessionId, (g) => ({ ...g, objectiveSent: false, updatedAt: Date.now() }))
    } finally {
      this.delivering.delete(sessionId)
    }
  }

  private scheduleAudit(sessionId: string): void {
    this.cancelAudit(sessionId)
    const quiet = Math.max(0, this.deps().config.goalQuietMs ?? 8000)
    const timer = setTimeout(() => {
      this.auditTimers.delete(sessionId)
      void this.audit(sessionId).catch((err) =>
        this.deps().logger.warn(`goal audit failed for ${sessionId}: ${errorMessage(err)}`),
      )
    }, quiet)
    timer.unref?.()
    this.auditTimers.set(sessionId, timer)
  }

  private cancelAudit(sessionId: string): void {
    const timer = this.auditTimers.get(sessionId)
    if (timer) clearTimeout(timer)
    this.auditTimers.delete(sessionId)
  }

  private async audit(sessionId: string): Promise<void> {
    if (this.stopped) return
    const goal = this.readGoal(sessionId)
    if (!goal || isTerminal(goal.state)) return
    if (goal.state === "paused") return

    let used = goal.usedTokens
    try {
      used = (await this.deps().sessions.status(sessionId)).context.used
    } catch {
      /* keep previous accounting */
    }
    const turns = goal.turns + 1
    const budget = goal.budgetTokens ?? this.deps().config.goalDefaultBudgetTokens
    const maxTurns = goal.maxTurns ?? this.deps().config.goalDefaultMaxTurns

    this.mutate(sessionId, (g) => ({ ...g, usedTokens: used, turns, updatedAt: Date.now() }))

    if (budget !== undefined && used >= budget) {
      this.setState(sessionId, "aborted", "budget exceeded")
      return
    }
    if (maxTurns !== undefined && turns >= maxTurns) {
      this.setState(sessionId, "aborted", "max turns reached")
      return
    }

    const verdict = await this.runAuditModel(sessionId, goal.objective)
    const current = this.readGoal(sessionId)
    if (!current || isTerminal(current.state)) return

    this.mutate(sessionId, (g) => ({
      ...g,
      lastVerdict: verdict.verdict,
      note: verdict.note,
      updatedAt: Date.now(),
    }))

    if (verdict.verdict === "complete") {
      this.setState(sessionId, "complete", verdict.note || "goal complete")
      return
    }
    if (verdict.verdict === "blocked") {
      this.setState(sessionId, "blocked", verdict.note || "blocked")
      return
    }

    this.setState(sessionId, "running", verdict.note || "continuing")
    try {
      await this.deps().sessions.prompt(sessionId, { text: CONTINUE_PROMPT })
    } catch (err) {
      this.deps().logger.warn(`goal continue prompt failed for ${sessionId}: ${errorMessage(err)}`)
    }
  }

  private async runAuditModel(
    sessionId: string,
    objective: string,
  ): Promise<{ verdict: "continue" | "complete" | "blocked"; note: string }> {
    const directory = this.deps().sessions.directoryOf(sessionId)
    if (!directory) return { verdict: "continue", note: "audit unavailable (unknown directory)" }
    const prompt = [
      "You are auditing an autonomous goal loop. Based on the session so far, decide whether the objective is achieved.",
      "Objective:",
      objective,
      "",
      'Respond with ONLY a strict JSON object and no prose: {"verdict":"continue"|"complete"|"blocked","note":"short reason"}.',
      "Use complete only when the objective is fully achieved, blocked when human input is required, continue otherwise.",
    ].join("\n")
    try {
      const res = await this.deps().client.sessionGenerate(sessionId, directory, prompt)
      const parsed = parseVerdict(res?.data?.text)
      if (!parsed) return { verdict: "continue", note: "audit verdict unparseable" }
      return parsed
    } catch (err) {
      this.deps().logger.warn(`audit model unavailable for ${sessionId}: ${errorMessage(err)}`)
      return { verdict: "continue", note: "audit unavailable" }
    }
  }

  // ---------- persistence / events ----------

  private readGoal(sessionId: string): StoredGoal | undefined {
    return this.store.read().goals.find((g) => g.sessionId === sessionId)
  }

  private mutate(sessionId: string, fn: (goal: StoredGoal) => StoredGoal): StoredGoal | undefined {
    const file = this.store.read()
    const idx = file.goals.findIndex((g) => g.sessionId === sessionId)
    if (idx === -1) return undefined
    file.goals[idx] = fn(file.goals[idx])
    this.store.write(file)
    return file.goals[idx]
  }

  private setState(sessionId: string, state: GoalState, note?: string): void {
    const updated = this.mutate(sessionId, (g) => ({
      ...g,
      state,
      note: note ?? g.note,
      updatedAt: Date.now(),
    }))
    if (updated) this.emit(updated)
  }

  private emit(goal: StoredGoal): void {
    const projectId = this.projectOf(goal.sessionId)
    const clean = this.strip(goal)
    this.deps().bus.emit({ type: "goal.updated", projectId, sessionId: goal.sessionId, data: { goal: clean } })
    this.deps()
      .sessions.status(goal.sessionId)
      .then((status) => {
        this.deps().bus.emit({
          type: "session.status",
          projectId,
          sessionId: goal.sessionId,
          data: { sessionId: goal.sessionId, status: status.status, reason: `goal:${goal.state}`, goal: clean },
        })
      })
      .catch(() => {
        this.deps().bus.emit({
          type: "session.status",
          projectId,
          sessionId: goal.sessionId,
          data: { sessionId: goal.sessionId, status: "unknown", reason: `goal:${goal.state}`, goal: clean },
        })
      })
  }

  private strip(goal: StoredGoal): Goal {
    const { objectiveSent: _objectiveSent, ...clean } = goal
    return clean
  }

  private projectOf(sessionId: string): string | undefined {
    try {
      return this.deps().sessions.projectOf(sessionId)
    } catch {
      return undefined
    }
  }

  private writeObjectiveFile(sessionId: string, objective: string): void {
    try {
      const dir = ohPaths().goalsDir
      ensureDir(dir)
      atomicWrite(join(dir, `${sessionId}.md`), `# Goal objective\n\n${objective}\n`)
    } catch (err) {
      this.deps().logger.warn(`cannot write goal file: ${errorMessage(err)}`)
    }
  }

  private removeObjectiveFile(sessionId: string): void {
    try {
      const file = join(ohPaths().goalsDir, `${sessionId}.md`)
      if (existsSync(file)) unlinkSync(file)
    } catch {
      /* ignore */
    }
  }
}
