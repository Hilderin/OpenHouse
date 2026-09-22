import { describe, expect, test } from "bun:test"
import { ControlService } from "../src/control/service"
import type { GetServices } from "../src/server/contracts"
import type { Project } from "../src/shared/types"

const projects: Project[] = [
  { id: "proj_a", name: "Alpha", path: "/tmp/alpha", available: true, createdAt: 1 },
]

function fakeDeps(): GetServices {
  const fake = {
    projects: {
      list: async () => projects,
    },
  }
  return (() => fake) as unknown as GetServices
}

describe("ControlService", () => {
  test("execute rejects with unknown action for unrecognised actions", async () => {
    const control = new ControlService(fakeDeps())
    await expect(control.execute("nope", {})).rejects.toThrow(/unknown action/)
  })

  test("execute dispatches projects.list to the projects service", async () => {
    const control = new ControlService(fakeDeps())
    const result = (await control.execute("projects.list", {})) as { projects: Project[] }
    expect(result.projects).toEqual(projects)
  })
})
