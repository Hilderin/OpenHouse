import type {
  Agent,
  AuditEntry,
  Command,
  Goal,
  Health,
  Level,
  McpServer,
  Model,
  ModelRef,
  PluginStatus,
  Project,
  Schedule,
  Session,
  SessionMessage,
  SessionStatusInfo,
  Skill,
} from "./types"

export class ApiError extends Error {
  code: string
  status: number
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.details = details
  }
}

const BASE = "/api/oh"

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (e) {
    throw new ApiError(0, "network_error", e instanceof Error ? e.message : "Network request failed")
  }

  const isJson = (res.headers.get("content-type") ?? "").includes("application/json")
  const payload: unknown = isJson ? await res.json().catch(() => undefined) : undefined

  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } })?.error
    throw new ApiError(
      res.status,
      err?.code ?? "http_error",
      err?.message ?? `Request failed with status ${res.status}`,
      err?.details,
    )
  }
  return payload as T
}

const qs = (params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") search.set(k, String(v))
  }
  const s = search.toString()
  return s ? `?${s}` : ""
}

const enc = encodeURIComponent

export const api = {
  // ---- health & info ----
  health: () => request<Health>("GET", "/health"),
  info: () => request<Record<string, unknown>>("GET", "/info"),
  plugin: () => request<PluginStatus>("GET", "/plugin"),

  // ---- projects ----
  listProjects: async (): Promise<Project[]> => (await request<{ projects: Project[] }>("GET", "/projects")).projects,
  getProject: async (id: string): Promise<Project> => (await request<{ project: Project }>("GET", `/projects/${enc(id)}`)).project,
  addProject: async (input: { path: string; name?: string }): Promise<Project> =>
    (await request<{ project: Project }>("POST", "/projects", input)).project,
  updateProject: async (
    id: string,
    patch: Partial<Pick<Project, "name" | "defaultModel" | "defaultAgent" | "subagentDepth" | "denyList">>,
  ): Promise<Project> => (await request<{ project: Project }>("PATCH", `/projects/${enc(id)}`, patch)).project,
  removeProject: (id: string) => request<{ ok: true }>("DELETE", `/projects/${enc(id)}`),

  // ---- catalog ----
  models: (projectId: string) => request<{ models: Model[]; default?: ModelRef }>("GET", `/projects/${enc(projectId)}/models`),
  agents: async (projectId: string): Promise<Agent[]> =>
    (await request<{ agents: Agent[] }>("GET", `/projects/${enc(projectId)}/agents`)).agents,
  skills: async (projectId: string): Promise<Skill[]> =>
    (await request<{ skills: Skill[] }>("GET", `/projects/${enc(projectId)}/skills`)).skills,
  commands: async (projectId: string): Promise<Command[]> =>
    (await request<{ commands: Command[] }>("GET", `/projects/${enc(projectId)}/commands`)).commands,
  mcp: async (projectId: string): Promise<McpServer[]> =>
    (await request<{ servers: McpServer[] }>("GET", `/projects/${enc(projectId)}/mcp`)).servers,
  mcpSet: async (projectId: string, name: string, mode: "enable" | "disable"): Promise<McpServer[]> =>
    (await request<{ servers: McpServer[] }>("POST", `/projects/${enc(projectId)}/mcp/${enc(name)}/${mode}`)).servers,
  levels: async (): Promise<Level[]> => (await request<{ levels: Level[] }>("GET", "/levels")).levels,

  // ---- sessions ----
  listSessions: (
    projectId: string,
    opts: { limit?: number; cursor?: string; includeArchived?: boolean; parentID?: string } = {},
  ) =>
    request<{ sessions: Session[]; cursor: { previous?: string; next?: string } }>(
      "GET",
      `/projects/${enc(projectId)}/sessions${qs({
        limit: opts.limit,
        cursor: opts.cursor,
        includeArchived: opts.includeArchived,
        parentID: opts.parentID,
      })}`,
    ),
  createSession: async (input: {
    projectId: string
    title?: string
    agent?: string
    model?: ModelRef
    parentID?: string
    level?: string
  }): Promise<Session> => (await request<{ session: Session }>("POST", "/sessions", input)).session,
  getSession: async (id: string): Promise<Session> => (await request<{ session: Session }>("GET", `/sessions/${enc(id)}`)).session,
  messages: (
    id: string,
    opts: { limit?: number; cursor?: string; order?: "asc" | "desc"; type?: string } = {},
  ) =>
    request<{ messages: SessionMessage[]; cursor: { previous?: string; next?: string } }>(
      "GET",
      `/sessions/${enc(id)}/messages${qs({ limit: opts.limit, cursor: opts.cursor, order: opts.order, type: opts.type })}`,
    ),
  prompt: async (id: string, input: { text: string; files?: unknown[]; agents?: unknown[]; skills?: unknown[]; delivery?: string }): Promise<SessionMessage> =>
    (await request<{ message: SessionMessage }>("POST", `/sessions/${enc(id)}/prompt`, input)).message,
  switchModel: async (id: string, model: ModelRef): Promise<Session> =>
    (await request<{ session: Session }>("POST", `/sessions/${enc(id)}/model`, { model })).session,
  switchAgent: async (id: string, agent: string): Promise<Session> =>
    (await request<{ session: Session }>("POST", `/sessions/${enc(id)}/agent`, { agent })).session,
  interrupt: (id: string) => request<{ ok: true }>("POST", `/sessions/${enc(id)}/interrupt`),
  compact: (id: string) => request<{ ok: true }>("POST", `/sessions/${enc(id)}/compact`),
  updateSession: async (id: string, patch: { title?: string; archived?: boolean; pinned?: boolean }): Promise<Session> =>
    (await request<{ session: Session }>("PATCH", `/sessions/${enc(id)}`, patch)).session,
  deleteSession: (id: string) => request<{ ok: true }>("DELETE", `/sessions/${enc(id)}`),
  status: (id: string) => request<SessionStatusInfo>("GET", `/sessions/${enc(id)}/status`),
  children: async (id: string): Promise<Session[]> =>
    (await request<{ sessions: Session[] }>("GET", `/sessions/${enc(id)}/children`)).sessions,

  // ---- goal ----
  getGoal: async (id: string): Promise<Goal | null> =>
    (await request<{ goal: Goal | null }>("GET", `/sessions/${enc(id)}/goal`)).goal,
  setGoal: async (
    id: string,
    input: { objective: string; budgetTokens?: number; maxTurns?: number },
  ): Promise<Goal> => (await request<{ goal: Goal }>("PUT", `/sessions/${enc(id)}/goal`, input)).goal,
  pauseGoal: async (id: string): Promise<Goal> =>
    (await request<{ goal: Goal }>("POST", `/sessions/${enc(id)}/goal/pause`)).goal,
  resumeGoal: async (id: string): Promise<Goal> =>
    (await request<{ goal: Goal }>("POST", `/sessions/${enc(id)}/goal/resume`)).goal,
  clearGoal: (id: string) => request<{ ok: true }>("DELETE", `/sessions/${enc(id)}/goal`),

  // ---- schedules ----
  schedules: async (projectId?: string): Promise<Schedule[]> =>
    (await request<{ schedules: Schedule[] }>("GET", `/schedules${qs({ projectId })}`)).schedules,
  createSchedule: async (input: {
    projectId: string
    name: string
    cron: string
    enabled?: boolean
    prompt: string
    model?: ModelRef
    agent?: string
    goal?: { objective: string; budgetTokens?: number; maxTurns?: number }
  }): Promise<Schedule> => (await request<{ schedule: Schedule }>("POST", "/schedules", input)).schedule,
  updateSchedule: async (id: string, patch: Partial<Schedule>): Promise<Schedule> =>
    (await request<{ schedule: Schedule }>("PATCH", `/schedules/${enc(id)}`, patch)).schedule,
  deleteSchedule: (id: string) => request<{ ok: true }>("DELETE", `/schedules/${enc(id)}`),
  toggleSchedule: async (id: string): Promise<Schedule> =>
    (await request<{ schedule: Schedule }>("POST", `/schedules/${enc(id)}/toggle`)).schedule,
  runSchedule: (id: string) => request<{ ok: true; sessionId: string }>("POST", `/schedules/${enc(id)}/run`),

  // ---- auto-accept ----
  audit: async (limit = 100): Promise<AuditEntry[]> =>
    (await request<{ entries: AuditEntry[] }>("GET", `/autoaccept/audit${qs({ limit })}`)).entries,
}
