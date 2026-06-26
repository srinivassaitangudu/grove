# Grove

**Git worktree manager for parallel development with AI coding agents.**

Grove solves a simple problem: when you're working on multiple features at once, each feature needs its own frontend, backend, and services — all running on different ports, with the right environment variables, without conflicting with each other. Grove does this automatically.

## The Problem

You're working on two features in the same project:

```
Feature A (auth redesign):    frontend :3000, backend :8000, database :5432
Feature B (new dashboard):    frontend :3000, backend :8000, database :5432
                                         ^ CONFLICT ^
```

You can only run one at a time. To test the other, you stop everything, switch branches, restart. Repeat all day.

## The Solution

```bash
grove start auth "redesign auth flow"
grove start dashboard "new dashboard" --share backend,database
```

Now both run simultaneously:

```
Main branch:     frontend :3000   backend :8000   database :5432
auth:            frontend :3100   backend :8100   database :5432 (shared)
dashboard:       frontend :3200   backend :8000 (shared)   database :5432 (shared)
```

Each feature gets its own git worktree, its own branch, its own ports, its own `.env.local` — all wired together automatically. Open both in your browser, side by side.

```
~/Developer/
  myapp/                   <- your main repo (untouched)
  myapp-auth/              <- worktree, branch: auth, frontend :3100
  myapp-dashboard/         <- worktree, branch: dashboard, frontend :3200
```

## Quick Start

```bash
# Install globally
npm install -g grove-cli

# In any git repo:
grove init                                    # scans project, discovers ports
grove start feature-a "implement login"       # creates isolated worktree
grove start feature-b "fix sidebar"           # another one, no conflicts
grove status                                  # see everything running
```

## Key Concepts

### Smart Port Discovery

When you run `grove init`, Grove scans your project to find every port in use:

- **package.json** scripts (`--port 3000`, `-p 8080`)
- **.env files** (`PORT=3000`, `DATABASE_URL=...localhost:5432/...`)
- **Framework configs** (`vite.config.ts`, `next.config.js`)
- **docker-compose.yml** (port mappings)
- **Python entry points** (`uvicorn.run(port=8000)`)
- **Dockerfiles** (`EXPOSE 3000`)

```
$ grove init

Detected services:
   - frontend (vite)
   - backend (python)

Discovered ports:
  PORT   SOURCE                          CONTEXT      CONFIDENCE
  5173   vite.config.ts                  frontend     high
  8000   .env (PORT=8000)                backend      high
  5432   .env (DATABASE_URL)             database     medium
  6379   docker-compose.yml (redis)      cache        high

Grove initialized
```

### Sequential Port Offsets

Each agent gets all its ports offset by a predictable step (default: +100):

| Service  | Main branch | Agent 1 (+100) | Agent 2 (+200) |
|----------|------------|----------------|----------------|
| frontend | :5173      | :5273          | :5373          |
| backend  | :8000      | :8100          | :8200          |
| database | :5432 (shared) | :5432 (shared) | :5432 (shared) |

Port 5273 is obviously agent 1's frontend. Port 8200 is obviously agent 2's backend. Easy to debug.

### Isolate vs Share

Not every service needs to be duplicated. If you're only changing frontend code, you don't need a separate backend:

```bash
# Only isolate what you're changing
grove start sidebar --isolate frontend --share backend,database

# Result:
#   frontend :3100  <- NEW process in worktree (isolated)
#   backend  :8000  <- points to main branch's backend (shared)
#   database :5432  <- points to main branch's database (shared)
```

- **Isolated** services get a new port and a new process in the worktree
- **Shared** services use the main branch's port — no new process spawned

### Profiles

Save common isolation patterns in `.grove/config.json`:

```json
{
  "profiles": {
    "frontend-only": {
      "isolate": ["frontend"],
      "share": ["backend", "database", "cache"]
    },
    "full-stack": {
      "isolate": ["frontend", "backend"],
      "share": ["database", "cache"]
    }
  }
}
```

Then use them:

```bash
grove start sidebar --profile frontend-only
```

## Commands

### `grove init`

Initialize grove in the current repo. Scans for ports, detects services, creates `.grove/config.json`.

```bash
grove init              # first-time setup
grove init --rescan     # re-run port discovery on existing config
```

### `grove start [name] [feature]`

Create a new worktree with isolated ports and environment.

```bash
grove start auth "redesign auth"                     # new agent
grove start sidebar --isolate frontend               # isolate only frontend
grove start sidebar --share backend,database         # share backend + db
grove start sidebar --profile frontend-only          # use saved profile
grove start                                          # auto-generate name
```

### `grove run <name> [prompt]`

Launch an AI coding agent inside the worktree. Auto-creates the worktree if it doesn't exist.

```bash
grove run auth "implement JWT authentication"
grove run auth --ai gemini "implement JWT auth"     # use different AI CLI
grove run auth                                       # interactive session
```

Works with any AI CLI: `claude`, `gemini`, `codex`, `aider`, or anything that accepts a prompt argument.

### `grove status`

Show all agents with ports, isolation mode, and liveness.

```bash
grove status
```

```
NAME                 PROJECT         PORTS                     STATUS     PATH
-----------------------------------------------------------------------------------------------
auth                 myapp           5273I 8100I               running    /Users/you/myapp-auth
sidebar              myapp           5273I 8000S               running    /Users/you/myapp-sidebar
-----------------------------------------------------------------------------------------------
  I=isolated  S=shared
```

### `grove stop <name>` / `grove stop-all`

Stop processes. Only kills isolated services (shared ones belong to the main branch).

```bash
grove stop auth
grove stop-all
```

### `grove logs <name>`

View recent logs for an agent's services.

```bash
grove logs auth
```

### `grove remove <name>`

Full cleanup: stop processes, delete worktree, remove branch.

```bash
grove remove auth
```

### `grove restart <name>`

Stop then start an agent's services.

```bash
grove restart auth
```

## MCP Server — AI-Native Workflow

Grove includes an MCP (Model Context Protocol) server that lets AI assistants like Claude manage worktrees programmatically. This is where Grove becomes truly powerful.

### Setup

```bash
# Register with Claude Code
claude mcp add grove -- grove-mcp
```

### How Claude Uses Grove

Once connected, Claude has access to these tools:

| Tool | What Claude does with it |
|------|------------------------|
| `grove_init` | Initialize grove in a repo, discover ports |
| `grove_start` | Create worktrees with smart isolation decisions |
| `grove_stop` / `grove_remove` | Clean up when done |
| `grove_status` | Check what's running |
| `grove_logs` | Debug service issues |
| `grove_get_config` | Read config + full schema documentation |
| `grove_update_config` | Fix/improve the config with correct ports and services |

### The Key Insight: Claude Fixes What Auto-Discovery Misses

Auto-discovery can't find everything. But Claude can read your project files and understand your stack. The workflow:

```
You: "Set up grove for this project"

Claude:
  1. Calls grove_init          → auto-detects what it can
  2. Calls grove_get_config    → sees the config + schema docs
  3. Reads your package.json, docker-compose.yml, .env files
  4. Calls grove_update_config → writes a perfect config with all services,
                                  correct ports, cross-references, and profiles
```

Claude knows the exact config schema because `grove_get_config` returns comprehensive documentation alongside the config — every field, every template variable, every example.

### Scenario: Claude Manages Parallel Features

```
You: "I need to work on auth redesign and dashboard revamp simultaneously"

Claude:
  1. Calls grove_start("auth", isolate: ["frontend", "backend"], share: ["database"])
  2. Calls grove_start("dashboard", isolate: ["frontend"], share: ["backend", "database"])
  3. Reports: "Both worktrees ready:
       auth:      frontend :3100, backend :8100, database :5432 (shared)
       dashboard: frontend :3200, backend :8000 (shared), database :5432 (shared)
       Open http://localhost:3100 and http://localhost:3200 to see both"
```

Claude decides what to isolate vs share based on what you're building. Frontend-only work? Share the backend. Full-stack changes? Isolate both. The intelligence is in Claude, not in Grove.

### Scenario: Claude Configures a Complex Project

Your project has Vite + Express + Supabase + Redis + Storybook. Auto-discovery finds some ports but misses others.

```
You: "The grove config is incomplete, fix it"

Claude:
  1. Calls grove_get_config     → sees partial config + schema docs
  2. Reads package.json         → finds storybook on :6006, express on :4000
  3. Reads docker-compose.yml   → finds redis on :6379
  4. Reads .env                 → finds SUPABASE_URL with port 54321
  5. Calls grove_update_config  → writes complete config:
       - frontend (vite, :5173)
       - backend (express, :4000)
       - storybook (storybook, :6006)
       - supabase (unmanaged, fixed :54321)
       - redis (unmanaged, fixed :6379)
       - profiles: frontend-only, full-stack, with-storybook
```

## Configuration

Grove stores config at `.grove/config.json`. This file should be committed to git.

### Example: Full-stack project

```json
{
  "version": 3,
  "services": [
    {
      "name": "frontend",
      "type": "vite",
      "dir": ".",
      "start_cmd": "npm run dev -- --port ${port}",
      "install_cmd": "npm install",
      "port_offset": 0,
      "original_port": 5173,
      "env_file": ".env.local",
      "env_vars": {
        "PORT": "${port}",
        "VITE_API_URL": "http://localhost:${services.backend.port}",
        "VITE_GROVE_AGENT": "${agent_name}"
      }
    },
    {
      "name": "backend",
      "type": "express",
      "dir": "server",
      "start_cmd": "npm run dev",
      "install_cmd": "npm install",
      "port_offset": 1,
      "original_port": 8000,
      "env_file": "server/.env",
      "env_vars": {
        "PORT": "${port}",
        "DATABASE_URL": "postgres://postgres:postgres@localhost:${services.database.port}/myapp",
        "FRONTEND_URL": "http://localhost:${services.frontend.port}",
        "GROVE_AGENT": "${agent_name}"
      }
    },
    {
      "name": "database",
      "type": "postgres",
      "dir": ".",
      "start_cmd": "",
      "install_cmd": "",
      "port_offset": 2,
      "original_port": 5432,
      "env_file": null,
      "env_vars": {},
      "managed": false,
      "fixed_port": 5432
    }
  ],
  "discovered_ports": [],
  "port_range_start": 54000,
  "port_block_size": 10,
  "port_strategy": "sequential",
  "port_step": 100,
  "profiles": {
    "frontend-only": {
      "isolate": ["frontend"],
      "share": ["backend", "database"]
    },
    "full-stack": {
      "isolate": ["frontend", "backend"],
      "share": ["database"]
    }
  },
  "ai_command": "claude"
}
```

### Service fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier (`"frontend"`, `"backend"`, `"database"`) |
| `type` | Yes | `"vite"`, `"nextjs"`, `"express"`, `"python"`, `"supabase"`, `"custom"` |
| `dir` | Yes | Relative path from repo root (`"."` for root) |
| `start_cmd` | Yes | Command to start the service (supports `${port}` template) |
| `install_cmd` | Yes | Dependency install command (empty string if none) |
| `port_offset` | Yes | Index position (0, 1, 2...) |
| `original_port` | Recommended | The port this service uses on the main branch |
| `env_file` | Yes | Where to write env vars (`null` to skip) |
| `env_vars` | Yes | Template variables to write |
| `managed` | No | Default `true`. Set `false` for databases, caches, etc. |
| `fixed_port` | No | For unmanaged services: the port they always run on |
| `fixed_url` | No | For unmanaged services: the URL |

### Template variables

Use in `start_cmd` and `env_vars` values:

| Variable | Resolves to |
|----------|------------|
| `${port}` | This service's assigned port |
| `${agent_name}` | Agent name (e.g., `"auth"`) |
| `${base_port}` | Base port of the agent's block |
| `${services.<name>.port}` | Another service's port |
| `${services.<name>.url}` | Another service's URL |

Cross-referencing is how services find each other. When `auth` agent starts, `${services.backend.port}` resolves to `8100` — the backend's offset port for that agent.

## Making Your App Port-Aware

Grove writes ports to `.env.local`, but your dev server needs to read them.

**Vite:**
```typescript
// vite.config.ts
export default defineConfig({
  server: {
    port: parseInt(process.env.PORT || '5173'),
    strictPort: true,
  },
});
```

**Next.js:** Reads `PORT` from `.env.local` automatically.

**Python (FastAPI):**
```python
import os
port = int(os.getenv("PORT", 8000))
uvicorn.run(app, host="0.0.0.0", port=port)
```

## Differentiating Browser Tabs

Grove writes `VITE_GROVE_AGENT` (or `NEXT_PUBLIC_GROVE_AGENT`) to env files. Use it to identify which worktree you're looking at:

```typescript
if (import.meta.env.DEV && import.meta.env.VITE_GROVE_AGENT) {
  document.title = `[${import.meta.env.VITE_GROVE_AGENT}] ${document.title}`;
}
```

Now your browser tabs show `[auth] MyApp` and `[dashboard] MyApp`.

## Architecture

```
~/.grove/
  state.json              <- global agent registry (all repos)

<repo>/.grove/
  config.json             <- project config (commit this)
  logs/                   <- per-agent log files
  README.md               <- generated reference guide

<repo>-<agent>/           <- git worktree (sibling directory)
  .env.local              <- generated with offset ports
  ...                     <- full copy of your codebase on its own branch
```

**State is global** (`~/.grove/state.json`) — tracks all agents across all repos.
**Config is per-repo** (`.grove/config.json`) — defines services, ports, profiles.
**Worktrees are siblings** — `myapp-auth/` sits next to `myapp/`.

## Prerequisites

- **git** (any modern version with worktree support)
- **Node.js** >= 20
- An AI CLI for `grove run` (claude, gemini, codex, aider — all optional)

## License

MIT
