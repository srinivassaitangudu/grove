import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

export interface AgentEntry {
  id: string;
  branch: string;
  path: string;
  feature: string;
  repo: string;
  base_port: number;
  created_at: string;
  pids?: number[];
}

export interface GroveState {
  version: number;
  agents: Record<string, AgentEntry>;
}

const STATE_FILE = 'state.json';

export function getStatePath(repoRoot: string): string {
  return path.join(repoRoot, '.grove', STATE_FILE);
}

export function ensureState(repoRoot: string): void {
  const statePath = getStatePath(repoRoot);
  const dir = path.dirname(statePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(statePath)) {
    const initial: GroveState = { version: 1, agents: {} };
    writeFileSync(statePath, JSON.stringify(initial, null, 2) + '\n');
  }
}

export function readState(repoRoot: string): GroveState {
  ensureState(repoRoot);
  const raw = readFileSync(getStatePath(repoRoot), 'utf-8');
  return JSON.parse(raw) as GroveState;
}

export function writeState(repoRoot: string, state: GroveState): void {
  ensureState(repoRoot);
  writeFileSync(getStatePath(repoRoot), JSON.stringify(state, null, 2) + '\n');
}

export function getAgent(repoRoot: string, agentId: string): AgentEntry | undefined {
  const state = readState(repoRoot);
  return state.agents[agentId];
}

export function addAgent(repoRoot: string, agent: AgentEntry): void {
  const state = readState(repoRoot);
  state.agents[agent.id] = agent;
  writeState(repoRoot, state);
}

export function removeAgent(repoRoot: string, agentId: string): void {
  const state = readState(repoRoot);
  delete state.agents[agentId];
  writeState(repoRoot, state);
}
