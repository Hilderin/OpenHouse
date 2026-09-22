import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react"
import { api, ApiError } from "./api"
import { initialState, reducer, type CatalogKind, type AppState, type DrawerKind } from "./store"
import { sse } from "./sse"
import type { Goal, ModelRef, OhEvent, Session, SessionMessage } from "./types"

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const PROJECT_STORAGE_KEY = "openhouse.selectedProjectId"

function readStoredProject(): string | undefined {
  try {
    const hash = window.location.hash
    const m = /(?:^|[#&])project=([^&]+)/.exec(hash)
    if (m?.[1]) return decodeURIComponent(m[1])
    return window.localStorage.getItem(PROJECT_STORAGE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function storeProject(id?: string): void {
  try {
    if (id) window.localStorage.setItem(PROJECT_STORAGE_KEY, id)
    else window.localStorage.removeItem(PROJECT_STORAGE_KEY)
  } catch {
    /* storage is best-effort */
  }
}

export interface AppApi {
  state: AppState
  selectProject(id?: string): void
  addProject(input: { path: string; name?: string }): Promise<void>
  updateProject(id: string, patch: { name?: string; defaultAgent?: string; defaultModel?: ModelRef }): Promise<void>
  removeProject(id: string): Promise<void>
  refreshProjects(): Promise<void>
  refreshSessions(): Promise<void>
  setIncludeArchived(value: boolean): void
  toggleChildren(parentId: string): Promise<void>
  openSession(session: Session): Promise<void>
  closeSession(): void
  createSession(): Promise<Session | undefined>
  updateSession(id: string, patch: { title?: string; archived?: boolean; pinned?: boolean }): Promise<void>
  deleteSession(id: string): Promise<void>
  switchModel(model: ModelRef): Promise<void>
  switchAgent(agent: string): Promise<void>
  sendPrompt(text: string): Promise<void>
  interrupt(): Promise<void>
  compact(): Promise<void>
  refreshStatus(id: string): Promise<void>
  refreshChildren(id: string): Promise<void>
  setGoal(input: { objective: string; budgetTokens?: number; maxTurns?: number }): Promise<void>
  pauseGoal(): Promise<void>
  resumeGoal(): Promise<void>
  clearGoal(): Promise<void>
  refreshSchedules(): Promise<void>
  createSchedule(input: {
    name: string
    cron: string
    prompt: string
    agent?: string
    model?: ModelRef
    goal?: { objective: string; budgetTokens?: number; maxTurns?: number }
  }): Promise<void>
  toggleSchedule(id: string): Promise<void>
  runSchedule(id: string): Promise<void>
  deleteSchedule(id: string): Promise<void>
  setMcp(name: string, mode: "enable" | "disable"): Promise<void>
  refreshAudit(): Promise<void>
  refreshPlugin(): Promise<void>
  refreshCatalog(kind?: CatalogKind): Promise<void>
  setDrawer(drawer?: DrawerKind): void
  toggleDrawer(drawer: DrawerKind): void
}

const Ctx = createContext<AppApi | null>(null)

export function useApp(): AppApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>")
  return ctx
}

export function useAppState(): AppState {
  return useApp().state
}

export function AppProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, dispatch] = useReducer(reducer, initialState)
  const stateRef = useRef(state)
  stateRef.current = state

  const projectId = state.selectedProjectId
  const openSessionId = state.chat.sessionId

  // ---- health ----
  const refreshHealth = useCallback(async () => {
    try {
      dispatch({ type: "health", health: await api.health() })
    } catch (e) {
      dispatch({ type: "health", error: errText(e) })
    }
  }, [])

  const refreshPlugin = useCallback(async () => {
    try {
      dispatch({ type: "plugin", plugin: await api.plugin() })
    } catch {
      /* plugin status is best-effort */
    }
  }, [])

  // ---- projects ----
  const refreshProjects = useCallback(async () => {
    dispatch({ type: "projects/loading" })
    try {
      const projects = await api.listProjects()
      dispatch({ type: "projects", projects })
      const stored = readStoredProject()
      if (!stateRef.current.selectedProjectId && stored && projects.some((p) => p.id === stored)) {
        dispatch({ type: "projects/select", id: stored })
      }
    } catch (e) {
      dispatch({ type: "projects/error", error: errText(e) })
    }
  }, [])

  const addProject = useCallback(async (input: { path: string; name?: string }) => {
    try {
      const project = await api.addProject(input)
      dispatch({ type: "project/upsert", project })
      dispatch({ type: "projects/select", id: project.id })
    } catch (e) {
      dispatch({ type: "projects/error", error: errText(e) })
    }
  }, [])

  const updateProject = useCallback(
    async (id: string, patch: { name?: string; defaultAgent?: string; defaultModel?: ModelRef }) => {
      try {
        const project = await api.updateProject(id, patch)
        dispatch({ type: "project/upsert", project })
      } catch (e) {
        dispatch({ type: "projects/error", error: errText(e) })
      }
    },
    [],
  )

  const removeProject = useCallback(async (id: string) => {
    try {
      await api.removeProject(id)
      dispatch({ type: "project/upsert", project: { id } as never, deleted: true })
      if (stateRef.current.selectedProjectId === id) dispatch({ type: "projects/select", id: undefined })
    } catch (e) {
      dispatch({ type: "projects/error", error: errText(e) })
    }
  }, [])

  // ---- catalog ----
  const refreshCatalog = useCallback(async (kind?: CatalogKind) => {
    const pid = stateRef.current.selectedProjectId
    if (!pid) return
    const kinds: CatalogKind[] = kind ? [kind] : ["models", "agents", "skills", "commands", "mcp"]
    for (const k of kinds) {
      const slice: CatalogKind = k === "providers" ? "models" : k
      dispatch({ type: "catalog/loading", kind: slice })
      try {
        if (slice === "models") {
          const res = await api.models(pid)
          dispatch({ type: "catalog/models", models: res.models, default: res.default })
        } else if (slice === "agents") {
          dispatch({ type: "catalog/agents", agents: await api.agents(pid) })
        } else if (slice === "skills") {
          dispatch({ type: "catalog/skills", skills: await api.skills(pid) })
        } else if (slice === "commands") {
          dispatch({ type: "catalog/commands", commands: await api.commands(pid) })
        } else if (slice === "mcp") {
          dispatch({ type: "catalog/mcp", servers: await api.mcp(pid) })
        }
      } catch (e) {
        dispatch({ type: "catalog/error", kind: slice, error: errText(e) })
      }
    }
  }, [])

  const loadLevels = useCallback(async () => {
    try {
      dispatch({ type: "levels", levels: await api.levels() })
    } catch {
      /* levels are optional */
    }
  }, [])

  // ---- sessions ----
  const refreshSessions = useCallback(async () => {
    const pid = stateRef.current.selectedProjectId
    if (!pid) {
      dispatch({ type: "sessions", sessions: [] })
      return
    }
    dispatch({ type: "sessions/loading" })
    try {
      const res = await api.listSessions(pid, { includeArchived: stateRef.current.includeArchived, limit: 100 })
      dispatch({ type: "sessions", sessions: res.sessions })
    } catch (e) {
      dispatch({ type: "sessions/error", error: errText(e) })
    }
  }, [])

  const setIncludeArchived = useCallback((value: boolean) => {
    dispatch({ type: "sessions/includeArchived", value })
  }, [])

  const toggleChildren = useCallback(async (parentId: string) => {
    const already = stateRef.current.expandedChildren.includes(parentId)
    if (already) {
      dispatch({ type: "children/toggle", parentId })
      return
    }
    dispatch({ type: "children/toggle", parentId })
    if (!stateRef.current.childSessions[parentId]) {
      try {
        dispatch({ type: "children/loaded", parentId, children: await api.children(parentId) })
      } catch {
        /* children are best-effort */
      }
    }
  }, [])

  // ---- schedules ----
  const refreshSchedules = useCallback(async () => {
    const pid = stateRef.current.selectedProjectId
    if (!pid) {
      dispatch({ type: "schedules", schedules: [] })
      return
    }
    dispatch({ type: "schedules/loading" })
    try {
      dispatch({ type: "schedules", schedules: await api.schedules(pid) })
    } catch (e) {
      dispatch({ type: "schedules/error", error: errText(e) })
    }
  }, [])

  // ---- audit ----
  const refreshAudit = useCallback(async () => {
    try {
      dispatch({ type: "audit", entries: await api.audit(100) })
    } catch (e) {
      dispatch({ type: "audit/error", error: errText(e) })
    }
  }, [])

  // ---- chat ----
  const openSession = useCallback(async (session: Session) => {
    dispatch({ type: "chat/open", session })
    try {
      const res = await api.messages(session.id, { order: "asc", limit: 200 })
      dispatch({ type: "chat/messages", messages: res.messages })
    } catch (e) {
      dispatch({ type: "chat/error", error: errText(e) })
    }
    void refreshStatus(session.id)
    void refreshChildren(session.id)
    void loadGoal(session.id)
  }, [])

  const refreshStatus = useCallback(async (id: string) => {
    try {
      dispatch({ type: "chat/status", status: await api.status(id) })
    } catch {
      /* status is best-effort */
    }
  }, [])

  const refreshChildren = useCallback(async (id: string) => {
    try {
      dispatch({ type: "chat/children", children: await api.children(id) })
    } catch {
      /* children are best-effort */
    }
  }, [])

  const loadGoal = useCallback(async (id: string) => {
    try {
      const goal = await api.getGoal(id)
      dispatch({ type: "chat/goal", goal, loading: false })
    } catch {
      dispatch({ type: "chat/goal", goal: null, loading: false })
    }
  }, [])

  const closeSession = useCallback(() => dispatch({ type: "chat/close" }), [])

  const createSession = useCallback(async () => {
    const pid = stateRef.current.selectedProjectId
    if (!pid) return undefined
    try {
      // No title: OpenCode generates it and it arrives later via session.updated.
      const session = await api.createSession({ projectId: pid })
      dispatch({ type: "session/upsert", session })
      await openSession(session)
      void refreshSessions()
      return session
    } catch (e) {
      dispatch({ type: "sessions/error", error: errText(e) })
      return undefined
    }
  }, [openSession, refreshSessions])

  const updateSession = useCallback(
    async (id: string, patch: { title?: string; archived?: boolean; pinned?: boolean }) => {
      try {
        const session = await api.updateSession(id, patch)
        dispatch({ type: "session/upsert", session })
      } catch (e) {
        dispatch({ type: "sessions/error", error: errText(e) })
      }
    },
    [],
  )

  const switchModel = useCallback(async (model: ModelRef) => {
    const id = stateRef.current.chat.sessionId
    if (!id) return
    try {
      const session = await api.switchModel(id, model)
      dispatch({ type: "session/upsert", session })
      dispatch({ type: "chat/session", session })
    } catch (e) {
      dispatch({ type: "chat/error", error: errText(e) })
    }
  }, [])

  const switchAgent = useCallback(async (agent: string) => {
    const id = stateRef.current.chat.sessionId
    if (!id) return
    try {
      const session = await api.switchAgent(id, agent)
      dispatch({ type: "session/upsert", session })
      dispatch({ type: "chat/session", session })
    } catch (e) {
      dispatch({ type: "chat/error", error: errText(e) })
    }
  }, [])

  const deleteSession = useCallback(async (id: string) => {
    try {
      await api.deleteSession(id)
      dispatch({ type: "session/upsert", session: { id } as never, deleted: true })
      if (stateRef.current.chat.sessionId === id) dispatch({ type: "chat/close" })
    } catch (e) {
      dispatch({ type: "sessions/error", error: errText(e) })
    }
  }, [])

  const sendPrompt = useCallback(
    async (text: string) => {
      const id = stateRef.current.chat.sessionId
      if (!id || !text.trim()) return
      dispatch({ type: "chat/sending", value: true })
      try {
        const message = await api.prompt(id, { text })
        dispatch({ type: "chat/message", message })
        void refreshStatus(id)
      } catch (e) {
        dispatch({ type: "chat/error", error: errText(e) })
      } finally {
        dispatch({ type: "chat/sending", value: false })
      }
    },
    [refreshStatus],
  )

  const interrupt = useCallback(async () => {
    const id = stateRef.current.chat.sessionId
    if (!id) return
    try {
      await api.interrupt(id)
    } catch (e) {
      dispatch({ type: "chat/error", error: errText(e) })
    }
  }, [])

  const compact = useCallback(async () => {
    const id = stateRef.current.chat.sessionId
    if (!id) return
    try {
      await api.compact(id)
    } catch (e) {
      dispatch({ type: "chat/error", error: errText(e) })
    }
  }, [])

  const setGoal = useCallback(
    async (input: { objective: string; budgetTokens?: number; maxTurns?: number }) => {
      const id = stateRef.current.chat.sessionId
      if (!id) return
      dispatch({ type: "chat/goal", goal: stateRef.current.chat.goal, loading: true })
      try {
        const goal = await api.setGoal(id, input)
        dispatch({ type: "chat/goal", goal })
      } catch (e) {
        dispatch({ type: "chat/error", error: errText(e) })
        dispatch({ type: "chat/goal", goal: stateRef.current.chat.goal, loading: false })
      }
    },
    [],
  )

  const pauseGoal = useCallback(async () => {
    const id = stateRef.current.chat.sessionId
    if (!id) return
    try {
      dispatch({ type: "chat/goal", goal: await api.pauseGoal(id) })
    } catch (e) {
      dispatch({ type: "chat/error", error: errText(e) })
    }
  }, [])

  const resumeGoal = useCallback(async () => {
    const id = stateRef.current.chat.sessionId
    if (!id) return
    try {
      dispatch({ type: "chat/goal", goal: await api.resumeGoal(id) })
    } catch (e) {
      dispatch({ type: "chat/error", error: errText(e) })
    }
  }, [])

  const clearGoal = useCallback(async () => {
    const id = stateRef.current.chat.sessionId
    if (!id) return
    try {
      await api.clearGoal(id)
      dispatch({ type: "chat/goal", goal: null })
    } catch (e) {
      dispatch({ type: "chat/error", error: errText(e) })
    }
  }, [])

  const createSchedule = useCallback<AppApi["createSchedule"]>(
    async (input) => {
      const pid = stateRef.current.selectedProjectId
      if (!pid) return
      try {
        const schedule = await api.createSchedule({ projectId: pid, ...input })
        dispatch({ type: "schedule/upsert", schedule })
      } catch (e) {
        dispatch({ type: "schedules/error", error: errText(e) })
      }
    },
    [],
  )

  const toggleSchedule = useCallback(async (id: string) => {
    try {
      dispatch({ type: "schedule/upsert", schedule: await api.toggleSchedule(id) })
    } catch (e) {
      dispatch({ type: "schedules/error", error: errText(e) })
    }
  }, [])

  const runSchedule = useCallback(
    async (id: string) => {
      try {
        const res = await api.runSchedule(id)
        void refreshSessions()
        if (res.sessionId) {
          const session = await api.getSession(res.sessionId)
          await openSession(session)
        }
      } catch (e) {
        dispatch({ type: "schedules/error", error: errText(e) })
      }
    },
    [openSession, refreshSessions],
  )

  const deleteSchedule = useCallback(async (id: string) => {
    try {
      await api.deleteSchedule(id)
      dispatch({ type: "schedules", schedules: stateRef.current.schedules.filter((s) => s.id !== id) })
    } catch (e) {
      dispatch({ type: "schedules/error", error: errText(e) })
    }
  }, [])

  const setMcp = useCallback(
    async (name: string, mode: "enable" | "disable") => {
      const pid = stateRef.current.selectedProjectId
      if (!pid) return
      dispatch({ type: "catalog/loading", kind: "mcp" })
      try {
        dispatch({ type: "catalog/mcp", servers: await api.mcpSet(pid, name, mode) })
      } catch (e) {
        dispatch({ type: "catalog/error", kind: "mcp", error: errText(e) })
      }
    },
    [],
  )

  const setDrawer = useCallback((drawer?: DrawerKind) => dispatch({ type: "drawer/set", drawer }), [])

  const toggleDrawer = useCallback((drawer: DrawerKind) => {
    dispatch({ type: "drawer/set", drawer: stateRef.current.drawer === drawer ? undefined : drawer })
  }, [])

  // ---- desktop notifications (only when the window is not focused) ----
  const notifiedRef = useRef(new Set<string>())
  const notify = useCallback((key: string, title: string, body?: string) => {
    if (typeof Notification === "undefined") return
    if (document.hasFocus()) return
    if (Notification.permission !== "granted") return
    if (notifiedRef.current.has(key)) return
    notifiedRef.current.add(key)
    try {
      const n = new Notification(title, { body, silent: false })
      n.onclick = () => {
        window.focus()
        n.close()
      }
    } catch {
      /* notifications are best-effort */
    }
  }, [])

  // Request permission on the first user interaction.
  useEffect(() => {
    if (typeof Notification === "undefined" || Notification.permission !== "default") return
    const request = () => {
      void Notification.requestPermission()
      window.removeEventListener("pointerdown", request)
      window.removeEventListener("keydown", request)
    }
    window.addEventListener("pointerdown", request, { once: true })
    window.addEventListener("keydown", request, { once: true })
    return () => {
      window.removeEventListener("pointerdown", request)
      window.removeEventListener("keydown", request)
    }
  }, [])

  // ---- SSE wiring ----
  useEffect(() => {
    const offStatus = sse.onStatus((s) => dispatch({ type: "sse", status: s }))
    sse.connect()

    const offs: Array<() => void> = []
    const on = (type: Parameters<typeof sse.on>[0], fn: (e: OhEvent) => void) => {
      offs.push(sse.on(type, fn as (e: OhEvent) => void))
    }

    on("opencode.status", (e) => {
      const d = e.data as { status?: string }
      if (d?.status) {
        const current = stateRef.current.health
        dispatch({
          type: "health",
          health: current
            ? { ...current, ok: d.status === "ready", opencode: { ...current.opencode, status: d.status as never } }
            : undefined,
        })
      }
      void refreshHealth()
    })

    on("session.updated", (e) => {
      const d = e.data as { session?: Session; deleted?: boolean }
      if (d?.deleted && e.sessionId) dispatch({ type: "session/upsert", session: { id: e.sessionId } as Session, deleted: true })
      else if (d?.session) dispatch({ type: "session/upsert", session: d.session })
    })

    on("session.status", (e) => {
      const d = e.data as { sessionId?: string; status?: Session["status"]; reason?: string; goal?: Goal }
      const sid = d?.sessionId
      if (!sid || !d?.status) return
      const prev = stateRef.current.sessions.find((s) => s.id === sid)?.status
      dispatch({ type: "session/status", sessionId: sid, status: d.status, goal: d.goal })

      const isOpen = stateRef.current.chat.sessionId === sid
      const session = stateRef.current.sessions.find((s) => s.id === sid)
      const title = session?.title || sid
      if (!isOpen) {
        const failed = d.status === "idle" && (d.reason === "failed" || d.reason === "interrupted")
        if (failed) {
          notify(`status:${sid}:${d.reason}`, `Session ${d.reason === "interrupted" ? "interrupted" : "failed"}`, title)
        } else if (d.status === "idle" && prev && prev !== "idle") {
          notify(`status:${sid}:idle:${session?.time.updated ?? Date.now()}`, "Session finished", title)
        }
      }
    })

    on("session.question", (e) => {
      const d = e.data as { sessionId?: string }
      const sid = d?.sessionId ?? e.sessionId
      const session = stateRef.current.sessions.find((s) => s.id === sid)
      notify(`question:${sid ?? "unknown"}`, "A session is waiting for an answer", session?.title || sid)
    })

    on("session.message", (e) => {
      const d = e.data as { sessionId?: string; message?: SessionMessage }
      if (d?.message && stateRef.current.chat.sessionId === (d.sessionId ?? e.sessionId)) {
        dispatch({ type: "chat/message", message: d.message })
        void refreshStatus(d.sessionId ?? e.sessionId ?? "")
        void refreshChildren(d.sessionId ?? e.sessionId ?? "")
      }
    })

    on("session.delta", (e) => {
      const d = e.data as { sessionId?: string; messageId?: string; kind?: string; delta?: string }
      if (stateRef.current.chat.sessionId !== (d.sessionId ?? e.sessionId)) return
      if (d?.messageId && d.delta) dispatch({ type: "chat/delta", messageId: d.messageId, delta: d.delta, kind: d.kind ?? "text" })
    })

    on("session.context", (e) => {
      const d = e.data as {
        sessionId?: string
        tokens?: unknown
        cost?: number
        context?: {
          used: number
          limit: number
          percent: number
          model?: ModelRef
          unknownAfterCompaction: boolean
        }
      }
      const sid = d?.sessionId ?? e.sessionId
      if (!sid || !d.context) return
      if (stateRef.current.chat.sessionId === sid) {
        const prev = stateRef.current.chat.status
        dispatch({
          type: "chat/status",
          status: prev
            ? { ...prev, tokens: (d.tokens as never) ?? prev.tokens, cost: d.cost ?? prev.cost, context: d.context }
            : {
                sessionId: sid,
                status: stateRef.current.chat.session?.status ?? "idle",
                tokens: (d.tokens as never) ?? {},
                cost: d.cost ?? 0,
                context: d.context,
              },
        })
      }
    })

    on("goal.updated", (e) => {
      const d = e.data as { goal?: Goal }
      const goal = d?.goal
      if (!goal) return
      if (stateRef.current.chat.sessionId === goal.sessionId) dispatch({ type: "chat/goal", goal })
      dispatch({ type: "session/status", sessionId: goal.sessionId, status: stateRef.current.chat.session?.status ?? "idle", goal })
      if (goal.state === "complete" || goal.state === "blocked" || goal.state === "aborted") {
        const session = stateRef.current.sessions.find((s) => s.id === goal.sessionId)
        notify(
          `goal:${goal.sessionId}:${goal.state}`,
          `Goal ${goal.state}`,
          session?.title || goal.objective,
        )
      }
    })

    on("schedule.run", (e) => {
      const d = e.data as { scheduleId?: string; status?: string; error?: string }
      if (!d?.scheduleId) return
      void refreshSchedules()
      void refreshSessions()
      if (d.status === "error") {
        dispatch({ type: "schedules/error", error: "A scheduled run failed" })
        const schedule = stateRef.current.schedules.find((s) => s.id === d.scheduleId)
        notify(`schedule:${d.scheduleId}:error`, "Scheduled run failed", schedule?.name || d.error || d.scheduleId)
      }
    })

    on("autoaccept", (e) => {
      const d = e.data as { entry?: AppState["audit"][number] }
      if (d?.entry) dispatch({ type: "audit/prepend", entry: d.entry })
    })

    on("catalog.updated", (e) => {
      const d = e.data as { projectId?: string; kind?: CatalogKind }
      const pid = d?.projectId ?? e.projectId
      if (!pid || pid !== stateRef.current.selectedProjectId) return
      if (d?.kind) void refreshCatalog(d.kind)
      else void refreshCatalog()
    })

    on("project.updated", (e) => {
      const d = e.data as { project?: { id: string } }
      if (d?.project) void refreshProjects()
    })

    on("snapshot", () => {
      void refreshHealth()
    })

    return () => {
      offStatus()
      for (const off of offs) off()
      sse.close()
    }
  }, [notify, refreshCatalog, refreshChildren, refreshHealth, refreshProjects, refreshSchedules, refreshSessions, refreshStatus])

  // ---- initial loads ----
  useEffect(() => {
    void refreshHealth()
    void refreshProjects()
    void refreshPlugin()
    void loadLevels()
    void refreshAudit()
  }, [loadLevels, refreshAudit, refreshHealth, refreshPlugin, refreshProjects])

  // ---- react to project selection ----
  useEffect(() => {
    storeProject(projectId)
    if (!projectId) {
      dispatch({ type: "sessions", sessions: [] })
      dispatch({ type: "schedules", schedules: [] })
      dispatch({ type: "chat/close" })
      return
    }
    dispatch({ type: "chat/close" })
    void refreshSessions()
    void refreshCatalog()
    void refreshSchedules()
  }, [projectId, refreshCatalog, refreshSchedules, refreshSessions])

  // ---- react to includeArchived ----
  useEffect(() => {
    if (projectId) void refreshSessions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.includeArchived])

  // ---- poll open-session status while busy ----
  useEffect(() => {
    if (!openSessionId) return
    const timer = setInterval(() => {
      const status = stateRef.current.chat.session?.status
      if (status === "busy" || status === "retry") void refreshStatus(openSessionId)
    }, 5000)
    return () => clearInterval(timer)
  }, [openSessionId, refreshStatus])

  const value = useMemo<AppApi>(
    () => ({
      state,
      selectProject: (id) => dispatch({ type: "projects/select", id }),
      addProject,
      updateProject,
      removeProject,
      refreshProjects,
      refreshSessions,
      setIncludeArchived,
      toggleChildren,
      openSession,
      closeSession,
      createSession,
      updateSession,
      deleteSession,
      switchModel,
      switchAgent,
      sendPrompt,
      interrupt,
      compact,
      refreshStatus,
      refreshChildren,
      setGoal,
      pauseGoal,
      resumeGoal,
      clearGoal,
      refreshSchedules,
      createSchedule,
      toggleSchedule,
      runSchedule,
      deleteSchedule,
      setMcp,
      refreshAudit,
      refreshPlugin,
      refreshCatalog,
      setDrawer,
      toggleDrawer,
    }),
    [
      state,
      addProject,
      updateProject,
      removeProject,
      refreshProjects,
      refreshSessions,
      setIncludeArchived,
      toggleChildren,
      openSession,
      closeSession,
      createSession,
      updateSession,
      deleteSession,
      switchModel,
      switchAgent,
      sendPrompt,
      interrupt,
      compact,
      refreshStatus,
      refreshChildren,
      setGoal,
      pauseGoal,
      resumeGoal,
      clearGoal,
      refreshSchedules,
      createSchedule,
      toggleSchedule,
      runSchedule,
      deleteSchedule,
      setMcp,
      refreshAudit,
      refreshPlugin,
      refreshCatalog,
      setDrawer,
      toggleDrawer,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export { ApiError }
