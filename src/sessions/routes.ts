import type { Hono } from "hono"
import type { GetServices } from "../server/contracts"
import { errMessage, fail } from "../server/http"

export function registerSessionRoutes(app: Hono, get: GetServices): void {
  const parseLimit = (v: string | undefined, def = 50) => {
    const n = v ? Number(v) : def
    return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : def
  }

  // ---- project catalog ----
  app.get("/api/oh/projects/:id/sessions", async (c) => {
    try {
      const res = await get().sessions.list(c.req.param("id"), {
        limit: parseLimit(c.req.query("limit")),
        cursor: c.req.query("cursor"),
        includeArchived: c.req.query("includeArchived") === "true",
        parentID: c.req.query("parentID"),
      })
      return c.json(res)
    } catch (e) {
      return fail(c, 404, "not_found", errMessage(e))
    }
  })

  app.get("/api/oh/projects/:id/models", async (c) => {
    try {
      return c.json(await get().sessions.models(c.req.param("id")))
    } catch (e) {
      return fail(c, 404, "not_found", errMessage(e))
    }
  })

  app.get("/api/oh/projects/:id/agents", async (c) => {
    try {
      return c.json({ agents: await get().sessions.agents(c.req.param("id")) })
    } catch (e) {
      return fail(c, 404, "not_found", errMessage(e))
    }
  })

  app.get("/api/oh/projects/:id/skills", async (c) => {
    try {
      return c.json({ skills: await get().sessions.skills(c.req.param("id")) })
    } catch (e) {
      return fail(c, 404, "not_found", errMessage(e))
    }
  })

  app.get("/api/oh/projects/:id/commands", async (c) => {
    try {
      return c.json({ commands: await get().sessions.commands(c.req.param("id")) })
    } catch (e) {
      return fail(c, 404, "not_found", errMessage(e))
    }
  })

  app.get("/api/oh/projects/:id/mcp", async (c) => {
    try {
      return c.json({ servers: await get().sessions.mcp(c.req.param("id")) })
    } catch (e) {
      return fail(c, 404, "not_found", errMessage(e))
    }
  })

  app.post("/api/oh/projects/:id/mcp/:name/:mode", async (c) => {
    const mode = c.req.param("mode")
    if (mode !== "enable" && mode !== "disable") return fail(c, 400, "bad_request", "mode must be enable|disable")
    try {
      const servers = await get().sessions.mcpSet(c.req.param("id"), c.req.param("name"), mode === "enable")
      get().bus.emit({ type: "catalog.updated", projectId: c.req.param("id"), data: { kind: "mcp" } })
      return c.json({ servers })
    } catch (e) {
      return fail(c, 400, "mcp_error", errMessage(e))
    }
  })

  // ---- sessions ----
  app.post("/api/oh/sessions", async (c) => {
    const body = await c.req.json().catch(() => ({}))
    try {
      const session = await get().sessions.create(body)
      return c.json({ session }, 201)
    } catch (e) {
      return fail(c, 400, "invalid_session", errMessage(e))
    }
  })

  app.get("/api/oh/sessions/:id", async (c) => {
    try {
      return c.json({ session: await get().sessions.get(c.req.param("id")) })
    } catch (e) {
      return fail(c, 404, "not_found", errMessage(e))
    }
  })

  app.get("/api/oh/sessions/:id/messages", async (c) => {
    try {
      const order = c.req.query("order") === "desc" ? "desc" : "asc"
      const res = await get().sessions.messages(c.req.param("id"), {
        limit: parseLimit(c.req.query("limit")),
        cursor: c.req.query("cursor"),
        order,
        type: c.req.query("type"),
      })
      return c.json(res)
    } catch (e) {
      return fail(c, 404, "not_found", errMessage(e))
    }
  })

  app.post("/api/oh/sessions/:id/prompt", async (c) => {
    const body = await c.req.json().catch(() => ({}))
    if (!body?.text || typeof body.text !== "string") return fail(c, 400, "bad_request", "text is required")
    try {
      const message = await get().sessions.prompt(c.req.param("id"), body)
      return c.json({ message })
    } catch (e) {
      return fail(c, 400, "prompt_failed", errMessage(e))
    }
  })

  app.post("/api/oh/sessions/:id/:action", async (c) => {
    const action = c.req.param("action")
    const id = c.req.param("id")
    if (action === "model" || action === "agent") {
      const body = await c.req.json().catch(() => ({}))
      try {
        const session =
          action === "model"
            ? await get().sessions.switchModel(id, body.model)
            : await get().sessions.switchAgent(id, body.agent)
        return c.json({ session })
      } catch (e) {
        return fail(c, 400, "switch_failed", errMessage(e))
      }
    }
    if (action !== "interrupt" && action !== "compact") return fail(c, 404, "not_found", "unknown action")
    try {
      if (action === "interrupt") await get().sessions.interrupt(id)
      else await get().sessions.compact(id)
      return c.json({ ok: true })
    } catch (e) {
      return fail(c, 400, "action_failed", errMessage(e))
    }
  })

  app.patch("/api/oh/sessions/:id", async (c) => {
    const body = await c.req.json().catch(() => ({}))
    try {
      const session = await get().sessions.update(c.req.param("id"), body)
      return c.json({ session })
    } catch (e) {
      return fail(c, 400, "update_failed", errMessage(e))
    }
  })

  app.delete("/api/oh/sessions/:id", async (c) => {
    try {
      await get().sessions.remove(c.req.param("id"))
      return c.json({ ok: true })
    } catch (e) {
      return fail(c, 400, "delete_failed", errMessage(e))
    }
  })

  app.get("/api/oh/sessions/:id/status", async (c) => {
    try {
      return c.json(await get().sessions.status(c.req.param("id")))
    } catch (e) {
      return fail(c, 404, "not_found", errMessage(e))
    }
  })

  app.get("/api/oh/sessions/:id/children", async (c) => {
    try {
      return c.json({ sessions: await get().sessions.children(c.req.param("id")) })
    } catch (e) {
      return fail(c, 404, "not_found", errMessage(e))
    }
  })

  app.get("/api/oh/levels", (c) => c.json({ levels: get().levels }))
}
