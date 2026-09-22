# OpenHouse — Architecture & module ownership (MVP1)

Spec fonctionnelle: `docs/analyse-mvp1.md` · API interne: `docs/api-contract.md`.

## Process model
`Electron main` héberge le core in-process (`startCore()`), ou `openhouse serve` en headless (Node/Bun).
Le core gère un enfant `opencode serve` v2.0.11 (spawn, santé, restart) et expose `/api/oh/*` + SSE sur `127.0.0.1:7800`.

## Invariants (à ne pas violer)
1. **Environnement assaini au spawn opencode** : supprimer toute var `OPENCODE*` / `OPENCHAMBER*` héritée, puis poser `OPENCODE_SERVER_PASSWORD` (le core génère un token) et, si fourni, `OPENCODE_CONFIG`. Sinon le serveur managé hérite du mot de passe/plugin d'OpenChamber (bug constaté).
2. **Auth opencode** : le serveur v2.0.11 exige HTTP Basic (user `opencode`, password = `OPENCODE_SERVER_PASSWORD`). Toutes les requêtes core→opencode portent `Authorization: Basic base64("opencode:"+password)`.
3. **Multi-projets** : scoping par header `x-opencode-directory: <path>` (ou `?directory=`). Un seul serveur opencode.
4. **Jamais d'écriture dans la sqlite opencode.** Toute config opencode se fait via son API HTTP, et uniquement de façon ciblée.
5. **Événements** : un seul lecteur SSE `GET /api/event` (porte `location.directory` par event) → fan-out sur le bus OpenHouse. Pas de watcher côté OpenHouse ; le hot-reload s'appuie sur les events catalogue (`skill.updated`, `agent.updated`, `command.updated`, `provider.updated`, `model.updated`, `plugin.updated`, `integration.updated`, `websearch.updated`, `reference.updated`) coalescés ~250 ms → event OpenHouse `catalog.updated`.
6. **Statut live** : synthétisé depuis `session.execution.started|succeeded|interrupted|failed` (v2 n'émet pas `session.status`) + `POST /api/session/:id/wait`.
7. **YOLO permanent** : répondeur serveur aux `permission.asked` → `POST /api/session/:id/permission/:requestID/reply` (body `{ reply:"once" }`), fail-closed (si l'event hub est déconnecté → on ne répond pas).
8. **Contexte** : `tokens.total` s'il existe, sinon dernière `session.usage.updated` / tokens du dernier message assistant ; limite = modèle du session record via `model.list`. Overlay `sessions-meta.json` pour pin/archive (v2 metadata = create-only).

## Wire opencode v2.0.11 (vérité terrain)
- `GET /api/info` → `{version,pid,urls,paths}` (pas `/api/health`).
- `GET /api/location` → `{directory, project:{id,directory,canonical}}`.
- `GET /api/session?directory=&cursor=&limit=` → `{data:[Session...], cursor:{previous?,next?}}`. `Session` keys: `id,projectID,agent,model,tokens,cost,time,title,location`.
- `POST /api/session` body `{id?,title?,agent?,model?{providerID,id,variant?},location?{directory},metadata?,permissions?:Rule[]}` → `{data:Session}`.
- `GET /api/session/:id` → `{data:Session}` · `DELETE` → 204 · `PATCH {title?,permissions?}` → 204.
- `GET /api/session/:id/message?limit&order=asc|desc&cursor&type` → `{data:[Message],cursor}`. Message types: `user(synthetic,system,skill,shell,assistant,compaction,idle,agent-switched,model-switched,location-switched)`. Assistant: `{content:[{type:"text",text}|{type:"tool",...}...],tokens,cost,finish,agent,model,time}`.
- `POST /api/session/:id/prompt` body `{id?,text,files?,agents?,skills?,metadata:{},delivery?}` → `{data:{id,type:"user",payload,delivery}}`.
- `POST /api/session/:id/interrupt|compact` → `{data|204}` · `GET /api/session/:id/context` → `{data:[Message]}` (messages depuis la dernière compaction).
- `POST /api/session/:id/agent` `{agent}` → 204 · `POST /api/session/:id/model` `{model:{providerID,id,variant?}}` → 204.
- `POST /api/experimental/session/:id/wait` → 204 (bloque jusqu'à idle).
- `GET /api/session/active` → `{data:Record<id,{type:"running"}>}`.
- `GET /api/agent` → `{location,data:[{id,name,description,mode:"primary"|"subagent"|"all",hidden,permissions:Rule[]}]}`.
- `GET /api/model` → `{location,data:[{providerID,id,name,limit:{context,input?,output?},cost,variants,status,enabled}]}` · `GET /api/model/default` → `{data:Ref}`.
- `GET /api/provider` → `{location,data:[{id,name,activation,package,settings}]}`.
- `GET /api/skill` → `{location,data:[{id,name,description,path,content?}]}` · `GET /api/command` → `{location,data:[{name,description}]}`.
- `GET /api/mcp` → `{data:[{name,type,status,tools?,enabled?}]}` · `POST /api/experimental/mcp/:server/connect|disconnect`.
- `POST /api/session/:id/permission/:requestID/reply` body `{reply:"once"|"always"|"reject", message?}`.
- `GET /api/event` SSE: `data: {id,created,type,location:{directory},data,durable?}` + `: heartbeat`. Types clés: `session.created|updated|deleted`, `session.execution.started|succeeded|interrupted|failed`, `session.text.delta`, `session.step.*`, `session.usage.updated`, `session.inbox.delivered|enqueued`, `permission.asked|replied`, `message.*`, `catalog` (`provider/model/agent/command/skill/plugin/integration/websearch/reference`.updated), `server.connected`.
- `Permission.Request` = `{id,sessionID,action,resources[],save?,metadata?,source?,message?}`.

## Layout & ownership
```
src/core/            paths, config, logger, store, events(bus), ids            [foundation]
src/opencode/        client(http+sse), lifecycle(spawn/health), events(hub)     [foundation]
src/server/          context(wiring), app(hono+static+sse), routes/health      [foundation]
src/cli.ts, electron/main.ts                                                   [foundation]
src/projects/        service.ts, routes.ts                                      [agent A]
src/sessions/        service.ts, routes.ts                                      [agent A]
src/scheduler/       service.ts, routes.ts, store.ts                            [agent B]
src/goal/            service.ts, routes.ts                                      [agent B]
src/autoaccept/      service.ts, routes.ts, audit.ts                            [agent B]
src/control/         actions.ts, service.ts, routes.ts                          [agent B]
src/plugin/          service.ts, plugin-dir/                                    [agent B]
src/levels.ts                                                                   [foundation]
ui/                  renderer React (Vite)                                      [agent C]
test/                bun tests + e2e                                            [agent D]
```

Chaque service reçoit `Services` (voir `src/server/context.ts`) et n'édite que ses propres fichiers.
`src/server/app.ts` et `src/server/context.ts` sont la propriété de l'intégrateur (ne pas modifier).

## Commandes
- Core: `bun run src/cli.ts serve` · UI dev: `bun run dev:ui` (proxy `/api` → 7800)
- Tests: `bun test` · Typecheck: `bun run typecheck`
- Binaire opencode managé: `~/.local/share/openhouse/opencode/2.0.11/opencode` (résolu via `OPENHOUSE_OPENCODE_BIN` ou `~/.config/openhouse/bin/opencode-2.0.11`).
