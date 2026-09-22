import type { Hono } from "hono"
import type { GetServices } from "../server/contracts"

export function registerAutoAcceptRoutes(app: Hono, get: GetServices): void {
  app.get("/api/oh/autoaccept/audit", async (c) => {
    const limit = Number(c.req.query("limit") ?? 100)
    return c.json({ entries: await get().autoaccept.audit(Number.isFinite(limit) ? limit : 100) })
  })
}
