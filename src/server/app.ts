import { readFileSync, statSync } from "node:fs"
import { extname, join, normalize, resolve, sep } from "node:path"
import { Hono, type Context } from "hono"
import { streamSSE } from "hono/streaming"
import type { EventBus, OhEvent } from "../core/events"
import { registerAutoAcceptRoutes } from "../autoaccept/routes"
import { registerControlRoutes } from "../control/routes"
import { registerGoalRoutes } from "../goal/routes"
import { registerProjectRoutes } from "../projects/routes"
import { registerPluginRoutes } from "../plugin/routes"
import { registerScheduleRoutes } from "../scheduler/routes"
import { registerSessionRoutes } from "../sessions/routes"
import type { GetServices } from "./contracts"
import { fail } from "./http"

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
}

export function createApp(get: GetServices): Hono {
  const app = new Hono()

  app.use("*", async (c, next) => {
    const started = Date.now()
    await next()
    if (!c.req.path.startsWith("/api/oh/event")) {
      get().logger.debug(`${c.req.method} ${c.req.path} -> ${c.res.status} ${Date.now() - started}ms`)
    }
  })

  app.get("/api/oh/health", (c) => {
    const s = get()
    return c.json({
      ok: s.opencode.status === "ready",
      version: "0.1.0",
      uptimeMs: Date.now() - s.startedAt,
      dataDir: s.config.dataDir,
      opencodePin: s.config.opencodePin,
      opencode: {
        status: s.opencode.status,
        version: s.opencode.version,
        url: s.opencode.url,
        error: s.opencode.error,
      },
    })
  })

  app.get("/api/oh/info", async (c) => {
    const s = get()
    const projects = await s.projects.list()
    return c.json({
      projects: projects.length,
      schedules: (await s.scheduler.list()).length,
      goals: s.goals.list().length,
      port: s.config.port,
      dataDir: s.config.dataDir,
      opencodePin: s.config.opencodePin,
      opencode: { status: s.opencode.status, version: s.opencode.version, url: s.opencode.url },
    })
  })

  registerProjectRoutes(app, get)
  registerSessionRoutes(app, get)
  registerScheduleRoutes(app, get)
  registerGoalRoutes(app, get)
  registerAutoAcceptRoutes(app, get)
  registerControlRoutes(app, get)
  registerPluginRoutes(app, get)

  app.post("/api/oh/control", async (c) => {
    const body = await c.req.json().catch(() => ({}))
    if (!body?.action || typeof body.action !== "string") return fail(c, 400, "bad_request", "action is required")
    try {
      const data = await get().control.execute(body.action, body)
      return c.json({ ok: true, data })
    } catch (e) {
      return fail(c, 400, "control_failed", e instanceof Error ? e.message : String(e))
    }
  })

  app.get("/api/oh/event", (c) => streamEvents(c, get().bus, get()))

  app.get("*", (c) => {
    const uiDist = get().config.uiDist
    if (c.req.path.startsWith("/api/")) return fail(c, 404, "not_found", "unknown api route")
    if (!uiDist) return c.text("OpenHouse UI not built. Run `bun run build:ui`.", 200)
    return serveStatic(c, uiDist, c.req.path)
  })

  return app
}

function streamEvents(c: Context, bus: EventBus, services: ReturnType<GetServices>) {
  return streamSSE(c, async (stream) => {
    let closed = false
    const write = (event: OhEvent) => {
      if (closed) return
      void stream.writeSSE({ data: JSON.stringify(event) }).catch(() => {
        closed = true
      })
    }
    write({
      type: "snapshot",
      at: Date.now(),
      data: {
        opencode: {
          status: services.opencode.status,
          version: services.opencode.version,
          url: services.opencode.url,
          error: services.opencode.error,
        },
        port: services.config.port,
      },
    })
    const unsub = bus.subscribe(write)
    const ping = setInterval(() => write({ type: "ping", at: Date.now(), data: {} }), 15_000)
    await new Promise<void>((res) => {
      c.req.raw.signal.addEventListener("abort", () => res())
      stream.onAbort(() => res())
    })
    closed = true
    unsub()
    clearInterval(ping)
  })
}

function serveStatic(c: Context, root: string, reqPath: string) {
  const rel = normalize(decodeURIComponent(reqPath)).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "")
  const candidates = [join(root, rel), join(root, "index.html")]
  for (const file of candidates) {
    const resolved = resolve(file)
    if (resolved !== resolve(root) && !resolved.startsWith(resolve(root) + sep)) continue
    try {
      if (statSync(resolved).isFile()) {
        const body = readFileSync(resolved)
        const type = MIME[extname(resolved).toLowerCase()] ?? "application/octet-stream"
        return c.body(body, 200, { "content-type": type })
      }
    } catch {
      /* try next */
    }
  }
  return c.notFound()
}
