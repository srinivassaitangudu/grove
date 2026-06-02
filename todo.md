# Grove — Todo

## Phase 1: Core ✅ DONE

- [x] Project scaffold (package.json, tsconfig.json, directory structure)
- [x] lib/config.ts — read/write .grove/config.json, detect project type
- [x] lib/state.ts — read/write .grove/state.json, CRUD for agents
- [x] lib/ports.ts — SHA-256 deterministic port hashing
- [x] lib/worktree.ts — git worktree add/remove/list
- [x] lib/process.ts — lsof-based port checking and killing
- [x] lib/env.ts — generate .env files from config
- [x] commands/init.ts — initialize grove in a repo
- [x] commands/start.ts — create worktree + ports + env + deps
- [x] commands/stop.ts — kill processes on ports
- [x] commands/status.ts — show all agents with liveness
- [x] commands/logs.ts — tail log files
- [x] commands/remove.ts — full cleanup (stop + remove worktree + delete branch)
- [x] commands/run.ts — AI-agnostic CLI launcher (claude/gemini/codex/aider)
- [x] npm link for global access
- [x] Tested on CSRdemo repo

---

## Phase 2: Multi-Service Env + Tab Differentiation ✅ DONE

### Config schema update
- [x] Update Service interface in config.ts:
  - [x] Add `port_offset: number` field
  - [x] Add `env_file: string` field (per-service, replaces top-level env_files)
  - [x] Add `env_vars: Record<string, string>` field (template-based)
  - [x] Keep backward compat: if old format detected, convert at read time
- [x] Update GroveConfig interface:
  - [x] Remove `env_files` array (moved to per-service)
  - [x] Keep `port_range_start` and `port_block_size`

### Template engine
- [x] Create lib/templates.ts:
  - [x] `resolveTemplate(template: string, vars: TemplateVars): string`
  - [x] Supported variables: `${port}`, `${agent_name}`, `${base_port}`
  - [x] Error on unresolved variables (typo detection)

### Env generation rewrite
- [x] Rewrite lib/env.ts:
  - [x] Loop over services (not env_files)
  - [x] For each service with an env_file:
    - [x] Compute port from base_port + port_offset
    - [x] Build variable map: { port, agent_name, base_port }
    - [x] Resolve all env_vars templates
    - [x] Write to worktree_dir/service.env_file
  - [x] Add header comment with agent name + timestamp

### Tab differentiation
- [x] Include `VITE_GROVE_AGENT` (or `NEXT_PUBLIC_GROVE_AGENT`) in default env_vars
- [ ] Document how to use it in app code (in README or implementation.md)

### Init command update
- [x] commands/init.ts generates new config format:
  - [x] Vite: env_file=".env.local", env_vars includes VITE_GROVE_AGENT
  - [x] Next.js: env_file=".env.local", env_vars includes NEXT_PUBLIC_GROVE_AGENT
  - [x] Python: env_file=".env", env_vars includes GROVE_AGENT

### Stop/Remove port_offset fix
- [x] stop.ts uses service.port_offset instead of sequential index
- [x] remove.ts uses service.port_offset instead of sequential index

### Testing
- [x] Test on CSRdemo (single service, Vite)
- [x] Verify backward compat with Phase 1 config format
- [x] Env file contains PORT + VITE_GROVE_AGENT
- [x] Test with a mock multi-service config (frontend + backend + supabase)
- [ ] Verify tab title works in browser

---

## Phase 3: Cross-References + Managed/Fixed Ports ✅ DONE

### Service cross-references
- [x] Extend template variables:
  - [x] `${services.<name>.port}` → another service's computed port
  - [x] `${services.<name>.url}` → fixed_url or `http://localhost:<port>`
- [x] Update lib/templates.ts:
  - [x] Accept full service port map via TemplateVars.services
  - [x] Resolve nested service references with regex match
  - [x] Error on unknown service names (typo detection)

### Managed vs Fixed ports
- [x] Add to Service interface:
  - [x] `managed?: boolean` (default: true)
  - [x] `fixed_port?: number`
  - [x] `fixed_url?: string`
  - [x] `env_file: string | null` (null = don't write env file)
- [x] Update port allocation logic:
  - [x] Skip unmanaged services in stop/remove port killing
  - [x] Skip unmanaged services in dependency installation
  - [x] Unmanaged services use fixed_port/fixed_url in variable resolution
- [x] Update env generation:
  - [x] Skip services with env_file: null
  - [x] Build service map with both managed + fixed ports
  - [x] Cross-references resolve correctly for both types

### Init command update
- [x] If supabase/config.toml detected, add as `managed: false` with fixed_port: 54321
- [x] Auto-add cross-references when multiple services detected:
  - [x] frontend → backend port
  - [x] backend → frontend port
  - [x] frontend/backend → supabase URL

### Testing
- [x] Test: frontend references backend port (VITE_API_URL=http://localhost:61931)
- [x] Test: backend references frontend port (FRONTEND_URL=http://localhost:61930)
- [x] Test: unmanaged Supabase referenced by managed services (fixed 54321)
- [x] Test: two worktrees get different ports but same Supabase URL
- [x] Verify .env files have correct cross-referenced values

---

## Phase 4: Global Runtime Tracking ✅ DONE

- [x] Centralize state.json in `~/.grove/state.json`
- [x] Extend AgentEntry with `repo_root` (absolute path)
- [x] Update `grove status` to show all agents from global state
- [x] Add `PROJECT` column to status output
- [x] Update `stop`, `remove`, `logs`, `restart` to work from any directory
- [x] Make `run` command work globally for existing agents
- [x] Resilient start/creation logic when outside a git repo
- [x] Update documentation (README.md, implementation.md)

---

## Phase 5: Background Mode + Context Injection

### 4A: Background AI execution
- [ ] Create `src/lib/ai-registry.ts`:
  - [ ] AI CLI config map (claude → --print, aider → --message --yes, etc.)
  - [ ] `getAiConfig(command): AiCliConfig`
- [ ] Extend AgentEntry in `src/lib/state.ts`:
  - [ ] Add `ai_pid?: number`
  - [ ] Add `ai_status?: 'idle' | 'running' | 'completed' | 'failed'`
  - [ ] Add `ai_started_at?: string`
  - [ ] Add `ai_command?: string`
  - [ ] Add `updateAgentAiStatus()` helper
- [ ] Update `src/commands/run.ts`:
  - [ ] Add `--background` / `-b` flag
  - [ ] Background: use `spawn()` with log file pipe
  - [ ] Record ai_pid in state.json
  - [ ] Attach close handler to update state on exit
  - [ ] Background requires a prompt (error if missing)
- [ ] Update `src/commands/status.ts`:
  - [ ] Check AI PID liveness via `process.kill(pid, 0)`
  - [ ] Show AI status: running (AI), completed, failed
- [ ] Update `src/commands/stop.ts`:
  - [ ] Kill AI process (ai_pid) when stopping
- [ ] Register `-b, --background` in `src/index.ts`

### 4B: CLAUDE.md injection
- [ ] Create `src/lib/context.ts`:
  - [ ] `generateClaudeMd(agent, config, serviceMap): string`
  - [ ] `injectClaudeMd(worktreeDir, content): void`
  - [ ] Uses `<!-- grove:context:start/end -->` delimiters
  - [ ] Merges with existing CLAUDE.md if present
- [ ] Export `buildServicePortMap` from `src/lib/env.ts`
- [ ] Call `injectClaudeMd()` in `src/commands/start.ts`

### 4C: Contextual prompt enhancement
- [ ] Add `buildPromptContext(agent, config): string` to `src/lib/context.ts`
- [ ] Prepend context to prompt in `src/commands/run.ts`
- [ ] Add `--no-context` flag to skip

### Testing
- [ ] `grove run gallery "task" -b` returns immediately, PID in state
- [ ] `grove status` shows "running (AI)" / "completed"
- [ ] `grove logs gallery` streams background output
- [ ] `grove start name "feature"` creates CLAUDE.md in worktree
- [ ] CLAUDE.md merges with existing one (delimiter test)
- [ ] Background prompt includes context prefix
- [ ] `--no-context` skips prefix

---

## Phase 5: Polish Commands

### 5A: `grove open <name>`
- [ ] Create `src/commands/open.ts`
- [ ] Open in VS Code: `code <path>`
- [ ] `--browser` flag: `open http://localhost:<port>`
- [ ] Add `editor?: string` to GroveConfig
- [ ] Register in `src/index.ts`

### 5B: `grove doctor`
- [ ] Create `src/commands/doctor.ts`
- [ ] Check: git, node, AI CLI installed
- [ ] Validate: config.json parses correctly
- [ ] Find: orphaned state entries (dir missing)
- [ ] Find: stale AI PIDs
- [ ] Suggest fixes for each issue
- [ ] Register in `src/index.ts`

### 5C: `grove diff <name>`
- [ ] Create `src/commands/diff.ts`
- [ ] `git diff main...HEAD` with `--stat` option
- [ ] Register in `src/index.ts`

### 5D: `grove pr <name>`
- [ ] Create `src/commands/pr.ts`
- [ ] Push branch, `gh pr create`
- [ ] Auto-fill title/body from feature + commits
- [ ] `--draft` flag support
- [ ] Register in `src/index.ts`

### Testing
- [ ] `grove open gallery` opens VS Code
- [ ] `grove open gallery --browser` opens browser
- [ ] `grove doctor` with all deps → all green
- [ ] `grove doctor` with missing dir → detects orphan
- [ ] `grove diff gallery` shows changes vs main
- [ ] `grove pr gallery` creates PR on GitHub

---

## Phase 6: npm Publish

- [ ] Create `.npmignore` (exclude src/, docs)
- [ ] Create `.gitignore` (node_modules/, dist/)
- [ ] Create `LICENSE` (MIT)
- [ ] Create `README.md` (quick start, command ref, config ref, AI CLI guide)
- [ ] Update `package.json` (files, prepublishOnly, repository, author)
- [ ] `npm pack` → verify tarball
- [ ] `npm publish`

---

## Phase 7: MCP Server

### Refactor: commands → operations
- [ ] Create `src/lib/operations.ts`:
  - [ ] `initProject(repoRoot): InitResult`
  - [ ] `startAgent(repoRoot, name, feature): StartResult`
  - [ ] `runAgentBackground(repoRoot, name, prompt, ai?): RunResult`
  - [ ] `stopAgent(repoRoot, name): StopResult`
  - [ ] `getStatus(repoRoot): StatusResult`
  - [ ] `getAgentLogs(repoRoot, name, lines?): string`
  - [ ] `removeAgent(repoRoot, name): RemoveResult`
  - [ ] `getAgentDiff(repoRoot, name): string`
- [ ] Refactor `src/commands/*.ts` to call operations.ts

### MCP server
- [ ] Create `src/mcp-server.ts` (entry point)
- [ ] Create `src/mcp/tools.ts` (tool definitions with JSON schemas)
- [ ] Create `src/mcp/handlers.ts` (handlers calling operations.ts)
- [ ] Add `@modelcontextprotocol/sdk` dependency
- [ ] Add `"grove-mcp"` bin entry in package.json
- [ ] Tools: grove_init, grove_start, grove_run_background, grove_status, grove_logs, grove_stop, grove_remove, grove_diff

### Testing
- [ ] MCP server starts and responds to tool list request
- [ ] grove_start creates worktree via MCP
- [ ] grove_run_background spawns AI via MCP
- [ ] grove_status returns structured data via MCP
- [ ] Configure in Claude Code and test orchestration

---

## Phase 8: Linear Integration

- [ ] Create `src/lib/linear.ts` (GraphQL API client, needs LINEAR_API_KEY)
- [ ] Add `--from-linear <id>` option to `grove run`
- [ ] Fetch ticket → use as agent name + prompt
- [ ] Add `linear_team_key` to GroveConfig
- [ ] Test: `grove run --from-linear LIN-123 -b`

---

## Backlog (Post Phase 8)

- [ ] `grove dashboard` — TUI with live status (ink or blessed)
- [ ] `grove sync <name>` — rebase main into worktree branch
- [ ] Plugin system for custom service types
- [ ] Config inheritance (global ~/.grove/config.json + per-repo)
- [ ] Port collision detection + auto-probe
- [ ] Worktree templates for common stacks
