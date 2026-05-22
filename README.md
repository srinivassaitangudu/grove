# Grove

Git worktree manager for parallel development with AI coding agents.

Grove lets you work on multiple features simultaneously — each in its own isolated directory, branch, and port. Pair it with Claude, Gemini, Codex, or any AI coding CLI to run parallel AI sessions across features.

## Quick Start

```bash
# Install
git clone <repo-url> && cd grove
npm install && npm run build && npm link

# In any git repo:
grove init                          # detect project, create config
grove start gallery "map feature"   # create isolated worktree
cd ../yourrepo-gallery && npm run dev   # runs on its own portgmein
```

## What it does

When you run `grove start gallery`, grove:

1. Creates a **git worktree** at `../yourrepo-gallery/` (sibling directory)
2. Creates a **git branch** called `gallery`
3. Hashes "gallery" into a **deterministic port** (same name = same port, always)
4. Writes a **`.env.local`** with port assignments into the worktree
5. Runs **`npm install`** (since node_modules won't exist in a new worktree)

Your main repo is never touched. Each worktree is fully isolated — separate files, separate branch, separate port.

```
~/Developer/
  myapp/                    <- your main repo (untouched)
  myapp-gallery/            <- worktree, branch: gallery, port: 60060
  myapp-dark-mode/          <- worktree, branch: dark-mode, port: 62220
  myapp-auth/               <- worktree, branch: auth, port: 57430
```

## Commands

### `grove init`

Initialize grove in the current repo. Auto-detects your project type (Vite, Next.js, Python, Supabase) and creates `.grove/config.json`.

```bash
grove init
```

Run this once per repo.

### `grove start <name> [feature]`

Create a new worktree with isolated ports, env files, and dependencies.

```bash
grove start gallery "CSR activities map"
grove start dark-mode "theme toggle"
grove start auth                        # feature description is optional
grove start                             # auto-generates a name
```

The name becomes both the branch name and the worktree directory name. Use whatever describes the work.

### `grove run <name> [prompt]`

Launch an AI coding agent inside the worktree. Creates the worktree first if it doesn't exist.

```bash
# Interactive session (you talk to the AI directly)
grove run gallery "implement the CSR activities map using Leaflet"

# Use a different AI CLI
grove run gallery --ai gemini "implement the map"
grove run gallery --ai aider "fix the markers"
grove run gallery --ai codex "add tests"

# No prompt — opens interactive session
grove run gallery
```

The AI CLI is configurable:
- Default is set in `.grove/config.json` (`"ai_command": "claude"`)
- Override per-run with `--ai <command>`
- Works with any CLI that accepts a prompt as an argument

### `grove status`

Show all worktrees with their ports and whether processes are running.

```bash
grove status
```

Output:
```
NAME                 BRANCH          PORT     STATUS     PATH
────────────────────────────────────────────────────────────────────────────
gallery              gallery         60060    running    /Users/you/myapp-gallery
dark-mode            dark-mode       62220    stopped    /Users/you/myapp-dark-mode
────────────────────────────────────────────────────────────────────────────
```

Status is checked in real time by looking at port usage — no stale PIDs.

### `grove stop <name>`

Kill processes running on the agent's ports. Does not remove the worktree.

```bash
grove stop gallery          # stop one
grove stop-all              # stop all agents
```

### `grove logs <name>`

View logs for an agent.

```bash
grove logs gallery
```

If no log file exists, shows guidance on how to capture logs.

### `grove remove <name>`

Full cleanup: stop processes, remove the git worktree, delete the branch, clean up state.

```bash
grove remove gallery
```

## How ports work

Grove doesn't use a port registry that counts up (3001, 3002, 3003...). Instead, it **hashes the agent name** into a deterministic port:

```
SHA-256("gallery") → port 60060 (always)
SHA-256("dark-mode") → port 62220 (always)
```

Same name = same port every time, on any machine. Remove a worktree, recreate it later — same port. No state file needed for port assignment.

Each agent gets a block of 10 ports (configurable). For a single-service app, only the first port is used. For multi-service stacks, each service gets the next port in the block.

Ports live in the 54000–63999 range by default, well above common dev ports (3000, 5173, 8000).

## Configuration

Grove stores its config at `.grove/config.json` in your repo root. This file is meant to be committed to git — it's project config, not runtime state.

### Single service (Vite, Next.js)

Generated automatically by `grove init`:

```json
{
  "version": 2,
  "services": [
    {
      "name": "frontend",
      "type": "vite",
      "dir": ".",
      "start_cmd": "npm run dev",
      "install_cmd": "npm install",
      "port_offset": 0,
      "env_file": ".env.local",
      "env_vars": {
        "PORT": "${port}",
        "VITE_GROVE_AGENT": "${agent_name}"
      }
    }
  ],
  "port_range_start": 54000,
  "port_block_size": 10,
  "ai_command": "claude"
}
```

### Multi-service (Next.js + Python + Supabase)

```json
{
  "version": 2,
  "services": [
    {
      "name": "frontend",
      "type": "nextjs",
      "dir": "frontend",
      "start_cmd": "npm run dev",
      "install_cmd": "npm install",
      "port_offset": 0,
      "env_file": "frontend/.env.local",
      "env_vars": {
        "PORT": "${port}",
        "NEXT_PUBLIC_GROVE_AGENT": "${agent_name}",
        "NEXT_PUBLIC_API_URL": "http://localhost:${services.backend.port}",
        "NEXT_PUBLIC_SUPABASE_URL": "${services.supabase_api.url}"
      }
    },
    {
      "name": "backend",
      "type": "python",
      "dir": "backend",
      "start_cmd": "python main.py",
      "install_cmd": "pip install -r requirements.txt",
      "port_offset": 1,
      "env_file": "backend/.env",
      "env_vars": {
        "PORT": "${port}",
        "GROVE_AGENT": "${agent_name}",
        "FRONTEND_URL": "http://localhost:${services.frontend.port}",
        "DATABASE_URL": "postgres://postgres:postgres@localhost:${services.supabase_api.port}/postgres"
      }
    },
    {
      "name": "supabase_api",
      "type": "supabase",
      "dir": "supabase",
      "start_cmd": "supabase start",
      "install_cmd": "",
      "port_offset": 0,
      "env_file": null,
      "env_vars": {},
      "managed": false,
      "fixed_port": 54321,
      "fixed_url": "http://localhost:54321"
    }
  ],
  "port_range_start": 54000,
  "port_block_size": 10,
  "ai_command": "claude"
}
```

### Config fields

| Field | Description |
|---|---|
| `services[].name` | Unique identifier for the service |
| `services[].type` | `vite`, `nextjs`, `python`, `supabase`, `custom` |
| `services[].dir` | Subdirectory for the service (`.` for root) |
| `services[].start_cmd` | Command to start the dev server |
| `services[].install_cmd` | Command to install dependencies |
| `services[].port_offset` | Which port in the block this service uses (0, 1, 2...) |
| `services[].env_file` | Where to write env vars (`null` to skip) |
| `services[].env_vars` | Template variables to write (see below) |
| `services[].managed` | `true` (default): port from hash. `false`: uses fixed_port |
| `services[].fixed_port` | Static port for unmanaged services |
| `services[].fixed_url` | Static URL for unmanaged services |
| `port_range_start` | Start of port range (default: 54000) |
| `port_block_size` | Ports per agent (default: 10) |
| `ai_command` | Default AI CLI (`claude`, `gemini`, `codex`, `aider`) |

### Template variables

Use these in `env_vars` values:

| Variable | Resolves to |
|---|---|
| `${port}` | This service's computed port |
| `${agent_name}` | The worktree/agent name (e.g., "gallery") |
| `${base_port}` | The hash block's base port |
| `${services.<name>.port}` | Another service's port |
| `${services.<name>.url}` | Another service's URL |

### Managed vs unmanaged services

**Managed** (default): Grove assigns a dynamic port from the hash block. Each worktree gets a different port.

**Unmanaged** (`managed: false`): The service has a fixed port/URL shared across all worktrees. Useful for shared databases, cloud services, or anything you don't want duplicated per worktree.

## Making your app port-aware

Grove writes the port to `.env.local`, but your dev server needs to read it.

### Vite

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    port: parseInt(process.env.PORT || '5173'),
    strictPort: true,
  },
});
```

### Next.js

Next.js reads `PORT` from `.env.local` automatically. No config change needed.

### Python (FastAPI/uvicorn)

```python
import os
port = int(os.getenv("PORT", 8000))
uvicorn.run(app, host="0.0.0.0", port=port)
```

## Differentiating browser tabs

Grove writes `VITE_GROVE_AGENT=gallery` (or `NEXT_PUBLIC_GROVE_AGENT`) into env files. Use it to show which worktree you're looking at:

```typescript
// In your app (dev mode only)
if (import.meta.env.DEV && import.meta.env.VITE_GROVE_AGENT) {
  document.title = `${import.meta.env.VITE_GROVE_AGENT} | ${document.title}`;
}
```

Now your browser tabs show `gallery | MyApp` and `dark-mode | MyApp`.

## Typical workflows

### Feature development

```bash
grove start feature-x "implement login page"
cd ../myapp-feature-x
npm run dev                    # runs on its assigned port
# make changes, commit, push
grove remove feature-x         # done, clean up
```

### Parallel AI sessions

```bash
# Terminal 1
grove run gallery "build the CSR activities map"

# Terminal 2
grove run dark-mode --ai gemini "implement dark mode"

# Terminal 3 — check what's happening
grove status
```

### Quick experiment

```bash
grove start experiment
cd ../myapp-experiment
# try something risky...
grove remove experiment        # throw it away, no mess
```

## Prerequisites

- **git** (with worktree support — any modern version)
- **Node.js** (for the grove CLI itself and npm-based projects)
- An AI CLI if using `grove run` (claude, gemini, codex, aider — all optional)

## Project structure

```
.grove/
  config.json    <- service definitions, port config (commit this)
  state.json     <- runtime: which worktrees exist (gitignored)
  logs/          <- captured logs (gitignored)
```

Add to your `.gitignore`:
```
.grove/state.json
.grove/logs/
.env.local
.env*.local
```

`grove init` handles this automatically.

## License

MIT
