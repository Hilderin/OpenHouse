import type { EventName, OhEvent } from "./types"

type Listener = (event: OhEvent) => void

export interface SseStatus {
  state: "connecting" | "open" | "error" | "closed"
  retries: number
  lastError?: string
}

/**
 * Typed wrapper around the OpenHouse SSE endpoint (`GET /api/oh/event`).
 *
 * `EventSource` reconnects on its own for transient drops, but it gives up
 * permanently on some failures (e.g. the server is restarted and the initial
 * HTTP connect fails). We add a manual retry with capped exponential backoff
 * so the renderer always recovers.
 */
export class SseClient {
  private source: EventSource | null = null
  private listeners = new Map<string, Set<Listener>>()
  private anyListeners = new Set<Listener>()
  private statusListeners = new Set<(s: SseStatus) => void>()
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retries = 0
  private closed = false

  private status: SseStatus = { state: "closed", retries: 0 }

  constructor(private readonly url = "/api/oh/event") {}

  connect(): void {
    if (this.closed || this.source) return
    this.setStatus({ state: "connecting", retries: this.retries })
    let source: EventSource
    try {
      source = new EventSource(this.url)
    } catch (e) {
      this.scheduleRetry(e instanceof Error ? e.message : "EventSource failed")
      return
    }
    this.source = source

    source.onopen = () => {
      this.retries = 0
      this.setStatus({ state: "open", retries: 0 })
    }

    source.onerror = () => {
      if (this.closed) return
      this.setStatus({ state: "error", retries: this.retries, lastError: "connection lost" })
      // Native EventSource is CONNECTING (0) and will retry by itself; only
      // take over when it has closed for good.
      if (source.readyState === EventSource.CLOSED) {
        this.teardownSource()
        this.scheduleRetry("connection closed")
      }
    }

    source.onmessage = (ev) => this.dispatch(ev.data)
  }

  close(): void {
    this.closed = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.teardownSource()
    this.setStatus({ state: "closed", retries: this.retries })
  }

  on<T = unknown>(name: EventName, fn: (event: OhEvent<T>) => void): () => void {
    let set = this.listeners.get(name)
    if (!set) {
      set = new Set()
      this.listeners.set(name, set)
    }
    const wrapped = fn as Listener
    set.add(wrapped)
    return () => set.delete(wrapped)
  }

  onAny(fn: (event: OhEvent) => void): () => void {
    this.anyListeners.add(fn)
    return () => this.anyListeners.delete(fn)
  }

  onStatus(fn: (s: SseStatus) => void): () => void {
    this.statusListeners.add(fn)
    fn(this.status)
    return () => this.statusListeners.delete(fn)
  }

  private dispatch(raw: string): void {
    let event: OhEvent
    try {
      event = JSON.parse(raw) as OhEvent
    } catch {
      return
    }
    for (const fn of this.anyListeners) safe(fn, event)
    const set = this.listeners.get(event.type)
    if (set) for (const fn of set) safe(fn, event)
  }

  private scheduleRetry(reason: string): void {
    if (this.closed || this.retryTimer) return
    this.retries += 1
    const delay = Math.min(30_000, 1_000 * 2 ** (this.retries - 1))
    this.setStatus({ state: "error", retries: this.retries, lastError: reason })
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, delay)
  }

  private teardownSource(): void {
    if (!this.source) return
    this.source.onopen = null
    this.source.onerror = null
    this.source.onmessage = null
    this.source.close()
    this.source = null
  }

  private setStatus(next: SseStatus): void {
    this.status = next
    for (const fn of this.statusListeners) fn(next)
  }
}

function safe(fn: Listener, event: OhEvent): void {
  try {
    fn(event)
  } catch {
    /* a listener must never break the dispatch loop */
  }
}

export const sse = new SseClient()
