import type { Hono } from "hono"
import type { GetServices } from "../server/contracts"
import { errMessage, fail } from "../server/http"

export function registerGoalRoutes(app: Hono, get: GetServices): void {
  app.put("/api/oh/sessions/:id/goal", async (c) => {
    const body = await c.req.json().catch(() => ({}))
    try {
      const goal = await get().goals.set(c.req.param("id"), body)
      return c.json({ goal })
    } catch (e) {
      return fail(c, 400, "invalid_goal", errMessage(e))
    }
  })

  app.get("/api/oh/sessions/:id/goal", (c) => {
    return c.json({ goal: get().goals.get(c.req.param("id")) })
  })

  app.post("/api/oh/sessions/:id/goal/pause", async (c) => {
    try {
      return c.json({ goal: await get().goals.pause(c.req.param("id")) })
    } catch (e) {
      return fail(c, 400, "invalid_goal", errMessage(e))
    }
  })

  app.post("/api/oh/sessions/:id/goal/resume", async (c) => {
    try {
      return c.json({ goal: await get().goals.resume(c.req.param("id")) })
    } catch (e) {
      return fail(c, 400, "invalid_goal", errMessage(e))
    }
  })

  app.delete("/api/oh/sessions/:id/goal", async (c) => {
    try {
      await get().goals.clear(c.req.param("id"))
      return c.json({ ok: true })
    } catch (e) {
      return fail(c, 400, "invalid_goal", errMessage(e))
    }
  })
}
