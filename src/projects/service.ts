import { createHash } from "node:crypto"
import { existsSync, realpathSync, statSync } from "node:fs"
import { resolve as resolvePath, sep } from "node:path"
import { ohPaths } from "../core/paths"
import { JsonStore } from "../core/store"
import type { GetServices, ProjectsService as IProjectsService } from "../server/contracts"
import type { Project } from "../shared/types"

interface Registry {
  projects: Project[]
}

export function projectId(path: string): string {
  return "proj_" + createHash("sha1").update(path).digest("hex").slice(0, 12)
}

function canon(input: string): string {
  const abs = resolvePath(input)
  try {
    return realpathSync(abs)
  } catch {
    return abs
  }
}

export class ProjectsService implements IProjectsService {
  private store = new JsonStore<Registry>(ohPaths().projects, () => ({ projects: [] }))
  private canonical = new Map<string, string>()

  constructor(private deps: GetServices) {}

  private loadCanonical(): void {
    this.canonical.clear()
    for (const p of this.store.read().projects) this.canonical.set(p.id, canon(p.path))
  }

  async list(): Promise<Project[]> {
    return this.store.read().projects.map((p) => this.decorate(p))
  }

  private decorate(p: Project): Project {
    const available = existsSync(p.path) && statSync(p.path).isDirectory()
    return { ...p, available }
  }

  get(id: string): Project | undefined {
    const p = this.store.read().projects.find((x) => x.id === id)
    return p ? this.decorate(p) : undefined
  }

  async add(input: { path: string; name?: string }): Promise<Project> {
    if (!input?.path || typeof input.path !== "string") throw new Error("path is required")
    const dir = canon(input.path)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`not a directory: ${input.path}`)
    const registry = this.store.read()
    const id = projectId(dir)
    if (registry.projects.some((p) => p.id === id || canon(p.path) === dir)) {
      throw new Error(`project already registered: ${dir}`)
    }
    const project: Project = {
      id,
      name: input.name?.trim() || dir.split(sep).filter(Boolean).pop() || dir,
      path: dir,
      available: true,
      createdAt: Date.now(),
    }
    registry.projects.push(project)
    this.store.write(registry)
    this.canonical.set(id, dir)
    return project
  }

  async update(
    id: string,
    patch: Partial<Pick<Project, "name" | "defaultModel" | "defaultAgent" | "subagentDepth" | "denyList">>,
  ): Promise<Project> {
    const registry = this.store.read()
    const idx = registry.projects.findIndex((p) => p.id === id)
    if (idx === -1) throw new Error("project not found")
    const current = registry.projects[idx]
    registry.projects[idx] = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.defaultModel !== undefined ? { defaultModel: patch.defaultModel } : {}),
      ...(patch.defaultAgent !== undefined ? { defaultAgent: patch.defaultAgent } : {}),
      ...(patch.subagentDepth !== undefined ? { subagentDepth: patch.subagentDepth } : {}),
      ...(patch.denyList !== undefined ? { denyList: patch.denyList } : {}),
    }
    this.store.write(registry)
    return this.decorate(registry.projects[idx])
  }

  async remove(id: string): Promise<void> {
    const registry = this.store.read()
    registry.projects = registry.projects.filter((p) => p.id !== id)
    this.store.write(registry)
    this.canonical.delete(id)
  }

  rescan(): void {
    this.loadCanonical()
  }

  idForDirectory(directory?: string): string | undefined {
    if (!directory) return undefined
    if (this.canonical.size === 0) this.loadCanonical()
    const dir = canon(directory)
    for (const [id, c] of this.canonical) {
      if (dir === c || dir.startsWith(c + sep)) return id
    }
    return undefined
  }

  directoryFor(id: string): string | undefined {
    return this.store.read().projects.find((p) => p.id === id)?.path
  }
}
