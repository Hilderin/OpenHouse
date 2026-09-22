import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { ohPaths } from "../core/paths"
import type { RawOpencodeEvent } from "../opencode/events"
import type { AutoAcceptService as IAutoAccept, GetServices } from "../server/contracts"
import type { AuditEntry } from "../shared/types"

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
  return new RegExp(`^${escaped}$`)
}

/**
 * Always-YOLO: server-side responder to every `permission.asked`.
 * Fail-closed: if the OpenCode event stream is not connected we do not reply.
 * A per-project deny-list can still reject matching requests.
 */
export class AutoAcceptService implements IAutoAccept {
  private recent: AuditEntry[] = []
  private file = ohPaths().audit

  constructor(private deps: GetServices) {
    try {
      if (existsSync(this.file)) {
        const lines = readFileSync(this.file, "utf8").trim().split("\n").filter(Boolean).slice(-500)
        this.recent = lines
          .map((l) => {
            try {
              return JSON.parse(l) as AuditEntry
            } catch {
              return null
            }
          })
          .filter((x): x is AuditEntry => Boolean(x))
      }
    } catch {
      /* ignore */
    }
  }

  onOpencodeEvent(event: RawOpencodeEvent): void {
    if (event.type !== "permission.asked") return
    const data = (event.data ?? {}) as Record<string, unknown>
    const sessionID = data.sessionID as string | undefined
    const requestID = data.id as string | undefined
    if (!sessionID || !requestID) return
    const action = String(data.action ?? "")
    const resources: string[] = Array.isArray(data.resources) ? (data.resources as string[]) : []
    const directory = event.location?.directory ?? this.deps().sessions.directoryOf(sessionID)
    const projectId = directory ? this.deps().projectIdForDirectory(directory) : undefined
    const project = projectId ? this.deps().projects.get(projectId) : undefined

    let reply: AuditEntry["reply"] = "once"
    let reason: AuditEntry["reason"] = "rule"
    const deny = project?.denyList ?? []
    if (deny.length) {
      const probes = [...resources, `${action} ${resources.join(" ")}`.trim()]
      if (probes.some((p) => deny.some((pat) => globToRegExp(pat).test(p)))) {
        reply = "reject"
        reason = "deny-list"
      }
    }

    if (!this.deps().hub.connected) {
      this.deps().logger.warn("auto-accept skipped (event stream disconnected): fail-closed")
      return
    }

    void this.deps()
      .client.permissionReply(sessionID, requestID, reply, directory)
      .catch((err) => this.deps().logger.warn(`permission reply failed: ${err?.message ?? err}`))

    const entry: AuditEntry = { at: Date.now(), sessionID, requestID, action, resources, reply, reason }
    this.recent.push(entry)
    if (this.recent.length > 500) this.recent = this.recent.slice(-500)
    try {
      appendFileSync(this.file, JSON.stringify(entry) + "\n")
    } catch {
      /* ignore */
    }
    this.deps().bus.emit({ type: "autoaccept", sessionId: sessionID, projectId, data: { entry } })
  }

  async audit(limit = 100): Promise<AuditEntry[]> {
    return this.recent.slice(-Math.max(1, limit)).reverse()
  }

  start(): void {}
  stop(): void {}
}
