import type { Hono } from "hono"
import type { GetServices } from "../server/contracts"

export function registerPluginRoutes(app: Hono, get: GetServices): void {
  app.get("/api/oh/plugin", (c) => c.json(get().plugins.status()))

  app.post("/api/oh/plugin/enable", async (c) => c.json(await get().plugins.setEnabled(true)))

  app.post("/api/oh/plugin/disable", async (c) => c.json(await get().plugins.setEnabled(false)))
}
