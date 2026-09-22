/**
 * OpenHouse agent tool plugin for OpenCode v2 (pinned 2.0.11).
 *
 * The v2 plugin API default-exports a definition `{ id, setup }` (the value
 * returned by `Plugin.define`). `define` is only a type helper, so this plain
 * object avoids a runtime dependency on `@opencode/plugin` being resolvable
 * from the plugin directory.
 *
 * `setup` registers exactly one tool, `openhouse`, which forwards
 * `{ action, ...params }` to the OpenHouse control API (`OPENHOUSE_CONTROL_URL`).
 */

interface OpenHouseTool {
  name: string
  description: string
  input: Record<string, unknown>
  execute(input: unknown): Promise<{ content: string }>
}

interface ToolEditor {
  add(tool: OpenHouseTool): void
}

interface PluginContext {
  tool: {
    transform(edit: (editor: ToolEditor) => void): Promise<unknown>
  }
}

const CONTROL_ACTIONS = [
  "health",
  "projects.list",
  "projects.add",
  "projects.remove",
  "sessions.list",
  "sessions.create",
  "sessions.send",
  "sessions.messages",
  "sessions.status",
  "sessions.interrupt",
  "sessions.delete",
  "models.list",
  "agents.list",
  "skills.list",
  "schedules.list",
  "schedules.create",
  "schedules.run",
  "schedules.delete",
  "schedules.toggle",
  "goal.set",
  "goal.status",
  "goal.clear",
  "mcp.list",
  "mcp.enable",
  "mcp.disable",
]

async function callControl(action: string, params: Record<string, unknown>): Promise<string> {
  const url = process.env.OPENHOUSE_CONTROL_URL
  if (!url) {
    return "Error: OPENHOUSE_CONTROL_URL is not set, so the OpenHouse control API is unreachable. Start OpenHouse (`openhouse serve`) and retry."
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...params }),
    })
    const text = await res.text()
    if (!res.ok) return `OpenHouse control error (HTTP ${res.status}): ${text || res.statusText}`
    return text || "{}"
  } catch (err) {
    return `OpenHouse control request failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

export default {
  id: "openhouse",
  async setup(ctx: PluginContext): Promise<void> {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "openhouse",
        description:
          "Control the OpenHouse manager. Pass an action and optional params. " +
          `Actions: ${CONTROL_ACTIONS.join(", ")}. ` +
          "Examples: { action: \"projects.list\" }, { action: \"sessions.create\", params: { projectId, level } }, " +
          "{ action: \"sessions.send\", params: { sessionId, text } }, { action: \"schedules.create\", params: { projectId, name, cron, prompt } }, " +
          "{ action: \"goal.set\", params: { sessionId, objective, budgetTokens, maxTurns } }.",
        input: {
          type: "object",
          properties: {
            action: { type: "string", description: "The OpenHouse control action to run." },
            params: { type: "object", description: "Action parameters (merged into the control body)." },
          },
          required: ["action"],
          additionalProperties: false,
        },
        async execute(input: unknown) {
          const { action, params } = (input ?? {}) as { action?: string; params?: Record<string, unknown> }
          if (!action) return { content: "Error: the openhouse tool requires an `action` string." }
          return { content: await callControl(action, params ?? {}) }
        },
      })
    })
  },
}
