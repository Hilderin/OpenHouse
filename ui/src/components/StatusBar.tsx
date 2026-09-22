import type { ReactNode } from "react"
import { useApp } from "../app-context"
import { pct, formatNumber, modelLabel } from "../format"
import { Badge, StatusDot } from "./common"

export function StatusBar(): ReactNode {
  const { state } = useApp()
  const oc = state.health?.opencode
  const chat = state.chat
  const status = chat.status
  const ctx = status?.context
  const percent = ctx ? ctx.percent || pct(ctx.used, ctx.limit) : 0
  const projectName = state.projects.find((p) => p.id === state.selectedProjectId)?.name

  const mcpEnabled = state.mcp.data.filter((s) => s.enabled).length
  const scheduleCount = state.schedules.length

  return (
    <footer className="statusbar">
      <div className="statusbar-group">
        <span className={`opencode-pill opencode-${oc?.status ?? "unknown"}`}>
          <span className="status-dot" />
          opencode {oc?.status ?? (state.healthError ? "down" : "…")}
        </span>
        {oc?.version ? <span className="muted small">v{oc.version}</span> : null}
        {state.health ? <span className="muted small">pin {state.health.opencodePin}</span> : null}
        <span className={`sse-pill sse-${state.sse.state}`} title={state.sse.lastError ?? ""}>
          SSE {state.sse.state}
          {state.sse.retries > 0 ? ` (retry ${state.sse.retries})` : ""}
        </span>
      </div>

      <div className="statusbar-group grow">
        <span className="muted small">project</span>
        <span className="ellipsis" title={projectName}>
          {projectName ?? "—"}
        </span>
        {chat.session ? (
          <>
            <StatusDot status={chat.session.status} />
            <span className="ellipsis" title={chat.session.title}>
              {chat.session.title || chat.session.id}
            </span>
            <Badge tone="info" title="model">
              {modelLabel(ctx?.model ?? chat.session.model)}
            </Badge>
            {chat.session.agent ? <Badge>{chat.session.agent}</Badge> : null}
          </>
        ) : (
          <span className="muted small">no session open</span>
        )}
      </div>

      <div className="statusbar-group">
        {chat.session && ctx ? (
          <>
            <span className="muted small" title="context tokens used / limit">
              {formatNumber(ctx.used)} / {ctx.limit ? formatNumber(ctx.limit) : "?"} tok
            </span>
            <span className="context-bar" title={`${percent}%`}>
              <span
                className={`context-fill${percent > 85 ? " bad" : percent > 60 ? " warn" : ""}`}
                style={{ width: `${percent}%` }}
              />
            </span>
            <span className="muted small">{percent}%</span>
            {ctx.unknownAfterCompaction ? <Badge tone="warn">ctx unknown</Badge> : null}
          </>
        ) : null}
        {status ? <span className="muted small">${(status.cost ?? 0).toFixed(4)}</span> : null}
        <span className="muted small" title="MCP servers enabled / total">
          mcp {mcpEnabled}/{state.mcp.data.length}
        </span>
        <span className="muted small" title="Scheduled tasks">
          cron {scheduleCount}
        </span>
        {state.plugin ? (
          <span
            className={`muted small${state.plugin.injected ? "" : " dim"}`}
            title={`plugin tool injection · ${state.plugin.configFile}`}
          >
            tool {state.plugin.injected ? "on" : state.plugin.enabled ? "accepted" : "off"}
          </span>
        ) : null}
      </div>
    </footer>
  )
}
