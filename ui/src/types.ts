export interface ModelRef {
  providerID: string
  id: string
  variant?: string
}

export interface TokenUsage {
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
  total?: number
}

export interface Project {
  id: string
  name: string
  path: string
  available: boolean
  defaultModel?: ModelRef
  defaultAgent?: string
  subagentDepth?: number
  denyList?: string[]
  createdAt: number
  sessionCount?: number
  lastActivity?: number
}

export type SessionStatus = "idle" | "busy" | "retry" | "unknown"

export interface Session {
  id: string
  projectId: string
  directory: string
  title: string
  agent?: string
  model?: ModelRef
  parentID?: string
  tokens: TokenUsage
  cost: number
  time: { created?: number; updated?: number; idle?: number }
  status: SessionStatus
  archived: boolean
  pinned: boolean
}

export interface ContentPart {
  type: string
  text?: string
  [key: string]: unknown
}

export interface SessionMessage {
  id: string
  type: string
  time?: { created?: number; completed?: number; streamed?: number }
  text?: string
  parts: ContentPart[]
  tokens?: TokenUsage
  cost?: number
  agent?: string
  model?: ModelRef
  outcome?: string
  raw: unknown
}

export interface SessionContext {
  used: number
  limit: number
  percent: number
  model?: ModelRef
  unknownAfterCompaction: boolean
}

export type GoalState = "armed" | "running" | "paused" | "complete" | "blocked" | "aborted"

export interface Goal {
  sessionId: string
  objective: string
  budgetTokens?: number
  maxTurns?: number
  turns: number
  usedTokens: number
  state: GoalState
  lastVerdict?: "continue" | "complete" | "blocked"
  note?: string
  updatedAt: number
}

export interface SessionStatusInfo {
  sessionId: string
  status: SessionStatus
  tokens: TokenUsage
  cost: number
  context: SessionContext
  goal?: Goal
}

export interface Schedule {
  id: string
  projectId: string
  name: string
  cron: string
  enabled: boolean
  prompt: string
  model?: ModelRef
  agent?: string
  goal?: { objective: string; budgetTokens?: number; maxTurns?: number }
  lastRun?: number
  lastStatus?: "ok" | "error"
  lastError?: string
  lastSessionId?: string
  nextRun?: number
  createdAt: number
}

export interface Level {
  name: string
  description: string
  rules: { action: string; resource: string; effect: "allow" | "deny" | "ask" }[]
}

export interface Model {
  providerID: string
  id: string
  modelID?: string
  name: string
  limit?: { context?: number; input?: number; output?: number }
  cost?: unknown
  variants?: unknown
  status?: string
  enabled?: boolean
}

export interface Agent {
  id: string
  name: string
  description?: string
  mode: "primary" | "subagent" | "all"
  hidden?: boolean
  permissions?: { action: string; resource: string; effect: "allow" | "deny" | "ask" }[]
}

export interface Skill {
  id: string
  name: string
  description?: string
  path?: string
}

export interface Command {
  name: string
  description?: string
}

export interface McpServer {
  name: string
  status: string
  enabled: boolean
  type?: "local" | "remote"
  tools?: string[]
}

export interface AuditEntry {
  at: number
  sessionID: string
  requestID: string
  action: string
  resources: string[]
  reply: "once" | "always" | "reject"
  reason: "rule" | "deny-list"
}

export interface OpencodeHealth {
  status: "starting" | "ready" | "error" | "stopped"
  version?: string
  url?: string
  pid?: number
  error?: string
}

export interface Health {
  ok: boolean
  version: string
  uptimeMs: number
  dataDir: string
  opencodePin: string
  opencode: OpencodeHealth
}

export interface PluginStatus {
  enabled: boolean
  configFile: string
  pluginDir: string
  injected: boolean
}

export interface OhEvent<P = unknown> {
  type: string
  at: number
  projectId?: string
  sessionId?: string
  data: P
}

export type EventName =
  | "snapshot"
  | "opencode.status"
  | "session.updated"
  | "session.status"
  | "session.message"
  | "session.question"
  | "session.delta"
  | "session.context"
  | "schedule.run"
  | "goal.updated"
  | "autoaccept"
  | "catalog.updated"
  | "project.updated"
  | "ping"
