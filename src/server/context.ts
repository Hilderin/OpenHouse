import { LEVELS } from "../core/levels"
import type { Config } from "../core/config"
import { createConfigLogger } from "../core/config"
import { EventBus } from "../core/events"
import { ohPaths } from "../core/paths"
import { ensureDir } from "../core/store"
import { OpencodeEventHub } from "../opencode/events"
import { OpencodeManager } from "../opencode/lifecycle"
import { AutoAcceptService } from "../autoaccept/service"
import { ControlService } from "../control/service"
import { GoalService } from "../goal/service"
import { ProjectsService } from "../projects/service"
import { PluginService } from "../plugin/service"
import { SchedulerService } from "../scheduler/service"
import { SessionsService } from "../sessions/service"
import type { GetServices, Services } from "./contracts"

/** Builds the OpenHouse service graph. Host-agnostic: Electron main or headless CLI. */
export async function createCore(cfg: Config): Promise<Services> {
  ensureDir(ohPaths().root)
  const logger = createConfigLogger(cfg)
  const bus = new EventBus()
  const opencode = new OpencodeManager({
    bin: cfg.opencodeBin,
    pin: cfg.opencodePin,
    host: "127.0.0.1",
    logger,
    bus,
    extraEnv: { ...cfg.opencodeEnv },
  })

  const services = {} as Services
  const get: GetServices = () => services
  Object.assign(services, {
    config: cfg,
    logger,
    bus,
    opencode,
    client: opencode.client,
    levels: LEVELS,
    startedAt: Date.now(),
  } as Partial<Services>)

  const hub = new OpencodeEventHub(opencode, logger, bus, (dir) => services.projects?.idForDirectory(dir))
  services.hub = hub
  services.projects = new ProjectsService(get)
  services.sessions = new SessionsService(get)
  services.scheduler = new SchedulerService(get)
  services.goals = new GoalService(get)
  services.autoaccept = new AutoAcceptService(get)
  services.control = new ControlService(get)
  services.plugins = new PluginService(get)
  services.projectIdForDirectory = (dir) => services.projects.idForDirectory(dir)
  services.directoryForProject = (id) => services.projects.directoryFor(id)

  services.start = async () => {
    logger.info(`starting core (opencode bin: ${cfg.opencodeBin ?? "NOT FOUND"})`)
    services.plugins.start()
    hub.on((e) => services.sessions.onOpencodeEvent(e))
    hub.on((e) => services.autoaccept.onOpencodeEvent(e))
    hub.on((e) => services.goals.onOpencodeEvent(e))
    await services.sessions.start()
    await services.opencode.start()
    hub.start()
    services.scheduler.start()
    services.goals.start()
    services.autoaccept.start()
    for (const project of await services.projects.list()) {
      services.client.location(project.path).catch(() => {})
    }
    logger.info("core ready")
  }

  services.stop = async () => {
    services.scheduler.stop()
    services.goals.stop()
    services.autoaccept.stop()
    services.plugins.stop()
    hub.stop()
    await services.opencode.stop()
    logger.info("core stopped")
  }

  return services
}
