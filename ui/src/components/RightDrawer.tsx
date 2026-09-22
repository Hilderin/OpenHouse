import type { ReactNode } from "react"
import { useApp } from "../app-context"
import type { DrawerKind } from "../store"
import { Badge, Empty, ErrorBanner, Spinner } from "./common"
import { formatNumber, modelLabel, pct, relativeTime } from "../format"

const TOOLBAR: { kind: DrawerKind; icon: string; label: string }[] = [
  { kind: "status", icon: "◉", label: "Chat status" },
  { kind: "skills", icon: "✦", label: "Skills" },
  { kind: "commands", icon: "⌘", label: "Commands" },
  { kind: "mcp", icon: "⚯", label: "MCP" },
  { kind: "schedules", icon: "⏰", label: "Schedules" },
  { kind: "autoaccept", icon: "✓", label: "Auto-accept" },
]

export function RightToolbar(): ReactNode {
  const { state, toggleDrawer } = useApp()
  return (
    <nav className="toolbar" aria-label="Panels">
      {TOOLBAR.map((t) => (
        <button
          key={t.kind}
          className={`toolbar-btn${state.drawer === t.kind ? " active" : ""}`}
          title={t.label}
          aria-label={t.label}
          onClick={() => toggleDrawer(t.kind)}
        >
          {t.icon}
        </button>
      ))}
    </nav>
  )
}

export function DrawerPanel(): ReactNode {
  const { state } = useApp()
  if (!state.drawer) return null
  const title = TOOLBAR.find((t) => t.kind === state.drawer)?.label ?? state.drawer
  return (
    <div className="drawer">
      <div className="drawer-head">
        <span>{title}</span>
      </div>
      <div className="drawer-body">
        {state.drawer === "status" ? <StatusDrawer /> : null}
        {state.drawer === "skills" ? <SkillsDrawer /> : null}
        {state.drawer === "commands" ? <CommandsDrawer /> : null}
        {state.drawer === "mcp" ? <McpDrawer /> : null}
        {state.drawer === "schedules" ? <SchedulesDrawer /> : null}
        {state.drawer === "autoaccept" ? <AutoAcceptDrawer /> : null}
      </div>
    </div>
  )
}

function StatusDrawer(): ReactNode {
  const { state, refreshStatus, refreshChildren } = useApp()
  const { chat } = state
  const session = chat.session
  const status = chat.status
  const ctx = status?.context
  if (!session) return <Empty>No session open.</Empty>
  const percent = ctx ? ctx.percent || pct(ctx.used, ctx.limit) : 0

  return (
    <div className="drawer-list">
      <Row label="Status" value={session.status} />
      <Row label="Session" value={session.title || session.id} />
      <Row label="Model" value={modelLabel(ctx?.model ?? session.model)} />
      <Row label="Agent" value={session.agent || "—"} />
      <Row
        label="Context"
        value={`${formatNumber(ctx?.used)} / ${ctx?.limit ? formatNumber(ctx.limit) : "?"} (${percent}%)`}
      />
      <Row label="Cost" value={`$${(status?.cost ?? session.cost ?? 0).toFixed(4)}`} />
      <Row label="Sub-agents" value={String(chat.children.length)} />
      {ctx?.unknownAfterCompaction ? <Badge tone="warn">context unknown after compaction</Badge> : null}
      <div className="row gap">
        <button className="btn btn-ghost btn-xs" onClick={() => void refreshStatus(session.id)}>
          Refresh
        </button>
        <button className="btn btn-ghost btn-xs" onClick={() => void refreshChildren(session.id)}>
          Refresh children
        </button>
      </div>
    </div>
  )
}

function SkillsDrawer(): ReactNode {
  const { state } = useApp()
  const cat = state.skills
  if (cat.loading && cat.data.length === 0) return <Spinner label="Loading skills…" />
  if (cat.error) return <ErrorBanner error={cat.error} />
  if (cat.data.length === 0) return <Empty>No skills discovered.</Empty>
  return (
    <ul className="drawer-list plain">
      {cat.data.map((s) => (
        <li key={s.id} className="drawer-item">
          <div className="drawer-item-name">{s.name || s.id}</div>
          {s.description ? <div className="muted small">{s.description}</div> : null}
          {s.path ? <div className="muted small ellipsis">{s.path}</div> : null}
        </li>
      ))}
    </ul>
  )
}

function CommandsDrawer(): ReactNode {
  const { state } = useApp()
  const cat = state.commands
  if (cat.loading && cat.data.length === 0) return <Spinner label="Loading commands…" />
  if (cat.error) return <ErrorBanner error={cat.error} />
  if (cat.data.length === 0) return <Empty>No commands available.</Empty>
  return (
    <ul className="drawer-list plain">
      {cat.data.map((c) => (
        <li key={c.name} className="drawer-item">
          <div className="drawer-item-name">/{c.name}</div>
          {c.description ? <div className="muted small">{c.description}</div> : null}
        </li>
      ))}
    </ul>
  )
}

function McpDrawer(): ReactNode {
  const { state, setMcp } = useApp()
  const cat = state.mcp
  if (cat.loading && cat.data.length === 0) return <Spinner label="Loading MCP…" />
  if (cat.error) return <ErrorBanner error={cat.error} />
  if (cat.data.length === 0) return <Empty>No MCP servers.</Empty>
  return (
    <ul className="drawer-list plain">
      {cat.data.map((s) => (
        <li key={s.name} className="drawer-item">
          <div className="row between">
            <div className="row gap">
              <span className="drawer-item-name">{s.name}</span>
              <Badge
                tone={
                  s.status === "connected"
                    ? "good"
                    : s.status === "failed" || s.status === "needs_auth"
                      ? "bad"
                      : s.status === "disabled"
                        ? "warn"
                        : "neutral"
                }
              >
                {s.status}
              </Badge>
            </div>
            <button className="btn btn-ghost btn-xs" onClick={() => void setMcp(s.name, s.enabled ? "disable" : "enable")}>
              {s.enabled ? "Disable" : "Enable"}
            </button>
          </div>
          {s.tools?.length ? <div className="muted small">{s.tools.length} tools</div> : null}
        </li>
      ))}
    </ul>
  )
}

function SchedulesDrawer(): ReactNode {
  const { state, toggleSchedule, runSchedule, deleteSchedule } = useApp()
  if (state.schedulesLoading && state.schedules.length === 0) return <Spinner label="Loading schedules…" />
  if (state.schedulesError) return <ErrorBanner error={state.schedulesError} />
  if (state.schedules.length === 0) return <Empty>No schedules for this project.</Empty>
  return (
    <ul className="drawer-list plain">
      {state.schedules.map((s) => (
        <li key={s.id} className="drawer-item">
          <div className="row between">
            <span className="drawer-item-name">{s.name}</span>
            <Badge tone={s.enabled ? "good" : "warn"}>{s.enabled ? "on" : "off"}</Badge>
          </div>
          <div className="muted small">
            <code className="cron">{s.cron}</code> · last {s.lastRun ? relativeTime(s.lastRun) : "never"}
            {s.lastStatus ? ` (${s.lastStatus})` : ""}
          </div>
          <div className="row gap">
            <button className="btn btn-ghost btn-xs" onClick={() => void toggleSchedule(s.id)}>
              {s.enabled ? "Disable" : "Enable"}
            </button>
            <button className="btn btn-ghost btn-xs" onClick={() => void runSchedule(s.id)}>
              Run now
            </button>
            <button className="btn btn-ghost btn-xs danger" onClick={() => void deleteSchedule(s.id)}>
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function AutoAcceptDrawer(): ReactNode {
  const { state, refreshAudit } = useApp()
  if (state.auditError) return <ErrorBanner error={state.auditError} onRetry={() => void refreshAudit()} />
  if (state.audit.length === 0) return <Empty>No auto-accept decisions yet.</Empty>
  return (
    <>
      <button className="btn btn-ghost btn-xs" onClick={() => void refreshAudit()}>
        Refresh
      </button>
      <ul className="drawer-list plain">
        {state.audit.map((e) => (
          <li key={`${e.at}-${e.requestID}`} className="drawer-item">
            <div className="row gap">
              <Badge tone={e.reply === "reject" ? "bad" : "good"}>{e.reply}</Badge>
              <span className="drawer-item-name">{e.action}</span>
              <span className="muted small">{relativeTime(e.at)}</span>
            </div>
            {e.resources.length ? <div className="muted small ellipsis">{e.resources.join(", ")}</div> : null}
          </li>
        ))}
      </ul>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="drawer-row">
      <span className="muted small">{label}</span>
      <span className="ellipsis" title={value}>
        {value}
      </span>
    </div>
  )
}
