import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';

export interface AgentEntry {
  id: string;
  branch: string;
  path: string;
  feature: string;
  repo: string;
  repo_root: string; // Absolute path to the repository
  base_port: number;
  created_at: string;
  pids?: number[];
}

export interface GroveState {
  version: number;
  agents: Record<string, AgentEntry>;
}

const STATE_FILE = 'state.json';

export function getGlobalGroveDir(): string {
  return path.join(os.homedir(), '.grove');
}

export function getStatePath(): string {
  return path.join(getGlobalGroveDir(), STATE_FILE);
}

export function ensureState(): void {
  const statePath = getStatePath();
  const dir = path.dirname(statePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(statePath)) {
    const initial: GroveState = { version: 1, agents: {} };
    writeFileSync(statePath, JSON.stringify(initial, null, 2) + '\n');
  }
}

export function readState(): GroveState {
  ensureState();
  const raw = readFileSync(getStatePath(), 'utf-8');
  return JSON.parse(raw) as GroveState;
}

export function writeState(state: GroveState): void {
  ensureState();
  writeFileSync(getStatePath(), JSON.stringify(state, null, 2) + '\n');
}

export function getAgent(agentId: string): AgentEntry | undefined {
  const state = readState();
  return state.agents[agentId];
}

export function addAgent(agent: AgentEntry): void {
  const state = readState();
  state.agents[agent.id] = agent;
  writeState(state);
}

export function removeAgent(agentId: string): void {
  const state = readState();
  delete state.agents[agentId];
  writeState(state);
}
