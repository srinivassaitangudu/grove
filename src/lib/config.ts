import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { CONFIG_SCHEMA_DOCS } from './schema-docs.js';

export interface Service {
  name: string;
  type: string;
  dir: string;
  start_cmd: string;
  install_cmd: string;
  port_offset: number;
  env_file: string | null;
  env_vars: Record<string, string>;
  managed?: boolean;
  fixed_port?: number;
  fixed_url?: string;
  original_port?: number;
}

export interface DiscoveredPort {
  port: number;
  source: string;
  context: 'frontend' | 'backend' | 'database' | 'cache' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  env_var?: string;
}

export interface Profile {
  isolate: string[];
  share: string[];
}

export interface GroveConfig {
  version: number;
  services: Service[];
  discovered_ports: DiscoveredPort[];
  port_range_start: number;
  port_block_size: number;
  port_strategy: 'sequential' | 'hash';
  port_step: number;
  profiles: Record<string, Profile>;
  ai_command: string;
}

// Legacy format (Phase 1) for backward compat
interface LegacyService {
  name: string;
  type: string;
  dir: string;
  start_cmd: string;
  install_cmd: string;
  env_var: string;
  default_port: number;
}

interface LegacyConfig {
  version: number;
  services: LegacyService[];
  env_files: string[];
  port_range_start: number;
  port_block_size: number;
  ai_command: string;
}

const CONFIG_DIR = '.grove';
const CONFIG_FILE = 'config.json';
const README_FILE = 'README.md';

const GROVE_README_COMMANDS = [
  '# Grove Project Metadata',
  '',
  'This folder contains Grove-specific configuration and runtime information for this project.',
  '',
  '## Project Structure',
  '',
  '- `config.json`: Project configuration (services, ports, AI commands).',
  '- `logs/`: Runtime logs for each active agent.',
  '- `README.md`: This reference guide.',
  '',
  '## Common Commands',
  '',
  '### Initialize Grove',
  '```bash',
  'grove init',
  '```',
  '',
  '### Create / Start Agent',
  '```bash',
  'grove start <name> [feature]',
  'grove start gallery "implement image gallery"',
  'grove start sidebar --isolate frontend --share backend,database',
  'grove start feature-x --profile frontend-only',
  '```',
  '',
  '### Run AI Prompt',
  '```bash',
  'grove run <name> [prompt] [--ai <command>]',
  '```',
  '',
  '### View Status / Logs / Stop / Remove',
  '```bash',
  'grove status',
  'grove logs <name>',
  'grove stop <name>',
  'grove restart <name>',
  'grove remove <name>',
  '```',
  '',
  '## Troubleshooting',
  '',
  '- **Service Connectivity:** Check `.env.local` in the worktree for correct port references.',
  '- **Port Conflicts:** Grove offsets ports by +100 per agent. Ensure ports are free.',
  '- **Stale State:** Check `~/.grove/state.json` or run `grove status`.',
  '',
].join('\n');

const GROVE_README_CONTENT = GROVE_README_COMMANDS + '\n' + CONFIG_SCHEMA_DOCS + '\n';

export function getConfigDir(repoRoot: string): string {
  return path.join(repoRoot, CONFIG_DIR);
}

export function getConfigPath(repoRoot: string): string {
  return path.join(repoRoot, CONFIG_DIR, CONFIG_FILE);
}

export function getREADMEPath(repoRoot: string): string {
  return path.join(repoRoot, CONFIG_DIR, README_FILE);
}

export function configExists(repoRoot: string): boolean {
  return existsSync(getConfigPath(repoRoot));
}

function isLegacyConfig(raw: unknown): raw is LegacyConfig {
  const obj = raw as Record<string, unknown>;
  return Array.isArray(obj.env_files) || (
    Array.isArray(obj.services) &&
    obj.services.length > 0 &&
    'env_var' in (obj.services as Record<string, unknown>[])[0]
  );
}

function migrateLegacyConfig(legacy: LegacyConfig): GroveConfig {
  const envFile = legacy.env_files?.[0] || '.env.local';
  const services: Service[] = legacy.services.map((s, i) => {
    const envVars: Record<string, string> = {
      [s.env_var]: '${port}',
    };
    // Add agent identifier based on type
    if (s.type === 'vite') {
      envVars['VITE_GROVE_AGENT'] = '${agent_name}';
    } else if (s.type === 'nextjs') {
      envVars['NEXT_PUBLIC_GROVE_AGENT'] = '${agent_name}';
    } else {
      envVars['GROVE_AGENT'] = '${agent_name}';
    }

    return {
      name: s.name,
      type: s.type,
      dir: s.dir,
      start_cmd: s.start_cmd,
      install_cmd: s.install_cmd,
      port_offset: i,
      env_file: s.dir === '.' ? envFile : `${s.dir}/.env`,
      env_vars: envVars,
    };
  });

  return {
    version: 2,
    services,
    discovered_ports: [],
    port_range_start: legacy.port_range_start,
    port_block_size: legacy.port_block_size,
    port_strategy: 'hash' as const,
    port_step: 100,
    profiles: {},
    ai_command: legacy.ai_command,
  };
}

function isV2Config(raw: unknown): boolean {
  const obj = raw as Record<string, unknown>;
  return obj.version === 2 && !('port_strategy' in obj);
}

function inferOriginalPort(service: Service): number {
  if (service.fixed_port) return service.fixed_port;
  if (service.type === 'vite') return 5173;
  if (service.type === 'nextjs') return 3000;
  if (service.type === 'python') return 8000;
  return 3000;
}

function migrateV2ToV3(v2: GroveConfig): GroveConfig {
  return {
    ...v2,
    version: 3,
    discovered_ports: v2.discovered_ports ?? [],
    port_strategy: v2.port_strategy ?? 'hash',
    port_step: v2.port_step ?? 100,
    profiles: v2.profiles ?? {},
    services: v2.services.map(s => ({
      ...s,
      original_port: s.original_port ?? inferOriginalPort(s),
    })),
  };
}

export function readConfig(repoRoot: string): GroveConfig {
  const configPath = getConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    throw new Error(`No grove config found. Run 'grove init' first.`);
  }
  const raw = JSON.parse(readFileSync(configPath, 'utf-8'));

  // Handle legacy (Phase 1) config format
  if (isLegacyConfig(raw)) {
    return migrateV2ToV3(migrateLegacyConfig(raw));
  }

  // Handle v2 config format
  if (isV2Config(raw)) {
    return migrateV2ToV3(raw as GroveConfig);
  }

  return raw as GroveConfig;
}

export function writeConfig(repoRoot: string, config: GroveConfig): void {
  const configDir = getConfigDir(repoRoot);
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  const configPath = getConfigPath(repoRoot);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

export function writeREADME(repoRoot: string): void {
  const readmePath = getREADMEPath(repoRoot);
  writeFileSync(readmePath, GROVE_README_CONTENT);
}

export function detectProjectType(repoRoot: string): Service[] {
  const services: Service[] = [];

  if (existsSync(path.join(repoRoot, 'vite.config.ts')) || existsSync(path.join(repoRoot, 'vite.config.js'))) {
    services.push({
      name: 'frontend',
      type: 'vite',
      dir: '.',
      start_cmd: 'npm run dev -- --port ${port}',
      install_cmd: 'npm install',
      port_offset: services.length,
      env_file: '.env.local',
      env_vars: {
        'PORT': '${port}',
        'VITE_GROVE_AGENT': '${agent_name}',
      },
    });
  } else if (existsSync(path.join(repoRoot, 'next.config.js')) || existsSync(path.join(repoRoot, 'next.config.mjs')) || existsSync(path.join(repoRoot, 'next.config.ts'))) {
    services.push({
      name: 'frontend',
      type: 'nextjs',
      dir: '.',
      start_cmd: 'npm run dev -- --port ${port}',
      install_cmd: 'npm install',
      port_offset: services.length,
      env_file: '.env.local',
      env_vars: {
        'PORT': '${port}',
        'NEXT_PUBLIC_GROVE_AGENT': '${agent_name}',
      },
    });
  }

  if (existsSync(path.join(repoRoot, 'requirements.txt')) || existsSync(path.join(repoRoot, 'pyproject.toml'))) {
    services.push({
      name: 'backend',
      type: 'python',
      dir: '.',
      start_cmd: 'python main.py',
      install_cmd: 'pip install -r requirements.txt',
      port_offset: services.length,
      env_file: 'backend/.env',
      env_vars: {
        'PORT': '${port}',
        'GROVE_AGENT': '${agent_name}',
      },
    });
  }

  if (existsSync(path.join(repoRoot, 'supabase', 'config.toml'))) {
    services.push({
      name: 'supabase_api',
      type: 'supabase',
      dir: 'supabase',
      start_cmd: 'supabase start',
      install_cmd: '',
      port_offset: 0,
      env_file: null,
      env_vars: {},
      managed: false,
      fixed_port: 54321,
      fixed_url: 'http://localhost:54321',
    });
  }

  // Add cross-references if multiple services detected
  const hasFrontend = services.some(s => s.name === 'frontend');
  const hasBackend = services.some(s => s.name === 'backend');
  const hasSupabase = services.some(s => s.name === 'supabase_api');

  if (hasFrontend && hasBackend) {
    const frontend = services.find(s => s.name === 'frontend')!;
    const backend = services.find(s => s.name === 'backend')!;
    // Frontend needs to know backend URL
    if (frontend.type === 'nextjs') {
      frontend.env_vars['NEXT_PUBLIC_API_URL'] = 'http://localhost:${services.backend.port}';
    } else {
      frontend.env_vars['VITE_API_URL'] = 'http://localhost:${services.backend.port}';
    }
    // Backend needs to know frontend URL
    backend.env_vars['FRONTEND_URL'] = 'http://localhost:${services.frontend.port}';
  }

  if (hasBackend && hasSupabase) {
    const backend = services.find(s => s.name === 'backend')!;
    backend.env_vars['SUPABASE_URL'] = '${services.supabase_api.url}';
    backend.env_vars['DATABASE_URL'] = 'postgres://postgres:postgres@localhost:${services.supabase_api.port}/postgres';
  }

  if (hasFrontend && hasSupabase) {
    const frontend = services.find(s => s.name === 'frontend')!;
    if (frontend.type === 'nextjs') {
      frontend.env_vars['NEXT_PUBLIC_SUPABASE_URL'] = '${services.supabase_api.url}';
    } else {
      frontend.env_vars['VITE_SUPABASE_URL'] = '${services.supabase_api.url}';
    }
  }

  return services;
}
