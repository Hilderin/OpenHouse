import type { Config } from "../core/config"
import type { EventBus } from "../core/events"
import type { Logger } from "../core/logger"
import type { OpencodeEventHub, RawOpencodeEvent } from "../opencode/events"
import type { OpencodeManager } from "../opencode/lifecycle"
import type { ModelRef, OpencodeClient } from "../opencode/client"
import type {
  AuditEntry,
  Goal,
  Level,
  McpServer,
  Project,
  Schedule,
  Session,
  SessionMessage,
  SessionStatusInfo,
} from "../shared/types"

export interface ProjectsService {
  list(): Promise<Project[]>
  get(id: string): Project | undefined
  add(input: { path: string; name?: string }): Promise<Project>
  update(id: string, patch: Partial<Pick<Project, "name" | "defaultModel" | "defaultAgent" | "subagentDepth" | "denyList">>): Promise<Project>
  remove(id: string): Promise<void>
  idForDirectory(directory?: string): string | undefined
  directoryFor(id: string): string | undefined
  rescan(): void
}

export interface SessionsService {
  list(projectId: string, opts?: { limit?: number; cursor?: string; includeArchived?: boolean; parentID?: string }): Promise<{ sessions: Session[]; cursor: { previous?: string; next?: string } }>
  get(id: string): Promise<Session>
  create(input: { projectId: string; title?: string; agent?: string; model?: ModelRef; level?: string }): Promise<Session>
  prompt(id: string, input: { text: string; files?: unknown[]; agents?: unknown[]; skills?: unknown[]; delivery?: string }): Promise<SessionMessage>
  messages(id: string, opts?: { limit?: number; cursor?: string; order?: "asc" | "desc"; type?: string }): Promise<{ messages: SessionMessage[]; cursor: { previous?: string; next?: string } }>
  status(id: string): Promise<SessionStatusInfo>
  children(id: string): Promise<Session[]>
  update(id: string, patch: { title?: string; pinned?: boolean; archived?: boolean }): Promise<Session>
  remove(id: string): Promise<void>
  interrupt(id: string): Promise<void>
  compact(id: string): Promise<void>
  switchModel(id: string, model: ModelRef): Promise<Session>
  switchAgent(id: string, agent: string): Promise<Session>
  models(projectId: string): Promise<{ models: Awaited<ReturnType<OpencodeClient["models"]>>["data"]; default?: ModelRef }>
  agents(projectId: string): Promise<unknown[]>
  skills(projectId: string): Promise<unknown[]>
  commands(projectId: string): Promise<unknown[]>
  mcp(projectId: string): Promise<McpServer[]>
  mcpSet(projectId: string, name: string, enabled: boolean): Promise<McpServer[]>
  directoryOf(id: string): string | undefined
  projectOf(id: string): string | undefined
  invalidateCatalog(directory?: string): void
  onOpencodeEvent(event: RawOpencodeEvent): void
  start(): Promise<void>
  stop(): void
}

export interface SchedulerService {
  list(projectId?: string): Promise<Schedule[]>
  create(input: { projectId: string; name: string; cron: string; enabled?: boolean; prompt: string; model?: ModelRef; agent?: string; goal?: Schedule["goal"] }): Promise<Schedule>
  update(id: string, patch: Partial<Schedule>): Promise<Schedule>
  remove(id: string): Promise<void>
  toggle(id: string): Promise<Schedule>
  run(id: string): Promise<{ sessionId: string }>
  start(): void
  stop(): void
}

export interface GoalService {
  set(sessionId: string, input: { objective: string; budgetTokens?: number; maxTurns?: number }): Promise<Goal>
  get(sessionId: string): Goal | null
  pause(sessionId: string): Promise<Goal>
  resume(sessionId: string): Promise<Goal>
  clear(sessionId: string): Promise<void>
  list(): Goal[]
  onOpencodeEvent(event: RawOpencodeEvent): void
  start(): void
  stop(): void
}

export interface AutoAcceptService {
  audit(limit?: number): Promise<AuditEntry[]>
  onOpencodeEvent(event: RawOpencodeEvent): void
  start(): void
  stop(): void
}

export interface ControlService {
  execute(action: string, params: Record<string, unknown>): Promise<unknown>
}

export interface PluginService {
  start(): void
  stop(): void
  status(): { enabled: boolean; configFile: string; pluginDir: string; injected: boolean }
  setEnabled(enabled: boolean): Promise<{ enabled: boolean; configFile: string; pluginDir: string; injected: boolean }>
  sync(): void
}

export interface Services {
  config: Config
  logger: Logger
  bus: EventBus
  opencode: OpencodeManager
  hub: OpencodeEventHub
  client: OpencodeClient
  projects: ProjectsService
  sessions: SessionsService
  scheduler: SchedulerService
  goals: GoalService
  autoaccept: AutoAcceptService
  control: ControlService
  plugins: PluginService
  projectIdForDirectory(directory?: string): string | undefined
  directoryForProject(id: string): string | undefined
  levels: Level[]
  startedAt: number
  start(): Promise<void>
  stop(): Promise<void>
}

export type GetServices = () => Services
