# OpenHouse

OpenChamber-lite : un gestionnaire multi-projets / multi-sessions au-dessus d'**OpenCode v2**, en application **Electron** avec un **cœur serveur headless** réutilisable (API HTTP + SSE).

- Spécification fonctionnelle : [`docs/analyse-mvp1.md`](docs/analyse-mvp1.md)
- Architecture & invariants : [`docs/architecture.md`](docs/architecture.md)
- Contrat de l'API interne : [`docs/api-contract.md`](docs/api-contract.md)

## Comment ça marche

```
┌─ Electron main (Node 22) ──────────────────────────────────┐
│  openhouse core (même code qu'en headless)                 │
│  projets / schedules / goals / auto-accept / event hub     │
│  API HTTP 127.0.0.1:7800 — /api/oh/* + SSE /api/oh/event   │
│  └─ enfant managé : opencode serve v2.0.11                 │
│      health /api/info, restart, warmup des répertoires     │
└────────────────────────────────────────────────────────────┘
   renderer React (servi par le core) — client HTTP/SSE
   mode headless : `bun run src/cli.ts serve`
```

Le cœur est **in-process dans Electron main** (jamais un sidecar) et expose la même API en mode headless, pour que les crons tournent même fenêtre fermée. L'environnement hérité d'OpenChamber est **assaini** avant de lancer opencode (`OPENCODE_*` / `OPENCHAMBER_*` supprimés) et un mot de passe serveur propre est généré.

## Prérequis

- [Bun](https://bun.sh) (`~/.bun/bin/bun`) — pas besoin de Node/npm
- Le binaire **OpenCode v2.0.11** :
  - via `OPENHOUSE_OPENCODE_BIN=/chemin/vers/opencode`, ou
  - à l'emplacement `~/.config/openhouse/bin/opencode-2.0.11`
  - (téléchargement : paquet npm `@opencode/cli-<os>-<arch>`)
- Une auth provider valide (lue dans la base OpenCode existante, ex. `opencode-go`)

## Installation & lancement

```bash
bun install

# UI (renderer)
bun run build:ui

# Mode headless (API + UI servies sur http://127.0.0.1:7800)
bun run src/cli.ts serve
# ou : bun run openhouse serve --port 7800 --host 127.0.0.1

# Mode développement UI (Vite, proxy /api -> 7800)
bun run dev:ui

# Application Electron (compile le main puis ouvre la fenêtre)
bun run electron
```

Variables d'environnement : `OPENHOUSE_PORT` (7800), `OPENHOUSE_HOST` (127.0.0.1), `OPENHOUSE_DATA_DIR` (`~/.config/openhouse`), `OPENHOUSE_OPENCODE_BIN`, `OPENHOUSE_OPENCODE_PIN`, `OPENHOUSE_LOG_LEVEL`.

État local : `~/.config/openhouse/` (`projects.json`, `schedules.json`, `sessions-meta.json`, `goals.json`, `goals/*.md`, `autoaccept-audit.jsonl`, `opencode.managed.json`).

## Fonctionnalités MVP1

| # | Fonctionnalité | État |
|---|---|---|
| 4.1 | Projets / folders (ajout, retrait, disponibilité, warmup) | ✅ |
| 4.2 | Historique de sessions par projet (pagination, pin/archive, arbre sub-agents) | ✅ |
| 4.3 | API/tools de contrôle (`/api/oh/control` + tool agent `openhouse`) | ✅ |
| 4.4 | Crons (création, activation, exécution, historique, option goal) | ✅ |
| 4.5 | Statut + context length (tokens, %, compaction, coût) | ✅ |
| 4.6 | Models / providers (sélection par session, variantes, défauts) | ✅ |
| 4.7 | Goal mode (boucle serveur, audit small model, budgets, cap de tours) | ✅ |
| 4.8 | Toujours YOLO (auto-accept fail-closed + journal d'audit + deny-list) | ✅ |
| 4.9 | Sélection d'agents | ✅ |
| 4.10 | Skills (sans UI) | ✅ |
| 4.11 | MCP (état, activation/désactivation, persistance `disabled`) | ✅ |
| 4.12 | Auto-reload skills/agents/commands (events, sans watcher) | ✅ |
| 4.13 | Sub-agents / niveaux (presets de permissions, arbre parent/enfant) | ✅ |

Hors scope : git/worktrees, notes projet, terminal, web/PWA, settings généraux, dev server (cf. `docs/analyse-mvp1.md`).

## Tests

```bash
# Unitaires + intégration optionnelle
bun test

# Test d'intégration de bout en bout (spawn un core isolé + opencode réel)
OPENHOUSE_E2E=1 bun test test/e2e.test.ts

# Tests manuels API (core sur :7800 requis)
bash /tmp/opencode/e2e.sh      # cycle API complet
bash /tmp/opencode/e2e2.sh     # auto-accept, hot-reload, plugin, sub-agents

# Smoke test Electron (capture une image de la fenêtre)
bun build /tmp/opencode/entry.ts --target node --format cjs --outfile /tmp/opencode/oh-core-bundle.cjs
DISPLAY=:0 OPENHOUSE_OPENCODE_BIN=<bin> node_modules/electron/dist/electron test/electron-smoke.cjs --no-sandbox
```

## Limites connues

- Packaging/distribution Electron non fourni (seul le smoke test est en place).
- MCP : la persistance du flag `disabled` n'est écrite que pour les serveurs déclarés dans le `opencode.json` du projet.
- Goal mode : si l'endpoint d'audit small model échoue, la boucle continue jusqu'aux limites dures (budget / nombre de tours).
- OpenHouse partage la base OpenCode de l'utilisateur (`~/.local/share/opencode/opencode.db`) et n'y écrit jamais directement.
