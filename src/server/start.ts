import { createServer } from "node:http"
import { getRequestListener } from "@hono/node-server"
import type { AddressInfo } from "node:net"
import type { Hono } from "hono"
import type { Config } from "../core/config"
import { ohPaths, resolveUiDist } from "../core/paths"
import { createApp } from "./app"
import { createCore } from "./context"
import type { Services } from "./contracts"

export interface CoreHandle {
  services: Services
  app: Hono
  port: number
  url: string
  stop(): Promise<void>
}

async function listen(app: Hono, host: string, port: number): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const server = createServer(getRequestListener(app.fetch))
  await new Promise<void>((res, rej) => {
    server.once("error", rej)
    server.listen(port, host, () => res())
  })
  return { server, port: (server.address() as AddressInfo).port }
}

/** Starts the OpenHouse core + HTTP API. Shared by the Electron shell and the headless CLI. */
export async function startCore(cfg: Config): Promise<CoreHandle> {
  const services = await createCore(cfg)
  const app = createApp(() => services)
  let server: ReturnType<typeof createServer>
  let port: number
  try {
    const res = await listen(app, cfg.host, cfg.port)
    server = res.server
    port = res.port
  } catch (err) {
    services.logger.warn(`port ${cfg.port} unavailable (${err instanceof Error ? err.message : err}), falling back to a random port`)
    const res = await listen(app, cfg.host, 0)
    server = res.server
    port = res.port
  }
  cfg.port = port
  cfg.uiDist = cfg.uiDist ?? resolveUiDist()
  services.logger.info(`OpenHouse API listening on http://${cfg.host}:${port}`)

  services.opencode.setExtraEnv({
    OPENCODE_CONFIG: ohPaths().managedConfig,
    OPENHOUSE_CONTROL_URL: `http://127.0.0.1:${port}/api/oh/control`,
  })

  await services.start()

  return {
    services,
    app,
    port,
    url: `http://${cfg.host === "0.0.0.0" ? "127.0.0.1" : cfg.host}:${port}`,
    stop: async () => {
      await services.stop()
      await new Promise<void>((res) => server.close(() => res()))
    },
  }
}
