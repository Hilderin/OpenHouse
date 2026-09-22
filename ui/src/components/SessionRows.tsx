import type { ReactNode } from "react"
import { useApp } from "../app-context"
import type { Session } from "../types"
import { formatNumber, modelLabel, relativeTime, truncate } from "../format"
import { ErrorBanner, Spinner } from "./common"

function StatusIcon({ status }: { status: Session["status"] }): ReactNode {
  if (status === "busy") return <span className="row-status busy" title="busy" />
  if (status === "retry") return <span className="row-status retry" title="retry">!</span>
  if (status === "idle") return <span className="row-status idle" title="idle">✓</span>
  return <span className="row-status unknown" title="unknown" />
}

function contextPercent(session: Session, models: { providerID: string; id: string; limit?: { context?: number } }[]): number | undefined {
  const used = session.tokens?.total ?? (session.tokens?.input ?? 0) + (session.tokens?.output ?? 0)
  const limit = models.find((m) => m.providerID === session.model?.providerID && m.id === session.model?.id)?.limit?.context
  if (!limit) return undefined
  return Math.min(100, Math.round((used / limit) * 100))
}

function SessionRow({
  session,
  child = false,
}: {
  session: Session
  child?: boolean
}): ReactNode {
  const { state, openSession, updateSession, deleteSession, toggleChildren } = useApp()
  const isOpen = state.chat.sessionId === session.id
  const percent = contextPercent(session, state.models.data)
  const expanded = state.expandedChildren.includes(session.id)
  const children = state.childSessions[session.id]
  const hasChildrenHint = !child && (session.parentID === undefined)

  return (
    <>
      <div className={`session-row${child ? " child" : ""}${isOpen ? " active" : ""}`}>
        {hasChildrenHint ? (
          <button
            className={`chevron${expanded ? " open" : ""}`}
            title={expanded ? "Collapse sub-agents" : "Expand sub-agents"}
            onClick={(e) => {
              e.stopPropagation()
              void toggleChildren(session.id)
            }}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="chevron-spacer" />
        )}

        <button className="session-row-main" onClick={() => void openSession(session)} title={session.title}>
          <StatusIcon status={session.status} />
          <span className="session-row-title">{truncate(session.title || "(untitled)", 60)}</span>
          {session.pinned ? <span className="pin" title="Pinned">★</span> : null}
          {session.archived ? <span className="muted small" title="Archived">▣</span> : null}
          <span className="session-row-meta">
            {session.agent ? <span className="muted small">{session.agent}</span> : null}
            <span className="muted small">{relativeTime(session.time.updated ?? session.time.created)}</span>
            {percent !== undefined ? (
              <span
                className={`ctx-pct${percent > 85 ? " bad" : percent > 60 ? " warn" : ""}`}
                title={`${formatNumber(session.tokens?.total)} tokens · ${percent}% context`}
              >
                {percent}%
              </span>
            ) : null}
          </span>
        </button>

        <span className="session-row-actions">
          <button
            className="icon-btn tiny"
            title={session.pinned ? "Unpin" : "Pin"}
            onClick={(e) => {
              e.stopPropagation()
              void updateSession(session.id, { pinned: !session.pinned })
            }}
          >
            {session.pinned ? "☆" : "★"}
          </button>
          <button
            className="icon-btn tiny"
            title={session.archived ? "Unarchive" : "Archive"}
            onClick={(e) => {
              e.stopPropagation()
              void updateSession(session.id, { archived: !session.archived })
            }}
          >
            {session.archived ? "↺" : "▣"}
          </button>
          <button
            className="icon-btn tiny danger"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation()
              void deleteSession(session.id)
            }}
          >
            ×
          </button>
        </span>
      </div>

      {!child && expanded ? (
        <div className="child-list">
          {children === undefined ? (
            <div className="muted small child-loading">Loading sub-agents…</div>
          ) : children.length === 0 ? (
            <div className="muted small child-loading">No sub-agents.</div>
          ) : (
            children.map((c) => <SessionRow key={c.id} session={c} child />)
          )}
        </div>
      ) : null}
    </>
  )
}

export function SessionRows(): ReactNode {
  const { state, refreshSessions, setIncludeArchived } = useApp()

  const roots = state.sessions.filter((s) => !s.parentID)
  const visible = state.includeArchived ? roots : roots.filter((s) => !s.archived)

  return (
    <div className="sessions">
      <div className="sessions-head">
        <span className="section-title">Sessions{state.sessions.length ? ` · ${roots.length}` : ""}</span>
        <label className="check" title="Include archived sessions">
          <input
            type="checkbox"
            checked={state.includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          <span className="small">Archived</span>
        </label>
        <button className="icon-btn" onClick={() => void refreshSessions()} title="Refresh">
          ⟳
        </button>
      </div>

      <ErrorBanner error={state.sessionsError} onRetry={() => void refreshSessions()} />

      {state.sessionsLoading && state.sessions.length === 0 ? <Spinner label="Loading sessions…" /> : null}

      {!state.sessionsLoading && visible.length === 0 ? (
        <div className="empty small">
          {state.selectedProjectId ? "No sessions. Use ＋ to create one." : "Select a project."}
        </div>
      ) : (
        <div className="session-rows">
          {visible.map((s) => (
            <SessionRow key={s.id} session={s} />
          ))}
        </div>
      )}

      {state.chat.session ? (
        <div className="sessions-foot muted small" title={`${modelLabel(state.chat.session.model)} · ${state.chat.session.id}`}>
          {truncate(state.chat.session.title || state.chat.session.id, 30)}
        </div>
      ) : null}
    </div>
  )
}
