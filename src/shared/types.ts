import type { OpenCodeModel } from "../opencode/client"

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

export interface SessionStatusInfo {
  sessionId: string
  status: SessionStatus
  tokens: TokenUsage
  cost: number
  context: SessionContext
  goal?: Goal
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

export interface CatalogModels {
  models: OpenCodeModel[]
  default?: ModelRef
}
