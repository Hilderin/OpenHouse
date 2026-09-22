import { useEffect, useRef, useState, type ReactNode } from "react"
import { useApp } from "../app-context"
import type { ContentPart, SessionMessage } from "../types"
import { Badge, Empty, ErrorBanner, Spinner, StatusDot } from "./common"
import { formatNumber, relativeTime, truncate } from "../format"
import { Composer } from "./Composer"
import { GoalBar } from "./GoalBar"

const MESSAGE_ICONS: Record<string, string> = {
  user: "›",
  assistant: "◆",
  synthetic: "·",
  system: "⚙",
  compaction: "❖",
  shell: "$",
  skill: "✦",
  idle: "○",
  "agent-switched": "⇄",
  "model-switched": "⇄",
  "location-switched": "⇄",
}

/** Types hidden behind the "System messages" toggle. */
const SYSTEM_MESSAGE_TYPES = new Set(["synthetic", "system", "compaction"])

/** Part types that are rendered inline in the main message body (vs. secondary parts). */
const INLINE_PART_TYPES = new Set(["text"])

function partHasContent(part: ContentPart): boolean {
  if (part.type === "text") return Boolean((part.text ?? "").trim())
  if (part.type === "reasoning") return Boolean((part.text ?? "").trim())
  if (part.type === "tool") return true
  if (part.type === "patch") return Boolean(part.text ?? part.patch ?? part.file ?? true)
  if (part.type === "file") return true
  if (part.type === "snapshot" || part.type === "step-start" || part.type === "step-finish") return false
  return true
}

/** An assistant message counts as renderable when it has text or a meaningful part. */
function isRenderable(message: SessionMessage): boolean {
  if ((message.text ?? "").trim()) return true
  return (message.parts ?? []).some(partHasContent)
}

export function ChatView(): ReactNode {
  const { state, compact, refreshStatus } = useApp()
  const { chat } = state
  const [showSystem, setShowSystem] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const systemCount = chat.messages.filter((m) => SYSTEM_MESSAGE_TYPES.has(m.type)).length
  const visibleMessages = chat.messages.filter(
    (m) => (showSystem || !SYSTEM_MESSAGE_TYPES.has(m.type)) && isRenderable(m),
  )

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visibleMessages.length, chat.streaming, chat.sessionId])

  if (!chat.sessionId || !chat.session) {
    return (
      <div className="panel placeholder">
        <Empty>Select or create a session to start chatting.</Empty>
      </div>
    )
  }

  const session = chat.session
  const busy = session.status === "busy" || session.status === "retry"

  return (
    <div className="panel chat-panel">
      <div className="chat-head">
        <div className="chat-title">
          <StatusDot status={session.status} />
          <span className="session-title">{session.title || "(untitled)"}</span>
          {session.model ? <Badge tone="info">{session.model.id}</Badge> : null}
          {session.agent ? <Badge>{session.agent}</Badge> : null}
          {session.pinned ? <span title="Pinned" className="pin">★</span> : null}
        </div>
        <div className="row gap">
          <label className="check" title="Show synthetic/system/compaction messages">
            <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} />
            <span className="small">System{systemCount ? ` (${systemCount})` : ""}</span>
          </label>
          <button className="icon-btn" onClick={() => void refreshStatus(session.id)} title="Refresh status">
            ⟳
          </button>
          <button
            className="icon-btn"
            onClick={() => void compact()}
            disabled={!busy}
            title="Compact context"
          >
            ⊟
          </button>
        </div>
      </div>

      <GoalBar />

      {chat.error ? <ErrorBanner error={chat.error} /> : null}

      <div className="chat-body" ref={scrollRef}>
        {chat.loading ? <Spinner label="Loading messages…" /> : null}
        {!chat.loading && visibleMessages.length === 0 && Object.keys(chat.streaming).length === 0 ? (
          <Empty>No messages yet. Send a prompt below.</Empty>
        ) : null}
        {visibleMessages.map((m) =>
          SYSTEM_MESSAGE_TYPES.has(m.type) ? (
            <SystemMessageLine key={m.id} message={m} />
          ) : (
            <MessageBubble key={m.id} message={m} streaming={chat.streaming[m.id]} />
          ),
        )}
        {Object.entries(chat.streaming).map(([id, text]) => (
          <MessageBubble
            key={`stream-${id}`}
            message={{ id, type: "assistant", parts: [], raw: null, time: { created: Date.now() } }}
            streaming={text}
          />
        ))}
      </div>

      <Composer />
    </div>
  )
}

/** Compact, collapsed one-liner used for synthetic/system/compaction messages. */
function SystemMessageLine({ message }: { message: SessionMessage }): ReactNode {
  const icon = MESSAGE_ICONS[message.type] ?? "•"
  const preview = truncate((message.text ?? "").replace(/\s+/g, " ").trim(), 100) || "(empty)"
  return (
    <details className={`system-line system-${message.type}`}>
      <summary>
        <span className="message-icon">{icon}</span>
        <span className="system-type">{message.type}</span>
        <span className="muted small">{relativeTime(message.time?.created)}</span>
        <span className="system-preview muted small">{preview}</span>
      </summary>
      <pre className="message-text">{message.text || "(empty)"}</pre>
    </details>
  )
}

function MessageBubble({ message, streaming }: { message: SessionMessage; streaming?: string }): ReactNode {
  const icon = MESSAGE_ICONS[message.type] ?? "•"

  if (streaming !== undefined) {
    return (
      <article className={`message message-${message.type}`}>
        <div className="message-gutter" title={message.type}>
          <span className="message-icon">{icon}</span>
        </div>
        <div className="message-content">
          <div className="message-head">
            <span className="message-type">{message.type}</span>
            <span className="muted small">{relativeTime(message.time?.created)}</span>
          </div>
          <pre className="message-text">{streaming || "…"}</pre>
        </div>
      </article>
    )
  }

  const bodyText = (message.text ?? "").trim()
  const parts = (message.parts ?? []).filter(partHasContent)
  // Avoid duplicating the main text when it is also present as a text part.
  const extraParts = parts.filter((p) => !(INLINE_PART_TYPES.has(p.type) && (p.text ?? "").trim() === bodyText))

  return (
    <article className={`message message-${message.type}`}>
      <div className="message-gutter" title={message.type}>
        <span className="message-icon">{icon}</span>
      </div>
      <div className="message-content">
        <div className="message-head">
          <span className="message-type">{message.type}</span>
          <span className="muted small">{relativeTime(message.time?.created)}</span>
          {message.agent ? <span className="muted small">· {message.agent}</span> : null}
          {message.model ? <span className="muted small">· {message.model.id}</span> : null}
          {message.tokens?.total ? (
            <Badge tone="neutral" title="tokens">
              {formatNumber(message.tokens.total)} tok
            </Badge>
          ) : null}
          {message.outcome ? <Badge tone="info">{message.outcome}</Badge> : null}
        </div>

        {bodyText ? <pre className="message-text">{message.text}</pre> : null}

        {extraParts.length > 0 ? (
          <div className="parts">
            {extraParts.map((p, i) => (
              <Part key={`${message.id}-${i}`} part={p} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  )
}

function Part({ part }: { part: ContentPart }): ReactNode {
  const type = part.type
  if (type === "text") {
    return part.text ? <pre className="message-text">{part.text}</pre> : null
  }
  if (type === "reasoning") {
    return (
      <details className="part part-reasoning">
        <summary>Reasoning</summary>
        <pre className="message-text">{String(part.text ?? "")}</pre>
      </details>
    )
  }
  if (type === "tool") {
    const name = String(part.name ?? part.tool ?? "tool")
    const state = (part.state ?? {}) as Record<string, unknown>
    const status = typeof state === "string" ? String(state) : String(state.status ?? part.status ?? "")
    const input = state.input ?? part.input
    const output = state.output ?? part.output
    const error = state.error ?? part.error
    const errorText =
      error && typeof error === "object" ? String((error as Record<string, unknown>).message ?? safeJson(error)) : error ? String(error) : ""
    return (
      <div className="part part-tool">
        <div className="part-head">
          <span className="part-label">tool</span>
          <span className="part-name">{name}</span>
          {status ? <Badge tone={status === "error" ? "bad" : "info"}>{status}</Badge> : null}
        </div>
        {input !== undefined ? <pre className="message-text muted-pre">{safeJson(input)}</pre> : null}
        {output !== undefined ? <pre className="message-text muted-pre">{safeJson(output)}</pre> : null}
        {errorText ? <pre className="message-text error-text">{errorText}</pre> : null}
      </div>
    )
  }
  if (type === "patch") {
    return (
      <div className="part part-patch">
        <div className="part-head">
          <span className="part-label">patch</span>
          {part.file ? <span className="part-name">{String(part.file)}</span> : null}
        </div>
        <pre className="message-text patch-text">{String(part.text ?? part.patch ?? safeJson(part))}</pre>
      </div>
    )
  }
  if (type === "file") {
    return (
      <div className="part part-file">
        <div className="part-head">
          <span className="part-label">file</span>
          {part.path ? <span className="part-name">{String(part.path)}</span> : null}
        </div>
        {part.text ? <pre className="message-text">{String(part.text)}</pre> : null}
      </div>
    )
  }
  if (type === "snapshot" || type === "step-start" || type === "step-finish") {
    return (
      <div className="part part-step muted small">
        {type}
        {part.text ? ` · ${truncate(String(part.text), 120)}` : ""}
      </div>
    )
  }
  return (
    <details className="part part-unknown">
      <summary>{type}</summary>
      <pre className="message-text muted-pre">{safeJson(part)}</pre>
    </details>
  )
}

function safeJson(value: unknown): string {
  try {
    if (typeof value === "string") return value
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
