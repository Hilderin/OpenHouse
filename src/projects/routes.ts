import type { Hono } from "hono"
import type { GetServices } from "../server/contracts"
import { errMessage, fail } from "../server/http"

export function registerProjectRoutes(app: Hono, get: GetServices): void {
  app.get("/api/oh/projects", async (c) => {
    return c.json({ projects: await get().projects.list() })
  })

  app.post("/api/oh/projects", async (c) => {
    const body = await c.req.json().catch(() => ({}))
    try {
      const project = await get().projects.add(body)
      get().bus.emit({ type: "project.updated", projectId: project.id, data: { project } })
      return c.json({ project }, 201)
    } catch (e) {
      return fail(c, 400, "invalid_project", errMessage(e))
    }
  })

  app.get("/api/oh/projects/:id", async (c) => {
    const project = get().projects.get(c.req.param("id"))
    if (!project) return fail(c, 404, "not_found", "project not found")
    return c.json({ project })
  })

  app.patch("/api/oh/projects/:id", async (c) => {
    const body = await c.req.json().catch(() => ({}))
    try {
      const project = await get().projects.update(c.req.param("id"), body)
      get().bus.emit({ type: "project.updated", projectId: project.id, data: { project } })
      return c.json({ project })
    } catch (e) {
      return fail(c, 400, "invalid_project", errMessage(e))
    }
  })

  app.delete("/api/oh/projects/:id", async (c) => {
    try {
      await get().projects.remove(c.req.param("id"))
      return c.json({ ok: true })
    } catch (e) {
      return fail(c, 400, "invalid_project", errMessage(e))
    }
  })
}
