import type { Logger } from "../core/logger"

export interface OpencodeConnection {
  baseUrl: string
  username?: string
  password?: string
}

export interface Rule {
  action: string
  resource: string
  effect: "allow" | "deny" | "ask"
}

export interface ModelRef {
  providerID: string
  id: string
  variant?: string
}

export interface RequestOptions {
  directory?: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  signal?: AbortSignal
}

export class OpencodeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`opencode ${status} ${path}: ${body.slice(0, 300)}`)
    this.name = "OpencodeHttpError"
  }
}

/** Thin, dependency-free HTTP + SSE client for the OpenCode v2 server. */
export class OpencodeClient {
  constructor(
    private conn: OpencodeConnection,
    private logger: Logger,
  ) {}

  setConnection(conn: OpencodeConnection): void {
    this.conn = conn
  }

  get baseUrl(): string {
    return this.conn.baseUrl
  }

  private authHeader(): string {
    const user = this.conn.username ?? "opencode"
    const pass = this.conn.password ?? ""
    return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`
  }

  private buildUrl(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(path, this.conn.baseUrl)
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue
        url.searchParams.set(k, String(v))
      }
    }
    return url.toString()
  }

  async request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { authorization: this.authHeader(), accept: "application/json" }
    if (opts.directory) headers["x-opencode-directory"] = opts.directory
    let bodyInit: string | undefined
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json"
      bodyInit = JSON.stringify(opts.body)
    }
    const res = await fetch(this.buildUrl(path, opts.query), {
      method,
      headers,
      body: bodyInit,
      signal: opts.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new OpencodeHttpError(res.status, path, text)
    }
    if (res.status === 204) return undefined as T
    const text = await res.text()
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      return text as unknown as T
    }
  }

  private get<T>(path: string, opts?: RequestOptions) {
    return this.request<T>("GET", path, opts)
  }
  private post<T>(path: string, opts?: RequestOptions) {
    return this.request<T>("POST", path, opts)
  }
  private patch<T>(path: string, opts?: RequestOptions) {
    return this.request<T>("PATCH", path, opts)
  }
  private del<T>(path: string, opts?: RequestOptions) {
    return this.request<T>("DELETE", path, opts)
  }

  // ---- system / location ----
  info() {
    return this.get<{ version: string; pid: number; urls: string[]; paths: Record<string, string> }>("/api/info")
  }
  location(directory: string) {
    return this.get<{ directory: string; project: { id: string; directory: string; canonical: string } }>(
      "/api/location",
      { directory },
    )
  }

  // ---- catalog ----
  agents(directory: string) {
    return this.get<{ data: Agent[] }>("/api/agent", { directory })
  }
  models(directory: string) {
    return this.get<{ data: OpenCodeModel[] }>("/api/model", { directory })
  }
  modelDefault(directory: string) {
    return this.get<{ data: ModelRef }>("/api/model/default", { directory })
  }
  providers(directory: string) {
    return this.get<{ data: Provider[] }>("/api/provider", { directory })
  }
  skills(directory: string) {
    return this.get<{ data: Skill[] }>("/api/skill", { directory })
  }
  commands(directory: string) {
    return this.get<{ data: Command[] }>("/api/command", { directory })
  }
  mcpList(directory: string) {
    return this.get<{ data: McpEntry[] }>("/api/mcp", { directory })
  }
  mcpConnect(directory: string, name: string) {
    return this.post<void>(`/api/experimental/mcp/${encodeURIComponent(name)}/connect`, { directory })
  }
  mcpDisconnect(directory: string, name: string) {
    return this.post<void>(`/api/experimental/mcp/${encodeURIComponent(name)}/disconnect`, { directory })
  }
  config(directory: string) {
    return this.get<{ data?: unknown } & Record<string, unknown>>("/api/config", { directory })
  }

  // ---- sessions ----
  sessions(
    directory: string,
    opts: { limit?: number; cursor?: string } = {},
  ) {
    return this.get<{ data: OcSession[]; cursor: { previous?: string; next?: string } }>("/api/session", {
      directory,
      query: { limit: opts.limit, cursor: opts.cursor, directory },
    })
  }
  sessionCreate(directory: string, body: Record<string, unknown>) {
    return this.post<{ data: OcSession }>("/api/session", { directory, body })
  }
  sessionGet(id: string, directory?: string) {
    return this.get<{ data: OcSession }>(`/api/session/${encodeURIComponent(id)}`, { directory })
  }
  sessionDelete(id: string, directory?: string) {
    return this.del<void>(`/api/session/${encodeURIComponent(id)}`, { directory })
  }
  sessionUpdate(id: string, body: { title?: string; permissions?: Rule[] }, directory?: string) {
    return this.patch<void>(`/api/session/${encodeURIComponent(id)}`, { directory, body })
  }
  sessionSwitchAgent(id: string, agent: string, directory?: string) {
    return this.post<void>(`/api/session/${encodeURIComponent(id)}/agent`, { directory, body: { agent } })
  }
  sessionSwitchModel(id: string, model: ModelRef, directory?: string) {
    return this.post<void>(`/api/session/${encodeURIComponent(id)}/model`, { directory, body: { model } })
  }
  sessionMessages(
    id: string,
    directory: string,
    opts: { limit?: number; order?: "asc" | "desc"; cursor?: string; type?: string } = {},
  ) {
    return this.get<{ data: OcMessage[]; cursor: { previous?: string; next?: string } }>(
      `/api/session/${encodeURIComponent(id)}/message`,
      { directory, query: { limit: opts.limit, order: opts.order, cursor: opts.cursor, type: opts.type } },
    )
  }
  sessionMessage(id: string, messageID: string, directory: string) {
    return this.get<{ data: OcMessage }>(`/api/session/${encodeURIComponent(id)}/message/${encodeURIComponent(messageID)}`, {
      directory,
    })
  }
  sessionPrompt(id: string, directory: string, body: Record<string, unknown>) {
    return this.post<{ data: { id: string; type: string } }>(`/api/session/${encodeURIComponent(id)}/prompt`, {
      directory,
      body,
    })
  }
  sessionInterrupt(id: string, directory: string) {
    return this.post<unknown>(`/api/session/${encodeURIComponent(id)}/interrupt`, { directory })
  }
  sessionCompact(id: string, directory: string) {
    return this.post<unknown>(`/api/session/${encodeURIComponent(id)}/compact`, { directory })
  }
  sessionContext(id: string, directory: string) {
    return this.get<{ data: OcMessage[] }>(`/api/session/${encodeURIComponent(id)}/context`, { directory })
  }
  /**
   * Transient small-model generation from the current session context (group `session.generate`).
   * Does not mutate session history. Used by the goal audit loop.
   */
  sessionGenerate(id: string, directory: string, prompt: string) {
    return this.post<{ data: { text: string } }>(`/api/session/${encodeURIComponent(id)}/generate`, {
      directory,
      body: { prompt },
    })
  }
  sessionActive(directory?: string) {
    return this.get<{ data: Record<string, { type: string }> }>("/api/session/active", { directory })
  }
  async sessionWait(id: string, directory: string, signal?: AbortSignal) {
    return this.post<void>(`/api/experimental/session/${encodeURIComponent(id)}/wait`, { directory, signal })
  }

  // ---- permissions ----
  permissionReply(sessionID: string, requestID: string, reply: "once" | "always" | "reject", directory?: string) {
    return this.post<void>(
      `/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`,
      { directory, body: { reply } },
    )
  }

  /** Server-Sent Events stream. Yields the `data:` payload strings until aborted. */
  async *stream(path: string, opts: { directory?: string; signal?: AbortSignal } = {}): AsyncGenerator<string> {
    const headers: Record<string, string> = {
      authorization: this.authHeader(),
      accept: "text/event-stream",
      "cache-control": "no-cache",
    }
    if (opts.directory) headers["x-opencode-directory"] = opts.directory
    const res = await fetch(this.buildUrl(path), { headers, signal: opts.signal })
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "")
      throw new OpencodeHttpError(res.status, path, text)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          for (const line of chunk.split("\n")) {
            if (line.startsWith("data:")) yield line.slice(5).trimStart()
          }
        }
      }
    } finally {
      try {
        await reader.cancel()
      } catch {
        /* ignore */
      }
    }
  }
}

export interface Agent {
  id: string
  name: string
  description?: string
  mode: "primary" | "subagent" | "all"
  hidden?: boolean
  permissions?: Rule[]
}

export interface OpenCodeModel {
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

export interface Provider {
  id: string
  name: string
  activation?: string
  package?: string
  settings?: unknown
}

export interface Skill {
  id: string
  name: string
  description?: string
  path?: string
  content?: string
}

export interface Command {
  name: string
  description?: string
}

export interface McpEntry {
  name: string
  status: string | { status: string; error?: string }
  integrationID?: string
}

export interface OcSession {
  id: string
  projectID?: string
  agent?: string
  model?: ModelRef
  tokens?: TokenUsage
  cost?: number
  time?: { created?: number; updated?: number; idle?: number }
  title?: string
  parentID?: string
  location?: { directory?: string }
}

export interface TokenUsage {
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
  total?: number
}

export interface OcMessage {
  id: string
  type: string
  time?: { created?: number; completed?: number; streamed?: number }
  text?: string
  content?: ContentPart[]
  tokens?: TokenUsage
  cost?: number
  agent?: string
  model?: ModelRef
  outcome?: string
  [key: string]: unknown
}

export interface ContentPart {
  type: string
  text?: string
  [key: string]: unknown
}
