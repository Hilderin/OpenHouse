import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { computeNextRun, SchedulerService } from "../src/scheduler/service"
import type { GetServices } from "../src/server/contracts"
import type { Project } from "../src/shared/types"
import { noopLogger, makeTempDir, removeTempDir } from "./util"

const project: Project = {
  id: "proj_test",
  name: "Test",
  path: "/tmp/oh-scheduler-project",
  available: true,
  createdAt: 1,
}

function fakeDeps(): GetServices {
  const fake = {
    projects: {
      get: (id: string) => (id === project.id ? project : undefined),
    },
    sessions: {
      create: async () => {
        throw new Error("sessions.create must not be called in unit tests")
      },
      prompt: async () => {
        throw new Error("sessions.prompt must not be called in unit tests")
      },
    },
    goals: {
      set: async () => {
        throw new Error("goals.set must not be called in unit tests")
      },
    },
    bus: { emit() {} },
    logger: noopLogger(),
  }
  return (() => fake) as unknown as GetServices
}

let dataDir: string
beforeEach(() => {
  dataDir = makeTempDir("oh-scheduler-")
  process.env.OPENHOUSE_DATA_DIR = dataDir
})
afterEach(() => {
  delete process.env.OPENHOUSE_DATA_DIR
  removeTempDir(dataDir)
})

describe("computeNextRun", () => {
  test("returns a future timestamp for a valid cron", () => {
    const next = computeNextRun("*/5 * * * *")
    expect(typeof next).toBe("number")
    expect(next!).toBeGreaterThan(Date.now() - 1000)
  })

  test("throws for an invalid cron", () => {
    expect(() => computeNextRun("not a cron")).toThrow(/invalid cron/)
    expect(() => computeNextRun("")).toThrow(/invalid cron/)
  })
})

describe("SchedulerService", () => {
  test("create rejects an invalid cron expression", async () => {
    const scheduler = new SchedulerService(fakeDeps())
    await expect(
      scheduler.create({ projectId: project.id, name: "bad", cron: "nope", prompt: "hi" }),
    ).rejects.toThrow(/invalid cron/)
  })

  test("create persists and list returns created items", async () => {
    const scheduler = new SchedulerService(fakeDeps())
    const created = await scheduler.create({
      projectId: project.id,
      name: "every five",
      cron: "*/5 * * * *",
      prompt: "hello",
    })
    expect(created.id.startsWith("sch_")).toBe(true)
    expect(created.enabled).toBe(true)
    expect(created.nextRun).toBeGreaterThan(Date.now() - 1000)
    const listed = await scheduler.list()
    expect(listed.map((s) => s.id)).toContain(created.id)
    expect(listed.find((s) => s.id === created.id)?.prompt).toBe("hello")
  })

  test("toggle flips enabled", async () => {
    const scheduler = new SchedulerService(fakeDeps())
    const created = await scheduler.create({
      projectId: project.id,
      name: "toggle me",
      cron: "*/5 * * * *",
      prompt: "hi",
    })
    const off = await scheduler.toggle(created.id)
    expect(off.enabled).toBe(false)
    const on = await scheduler.toggle(created.id)
    expect(on.enabled).toBe(true)
  })

  test("update and remove mutate the stored list", async () => {
    const scheduler = new SchedulerService(fakeDeps())
    const created = await scheduler.create({
      projectId: project.id,
      name: "editable",
      cron: "*/5 * * * *",
      prompt: "hi",
    })
    const updated = await scheduler.update(created.id, { name: "renamed", enabled: false })
    expect(updated.name).toBe("renamed")
    expect(updated.enabled).toBe(false)
    await scheduler.remove(created.id)
    expect((await scheduler.list()).some((s) => s.id === created.id)).toBe(false)
  })
})
