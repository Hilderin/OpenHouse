import { existsSync } from "node:fs"
import { join } from "node:path"
import { ohPaths, repoRoot } from "../core/paths"
import { atomicWrite, ensureDir, JsonStore } from "../core/store"
import type { GetServices, PluginService as IPlugin } from "../server/contracts"

interface PluginState {
  enabled: boolean
}

/**
 * Manages the watched OpenCode config file injected via `OPENCODE_CONFIG`.
 * Toggling the plugin entry is live: OpenCode watches its config files.
 * The enabled flag is persisted so it survives restarts.
 */
export class PluginService implements IPlugin {
  private configFile = ohPaths().managedConfig
  private pluginDir = join(repoRoot(), "src", "plugin", "plugin-dir")
  private store = new JsonStore<PluginState>(join(ohPaths().root, "plugin.json"), () => ({ enabled: false }))
  private enabled: boolean

  constructor(private deps: GetServices) {
    this.enabled = this.store.read().enabled === true
  }

  start(): void {
    this.sync()
  }

  stop(): void {}

  status() {
    return {
      enabled: this.enabled,
      configFile: this.configFile,
      pluginDir: this.pluginDir,
      injected: this.enabled && existsSync(this.pluginDir),
    }
  }

  async setEnabled(enabled: boolean): Promise<ReturnType<PluginService["status"]>> {
    this.enabled = enabled === true
    this.store.write({ enabled: this.enabled })
    this.sync()
    return this.status()
  }

  sync(): void {
    ensureDir(ohPaths().root)
    const config = {
      $schema: "https://opencode.ai/config.json",
      plugin: this.enabled && existsSync(this.pluginDir) ? [`file://${this.pluginDir}`] : [],
    }
    atomicWrite(this.configFile, JSON.stringify(config, null, 2))
  }
}
