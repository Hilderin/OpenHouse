# OpenHouse — Internal API contract (v1)

Base: `http://127.0.0.1:<port>` (default 7800). All routes under `/api/oh`.
JSON in/out. Errors: HTTP 4xx/5xx with body `{ "error": { "code": string, "message": string, "details"?: any } }`.

All session/project-scoped OpenHouse endpoints proxy to the managed OpenCode v2 server
(`x-opencode-directory` scoping), and never write to OpenCode's sqlite.

## Health & info
- `GET /api/oh/health` → `{ ok:boolean, version:string, uptimeMs:number, dataDir:string, opencodePin:string, opencode:{ status:"starting"|"ready"|"error"|"stopped", version?:string, url?:string, pid?:number, error?:string } }`
- `GET /api/oh/info` → `{ projects:number, sessions:number, schedules:number, goals:number, port:number, dataDir:string, opencodePin:string, opencode:{...} }`

## Projects
Project = `{ id, name, path, available:boolean, defaultModel?:ModelRef, defaultAgent?:string, subagentDepth?:number, denyList?:string[], createdAt:number, sessionCount?:number, lastActivity?:number }`
- `GET /api/oh/projects` → `{ projects:Project[] }`
- `POST /api/oh/projects` body `{ path:string, name?:string }` → `{ project:Project }` (400 if path missing/duplicate)
- `GET /api/oh/projects/:id` → `{ project:Project }`
- `PATCH /api/oh/projects/:id` body `{ name?, defaultModel?, defaultAgent?, subagentDepth?, denyList? }` → `{ project:Project }`
- `DELETE /api/oh/projects/:id` → `{ ok:true }` (registry only; never deletes files/sessions)

### Catalog per project (proxied, `directory=project.path`)
- `GET /api/oh/projects/:id/models` → `{ models:Model[], default:ModelRef }` where `Model = { providerID, id, name, limit:{context,input?,output?}, cost?, variants?:string[], status, enabled }`
- `GET /api/oh/projects/:id/agents` → `{ agents:Agent[] }` where `Agent = { id, name, description?, mode:"primary"|"subagent"|"all", hidden, permissions:Rule[] }`
- `GET /api/oh/projects/:id/skills` → `{ skills:{ id,name,description,path }[] }`
- `GET /api/oh/projects/:id/commands` → `{ commands:{ name,description }[] }`
- `GET /api/oh/projects/:id/mcp` → `{ servers:McpServer[] }` where `McpServer = { name, status:"connected"|"disabled"|"failed"|"needs_auth"|"needs_client_registration", enabled:boolean, type:"local"|"remote", tools?:string[] }`
- `POST /api/oh/projects/:id/mcp/:name/enable` → `{ servers:McpServer[] }`
- `POST /api/oh/projects/:id/mcp/:name/disable` → `{ servers:McpServer[] }`

## Sessions
Session = `{ id, projectId, directory, title, agent, model:ModelRef, parentID?:string, tokens:{input,output,reasoning,cache:{read,write}}, cost:number, time:{created,updated,idle?}, status:"idle"|"busy"|"retry"|"unknown", archived:boolean, pinned:boolean }`
- `GET /api/oh/projects/:id/sessions?limit?&cursor?&includeArchived?&parentID?` → `{ sessions:Session[], cursor:{previous?,next?} }`
- `POST /api/oh/sessions` body `{ projectId:string, title?, agent?, model?:ModelRef, parentID?, level?:LevelName }` → `{ session:Session }`
   - `level` applies a permission ruleset preset (see Levels) to the new session.
- `GET /api/oh/sessions/:id` → `{ session:Session }`
- `GET /api/oh/sessions/:id/messages?limit?&cursor?&order=asc|desc` → `{ messages:Message[], cursor }`
   - `Message = { id, type:"user"|"assistant"|"synthetic"|"system"|"compaction"|"shell"|"skill"|"idle"|"agent-switched"|"model-switched"|"location-switched", time:{created,completed?,streamed?}, text?:string, parts:ContentPart[], tokens?, cost?, agent?, model?, outcome?, raw:any }`
   - `ContentPart = { type:"text"|"reasoning"|"tool"|"patch"|"file"|"snapshot"|"step-start"|"step-finish"|..., ... }` (raw v2 content passthrough with a normalized `text` for text parts)
- `POST /api/oh/sessions/:id/prompt` body `{ text:string, files?, agents?, skills?, delivery? }` → `{ message:Message }`
- `POST /api/oh/sessions/:id/model` body `{ model:ModelRef }` → `{ session:Session }`
- `POST /api/oh/sessions/:id/agent` body `{ agent:string }` → `{ session:Session }`
- `POST /api/oh/sessions/:id/interrupt` → `{ ok:true }`
- `POST /api/oh/sessions/:id/compact` → `{ ok:true }`
- `PATCH /api/oh/sessions/:id` body `{ title?, archived?, pinned? }` → `{ session:Session }`
- `DELETE /api/oh/sessions/:id` → `{ ok:true }`
- `GET /api/oh/sessions/:id/status` → `{ sessionId, status, tokens, cost, context:{ used:number, limit:number, percent:number, model?:ModelRef, unknownAfterCompaction:boolean }, goal?:Goal }`
- `GET /api/oh/sessions/:id/children` → `{ sessions:Session[] }`

### Goal
Goal = `{ sessionId, objective:string, budgetTokens?:number, maxTurns?:number, turns:number, usedTokens:number, state:"armed"|"running"|"paused"|"complete"|"blocked"|"aborted", lastVerdict?, note?, updatedAt:number }`
- `PUT /api/oh/sessions/:id/goal` body `{ objective:string, budgetTokens?, maxTurns? }` → `{ goal:Goal }`
- `GET /api/oh/sessions/:id/goal` → `{ goal:Goal|null }`
- `POST /api/oh/sessions/:id/goal/pause` → `{ goal:Goal }`
- `POST /api/oh/sessions/:id/goal/resume` → `{ goal:Goal }`
- `DELETE /api/oh/sessions/:id/goal` → `{ ok:true }`

## Schedules
Schedule = `{ id, projectId, name, cron:string, enabled:boolean, prompt:string, model?:ModelRef, agent?:string, goal?:{ objective, budgetTokens?, maxTurns? }, lastRun?:number, lastStatus?:"ok"|"error", lastError?, lastSessionId?, nextRun?:number, createdAt:number }`
- `GET /api/oh/schedules?projectId?` → `{ schedules:Schedule[] }`
- `POST /api/oh/schedules` body `{ projectId, name, cron, enabled?, prompt, model?, agent?, goal? }` → `{ schedule:Schedule }`
- `PATCH /api/oh/schedules/:id` body partial → `{ schedule:Schedule }`
- `DELETE /api/oh/schedules/:id` → `{ ok:true }`
- `POST /api/oh/schedules/:id/toggle` → `{ schedule:Schedule }`
- `POST /api/oh/schedules/:id/run` → `{ ok:true, sessionId:string }`

## Levels (sub-agent permission presets)
Level = `{ name:"read-only"|"standard"|"full", description:string, rules:Rule[] }`
- `GET /api/oh/levels` → `{ levels:Level[] }`
Rules are OpenCode v2 ordered rules `{ action, resource, effect:"allow"|"deny"|"ask" }`.

## Auto-accept (always YOLO)
- `GET /api/oh/autoaccept/audit?limit?` → `{ entries:{ at:number, sessionID:string, requestID:string, action:string, resources:string[], reply:"once"|"always"|"reject", reason:"rule"|"deny-list" }[] }`

## Control (typed action contract; also exposed as agent tool `openhouse`)
- `POST /api/oh/control` body `{ action:string, ...params }` → `{ ok:true, data:any }`
Actions (MVP): `health`, `projects.list`, `projects.add`, `projects.remove`, `sessions.list`, `sessions.create`, `sessions.send`, `sessions.messages`, `sessions.status`, `sessions.interrupt`, `sessions.delete`, `models.list`, `agents.list`, `skills.list`, `schedules.list`, `schedules.create`, `schedules.run`, `schedules.delete`, `schedules.toggle`, `goal.set`, `goal.status`, `goal.pause`, `goal.resume`, `goal.clear`, `mcp.list`, `mcp.enable`, `mcp.disable`.

## Events (SSE)
- `GET /api/oh/event?projectId?` → `text/event-stream`. Events: `{ type, at:number, projectId?, sessionId?, data:any }`.
Types:
- `snapshot` `{ opencode:{...} }` (on connect)
- `opencode.status` `{ status, version?, url?, error? }`
- `session.updated` `{ session }`
- `session.status` `{ sessionId, status, reason?:string, goal?:Goal }`
- `session.message` `{ sessionId, message:Message }` (on commit)
- `session.question` `{ sessionId, question:any }` (opencode `form.created` / `question.asked` — the session is waiting for an answer)
- `session.delta` `{ sessionId, messageId, kind:"text"|"reasoning"|"tool", index?, delta:string }`
- `session.context` `{ sessionId, context }` (throttled token updates)
- `schedule.run` `{ scheduleId, projectId, sessionId, status:"started"|"ok"|"error", error? }`
- `goal.updated` `{ goal }`
- `autoaccept` `{ entry }`
- `catalog.updated` `{ projectId, kind:"models"|"agents"|"commands"|"skills"|"mcp"|"providers" }`
- `project.updated` `{ project }`
- `ping` `{ at }` (every 15s)

## Static UI
- The core serves the built UI (`ui/dist`) at `/` with SPA fallback (non-`/api` GET → index.html).
