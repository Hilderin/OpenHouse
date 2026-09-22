import type { Level } from "../shared/types"

/** Permission ruleset presets applied to sessions ("sub-agent levels"). */
export const LEVELS: Level[] = [
  {
    name: "read-only",
    description: "Inspect only: reads allowed, edits and shell denied.",
    rules: [
      { action: "edit", resource: "*", effect: "deny" },
      { action: "patch", resource: "*", effect: "deny" },
      { action: "shell", resource: "*", effect: "deny" },
      { action: "bash", resource: "*", effect: "deny" },
    ],
  },
  {
    name: "standard",
    description: "Reads and edits allowed, shell asks first.",
    rules: [
      { action: "edit", resource: "*", effect: "allow" },
      { action: "shell", resource: "*", effect: "ask" },
    ],
  },
  {
    name: "full",
    description: "No restrictions (YOLO).",
    rules: [{ action: "*", resource: "*", effect: "allow" }],
  },
]

export function levelByName(name?: string): Level | undefined {
  if (!name) return undefined
  return LEVELS.find((l) => l.name === name)
}
