import type { EventBus } from "../core/events"
import type { Logger } from "../core/logger"
import type { OpencodeManager } from "./lifecycle"

export interface RawOpencodeEvent {
  id?: string
  created?: number
  type: string
  location?: { directory?: string }
  data?: Record<string, unknown>
  durable?: Record<string, unknown>
}

export type RawEventHandler = (event: RawOpencodeEvent) => void

const CATALOG_KINDS: Array<[RegExp, string]> = [
  [/^agent\.updated$/, "agents"],
  [/^command\.updated$/, "commands"],
  [/^skill\.updated$/, "skills"],
  [/^(provider|model|integration|websearch|reference)\.updated$/, "models"],
  [/^plugin\.updated$/, "plugins"],
  [/^mcp\./, "mcp"],
  [/^location\.updated$/, "location"],
]

/**
 * Single reader of OpenCode's `/api/event` SSE stream with reconnect + catalog coalescing.
 * Services subscribe via `on()`; OpenHouse SSE clients get `catalog.updated` on the bus.
 */
export class OpencodeEventHub {
  connected = false
  private listeners = new Set<RawEventHandler>()
  private abort?: AbortController
  private stopped = false
  private attempts = 0
  private catalogTimers = new Map<string, NodeJS.Timeout>()

  constructor(
    private manager: OpencodeManager,
    private logger: Logger,
    private bus: EventBus,
    private resolveProjectId: (directory?: string) => string | undefined,
  ) {}

  on(fn: RawEventHandler): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  start(): void {
    this.stopped = false
    void this.loop()
  }

  stop(): void {
    this.stopped = true
    this.abort?.abort()
    for (const t of this.catalogTimers.values()) clearTimeout(t)
    this.catalogTimers.clear()
    this.connected = false
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      if (this.manager.status !== "ready") {
        await delay(1000)
        continue
      }
      this.abort = new AbortController()
      try {
        for await (const payload of this.manager.client.stream("/api/event", { signal: this.abort.signal })) {
          if (this.stopped) return
          let event: RawOpencodeEvent
          try {
            event = JSON.parse(payload)
          } catch {
            continue
          }
          this.attempts = 0
          this.connected = true
          this.dispatch(event)
        }
      } catch (err) {
        if (this.stopped) return
        this.logger.warn(`event stream error: ${err instanceof Error ? err.message : err}`)
      }
      this.connected = false
      if (this.stopped) return
      const backoff = Math.min(1000 * 2 ** this.attempts, 30_000)
      this.attempts++
      await delay(backoff)
    }
  }

  private dispatch(event: RawOpencodeEvent): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(event)
      } catch (err) {
        this.logger.warn(`event listener error: ${err instanceof Error ? err.message : err}`)
      }
    }
    for (const [re, kind] of CATALOG_KINDS) {
      if (re.test(event.type)) this.scheduleCatalog(kind, event.location?.directory)
    }
  }

  private scheduleCatalog(kind: string, directory?: string): void {
    const key = `${directory ?? ""}|${kind}`
    const existing = this.catalogTimers.get(key)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.catalogTimers.delete(key)
      this.bus.emit({
        type: "catalog.updated",
        projectId: this.resolveProjectId(directory),
        data: { kind, directory },
      })
    }, 250)
    this.catalogTimers.set(key, timer)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
