import { readFileSync, existsSync } from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';
import { DiscoveredPort } from './config.js';

const PORT_MIN = 1024;
const PORT_MAX = 65535;

function isValidPort(n: number): boolean {
  return Number.isInteger(n) && n >= PORT_MIN && n <= PORT_MAX;
}

// Known database/cache ports to auto-classify
const KNOWN_PORTS: Record<number, { context: DiscoveredPort['context']; label: string }> = {
  5432: { context: 'database', label: 'PostgreSQL' },
  3306: { context: 'database', label: 'MySQL' },
  27017: { context: 'database', label: 'MongoDB' },
  6379: { context: 'cache', label: 'Redis' },
  11211: { context: 'cache', label: 'Memcached' },
};

function inferContext(port: number, envVar?: string, hint?: string): DiscoveredPort['context'] {
  if (KNOWN_PORTS[port]) return KNOWN_PORTS[port].context;

  const lower = (envVar ?? '').toLowerCase() + ' ' + (hint ?? '').toLowerCase();
  if (lower.includes('database') || lower.includes('db_') || lower.includes('postgres') || lower.includes('mysql') || lower.includes('mongo')) {
    return 'database';
  }
  if (lower.includes('redis') || lower.includes('cache') || lower.includes('memcache')) {
    return 'cache';
  }
  if (lower.includes('frontend') || lower.includes('vite') || lower.includes('next') || lower.includes('react') || lower.includes('client')) {
    return 'frontend';
  }
  if (lower.includes('backend') || lower.includes('api') || lower.includes('server') || lower.includes('uvicorn') || lower.includes('flask') || lower.includes('express')) {
    return 'backend';
  }

  return 'unknown';
}

function readFileSafe(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// Scanner 1: package.json scripts
function scanPackageJson(repoRoot: string): DiscoveredPort[] {
  const ports: DiscoveredPort[] = [];
  const pkgPath = path.join(repoRoot, 'package.json');
  const content = readFileSafe(pkgPath);
  if (!content) return ports;

  try {
    const pkg = JSON.parse(content);
    const scripts = pkg.scripts as Record<string, string> | undefined;
    if (!scripts) return ports;

    for (const [name, cmd] of Object.entries(scripts)) {
      // Match --port 3000, --port=3000, -p 3000, -p=3000
      const portMatches = cmd.matchAll(/(?:--port|--PORT|-p)[=\s]+(\d+)/g);
      for (const m of portMatches) {
        const port = parseInt(m[1], 10);
        if (isValidPort(port)) {
          ports.push({
            port,
            source: `package.json ("${name}")`,
            context: inferContext(port, undefined, name),
            confidence: 'high',
          });
        }
      }

      // Match PORT=3000 in scripts
      const envMatches = cmd.matchAll(/PORT=(\d+)/g);
      for (const m of envMatches) {
        const port = parseInt(m[1], 10);
        if (isValidPort(port)) {
          ports.push({
            port,
            source: `package.json ("${name}")`,
            context: inferContext(port, 'PORT', name),
            confidence: 'high',
            env_var: 'PORT',
          });
        }
      }
    }
  } catch {
    // Invalid JSON
  }

  return ports;
}

// Scanner 2: .env files
function scanEnvFiles(repoRoot: string): DiscoveredPort[] {
  const ports: DiscoveredPort[] = [];
  const envFileNames = ['.env', '.env.local', '.env.development', '.env.example', '.env.dev'];

  for (const envFileName of envFileNames) {
    const content = readFileSafe(path.join(repoRoot, envFileName));
    if (!content) continue;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex < 0) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();

      // Direct port assignment: PORT=3000, SERVER_PORT=8080, etc.
      if (/PORT/i.test(key)) {
        const port = parseInt(value, 10);
        if (isValidPort(port)) {
          ports.push({
            port,
            source: envFileName,
            context: inferContext(port, key),
            confidence: 'high',
            env_var: key,
          });
        }
        continue;
      }

      // URL-based: DATABASE_URL=postgres://...localhost:5432/...
      const urlPortMatch = value.match(/localhost:(\d+)|127\.0\.0\.1:(\d+)/);
      if (urlPortMatch) {
        const port = parseInt(urlPortMatch[1] || urlPortMatch[2], 10);
        if (isValidPort(port)) {
          ports.push({
            port,
            source: envFileName,
            context: inferContext(port, key),
            confidence: 'medium',
            env_var: key,
          });
        }
      }
    }
  }

  return ports;
}

// Scanner 3: Framework config files
function scanFrameworkConfigs(repoRoot: string): DiscoveredPort[] {
  const ports: DiscoveredPort[] = [];

  const configFiles = [
    { file: 'vite.config.ts', context: 'frontend' as const },
    { file: 'vite.config.js', context: 'frontend' as const },
    { file: 'vite.config.mts', context: 'frontend' as const },
    { file: 'nuxt.config.ts', context: 'frontend' as const },
    { file: 'nuxt.config.js', context: 'frontend' as const },
    { file: 'astro.config.mjs', context: 'frontend' as const },
    { file: 'astro.config.ts', context: 'frontend' as const },
    { file: 'webpack.config.js', context: 'frontend' as const },
  ];

  for (const { file, context } of configFiles) {
    const content = readFileSafe(path.join(repoRoot, file));
    if (!content) continue;

    // Match port: 3000 or port: 5173 in server config blocks
    const portMatches = content.matchAll(/port\s*:\s*(\d+)/g);
    for (const m of portMatches) {
      const port = parseInt(m[1], 10);
      if (isValidPort(port)) {
        ports.push({
          port,
          source: file,
          context,
          confidence: 'high',
        });
      }
    }
  }

  return ports;
}

// Scanner 4: docker-compose.yml
function scanDockerCompose(repoRoot: string): DiscoveredPort[] {
  const ports: DiscoveredPort[] = [];
  const composeFiles = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

  for (const fileName of composeFiles) {
    const content = readFileSafe(path.join(repoRoot, fileName));
    if (!content) continue;

    try {
      const doc = yaml.load(content) as Record<string, unknown>;
      const services = doc?.services as Record<string, Record<string, unknown>> | undefined;
      if (!services) continue;

      for (const [serviceName, serviceConfig] of Object.entries(services)) {
        const portsList = serviceConfig?.ports as unknown[] | undefined;
        if (!portsList) continue;

        for (const portEntry of portsList) {
          const portStr = String(portEntry);
          // Match "3000:3000" or "8080:80" — host port is the first number
          const match = portStr.match(/^"?(\d+):(\d+)"?$/);
          if (match) {
            const hostPort = parseInt(match[1], 10);
            if (isValidPort(hostPort)) {
              ports.push({
                port: hostPort,
                source: `${fileName} (${serviceName})`,
                context: inferContext(hostPort, undefined, serviceName),
                confidence: 'high',
              });
            }
          } else {
            // Single port: "3000"
            const singleMatch = portStr.match(/^"?(\d+)"?$/);
            if (singleMatch) {
              const port = parseInt(singleMatch[1], 10);
              if (isValidPort(port)) {
                ports.push({
                  port,
                  source: `${fileName} (${serviceName})`,
                  context: inferContext(port, undefined, serviceName),
                  confidence: 'medium',
                });
              }
            }
          }
        }
      }
    } catch {
      // Invalid YAML
    }
  }

  return ports;
}

// Scanner 5: Python entry points
function scanPythonEntryPoints(repoRoot: string): DiscoveredPort[] {
  const ports: DiscoveredPort[] = [];
  const pyFiles = ['main.py', 'app.py', 'server.py', 'run.py', 'manage.py'];

  for (const pyFile of pyFiles) {
    const content = readFileSafe(path.join(repoRoot, pyFile));
    if (!content) continue;

    // Match uvicorn.run(..., port=8000), app.run(port=5000), etc.
    const patterns = [
      /uvicorn\.run\([^)]*port\s*=\s*(\d+)/g,
      /\.run\([^)]*port\s*=\s*(\d+)/g,
      /\.bind\(\s*\(\s*['"][^'"]*['"]\s*,\s*(\d+)\s*\)/g,
    ];

    for (const pattern of patterns) {
      const matches = content.matchAll(pattern);
      for (const m of matches) {
        const port = parseInt(m[1], 10);
        if (isValidPort(port)) {
          ports.push({
            port,
            source: pyFile,
            context: 'backend',
            confidence: 'medium',
          });
        }
      }
    }
  }

  return ports;
}

// Scanner 6: Dockerfiles
function scanDockerfile(repoRoot: string): DiscoveredPort[] {
  const ports: DiscoveredPort[] = [];
  const dockerFiles = ['Dockerfile', 'Dockerfile.dev', 'Dockerfile.prod'];

  for (const dockerFile of dockerFiles) {
    const content = readFileSafe(path.join(repoRoot, dockerFile));
    if (!content) continue;

    const exposeMatches = content.matchAll(/^EXPOSE\s+(\d+)/gm);
    for (const m of exposeMatches) {
      const port = parseInt(m[1], 10);
      if (isValidPort(port)) {
        ports.push({
          port,
          source: dockerFile,
          context: inferContext(port),
          confidence: 'low',
        });
      }
    }
  }

  return ports;
}

// Deduplicate: keep highest confidence per port number
function deduplicatePorts(ports: DiscoveredPort[]): DiscoveredPort[] {
  const confidenceRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const bestByPort = new Map<number, DiscoveredPort>();

  for (const p of ports) {
    const existing = bestByPort.get(p.port);
    if (!existing || confidenceRank[p.confidence] > confidenceRank[existing.confidence]) {
      bestByPort.set(p.port, p);
    }
  }

  return Array.from(bestByPort.values()).sort((a, b) => a.port - b.port);
}

export function discoverPorts(repoRoot: string): DiscoveredPort[] {
  const allPorts: DiscoveredPort[] = [
    ...scanPackageJson(repoRoot),
    ...scanEnvFiles(repoRoot),
    ...scanFrameworkConfigs(repoRoot),
    ...scanDockerCompose(repoRoot),
    ...scanPythonEntryPoints(repoRoot),
    ...scanDockerfile(repoRoot),
  ];

  return deduplicatePorts(allPorts);
}
