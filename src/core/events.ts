export interface OhEvent {
  type: string
  at: number
  projectId?: string
  sessionId?: string
  data: unknown
}

export type OhEventHandler = (event: OhEvent) => void

/** In-process pub/sub used to fan OpenHouse events out to SSE clients and internal consumers. */
export class EventBus {
  private subs = new Set<OhEventHandler>()

  emit(event: Omit<OhEvent, "at"> & { at?: number }): void {
    const full: OhEvent = { at: Date.now(), ...event }
    for (const sub of [...this.subs]) {
      try {
        sub(full)
      } catch {
        /* subscriber must not break the bus */
      }
    }
  }

  subscribe(fn: OhEventHandler): () => void {
    this.subs.add(fn)
    return () => {
      this.subs.delete(fn)
    }
  }
}
