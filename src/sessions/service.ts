import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { ohPaths } from "../core/paths"
import { JsonStore, atomicWrite } from "../core/store"
import { levelByName } from "../core/levels"
import type { OpenCodeModel, OcMessage, OcSession, ModelRef } from "../opencode/client"
import type { RawOpencodeEvent } from "../opencode/events"
import type { GetServices, SessionsService as ISessionsService } from "../server/contracts"
import type {
  McpServer,
  Session,
  SessionMessage,
  SessionStatus,
  SessionStatusInfo,
  TokenUsage,
} from "../shared/types"

interface MetaEntry {
  title?: string
  pinned?: boolean
  archived?: boolean
}
type MetaFile = Record<string, MetaEntry>

interface SessionIndexEntry {
  projectId: string
  directory: string
  title?: string
  model?: ModelRef
}

const DEFAULT_CONTEXT_LIMIT = 200_000
const MODELS_TTL = 60_000

export function computeUsed(tokens: TokenUsage | undefined): number {
  if (!tokens) return 0
  const cache = tokens.cache ?? {}
  return tokens.total ?? (tokens.input ?? 0) + (cache.read ?? 0) + (cache.write ?? 0)
}

function extractText(m: OcMessage): string {
  if (typeof m.text === "string" && m.text) return m.text
  const parts = m.content
  if (Array.isArray(parts)) {
    return parts
      .filter((p) => p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("")
  }
  return ""
}

export class SessionsService implements ISessionsService {
  private meta = new JsonStore<MetaFile>(ohPaths().sessionsMeta, () => ({}))
  private index = new Map<string, SessionIndexEntry>()
  private modelsCache = new Map<string, { models: OpenCodeModel[]; at: number }>()
  private statusMap = new Map<string, SessionStatus>()
  private usageMap = new Map<string, { tokens?: TokenUsage; cost?: number; at: number }>()
  private compactedAt = new Map<string, number>()

  constructor(private deps: GetServices) {}

  // ---------- mapping ----------
  private mapSession(s: OcSession, directory?: string): Session {
    const dir = s.location?.directory ?? directory ?? ""
    const projectId = this.deps().projectIdForDirectory(dir) ?? ""
    const meta = this.meta.read()[s.id] ?? {}
    return {
      id: s.id,
      projectId,
      directory: dir,
      title: meta.title ?? s.title ?? "(untitled)",
      agent: s.agent,
      model: s.model,
      parentID: s.parentID,
      tokens: s.tokens ?? {},
      cost: s.cost ?? 0,
      time: s.time ?? {},
      status: this.statusMap.get(s.id) ?? "idle",
      archived: meta.archived ?? false,
      pinned: meta.pinned ?? false,
    }
  }

  private mapMessage(m: OcMessage): SessionMessage {
    return {
      id: m.id,
      type: m.type,
      time: m.time,
      text: extractText(m),
      parts: (m.content as SessionMessage["parts"]) ?? [],
      tokens: m.tokens,
      cost: m.cost,
      agent: m.agent,
      model: m.model,
      outcome: m.outcome,
      raw: m,
    }
  }

  private indexSession(s: OcSession, directory?: string): void {
    const dir = s.location?.directory ?? directory
    if (!dir) return
    this.index.set(s.id, {
      projectId: this.deps().projectIdForDirectory(dir) ?? "",
      directory: dir,
      title: s.title,
      model: s.model,
    })
  }

  // ---------- catalog ----------
  private async ensureModels(projectId: string): Promise<OpenCodeModel[]> {
    const cache = this.modelsCache.get(projectId)
    if (cache && Date.now() - cache.at < MODELS_TTL) return cache.models
    const dir = this.deps().projects.directoryFor(projectId)
    if (!dir) return []
    try {
      const res = await this.deps().client.models(dir)
      this.modelsCache.set(projectId, { models: res.data, at: Date.now() })
      return res.data
    } catch (err) {
      this.deps().logger.warn(`model list failed for ${dir}: ${err instanceof Error ? err.message : err}`)
      return cache?.models ?? []
    }
  }

  async models(projectId: string) {
    const dir = this.deps().projects.directoryFor(projectId)
    const models = await this.ensureModels(projectId)
    let def: ModelRef | undefined
    if (dir) {
      try {
        def = (await this.deps().client.modelDefault(dir)).data
      } catch {
        /* ignore */
      }
    }
    return { models, default: def }
  }

  async agents(projectId: string): Promise<unknown[]> {
    const dir = this.deps().projects.directoryFor(projectId)
    if (!dir) throw new Error("project not found")
    return (await this.deps().client.agents(dir)).data
  }

  async skills(projectId: string): Promise<unknown[]> {
    const dir = this.deps().projects.directoryFor(projectId)
    if (!dir) throw new Error("project not found")
    return (await this.deps().client.skills(dir)).data
  }

  async commands(projectId: string): Promise<unknown[]> {
    const dir = this.deps().projects.directoryFor(projectId)
    if (!dir) throw new Error("project not found")
    return (await this.deps().client.commands(dir)).data
  }

  async mcp(projectId: string): Promise<McpServer[]> {
    const dir = this.deps().projects.directoryFor(projectId)
    if (!dir) throw new Error("project not found")
    const res = await this.deps().client.mcpList(dir)
    return (res.data ?? []).map((e) => {
      const status = typeof e.status === "string" ? e.status : (e.status?.status ?? "unknown")
      return {
        name: e.name,
        status,
        enabled: status !== "disabled",
        type: undefined,
        tools: undefined,
      }
    })
  }

  async mcpSet(projectId: string, name: string, enabled: boolean): Promise<McpServer[]> {
    const project = this.deps().projects.get(projectId)
    const dir = project?.path
    if (!dir) throw new Error("project not found")
    if (enabled) await this.deps().client.mcpConnect(dir, name)
    else await this.deps().client.mcpDisconnect(dir, name)
    if (project) this.persistMcpDisabled(project.path, name, !enabled)
    return this.mcp(projectId)
  }

  /** Best-effort persistence of the disabled flag for project-local MCP servers (v2 config uses `disabled`). */
  private persistMcpDisabled(projectPath: string, name: string, disabled: boolean): void {
    try {
      const file = join(projectPath, "opencode.json")
      if (!existsSync(file)) return
      const cfg = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>
      const server = cfg?.mcp?.servers?.[name]
      if (!server || typeof server !== "object") return
      server.disabled = disabled
      atomicWrite(file, JSON.stringify(cfg, null, 2))
    } catch (err) {
      this.deps().logger.warn(`could not persist mcp disabled flag: ${err instanceof Error ? err.message : err}`)
    }
  }

  invalidateCatalog(directory?: string): void {
    if (!directory) {
      this.modelsCache.clear()
      return
    }
    const pid = this.deps().projectIdForDirectory(directory)
    if (pid) this.modelsCache.delete(pid)
  }

  // ---------- sessions ----------
  async list(
    projectId: string,
    opts: { limit?: number; cursor?: string; includeArchived?: boolean; parentID?: string } = {},
  ): Promise<{ sessions: Session[]; cursor: { previous?: string; next?: string } }> {
    const project = this.deps().projects.get(projectId)
    if (!project) throw new Error("project not found")
    const res = await this.deps().client.sessions(project.path, { limit: opts.limit ?? 50, cursor: opts.cursor })
    const mapped = res.data.map((s) => {
      this.indexSession(s, project.path)
      return this.mapSession(s, project.path)
    })
    let sessions = mapped
    if (!opts.includeArchived) sessions = sessions.filter((s) => !s.archived)
    if (opts.parentID) sessions = sessions.filter((s) => s.parentID === opts.parentID)
    return { sessions, cursor: res.cursor ?? {} }
  }

  private async resolveDirectory(id: string): Promise<string> {
    const known = this.index.get(id)?.directory
    if (known) return known
    const res = await this.deps().client.sessionGet(id)
    const dir = res.data?.location?.directory
    if (!dir) throw new Error("session has no location")
    this.indexSession(res.data, dir)
    return dir
  }

  async get(id: string): Promise<Session> {
    const dir = await this.resolveDirectory(id)
    const res = await this.deps().client.sessionGet(id, dir)
    this.indexSession(res.data, dir)
    return this.mapSession(res.data, dir)
  }

  async create(input: { projectId: string; title?: string; agent?: string; model?: ModelRef; level?: string }): Promise<Session> {
    const project = this.deps().projects.get(input.projectId)
    if (!project) throw new Error("project not found")
    const level = levelByName(input.level)
    const body: Record<string, unknown> = {
      location: { directory: project.path },
    }
    if (input.title) body.title = input.title
    const agent = input.agent ?? project.defaultAgent
    if (agent) body.agent = agent
    const model = input.model ?? project.defaultModel
    if (model) body.model = model
    if (level) body.permissions = level.rules
    const res = await this.deps().client.sessionCreate(project.path, body)
    this.indexSession(res.data, project.path)
    return this.mapSession(res.data, project.path)
  }

  async prompt(
    id: string,
    input: { text: string; files?: unknown[]; agents?: unknown[]; skills?: unknown[]; delivery?: string },
  ): Promise<SessionMessage> {
    const dir = await this.resolveDirectory(id)
    const body: Record<string, unknown> = { text: input.text, metadata: {} }
    if (input.files) body.files = input.files
    if (input.agents) body.agents = input.agents
    if (input.skills) body.skills = input.skills
    if (input.delivery) body.delivery = input.delivery
    const res = await this.deps().client.sessionPrompt(id, dir, body)
    const msgId = res?.data?.id
    if (msgId) {
      try {
        const m = await this.deps().client.sessionMessage(id, msgId, dir)
        return this.mapMessage(m.data)
      } catch {
        /* fall through to synthetic */
      }
    }
    return {
      id: msgId ?? `local_${Date.now()}`,
      type: "user",
      time: { created: Date.now() },
      text: input.text,
      parts: [{ type: "text", text: input.text }],
      raw: res,
    }
  }

  async messages(
    id: string,
    opts: { limit?: number; cursor?: string; order?: "asc" | "desc"; type?: string } = {},
  ): Promise<{ messages: SessionMessage[]; cursor: { previous?: string; next?: string } }> {
    const dir = await this.resolveDirectory(id)
    const res = await this.deps().client.sessionMessages(id, dir, {
      limit: opts.limit ?? 50,
      order: opts.order ?? "asc",
      cursor: opts.cursor,
      type: opts.type,
    })
    return { messages: res.data.map((m) => this.mapMessage(m)), cursor: res.cursor ?? {} }
  }

  async children(id: string): Promise<Session[]> {
    const dir = await this.resolveDirectory(id)
    const found: Session[] = []
    let cursor: string | undefined
    for (let page = 0; page < 10; page++) {
      const res = await this.deps().client.sessions(dir, { limit: 200, cursor })
      for (const s of res.data) {
        this.indexSession(s, dir)
        if (s.parentID === id) found.push(this.mapSession(s, dir))
      }
      if (!res.cursor?.next) break
      cursor = res.cursor.next
    }
    return found
  }

  async update(id: string, patch: { title?: string; pinned?: boolean; archived?: boolean }): Promise<Session> {
    const dir = await this.resolveDirectory(id)
    if (patch.title !== undefined) await this.deps().client.sessionUpdate(id, { title: patch.title }, dir)
    const meta = this.meta.read()
    const entry = meta[id] ?? {}
    if (patch.title !== undefined) entry.title = patch.title
    if (patch.pinned !== undefined) entry.pinned = patch.pinned
    if (patch.archived !== undefined) entry.archived = patch.archived
    meta[id] = entry
    this.meta.write(meta)
    return this.get(id)
  }

  async remove(id: string): Promise<void> {
    const dir = await this.resolveDirectory(id)
    await this.deps().client.sessionDelete(id, dir)
    const meta = this.meta.read()
    delete meta[id]
    this.meta.write(meta)
    this.index.delete(id)
    this.statusMap.delete(id)
    this.usageMap.delete(id)
  }

  async interrupt(id: string): Promise<void> {
    const dir = await this.resolveDirectory(id)
    await this.deps().client.sessionInterrupt(id, dir)
  }

  async switchModel(id: string, model: ModelRef): Promise<Session> {
    const dir = await this.resolveDirectory(id)
    await this.deps().client.sessionSwitchModel(id, model, dir)
    const entry = this.index.get(id)
    if (entry) this.index.set(id, { ...entry, model })
    return this.get(id)
  }

  async switchAgent(id: string, agent: string): Promise<Session> {
    const dir = await this.resolveDirectory(id)
    await this.deps().client.sessionSwitchAgent(id, agent, dir)
    return this.get(id)
  }

  async compact(id: string): Promise<void> {
    const dir = await this.resolveDirectory(id)
    await this.deps().client.sessionCompact(id, dir)
  }

  async status(id: string): Promise<SessionStatusInfo> {
    const dir = await this.resolveDirectory(id)
    const res = await this.deps().client.sessionGet(id, dir)
    const session = this.mapSession(res.data, dir)
    const usage = this.usageMap.get(id)
    const tokens = usage?.tokens ?? session.tokens ?? {}
    const used = computeUsed(tokens)
    let limit = DEFAULT_CONTEXT_LIMIT
    const models = await this.ensureModels(session.projectId)
    if (session.model) {
      const m = models.find((x) => x.providerID === session.model?.providerID && x.id === session.model?.id)
      if (m?.limit?.context) limit = m.limit.context
    }
    const unknownAfterCompaction = (this.compactedAt.get(id) ?? 0) > (usage?.at ?? 0)
    let goal
    try {
      goal = this.deps().goals?.get(id) ?? undefined
    } catch {
      goal = undefined
    }
    return {
      sessionId: id,
      status: this.statusMap.get(id) ?? "idle",
      tokens,
      cost: usage?.cost ?? session.cost,
      context: {
        used,
        limit,
        percent: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0,
        model: session.model,
        unknownAfterCompaction,
      },
      goal: goal ?? undefined,
    }
  }

  directoryOf(id: string): string | undefined {
    return this.index.get(id)?.directory
  }

  projectOf(id: string): string | undefined {
    return this.index.get(id)?.projectId || undefined
  }

  async start(): Promise<void> {
    try {
      const active = await this.deps().client.sessionActive()
      for (const id of Object.keys(active.data ?? {})) this.statusMap.set(id, "busy")
    } catch {
      /* ignore */
    }
  }

  stop(): void {
    /* nothing to release */
  }

  // ---------- events ----------
  onOpencodeEvent(event: RawOpencodeEvent): void {
    const data = (event.data ?? {}) as Record<string, unknown>
    const sid = typeof data.sessionID === "string" ? data.sessionID : undefined
    const dir = event.location?.directory ?? (sid ? this.index.get(sid)?.directory : undefined)
    const pid = dir ? this.deps().projectIdForDirectory(dir) : undefined

    switch (event.type) {
      case "session.created":
      case "session.updated": {
        if (!sid || !dir) break
        this.index.set(sid, {
          projectId: pid ?? "",
          directory: dir,
          title: data.title as string | undefined,
          model: data.model as ModelRef | undefined,
        })
        const session: Session = {
          id: sid,
          projectId: pid ?? "",
          directory: dir,
          title: (data.title as string) ?? "(untitled)",
          agent: data.agent as string | undefined,
          model: data.model as ModelRef | undefined,
          parentID: data.parentID as string | undefined,
          tokens: (data.tokens as TokenUsage) ?? {},
          cost: (data.cost as number) ?? 0,
          time: {},
          status: this.statusMap.get(sid) ?? "idle",
          archived: this.meta.read()[sid]?.archived ?? false,
          pinned: this.meta.read()[sid]?.pinned ?? false,
        }
        this.deps().bus.emit({ type: "session.updated", projectId: pid, sessionId: sid, data: { session } })
        break
      }
      case "session.deleted": {
        if (!sid) break
        this.index.delete(sid)
        this.statusMap.delete(sid)
        this.usageMap.delete(sid)
        this.deps().bus.emit({ type: "session.updated", projectId: pid, sessionId: sid, data: { deleted: true } })
        break
      }
      case "session.execution.started":
        this.setStatus(sid, "busy", pid)
        break
      case "session.execution.succeeded":
        this.setStatus(sid, "idle", pid)
        break
      case "session.execution.interrupted":
        this.setStatus(sid, "idle", pid, "interrupted")
        break
      case "session.execution.failed":
        this.setStatus(sid, "idle", pid, "failed")
        break
      case "session.usage.updated":
      case "session.step.ended":
        this.setUsage(sid, data.tokens as TokenUsage | undefined, data.cost as number | undefined, pid)
        break
      case "session.text.delta":
        this.deps().bus.emit({
          type: "session.delta",
          projectId: pid,
          sessionId: sid,
          data: {
            messageId: data.assistantMessageID,
            kind: "text",
            ordinal: data.ordinal,
            delta: data.delta,
          },
        })
        break
      case "session.compacted":
        if (sid) this.compactedAt.set(sid, Date.now())
        break
      case "form.created":
      case "question.asked": {
        this.deps().bus.emit({
          type: "session.question",
          projectId: pid,
          sessionId: sid,
          data: { sessionId: sid, question: event.data },
        })
        break
      }
      default:
        break
    }
    if (/^(model|provider)\.updated$/.test(event.type) || event.type === "session.compacted") {
      this.invalidateCatalog(event.location?.directory)
    }
  }

  private setStatus(sid: string | undefined, status: SessionStatus, projectId?: string, reason?: string): void {
    if (!sid) return
    if (status === "idle") this.statusMap.set(sid, "idle")
    else this.statusMap.set(sid, status)
    let goal
    try {
      goal = this.deps().goals?.get(sid) ?? undefined
    } catch {
      goal = undefined
    }
    this.deps().bus.emit({
      type: "session.status",
      projectId,
      sessionId: sid,
      data: { sessionId: sid, status, reason, goal },
    })
  }

  private setUsage(
    sid: string | undefined,
    tokens: TokenUsage | undefined,
    cost: number | undefined,
    projectId?: string,
  ): void {
    if (!sid) return
    this.usageMap.set(sid, { tokens, cost, at: Date.now() })
    const used = computeUsed(tokens)
    const pid = projectId ?? this.index.get(sid)?.projectId
    const model = this.index.get(sid)?.model
    const emitContext = (limit: number) => {
      this.deps().bus.emit({
        type: "session.context",
        projectId: pid,
        sessionId: sid,
        data: {
          sessionId: sid,
          tokens,
          cost,
          context: {
            used,
            limit,
            percent: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0,
            model,
            unknownAfterCompaction: false,
          },
        },
      })
    }
    if (pid && model) {
      void this.ensureModels(pid)
        .then((models) => {
          const m = models.find((x) => x.providerID === model.providerID && x.id === model.id)
          emitContext(m?.limit?.context ?? DEFAULT_CONTEXT_LIMIT)
        })
        .catch(() => emitContext(DEFAULT_CONTEXT_LIMIT))
    } else {
      emitContext(DEFAULT_CONTEXT_LIMIT)
    }
  }
}
