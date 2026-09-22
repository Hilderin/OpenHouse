import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { AutoAcceptService } from "../src/autoaccept/service"
import type { RawOpencodeEvent } from "../src/opencode/events"
import type { GetServices } from "../src/server/contracts"
import type { Project } from "../src/shared/types"
import { makeTempDir, noopLogger, removeTempDir } from "./util"

interface ReplyCall {
  sessionID: string
  requestID: string
  reply: string
  directory?: string
}

const project: Project = {
  id: "proj_aa",
  name: "AutoAccept Test",
  path: "/tmp/aa-project",
  available: true,
  createdAt: 1,
}

let dataDir: string
let replies: ReplyCall[]
let hub: { connected: boolean }
let emitted: unknown[]

function makeDeps(): GetServices {
  const fake = {
    hub,
    client: {
      permissionReply(sessionID: string, requestID: string, reply: "once" | "always" | "reject", directory?: string) {
        replies.push({ sessionID, requestID, reply, directory })
        return Promise.resolve()
      },
    },
    sessions: {
      directoryOf: () => project.path,
    },
    projectIdForDirectory: () => project.id,
    projects: {
      get: () => project,
    },
    bus: {
      emit(event: unknown) {
        emitted.push(event)
      },
    },
    logger: noopLogger(),
  }
  return (() => fake) as unknown as GetServices
}

function permissionEvent(requestID: string, action: string, resources: string[]): RawOpencodeEvent {
  return {
    type: "permission.asked",
    location: { directory: project.path },
    data: { sessionID: "ses_1", id: requestID, action, resources },
  }
}

beforeEach(() => {
  dataDir = makeTempDir("oh-autoaccept-")
  process.env.OPENHOUSE_DATA_DIR = dataDir
  replies = []
  emitted = []
  hub = { connected: true }
  delete project.denyList
})

afterEach(() => {
  delete process.env.OPENHOUSE_DATA_DIR
  removeTempDir(dataDir)
})

describe("AutoAcceptService", () => {
  test("replies once and records an audit entry when the hub is connected", async () => {
    const service = new AutoAcceptService(makeDeps())
    service.onOpencodeEvent(permissionEvent("req_1", "shell", ["shell:ls"]))

    expect(replies).toEqual([
      { sessionID: "ses_1", requestID: "req_1", reply: "once", directory: project.path },
    ])
    const entries = await service.audit()
    expect(entries.length).toBe(1)
    expect(entries[0]).toMatchObject({
      sessionID: "ses_1",
      requestID: "req_1",
      action: "shell",
      resources: ["shell:ls"],
      reply: "once",
      reason: "rule",
    })
    expect(emitted.some((e) => (e as { type?: string }).type === "autoaccept")).toBe(true)
  })

  test("fails closed (no reply, no audit) when the hub is disconnected", async () => {
    hub.connected = false
    const service = new AutoAcceptService(makeDeps())
    service.onOpencodeEvent(permissionEvent("req_2", "shell", ["shell:ls"]))

    expect(replies).toEqual([])
    expect(await service.audit()).toEqual([])
  })

  test("rejects when a project deny-list entry matches the resource", async () => {
    project.denyList = ["shell:*"]
    const service = new AutoAcceptService(makeDeps())
    service.onOpencodeEvent(permissionEvent("req_3", "shell", ["shell:rm -rf /"]))

    expect(replies).toEqual([
      { sessionID: "ses_1", requestID: "req_3", reply: "reject", directory: project.path },
    ])
    const entries = await service.audit()
    expect(entries[0]).toMatchObject({ requestID: "req_3", reply: "reject", reason: "deny-list" })
  })

  test("ignores non-permission events", async () => {
    const service = new AutoAcceptService(makeDeps())
    service.onOpencodeEvent({ type: "session.created", data: {} })
    expect(replies).toEqual([])
    expect(await service.audit()).toEqual([])
  })
})
