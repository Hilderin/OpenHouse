# OpenHouse — Analyse fonctionnelle & technique (MVP1)

**Date:** 2026-09-21
**Statut:** document de décision — à valider avant implémentation
**Révision 2 (2026-09-21):** pivot UI — décision utilisateur : **application Electron « à la OpenChamber »** au lieu d'une TUI. Le cœur daemon-first est conservé (hosté dans le process principal Electron + mode headless pour les crons).
**Sources analysées:**
- OpenChamber, branche `opencode-v2-refactoring` (worktree `/tmp/opencode/oc2v2`, commit `229d4f386`, 36 commits devant `main`) — intégration OpenCode v2 de référence
- OpenCode, repo `/home/guillaume/Documents/Projects/opencode` — produit v2 = tags `v2.0.x` (dernier local `v2.0.11`, npm `@opencode/cli`), packages `cli/core/server/protocol/schema/client/sdk-next/tui`
- Binary `opencode` actuellement sur le PATH = 1.18.30 (**v1**, monté par l'AppImage OpenChamber) — inutilisable pour OpenHouse, voir §8 Phase 0

---

## 1. Vision et positionnement

OpenHouse = **« OpenChamber lite »** : un gestionnaire multi-projets/sessions par-dessus OpenCode v2, sous forme d'une **application Electron** dont le process principal héberge un **cœur serveur headless** (le même code peut tourner en daemon standalone pour les crons sans app ouverte).

| | OpenChamber | OpenHouse |
|---|---|---|
| Surfaces | Electron + Web/PWA + VS Code + mobile | Electron uniquement (+ API HTTP locale pour CLI/scripts) |
| Process résidents | 1 serveur (dans Electron main) + 1 `opencode serve` + PTY + git polling | 1 cœur dans Electron main + 1 `opencode serve` (+ MCP) |
| UI | React 19 + Vite + Tailwind + CodeMirror + Shiki | React (renderer) — patterns réutilisables de `packages/ui` d'OpenChamber |
| Fonctions server-side | sessions, crons, goal, auto-accept, terminal, git, fs, tunnels, extensions… | sessions, crons, goal, auto-accept, control API — **le reste est hors scope** |

Objectifs non fonctionnels : le « lite » vient **du périmètre et du modèle de processus**, pas de la techno de rendu — pas de PTY hébergés (terminal hors scope), pas de polling git, pas de watchers (délégué à OpenCode v2), pas de serveur web/PWA/tunnels/extensions, fenêtre unique, cœur agnostique du host (Electron main ou CLI headless). Electron ramène un Chromium (~200-400 MB) : c'est le compromis accepté en échange d'une UI riche éprouvée.

**Insight structurant d'OpenChamber :** tout ce qui est intéressant vit déjà dans sa couche headless `packages/web/server/` — et son process Electron **héberge le backend in-process, jamais en sidecar** (`packages/electron/process-lifecycle.md`). OpenHouse suit exactement ce découpage : *cœur daemon-first, le renderer n'est qu'un client HTTP/SSE de même origine* — remplaçable, et le cœur tourne aussi sans UI.

---

## 2. Ce qu'on hérite d'OpenChamber (branche v2) — patterns réutilisables

| Pattern | Source (worktree) | Transposition OpenHouse |
|---|---|---|
| Lifecycle OpenCode managé | `packages/web/server/lib/opencode/lifecycle.js` (spawn `opencode serve --hostname --port`, health `GET /api/info` /15s, classification erreurs, restart + rebind events, warmup répertoires récents, teardown par groupe de process) | Reprendre quasi tel quel (S) |
| Scoping multi-projets | header `x-opencode-directory` + `clientFor(directory)` (`packages/ui/src/lib/opencode/client.ts`) | Client SDK par projet, un seul serveur opencode |
| Hub d'événements | 1 lecteur SSE global (`event-stream/global-hub.js`) + fan-out, coalescing delta 50 ms (mesuré : 5,7 KB → 483 frames au lieu de 3 402), replay buffer borné, watchdog stall | Reprise avec bornage mémoire (M) |
| Goal mode | `packages/web/server/lib/session-goal/` : boucle serveur, quiet window 15 s après `session.status idle`, objectif dans `goals/<sessionId>.md` + `metadata.*.goal`, audit par small model `{verdict: continue\|complete\|blocked}`, budget tokens, cap 20 turns, abort⇄pause | Version simplifiée (voir §4.7) |
| Auto-accept (YOLO) | `packages/web/server/lib/permission-auto-accept/` : le serveur est l'unique répondeur aux `permission.asked`, fail-closed, héritage nearest-ancestor pour sessions sub-agents, réconciliation après restart | Cœur du « toujours YOLO » (§4.8) |
| Crons | `packages/web/server/lib/scheduled-tasks/` : cron-parser + luxon, claiming cross-instance sous lock fichier, exécution = création session + prompt, option goal | Reprise sans la partie « loops .md » en MVP1 (§4.4) |
| Contrat de control | `openchamber-control/actions.js` : actions typées (`projects.list`, `session.create|send|fork|status|messages`, `schedule.*`) partagées CLI ↔ tool agent via `POST /api/openchamber/control` | Même contrat, renommé `openhouse` (§4.3) |
| Plugin managé injecté | `managed-config-file.js` : fichier config surveillé `OPENCODE_CONFIG=<data>/opencode.managed.json` listant des plugins (tools) — toggle sans restart | Pour injecter le tool `openhouse` aux agents (§4.3, §4.13) |
| Context length | `packages/ui/src/stores/utils/tokenUtils.ts` : préférer `tokens.total` du dernier message assistant (pas la somme des parts, qui sur-compte les tours multi-steps) ; limite = modèle du *session record* ; fallback 200k | Algorithme repris (§4.5) |
| État local | JSON + `.json.lock` sous `~/.config/openchamber` (settings, projects/<id>.json, overlays sessions) — pas de SQLite propre | Même approche sous `~/.config/openhouse` |

**Pièges v1→v2 documentés par la cutover OpenChamber** (à ne pas redécouvrir) :
1. Le *session record* est l'autorité pour model/agent (`session.switchModel`/`switchAgent`), pas le prompt.
2. Messages plats v2 (`session_message`, `content[]`), compaction = message first-class qui streame.
3. Permissions = tableau ordonné `{action, resource, effect: allow|deny|ask}`, dernière correspondance gagne.
4. Credentials dans la sqlite d'OpenCode (`credential`) — lecture seule, écritures uniquement via les flows HTTP d'OpenCode.
5. Statut live **synthétisé** depuis `session.execution.started|succeeded|interrupted|failed` (v2 n'émet pas de `session.status`).
6. Overlays nécessaires côté manager : v2 n'accepte les metadata qu'à la création, pas d'état archive → overlays JSON locaux.
7. Cadence breaking élevée : 2.0.3 → 2.0.10 a supprimé `/api/health`, changé le storm `catalog.updated` en `provider/model.updated`, changé le rename de session… → **pin de version exact + tests de contrat obligatoires**.

---

## 3. Surface OpenCode v2 exploitée

- **Un serveur, plusieurs projets** : `opencode serve` (défaut `127.0.0.1`, port auto 4096→libre), instances chargées par requête via `x-opencode-directory` ; les routes session-scopées v2 résolvent la location depuis la ligne de session.
- **Client SDK** : `@opencode/client` (généré, zéro Effect) — `OpenCode.make({ baseUrl })`, `clientFor(directory)` via header. Pin exact (OpenChamber : 2.0.10 ; dernier tag dispo : 2.0.11).
- **Groupes `/api/*` (v2.0.11)** : `session` (list/create/active/get/switchAgent/switchModel/prompt/compact/wait/interrupt/revert stage-clear-commit/context/history/events avec curseur `after`), `message` (paginé curseur), `permission` (request/saved/reply), `form` (questions), `event` (SSE), `mcp`, `skill`, `agent`, `command`, `model`, `provider`, `generate` (small model), `worktree`, `vcs`, `project`, `location`, `fs`, `credential`, `integration`, `plugin`, `pty`, `persistent-pty`, `shell`, `websearch`, `debug`, `migration`, `server`, `rpc`, `reference`.
- **Événements** : `GET /api/event` (instance) et `GET /api/global/event` (cross-projets) ; v2 durables par session avec replay `after` ; hot-reload natif — OpenCode v2 surveille ses fichiers et émet `skill.updated`, `provider.updated`, `model.updated` (entre autres). **OpenHouse ne pose aucun watcher.**
- **Subagents** : tool `subagent` (ex-`task`) → session enfant (`parentID`, id dans `metadata.sessionID` du tool), permissions dérivées parent+agent, `subagent_depth` (défaut 1) dans la config.
- **YOLO** : pas de flag serveur « accept-all » ; pattern officiel = répondeur événementiel aux `permission.asked` (cf. `opencode run --auto`) + éventuelles règles `allow` en config.
- **Persistence** : sqlite `~/.local/share/opencode/opencode.db` (WAL) — `session_v2`, `session_message`, `event`, `credential`, `kv`. OpenHouse n'écrit **jamais** dedans.
- **Manques assumés par v2** (deltas à la charge d'OpenHouse) : cron/scheduler, goal mode, archive, pin/metadata post-création.

---

## 4. Analyse fonctionnelle MVP1 — feature par feature

Légende complexité : S (< 1 j), M (1-3 j), L (3-5 j).

### 4.1 Projets / folders — `S/M`
- **Besoin** : ajouter/retirer des dossiers de travail ; voir leurs sessions.
- **Apport v2** : scoping `x-opencode-directory` ; `project.list`, `location.get` ; instances per-directory paresseuses (warmup des répertoires récents après démarrage — pattern OpenChamber).
- **Delta OpenHouse** : registry local (`projects.json` : `{id, path, name}`) + validation (path existe, pas doublon) + warmup. Pas de git/worktrees (hors scope). Parité fonctionnelle avec OpenChamber hors worktrees ≈ 80%.
- **Risque** : répertoire déplacé/supprimé → état « unavailable » propre à afficher.

### 4.2 Historique de sessions par projet — `M`
- **Apport v2** : `session.list` paginé filtré par directory + `parentID` (arbre sub-agents), `message.list` paginé, `session.events` avec replay `after`.
- **Delta OpenHouse** : cache léger côté renderer (première page immédiate), synthèse du statut busy/idle depuis `session.execution.*`, overlay minimal `sessions-meta.json` (titre affiché/pin/archive si voulu — v2 ne prend les metadata qu'à la création).
- **Décision** : garder ou non l'archive en MVP1 (recommandé : oui, c'est ~100 lignes, sinon la liste devient un dépotoir).

### 4.3 API/tools pour communiquer avec les sessions OpenHouse — `M`
- **Besoin** : parité avec le modèle OpenChamber — (a) API HTTP pour clients externes (CLI/scripts), (b) tool injecté aux agents pour qu'ils pilotent OpenHouse eux-mêmes.
- **Design** : un seul **contrat d'actions typées** (style `openchamber-control/actions.js`) : `projects.list`, `session.create|send|fork|status|messages`, `schedule.status|list|create|run|delete|toggle`, `models.list`, `goal.status`… exposé :
  1. en `POST /api/oh/control` (HTTP, pour CLI/scripts/renderer),
  2. en tool `openhouse` injecté aux agents via le **fichier config managé surveillé** (`OPENCODE_CONFIG` → `plugins: [<dir>]`) — toggle live sans restart.
- **Règle OpenChamber à conserver** : les deux adaptateurs délèguent au même service ; aucun ne spawn/appelle l'autre.

### 4.4 Jobs cron — `M`
- **Besoin** : tâches planifiées (daily/weekly/cron/once) créant une session et envoyant un prompt.
- **Apport v2** : aucun scheduler intégré (seul `schedule` GitHub Actions, externe).
- **Delta OpenHouse** : scheduler in-daemon (timers + `cron-parser`), stockage `schedules.json` (global, `{projectId, name, cron, enabled, model, agent, prompt, goal?}`), `lastRun`/`nextRun`, claiming par lock fichier si double daemon, exécution = `session.create` + `session.prompt` (+ goal optionnel), événements de run sur le SSE OpenHouse. Héritage direct du design `scheduled-tasks/` d'OpenChamber, sans les « loops .md » ni la double instance.
- **Fonctionnel UI** : liste des schedules par projet, toggle enabled, run manuel, statut dernier run.

### 4.5 Status + context length — `S/M`
- **Apport v2** : tokens sur le session record et les messages (`tokens.total` final par tour), limites par modèle (`model.list` → `limit.context/input/output`), compaction auto observable, `session.context` (v2.0.11) en complément.
- **Delta OpenHouse** : calcul côté daemon — % = `tokens.total` du dernier message assistant ÷ limite du modèle du session record (algorithme OpenChamber `tokenUtils`), affichage UI (barre de contexte + cache hit rate), état « unknown after compaction » temporaire. Statut busy/idle/retry synthétisé des événements `session.execution.*` + `GET /api/session/active` / `session.wait`.

### 4.6 Models / providers — `S`
- **Apport v2** : `model.list` (catalogue plat, chaque entrée nomme son provider), `provider.list`, `model.default`, `session.switchModel` (préserve l'epoch de contexte), variantes (effort de raisonnement).
- **Delta OpenHouse** : défaut par projet (config OpenHouse) + sélection par session dans l'UI (switch avant envoi), favoris/récents locaux. Custom providers : hors MVP1 (écriture config = périmètre « Settings », hors scope) — lecture seule.

### 4.7 Goal mode — `L`
- **Besoin** : objectif long-courant, la session boucle seule jusqu'à complétion — doit survivre à la fermeture de la fenêtre et tourner aussi en mode headless (donc dans le cœur serveur, pas dans le renderer).
- **Design MVP1 (simplification du loop OpenChamber)** :
  - armement : `PUT /api/oh/sessions/:id/goal {objective, budgetTokens?, maxTurns?}` → objectif persisté (`goals/<sessionId>.md` + entrée d'état) ;
  - boucle : après `session.execution.succeeded` + quiet window 10-15 s → si pas terminé, relance ;
  - **autorité de terminaison = audit small model** (groupe `generate` v2 / `POST /api/experimental/generate`) : `{verdict: continue|complete|blocked, note}` ;
  - hard stops : budget tokens (comptabilité segmentée autour des compactions), cap turns, erreurs assistant, abort⇄pause ;
  - notifications sur le SSE OpenHouse + toast UI.
- **Risque** : faux « complete » → exiger note + budget obligatoire ; coût small model (utiliser `small_model`-compatible).

### 4.8 Toujours YOLO — `S/M`
- **Design** : répondeur daemon aux `permission.asked` → `permission.reply` (once) — le pattern exact de `run --auto` et d'OpenChamber, **toujours actif** (conforme au souhait « toujours en mode yolo »), avec :
  - fail-closed (si le daemon perd le flux SSE → les permissions rependent, jamais d'auto-allow implicite) ;
  - héritage nearest-ancestor pour les sessions sub-agent (parité OpenChamber) ;
  - journal d'audit local des auto-accepts (action+resource+session, horodaté) — consultable via l'API ;
  - deny-list optionnelle par projet (règles `deny` écrites en config v2 au moment de l'ajout du projet — one-shot, pas une UI Settings).
- **Alternative écartée en MVP1** : écrire `{effect:"allow"}` global dans la config v2 (couvrirait les runs sans daemon, mais moins contrôlable/auditable).

### 4.9 Sélection d'agents — `S`
- **Apport v2** : `agent.list` par répertoire (built-ins `build`/`plan` + `.opencode/agent|agents/*.md` + config), `session.switchAgent`, agents `mode: primary|subagent|all`.
- **Delta OpenHouse** : défaut par projet + picker à la création/switch. Lecture seule sur les définitions (pas d'UI d'édition).

### 4.10 Skills — `S`
- Pas d'UI (demandé). Découverte 100% OpenCode (`~/.config/opencode/skills`, `.opencode/skills`, `.claude`, `.agents`, `skills.paths/urls`). L'UI affiche au plus la liste (read-only) pour vérifier le chargement. Injection : les skills sont exposés au modèle en noms+descriptions, chargés à la demande via le tool `skill`.

### 4.11 MCPs — état + activer/désactiver — `M`
- **Apport v2** : groupe `mcp` (état `connected|disabled|failed|needs_auth` + tools cachés par serveur), `mcp.connect`/`mcp.disconnect` runtime, config `mcp.servers` avec `enabled`, OAuth remote.
- **Delta OpenHouse** : vue d'état par projet + toggle. Deux mécanismes : (a) connect/disconnect runtime (immédiat), (b) persistance = écrire `enabled: false` dans la couche config user du projet (écriture config ciblée, pas une UI Settings générale). Needs_auth → affiché, le flow OAuth complet est hors MVP1 (sauf si trivial via `integration`).

### 4.12 Auto-reload skills/agents/commands — `S`
- **Apport v2** : OpenCode v2 surveille ses propres fichiers et émet `skill.updated`, `provider.updated`, `model.updated`, etc. — reload à chaud sans restart (confirmé sur tag v2.0.11 : `session.skill.activated`, `skill.updated`…).
- **Delta OpenHouse** : **aucun watcher côté OpenHouse** ; s'abonner au SSE, coalescer les rafales (fenêtre ~250 ms, pattern OpenChamber `catalogRefresh`), re-lire la tranche concernée. Restart d'opencode réservé au changement de binary/port.

### 4.13 Gestion des sub-agents avec différents niveaux — `M/L`
- **Apport v2** : tool `subagent` → session enfant `parentID`, permissions dérivées (parent ∩ agent), `subagent_depth` configurable, `session.list?parentID=` pour l'arbre.
- **Delta OpenHouse** :
  1. vue arbre des sessions enfants dans l'historique (parentID) + coût/tokens par enfant ;
  2. **niveaux** = presets de règles de permissions v2 applicables aux agents définis par l'utilisateur (ex. `read-only` : deny `edit`,`bash` ; `standard` ; `full`) — écrits dans `.opencode/agent/<name>.md`/config du projet au moment de l'application (action ponctuelle, pas une UI Settings) ;
  3. `subagent_depth` par projet (config) ;
  4. bonus cohérent avec §4.3 : le tool `openhouse` injecté permet à l'agent de créer des sessions OpenHouse avec un `level` paramétrable.

---

## 5. Architecture technique proposée

### 5.1 Modèle de processus

```
┌─ Electron main (Node 22) ──────────────────────────────────┐
│  openhouse core (code identique au mode headless)          │
│  registry projets / schedules / overlays (JSON + flock)    │
│  scheduler (cron-parser + timers)                          │
│  goal loops + auto-accept (répondeurs SSE)                 │
│  event hub : 1 lecteur /api/global/event + fan-out SSE     │
│  HTTP localhost :7800 — /api/oh/* + SSE /api/oh/event      │
│  └─ child managé : opencode serve v2 (pin 2.0.11)          │
│      health /api/info, restart+rebind, warmup répertoires  │
│      └─ enfants propres : serveurs MCP, shells             │
└────────────────────────────────────────────────────────────┘
   renderer React — client HTTP/SSE du core (même origine)
   clients externes : curl / scripts / CLI / tool openhouse
   mode headless : `openhouse serve` (Node/Bun, même core)
```

- **Cœur in-process, jamais en sidecar** (pattern OpenChamber `process-lifecycle.md`) : le renderer n'est qu'un client ; le core démarre avec l'app et expose l'API locale aux clients externes.
- **Mode headless `openhouse serve`** : le même core tourne sans fenêtre (Node ou Bun) — utile pour les crons/goals quand l'app est fermée ; le claiming par lock (§4.4) gère déjà la coexistence app+daemon.
- Pas de PTY (terminal hors scope), pas de polling git (hors scope), pas de watchers (délégué à v2), pas de PWA/tunnels/extensions (hors scope).

### 5.2 Stack (recommandation)

| Composant | Choix | Justification / alternative |
|---|---|---|
| Runtime | **TypeScript** — Electron main (Node 22) en prod ; **Bun** pour dev/tests/scripts | le core doit tourner à l'identique dans Electron main et en headless → API Node uniquement |
| Client OpenCode | **`@opencode/client`** pin exact (2.0.11) | généré, zéro Effect ; wrapper reconnect SSE (backoff expo 1s→30s, comme la TUI officielle) |
| Core serveur | **Hono + `@hono/node-server`** (HTTP + SSE) | léger (~0 dep), portable Node/Electron/Bun ; pas d'Express, pas d'Effect |
| UI | **Electron + React 19 (renderer)**, electron-vite | parité maximale avec les patterns d'OpenChamber (`packages/ui` : stores sync, sidebar, chat, tokenUtils) — vérifier la licence avant copie verbatim |
| État | **JSON + flock** sous `~/.config/openhouse` | pattern OpenChamber éprouvé, debuggable, pas de SQLite |
| Schedules | `cron-parser` (ou `croner`) + `Temporal`/`luxon` | parité OpenChamber |
| Validation | schemas `@opencode/schema` + zod pour nos propres payloads | cohérence wire |

### 5.3 Découpage (modules)

Le cœur (`src/`) est **agnostique du host** — démarré par Electron main ou par le CLI headless `openhouse serve`.

```
src/
  server/          # Hono, routes /api/oh/*, SSE hub
  opencode/        # lifecycle (spawn/health/restart/warmup), client SDK, reconnect SSE
  projects/        # registry + config par projet + warmup
  sessions/        # listes paginées, statuts synthétisés, context tokens, overlays (meta/archive)
  scheduler/       # crons, claiming lock, exécution
  goal/            # boucle goal + audit small model + budgets
  autoaccept/      # répondeur permission.asked + audit log + deny-list
  control/         # contrat d'actions typées (HTTP + tool)
  plugin/          # config managé surveillé → tool openhouse injecté
ui/                # renderer React : projets, sessions, chat, pickers, barre de contexte
electron/          # main process : fenêtre, hosting du core, IPC minimal
bin/               # CLI headless `openhouse serve`
```

### 5.4 État local (fichiers)

| Fichier | Contenu |
|---|---|
| `~/.config/openhouse/projects.json` | registry `{id, path, name, defaultModel?, defaultAgent?, denyList?, subagentDepth?}` |
| `~/.config/openhouse/schedules.json` | tâches cron + `lastRun/nextRun` + claiming |
| `~/.config/openhouse/sessions-meta.json` | overlay pin/archive/titre (v2 : metadata create-only) |
| `~/.config/openhouse/goals/<sessionId>.md` | objectifs goal |
| `~/.config/openhouse/autoaccept-audit.jsonl` | journal des auto-accepts |
| `~/.config/openhouse/daemon.json` | port, pid, version pin opencode |

### 5.5 API OpenHouse (esquisse)

- `GET /api/oh/health|info` — daemon + santé opencode managé
- `GET|POST|DELETE /api/oh/projects[/:id]` — registry
- `GET /api/oh/projects/:id/sessions` — fusion `session.list` + overlays + statut synthétisé
- `GET /api/oh/sessions/:id/messages` ; `POST /api/oh/sessions` ; `POST /api/oh/sessions/:id/prompt|interrupt` ; `DELETE /api/oh/sessions/:id`
- `GET /api/oh/sessions/:id/status` — busy/idle, tokens, % contexte, modèle, coût
- `GET|POST /api/oh/schedules[/:id]` ; `PATCH …/enabled` ; `POST …/run`
- `GET /api/oh/projects/:id/models|agents|mcp` ; `POST /api/oh/projects/:id/mcp/:name/enable|disable`
- `PUT|DELETE /api/oh/sessions/:id/goal`
- `POST /api/oh/control` — contrat d'actions typées (CLI, scripts, tool agent)
- `GET /api/oh/event` — SSE hub (statuts, exécutions schedules, goals, auto-accepts)

### 5.6 Sécurité

Bind `127.0.0.1` par défaut ; token simple si binding réseau demandé. YOLO permanent ⇒ le journal d'audit + deny-list sont les garde-fous ; jamais d'exposition du daemon sans token. Les credentials restent dans la sqlite d'OpenCode (OpenHouse n'y touche jamais en écriture).

---

## 6. Grille récapitulative

| # | Feature MVP1 | Apport OpenCode v2 | Delta OpenHouse | Complexité | Phase |
|---|---|---|---|---|---|
| 4.1 | Projets/folders | scoping directory, project.list | registry + warmup | S/M | P1 |
| 4.2 | Historique sessions | session.list/message.list paginés | statut synthétisé, overlay meta/archive | M | P1 |
| 4.3 | API/tools sessions | — | contrat control + plugin managé | M | P5 |
| 4.4 | Crons | — (aucun) | scheduler + storage + claiming | M | P3 |
| 4.5 | Status/contexte | tokens, limits, compaction | calcul % (algorithme OpenChamber) | S/M | P1 |
| 4.6 | Models/providers | model/provider.list, switchModel | défauts/pickers UI | S | P1 |
| 4.7 | Goal mode | generate (small model), events exec | boucle daemon + audit + budgets | L | P4 |
| 4.8 | Toujours YOLO | permission.asked/reply | répondeur fail-closed + audit | S/M | P2 |
| 4.9 | Agents | agent.list, switchAgent | défauts/pickers | S | P1 |
| 4.10 | Skills (sans UI) | discovery + tool skill | (rien / liste read-only) | S | P2 |
| 4.11 | MCP état + toggle | mcp group, connect/disconnect, enabled | vue + toggle + écriture config ciblée | M | P2 |
| 4.12 | Auto-reload | watchers v2 + events | abonnement + coalescing 250 ms | S | P2 |
| 4.13 | Sub-agents niveaux | subagent tool, parentID, depth | arbre, presets permissions, depth/projet | M/L | P5 |

---

## 7. Risques et mitigations

| Risque | Impact | Mitigation |
|---|---|---|
| Cadence breaking d'OpenCode v2 (2.0.3→2.0.11 a déjà cassé health/events/rename) | fort | pin exact + snapshot des endpoints utilisés (tests de contrat au démarrage du daemon) + veille releases |
| `@opencode/client` : SSE decoder sans auto-reconnect | moyen | wrapper reconnect (backoff expo), watchdog stall (pattern OpenChamber) |
| YOLO permanent = exécution non supervisée | moyen | fail-closed, audit log, deny-list, localhost-only |
| Goal : faux « complete » / coûts small model | moyen | verdict + note obligatoires, budget tokens + cap turns, comptabilité segmentée autour des compactions |
| Renderer React perf (listes de sessions longues, streaming) | moyen | listes virtualisées (pattern `@tanstack/virtual` d'OpenChamber), coalescing SSE côté core, caches bornés |
| Electron : coût Chromium (~200-400 MB) | accepté | compromis choisi (UI riche) ; le « lite » tient au périmètre (pas de PTY/git/tunnels/web server) |
| Double daemon (lock schedules) | faible | claiming par lock fichier (pattern OpenChamber) |
| Drift des overlays vs sessions supprimées côté opencode | faible | réconciliation au démarrage + à chaque liste |

---

## 8. Plan de mise en œuvre suggéré

- **P0 — Socle (2-3 j)** : repo TS (Bun en dev) + scaffold Electron/electron-vite, pin `@opencode/client` 2.0.11, obtention du binary opencode v2 (npm `@opencode/cli-<os>-<arch>` — pattern `prepare-opencode-cli.mjs` d'OpenChamber — ou build du tag local v2.0.11), core Hono in-process (routes `/api/oh/*` + SSE), lifecycle opencode (spawn/health/restart/warmup), squelette UI (fenêtre + sidebar projets + barre de statut), CLI headless `openhouse serve`, `/api/oh/health`. **Point clé : l'opencode installé actuellement (1.18.30 v1, monté par l'AppImage OpenChamber) ne convient pas — il faut provisionner le CLI 2.0.x.**
- **P1 — Projets & sessions (2-3 j)** : registry, listes/messages/prompt/interrupt, statut + contexte, pickers model/agent.
- **P2 — YOLO + MCP + reload (1-2 j)** : auto-accept + audit, vue/toggle MCP, refresh catalogue sur events.
- **P3 — Crons (1-2 j)**.
- **P4 — Goal mode (2-3 j)**.
- **P5 — Control API + tool injecté + sub-agents niveaux (2-3 j)**.

Total estimé : **~2-3 semaines** d'effort concentré pour le MVP1 complet (P0 légèrement alourdi par le scaffold Electron).

**Hors scope confirmé (gardes-fous)** : git/worktrees, notes/connaissance projet, terminal/PTY, web app/PWA standalone (l'UI Electron est la seule surface), VS Code/mobile, settings généraux, dev server, tunnels/pairing. Toute écriture de config OpenCode reste ciblée et ponctuelle (toggle MCP, deny-list, presets agents) — pas d'équivalent de la page Settings d'OpenChamber.

---

## 9. Décisions

**Actées (2026-09-21):**
1. **UI = Electron + renderer React**, modèle OpenChamber (cœur in-process dans le main, jamais en sidecar) — pivot décidé par l'utilisateur, la TUI est écartée.
2. **Intégration OpenCode = child managé `opencode serve`** (isole les crashs, permet l'attachement externe ; embed in-process `sdk-next` reste une optimisation future possible).
3. **Pin OpenCode = 2.0.11** (dernier tag local, groupe `mcp` v2 + `session.context`).
4. **Auto-start** : non-pertinent dans l'app (le cœur démarre avec la fenêtre) ; le mode headless `openhouse serve` couvre les crons sans app ouverte, avec claiming par lock en cas de coexistence.

**Ouvertes (à trancher avant P0):**
1. **Renderer : React 19 (recommandé — réutilise les patterns `packages/ui` d'OpenChamber) vs Solid.**
2. **Archive/pin des sessions** en MVP1 (recommandé : oui, overlay léger).
3. **Storage des schedules** : global `schedules.json` (recommandé) vs par projet.
4. **Nom du tool injecté** : `openhouse` (+ niveaux en paramètre) — confirmer.
5. **Port par défaut** du cœur (proposition : 7800) + politique token.
6. **Fenêtre unique vs multi-fenêtres** (recommandé : unique en MVP1).
7. **Réutilisation de code OpenChamber** : vérifier la licence du repo avant toute copie verbatim (sinon réimplémentation « inspirée de »).
