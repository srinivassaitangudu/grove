# Grove — Implementation Plan

## Overview

Grove is a CLI tool that manages git worktrees for parallel development. Each worktree gets isolated ports, env files, and can run its own AI coding agent (Claude, Gemini, Codex, Aider).

---

## Architecture

### How TypeScript + Node.js works in this project

```
You type "grove start gallery"
       │
       ▼
Shell finds /usr/local/bin/grove (symlink created by npm link)
       │
       ▼
Symlink points to ~/Developer/grove/dist/index.js
       │
       ▼
First line: #!/usr/bin/env node → OS runs it with Node.js
       │
       ▼
Node executes the compiled JavaScript (dist/)
       │
       ▼
Commander library parses args → routes to the right command function
       │
       ▼
Command function does the work (git, fs, child_process)
```

### Build process

```
src/*.ts  ──(tsc)──►  dist/*.js
TypeScript            JavaScript (what actually runs)
```

- You edit files in `src/`
- Run `npm run build` to compile
- Node runs files from `dist/`
- `npm link` makes `grove` available globally

### Project structure

```
grove/
├── package.json          ← metadata, dependencies, "bin" entry point
├── tsconfig.json         ← TypeScript compiler settings
├── implementation.md     ← this file
├── todo.md               ← task tracking
├── src/
│   ├── index.ts          ← CLI entry point + command routing (Commander)
│   ├── commands/         ← one file per command
│   │   ├── init.ts       ← grove init
│   │   ├── start.ts      ← grove start <name>
│   │   ├── stop.ts       ← grove stop <name>, grove stop-all
│   │   ├── status.ts     ← grove status
│   │   ├── logs.ts       ← grove logs <name>
│   │   ├── remove.ts     ← grove remove <name>
│   │   └── run.ts        ← grove run <name> "prompt"
│   └── lib/              ← shared utilities
│       ├── config.ts     ← read project-specific .grove/config.json
│       ├── state.ts      ← read/write global ~/.grove/state.json
│       ├── ports.ts      ← SHA-256 hash → deterministic port
│       ├── worktree.ts   ← git worktree operations
│       ├── process.ts    ← lsof-based port checking/killing
│       └── env.ts        ← generate .env files
├── dist/                 ← compiled JS output (gitignored)
└── node_modules/         ← dependencies (gitignored)
```

### Registry location

Grove maintains its global state in the user's home directory:
- Windows: `%USERPROFILE%\.grove\state.json`
- macOS/Linux: `~/.grove/state.json`

Project-specific configuration (`.grove/config.json`) remains in each repository.

### Per-repo structure (what grove creates in user repos)

```
your-repo/
├── .grove/
│   ├── config.json       ← service definitions, port config (committed)
│   └── logs/             ← captured logs (gitignored)
└── ...

../your-repo-gallery/     ← worktree (sibling directory)
├── .env.local            ← generated port assignments
├── frontend/.env.local   ← (if multi-service)
├── backend/.env          ← (if multi-service)
└── ...
```

### Key concepts

**Deterministic port hashing:**
```
SHA-256(name) → first 8 hex → decimal → mod 1000 → block index
base_port = port_range_start + (block_index × port_block_size)
```
Same name always gives same port. No registry needed.

**Port block:** Each worktree gets a block of N ports (default 10). Service at index 0 gets base_port + 0, index 1 gets base_port + 1, etc.

**State is minimal:** state.json tracks what was created across all projects (worktree path, branch, ports, and repo root). It does NOT track PIDs. Liveness is checked in real time via port usage and PIDs.

**AI-agnostic:** The `run` command spawns any CLI in the worktree directory with `stdio: 'inherit'` (fully interactive). Claude, Gemini, Codex, Aider all work the same way.

---

## Phase 1: Core (DONE ✅)

What exists today and works:

- `grove init` — detects project type, writes config.json, initializes state
- `grove start <name> [feature]` — creates worktree, hashes port, generates .env.local, installs deps
- `grove stop <name>` — kills processes on the agent's ports via lsof
- `grove stop-all` — kills all agent processes
- `grove status` — shows all agents with port + liveness
- `grove logs <name>` — tails log file or shows guidance
- `grove remove <name>` — stops processes, removes worktree, deletes branch
- `grove run <name> [prompt] --ai <cmd>` — launches AI CLI in the worktree

**Limitations of Phase 1:**
- Single .env.local for all services (dumped together)
- No distinction between services in env output
- No tab/browser differentiation
- No cross-references between services
- No managed vs fixed port distinction

---

## Phase 2: Multi-Service Env + Tab Differentiation (DONE ✅)

### Goal

Each service writes to its own env file with only its relevant variables. Browser tabs show which worktree you're looking at.

### Config schema changes

Current:
```json
{
  "services": [
    { "name": "frontend", "env_var": "PORT", ... }
  ],
  "env_files": [".env.local"]
}
```

New:
```json
{
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
        "VITE_GROVE_AGENT": "${agent_name}",
        "VITE_GROVE_PORT": "${port}"
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
        "GROVE_AGENT": "${agent_name}"
      }
    }
  ],
  "port_range_start": 54000,
  "port_block_size": 10,
  "ai_command": "claude"
}
```

Key changes:
- `env_files` (top-level array) removed → each service declares its own `env_file`
- `env_var` (single string) → `env_vars` (object with templates)
- New `port_offset` field: which offset in the block this service uses
- Templates: `${port}` = this service's port, `${agent_name}` = worktree name

### Env generation logic

For each service in config:
1. Compute port: `base_port + service.port_offset`
2. Resolve template variables in `env_vars`:
   - `${port}` → this service's computed port
   - `${agent_name}` → the worktree/agent name
   - `${base_port}` → the block's base port
3. Write to `worktree_dir/service.env_file`

### Tab differentiation

The env file will contain `VITE_GROVE_AGENT=gallery`. In the app:

**For Vite/React (CSRdemo):**
```typescript
// In App.tsx or main.tsx (only in dev mode)
if (import.meta.env.DEV && import.meta.env.VITE_GROVE_AGENT) {
  document.title = `${import.meta.env.VITE_GROVE_AGENT} | ${document.title}`;
}
```

**For Next.js:**
```typescript
// In layout.tsx or _app.tsx
if (process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_GROVE_AGENT) {
  // set in <title> or use next/head
}
```

This is app-level code — grove just provides the env var. The user decides how to display it.

### Files to modify

- `src/lib/config.ts` — update GroveConfig and Service interfaces
- `src/lib/env.ts` — rewrite to handle per-service env files + templates
- `src/commands/init.ts` — generate new config format
- `src/commands/start.ts` — pass agent name to env generation
- Backward compat: support old `env_files` array format during transition

---

## Phase 3: Cross-References + Managed/Fixed Ports (DONE ✅)

### Goal

Services can reference each other's ports in their env files. Some services can opt out of dynamic port allocation (e.g., shared database).

### Cross-references

Template variables expand to include other services:
```json
{
  "name": "frontend",
  "env_vars": {
    "PORT": "${port}",
    "NEXT_PUBLIC_API_URL": "http://localhost:${services.backend.port}",
    "NEXT_PUBLIC_SUPABASE_URL": "http://localhost:${services.supabase_api.port}"
  }
}
```

The template resolver needs access to ALL services' computed ports, then fills in `${services.<name>.port}` references.

### Managed vs Fixed

```json
{
  "name": "supabase_api",
  "managed": false,
  "fixed_port": 54321,
  "fixed_url": "http://localhost:54321",
  "env_file": null
}
```

When `managed: false`:
- No port is allocated from the hash block
- The service has a fixed port/URL that's the same across all worktrees
- Other services can still reference it via `${services.supabase_api.port}` → always 54321
- No env file is written for this service (it doesn't need one)

### Template resolution order

1. Compute all managed ports first (base_port + offset)
2. Assign fixed ports to unmanaged services
3. Build variable map: `{ port, agent_name, base_port, services: { name: { port, url } } }`
4. Resolve all `${...}` templates against this map
5. Write env files

### Complete multi-service config example (Next.js + Python + Supabase)

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
        "SUPABASE_URL": "${services.supabase_api.url}",
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

### Template variables reference

| Variable | Resolves to |
|---|---|
| `${port}` | This service's computed port (base_port + port_offset) |
| `${agent_name}` | The worktree/agent name (e.g., "gallery") |
| `${base_port}` | The hash block's base port |
| `${services.<name>.port}` | Another service's port (managed or fixed) |
| `${services.<name>.url}` | Another service's URL (fixed_url or http://localhost:port) |

---

## Phase 4: Polish + Distribution

### New commands

**`grove open <name>`**
- Opens the worktree in VS Code: `code <worktree_path>`
- Optionally opens the browser: `open http://localhost:<port>`
- Config: `"editor": "code"` in config.json

**`grove doctor`**
- Checks prerequisites: git, node, jq (if needed), configured AI CLI
- Validates config.json schema
- Finds orphaned worktrees (in state but directory missing)
- Finds orphaned processes (port in use but no state entry)
- Suggests fixes

**`grove diff <name>`**
- Shows git diff between the worktree's branch and main
- `git -C <worktree> diff main...HEAD`

**`grove pr <name>`**
- Creates a GitHub PR from the worktree's branch
- Uses `gh pr create` under the hood
- Auto-fills title from feature name, body from commit messages

### npm publish

1. Add `.npmignore` (exclude `src/`, keep `dist/`)
2. Add `"files": ["dist", "bin"]` to package.json
3. `npm publish` → available as `npm install -g grove-cli`
4. Users install and use immediately: `grove init` in any repo

### README.md

- Quick start (3 commands to go from zero to parallel dev)
- Config reference
- AI CLI setup guide (claude, gemini, codex, aider)
- Examples for different stacks (Vite, Next.js, Python, monorepo)

### Potential future (beyond Phase 4)

- `grove dashboard` — TUI with live status of all worktrees
- `grove sync <name>` — rebase main into worktree branch
- Plugin system for custom service types
- Config schema validation with JSON Schema
- Auto-detect when user has Supabase, Docker, etc.

---

## How to develop grove itself

```bash
cd ~/Developer/grove

# Edit source files in src/
# Then build:
npm run build

# Test immediately (npm link makes it global):
cd ~/Developer/CSRdemo
grove status

# Watch mode (auto-rebuild on save):
npm run dev
# (in another terminal, test commands)
```

### Adding a new command

1. Create `src/commands/mycommand.ts`
2. Export a function: `export function myCommand(): void { ... }`
3. Register it in `src/index.ts`:
   ```typescript
   import { myCommand } from './commands/mycommand.js';
   program.command('mycommand').action(() => myCommand());
   ```
4. `npm run build`
5. Test: `grove mycommand`

### Adding a new lib utility

1. Create or edit a file in `src/lib/`
2. Export functions you need
3. Import them in commands: `import { myUtil } from '../lib/myutil.js';`
4. Note: always use `.js` extension in imports (ESM requirement)
