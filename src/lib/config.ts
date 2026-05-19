import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

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
}

export interface GroveConfig {
  version: number;
  services: Service[];
  port_range_start: number;
  port_block_size: number;
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

export function getConfigDir(repoRoot: string): string {
  return path.join(repoRoot, CONFIG_DIR);
}

export function getConfigPath(repoRoot: string): string {
  return path.join(repoRoot, CONFIG_DIR, CONFIG_FILE);
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
    port_range_start: legacy.port_range_start,
    port_block_size: legacy.port_block_size,
    ai_command: legacy.ai_command,
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
    return migrateLegacyConfig(raw);
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

export function detectProjectType(repoRoot: string): Service[] {
  const services: Service[] = [];

  if (existsSync(path.join(repoRoot, 'vite.config.ts')) || existsSync(path.join(repoRoot, 'vite.config.js'))) {
    services.push({
      name: 'frontend',
      type: 'vite',
      dir: '.',
      start_cmd: 'npm run dev',
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
      start_cmd: 'npm run dev',
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
