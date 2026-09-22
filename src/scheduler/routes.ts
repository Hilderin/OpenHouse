import type { Hono } from "hono"
import type { GetServices } from "../server/contracts"
import { errMessage, fail } from "../server/http"

export function registerScheduleRoutes(app: Hono, get: GetServices): void {
  app.get("/api/oh/schedules", async (c) => {
    const projectId = c.req.query("projectId")
    return c.json({ schedules: await get().scheduler.list(projectId) })
  })

  app.post("/api/oh/schedules", async (c) => {
    const body = await c.req.json().catch(() => ({}))
    try {
      const schedule = await get().scheduler.create(body)
      return c.json({ schedule }, 201)
    } catch (e) {
      return fail(c, 400, "invalid_schedule", errMessage(e))
    }
  })

  app.patch("/api/oh/schedules/:id", async (c) => {
    const body = await c.req.json().catch(() => ({}))
    try {
      const schedule = await get().scheduler.update(c.req.param("id"), body)
      return c.json({ schedule })
    } catch (e) {
      return fail(c, 400, "invalid_schedule", errMessage(e))
    }
  })

  app.delete("/api/oh/schedules/:id", async (c) => {
    try {
      await get().scheduler.remove(c.req.param("id"))
      return c.json({ ok: true })
    } catch (e) {
      return fail(c, 400, "invalid_schedule", errMessage(e))
    }
  })

  app.post("/api/oh/schedules/:id/toggle", async (c) => {
    try {
      const schedule = await get().scheduler.toggle(c.req.param("id"))
      return c.json({ schedule })
    } catch (e) {
      return fail(c, 400, "invalid_schedule", errMessage(e))
    }
  })

  app.post("/api/oh/schedules/:id/run", async (c) => {
    try {
      const { sessionId } = await get().scheduler.run(c.req.param("id"))
      return c.json({ ok: true, sessionId })
    } catch (e) {
      return fail(c, 400, "run_failed", errMessage(e))
    }
  })
}
