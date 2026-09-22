import type { ModelRef } from "../opencode/client"
import type { ControlService as IControl, GetServices } from "../server/contracts"

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

/**
 * Typed action contract shared by `POST /api/oh/control` and the injected
 * `openhouse` agent tool. Every action delegates to an existing service.
 */
export class ControlService implements IControl {
  constructor(private deps: GetServices) {}

  async execute(action: string, params: Record<string, unknown>): Promise<unknown> {
    const d = this.deps()
    const p = params ?? {}
    switch (action) {
      case "health": {
        const opencode = d.opencode
        return {
          ok: opencode.status === "ready",
          version: "0.1.0",
          uptimeMs: Date.now() - d.startedAt,
          dataDir: d.config.dataDir,
          opencodePin: d.config.opencodePin,
          opencode: {
            status: opencode.status,
            version: opencode.version,
            url: opencode.url,
            error: opencode.error,
          },
        }
      }

      case "projects.list":
        return { projects: await d.projects.list() }
      case "projects.add":
        return {
          project: await d.projects.add({
            path: str(p.path) ?? "",
            name: str(p.name),
          }),
        }
      case "projects.remove": {
        const id = str(p.projectId) ?? str(p.id)
        if (!id) throw new Error("projectId is required")
        await d.projects.remove(id)
        return { ok: true }
      }

      case "sessions.list": {
        const projectId = str(p.projectId) ?? str(p.project)
        if (!projectId) throw new Error("projectId is required")
        return d.sessions.list(projectId, {
          limit: num(p.limit),
          cursor: str(p.cursor),
          includeArchived: bool(p.includeArchived),
          parentID: str(p.parentID),
        })
      }
      case "sessions.create": {
        const projectId = str(p.projectId)
        if (!projectId) throw new Error("projectId is required")
        return {
          session: await d.sessions.create({
            projectId,
            title: str(p.title),
            agent: str(p.agent),
            model: p.model as ModelRef | undefined,
            level: str(p.level),
          }),
        }
      }
      case "sessions.send": {
        const sessionId = str(p.sessionId) ?? str(p.id)
        if (!sessionId) throw new Error("sessionId is required")
        return { message: await d.sessions.prompt(sessionId, { text: str(p.text) ?? str(p.prompt) ?? "" }) }
      }
      case "sessions.messages": {
        const sessionId = str(p.sessionId) ?? str(p.id)
        if (!sessionId) throw new Error("sessionId is required")
        return d.sessions.messages(sessionId, {
          limit: num(p.limit),
          cursor: str(p.cursor),
          order: p.order === "desc" ? "desc" : "asc",
          type: str(p.type),
        })
      }
      case "sessions.status": {
        const sessionId = str(p.sessionId) ?? str(p.id)
        if (!sessionId) throw new Error("sessionId is required")
        return d.sessions.status(sessionId)
      }
      case "sessions.interrupt": {
        const sessionId = str(p.sessionId) ?? str(p.id)
        if (!sessionId) throw new Error("sessionId is required")
        await d.sessions.interrupt(sessionId)
        return { ok: true }
      }
      case "sessions.delete": {
        const sessionId = str(p.sessionId) ?? str(p.id)
        if (!sessionId) throw new Error("sessionId is required")
        await d.sessions.remove(sessionId)
        return { ok: true }
      }

      case "models.list": {
        const projectId = str(p.projectId)
        if (!projectId) throw new Error("projectId is required")
        return d.sessions.models(projectId)
      }
      case "agents.list": {
        const projectId = str(p.projectId)
        if (!projectId) throw new Error("projectId is required")
        return { agents: await d.sessions.agents(projectId) }
      }
      case "skills.list": {
        const projectId = str(p.projectId)
        if (!projectId) throw new Error("projectId is required")
        return { skills: await d.sessions.skills(projectId) }
      }

      case "schedules.list":
        return { schedules: await d.scheduler.list(str(p.projectId)) }
      case "schedules.create": {
        const projectId = str(p.projectId)
        const cron = str(p.cron)
        const prompt = str(p.prompt)
        if (!projectId) throw new Error("projectId is required")
        if (!cron) throw new Error("cron is required")
        if (prompt === undefined) throw new Error("prompt is required")
        return {
          schedule: await d.scheduler.create({
            projectId,
            name: str(p.name) ?? "schedule",
            cron,
            enabled: bool(p.enabled),
            prompt,
            model: p.model as ModelRef | undefined,
            agent: str(p.agent),
            goal: p.goal as { objective: string; budgetTokens?: number; maxTurns?: number } | undefined,
          }),
        }
      }
      case "schedules.run": {
        const id = str(p.id) ?? str(p.scheduleId)
        if (!id) throw new Error("id is required")
        const { sessionId } = await d.scheduler.run(id)
        return { ok: true, sessionId }
      }
      case "schedules.delete": {
        const id = str(p.id) ?? str(p.scheduleId)
        if (!id) throw new Error("id is required")
        await d.scheduler.remove(id)
        return { ok: true }
      }
      case "schedules.toggle": {
        const id = str(p.id) ?? str(p.scheduleId)
        if (!id) throw new Error("id is required")
        return { schedule: await d.scheduler.toggle(id) }
      }

      case "goal.set": {
        const sessionId = str(p.sessionId) ?? str(p.id)
        if (!sessionId) throw new Error("sessionId is required")
        return {
          goal: await d.goals.set(sessionId, {
            objective: str(p.objective) ?? "",
            budgetTokens: num(p.budgetTokens),
            maxTurns: num(p.maxTurns),
          }),
        }
      }
      case "goal.status": {
        const sessionId = str(p.sessionId) ?? str(p.id)
        if (!sessionId) throw new Error("sessionId is required")
        return { goal: d.goals.get(sessionId) }
      }
      case "goal.pause": {
        const sessionId = str(p.sessionId) ?? str(p.id)
        if (!sessionId) throw new Error("sessionId is required")
        return { goal: await d.goals.pause(sessionId) }
      }
      case "goal.resume": {
        const sessionId = str(p.sessionId) ?? str(p.id)
        if (!sessionId) throw new Error("sessionId is required")
        return { goal: await d.goals.resume(sessionId) }
      }
      case "goal.clear": {
        const sessionId = str(p.sessionId) ?? str(p.id)
        if (!sessionId) throw new Error("sessionId is required")
        await d.goals.clear(sessionId)
        return { ok: true }
      }

      case "mcp.list": {
        const projectId = str(p.projectId)
        if (!projectId) throw new Error("projectId is required")
        return { servers: await d.sessions.mcp(projectId) }
      }
      case "mcp.enable": {
        const projectId = str(p.projectId)
        const name = str(p.name)
        if (!projectId || !name) throw new Error("projectId and name are required")
        return { servers: await d.sessions.mcpSet(projectId, name, true) }
      }
      case "mcp.disable": {
        const projectId = str(p.projectId)
        const name = str(p.name)
        if (!projectId || !name) throw new Error("projectId and name are required")
        return { servers: await d.sessions.mcpSet(projectId, name, false) }
      }

      default:
        throw new Error(`unknown action: ${action}`)
    }
  }
}
