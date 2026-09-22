import type { ReactNode } from "react"
import type { SessionStatus } from "../types"
import { statusLabel } from "../format"

export function StatusDot({ status }: { status?: SessionStatus }): ReactNode {
  return <span className={`status-dot status-${status ?? "unknown"}`} title={statusLabel(status)} />
}

export function Spinner({ label }: { label?: string }): ReactNode {
  return (
    <span className="spinner-wrap">
      <span className="spinner" aria-hidden />
      {label ? <span className="muted">{label}</span> : null}
    </span>
  )
}

export function Empty({ children }: { children: ReactNode }): ReactNode {
  return <div className="empty">{children}</div>
}

export function ErrorBanner({ error, onRetry }: { error?: string; onRetry?: () => void }): ReactNode {
  if (!error) return null
  return (
    <div className="error-banner" role="alert">
      <span className="error-text">{error}</span>
      {onRetry ? (
        <button className="btn btn-ghost btn-xs" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  )
}

export function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode
  tone?: "neutral" | "good" | "warn" | "bad" | "info"
  title?: string
}): ReactNode {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  )
}
