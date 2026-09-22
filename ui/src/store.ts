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
  SessionStatus,
  SessionStatusInfo,
  Skill,
} from "./types"

export interface CatalogState<T> {
  data: T
  loading: boolean
  error?: string
}

export type DrawerKind = "status" | "skills" | "commands" | "mcp" | "schedules" | "autoaccept"

export interface ChatState {
  sessionId?: string
  session?: Session
  messages: SessionMessage[]
  loading: boolean
  error?: string
  /** Live streaming text keyed by messageId (assembled from session.delta). */
  streaming: Record<string, string>
  /** Periodically refreshed status/context for the open session. */
  status?: SessionStatusInfo
  children: Session[]
  goal: Goal | null
  goalLoading: boolean
  sending: boolean
}

export interface AppState {
  health?: Health
  healthError?: string
  plugin?: PluginStatus
  sse: { state: "connecting" | "open" | "error" | "closed"; retries: number; lastError?: string }

  projects: Project[]
  projectsLoading: boolean
  projectsError?: string
  selectedProjectId?: string

  sessions: Session[]
  sessionsLoading: boolean
  sessionsError?: string
  includeArchived: boolean
  /** Children loaded on demand, keyed by parent session id. */
  childSessions: Record<string, Session[]>
  expandedChildren: string[]

  levels: Level[]

  models: CatalogState<Model[]>
  defaultModel?: ModelRef
  agents: CatalogState<Agent[]>
  skills: CatalogState<Skill[]>
  commands: CatalogState<Command[]>
  mcp: CatalogState<McpServer[]>

  chat: ChatState

  drawer?: DrawerKind

  schedules: Schedule[]
  schedulesLoading: boolean
  schedulesError?: string

  audit: AuditEntry[]
  auditError?: string
}

export const initialState: AppState = {
  projects: [],
  projectsLoading: false,
  selectedProjectId: undefined,
  sessions: [],
  sessionsLoading: false,
  includeArchived: false,
  childSessions: {},
  expandedChildren: [],
  levels: [],
  models: { data: [], loading: false },
  agents: { data: [], loading: false },
  skills: { data: [], loading: false },
  commands: { data: [], loading: false },
  mcp: { data: [], loading: false },
  chat: { messages: [], loading: false, streaming: {}, children: [], goal: null, goalLoading: false, sending: false },
  drawer: undefined,
  schedules: [],
  schedulesLoading: false,
  audit: [],
  sse: { state: "closed", retries: 0 },
}

type Action =
  | { type: "health"; health?: Health; error?: string }
  | { type: "plugin"; plugin?: PluginStatus }
  | { type: "sse"; status: AppState["sse"] }
  | { type: "projects/loading" }
  | { type: "projects"; projects: Project[] }
  | { type: "projects/error"; error: string }
  | { type: "projects/select"; id?: string }
  | { type: "project/upsert"; project: Project; deleted?: boolean }
  | { type: "sessions/loading" }
  | { type: "sessions"; sessions: Session[] }
  | { type: "sessions/error"; error: string }
  | { type: "sessions/includeArchived"; value: boolean }
  | { type: "session/upsert"; session: Session; deleted?: boolean }
  | { type: "session/status"; sessionId: string; status: SessionStatus; goal?: Goal }
  | { type: "children/loaded"; parentId: string; children: Session[] }
  | { type: "children/toggle"; parentId: string }
  | { type: "levels"; levels: Level[] }
  | { type: "catalog/loading"; kind: CatalogSlice }
  | { type: "catalog/error"; kind: CatalogSlice; error: string }
  | { type: "catalog/models"; models: Model[]; default?: ModelRef }
  | { type: "catalog/agents"; agents: Agent[] }
  | { type: "catalog/skills"; skills: Skill[] }
  | { type: "catalog/commands"; commands: Command[] }
  | { type: "catalog/mcp"; servers: McpServer[] }
  | { type: "chat/open"; session: Session }
  | { type: "chat/session"; session: Session }
  | { type: "chat/loading" }
  | { type: "chat/messages"; messages: SessionMessage[] }
  | { type: "chat/message"; message: SessionMessage }
  | { type: "chat/error"; error: string }
  | { type: "chat/delta"; messageId: string; delta: string; kind: string }
  | { type: "chat/sending"; value: boolean }
  | { type: "chat/status"; status?: SessionStatusInfo }
  | { type: "chat/children"; children: Session[] }
  | { type: "chat/goal"; goal: Goal | null; loading?: boolean }
  | { type: "chat/close" }
  | { type: "drawer/set"; drawer?: DrawerKind }
  | { type: "schedules/loading" }
  | { type: "schedules"; schedules: Schedule[] }
  | { type: "schedules/error"; error: string }
  | { type: "schedule/upsert"; schedule: Schedule }
  | { type: "audit"; entries: AuditEntry[] }
  | { type: "audit/error"; error: string }
  | { type: "audit/prepend"; entry: AuditEntry }

export type CatalogSlice = "models" | "agents" | "skills" | "commands" | "mcp"
export type CatalogKind = CatalogSlice | "providers"

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "health":
      return { ...state, health: action.health, healthError: action.error }

    case "plugin":
      return { ...state, plugin: action.plugin }

    case "sse":
      return { ...state, sse: action.status }

    case "projects/loading":
      return { ...state, projectsLoading: true, projectsError: undefined }
    case "projects":
      return { ...state, projects: action.projects, projectsLoading: false, projectsError: undefined }
    case "projects/error":
      return { ...state, projectsLoading: false, projectsError: action.error }
    case "projects/select":
      return { ...state, selectedProjectId: action.id }
    case "project/upsert": {
      if (action.deleted) {
        return { ...state, projects: state.projects.filter((p) => p.id !== action.project.id) }
      }
      const exists = state.projects.some((p) => p.id === action.project.id)
      const projects = exists
        ? state.projects.map((p) => (p.id === action.project.id ? action.project : p))
        : [...state.projects, action.project]
      return { ...state, projects }
    }

    case "sessions/loading":
      return { ...state, sessionsLoading: true, sessionsError: undefined }
    case "sessions":
      return { ...state, sessions: action.sessions, sessionsLoading: false, sessionsError: undefined }
    case "sessions/error":
      return { ...state, sessionsLoading: false, sessionsError: action.error }
    case "sessions/includeArchived":
      return { ...state, includeArchived: action.value }
    case "session/upsert": {
      const filtered = action.deleted
        ? state.sessions.filter((s) => s.id !== action.session.id)
        : mergeSession(state.sessions, action.session)
      const chat =
        state.chat.session?.id === action.session.id
          ? { ...state.chat, session: action.deleted ? undefined : action.session }
          : state.chat
      return { ...state, sessions: filtered, chat }
    }
    case "session/status": {
      const sessions = state.sessions.map((s) =>
        s.id === action.sessionId ? { ...s, status: action.status } : s,
      )
      const chat =
        state.chat.sessionId === action.sessionId
          ? {
              ...state.chat,
              session: state.chat.session ? { ...state.chat.session, status: action.status } : state.chat.session,
              status: state.chat.status
                ? { ...state.chat.status, status: action.status, goal: action.goal ?? state.chat.status.goal }
                : state.chat.status,
              goal: action.goal ?? state.chat.goal,
            }
          : state.chat
      return { ...state, sessions, chat }
    }

    case "children/loaded":
      return { ...state, childSessions: { ...state.childSessions, [action.parentId]: action.children } }
    case "children/toggle": {
      const expanded = state.expandedChildren.includes(action.parentId)
      return {
        ...state,
        expandedChildren: expanded
          ? state.expandedChildren.filter((id) => id !== action.parentId)
          : [...state.expandedChildren, action.parentId],
      }
    }

    case "levels":
      return { ...state, levels: action.levels }

    case "catalog/loading":
      return { ...state, [action.kind]: { ...state[action.kind], loading: true, error: undefined } } as AppState
    case "catalog/error":
      return { ...state, [action.kind]: { ...state[action.kind], loading: false, error: action.error } } as AppState
    case "catalog/models":
      return { ...state, models: { data: action.models, loading: false }, defaultModel: action.default }
    case "catalog/agents":
      return { ...state, agents: { data: action.agents, loading: false } }
    case "catalog/skills":
      return { ...state, skills: { data: action.skills, loading: false } }
    case "catalog/commands":
      return { ...state, commands: { data: action.commands, loading: false } }
    case "catalog/mcp":
      return { ...state, mcp: { data: action.servers, loading: false } }

    case "chat/open":
      return {
        ...state,
        chat: {
          sessionId: action.session.id,
          session: action.session,
          messages: [],
          loading: true,
          streaming: {},
          children: [],
          goal: null,
          goalLoading: true,
          sending: false,
        },
      }
    case "chat/loading":
      return { ...state, chat: { ...state.chat, loading: true, error: undefined } }
    case "chat/session":
      return { ...state, chat: { ...state.chat, session: action.session } }
    case "chat/messages":
      return { ...state, chat: { ...state.chat, messages: action.messages, loading: false, error: undefined } }
    case "chat/message": {
      const messages = mergeMessage(state.chat.messages, action.message)
      const streaming = { ...state.chat.streaming }
      delete streaming[action.message.id]
      return { ...state, chat: { ...state.chat, messages, streaming } }
    }
    case "chat/error":
      return { ...state, chat: { ...state.chat, loading: false, error: action.error } }
    case "chat/delta": {
      const streaming = { ...state.chat.streaming }
      streaming[action.messageId] = (streaming[action.messageId] ?? "") + action.delta
      return { ...state, chat: { ...state.chat, streaming } }
    }
    case "chat/sending":
      return { ...state, chat: { ...state.chat, sending: action.value } }
    case "chat/status":
      return { ...state, chat: { ...state.chat, status: action.status, goal: action.status?.goal ?? state.chat.goal } }
    case "chat/children":
      return { ...state, chat: { ...state.chat, children: action.children } }
    case "chat/goal":
      return { ...state, chat: { ...state.chat, goal: action.goal, goalLoading: action.loading ?? false } }
    case "chat/close":
      return { ...state, chat: { ...initialState.chat } }

    case "drawer/set":
      return { ...state, drawer: action.drawer }

    case "schedules/loading":
      return { ...state, schedulesLoading: true, schedulesError: undefined }
    case "schedules":
      return { ...state, schedules: action.schedules, schedulesLoading: false, schedulesError: undefined }
    case "schedules/error":
      return { ...state, schedulesLoading: false, schedulesError: action.error }
    case "schedule/upsert": {
      const exists = state.schedules.some((s) => s.id === action.schedule.id)
      const schedules = exists
        ? state.schedules.map((s) => (s.id === action.schedule.id ? action.schedule : s))
        : [...state.schedules, action.schedule]
      return { ...state, schedules }
    }

    case "audit":
      return { ...state, audit: action.entries, auditError: undefined }
    case "audit/error":
      return { ...state, auditError: action.error }
    case "audit/prepend":
      return { ...state, audit: [action.entry, ...state.audit].slice(0, 200) }

    default:
      return state
  }
}

function mergeSession(list: Session[], next: Session): Session[] {
  const exists = list.some((s) => s.id === next.id)
  const merged = exists ? list.map((s) => (s.id === next.id ? { ...s, ...next } : s)) : [...list, next]
  return sortSessions(merged)
}

function mergeMessage(list: SessionMessage[], next: SessionMessage): SessionMessage[] {
  const exists = list.some((m) => m.id === next.id)
  const merged = exists ? list.map((m) => (m.id === next.id ? { ...m, ...next } : m)) : [...list, next]
  return sortMessages(merged)
}

export function sortSessions(list: Session[]): Session[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const at = a.time.updated ?? a.time.created ?? 0
    const bt = b.time.updated ?? b.time.created ?? 0
    return bt - at
  })
}

export function sortMessages(list: SessionMessage[]): SessionMessage[] {
  return [...list].sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
}
