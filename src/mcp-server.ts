#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { readState } from './lib/state.js';
import { getProcessStatus } from './lib/process.js';
import { readConfig, getConfigPath, configExists, GroveConfig } from './lib/config.js';
import { CONFIG_SCHEMA_DOCS } from './lib/schema-docs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GROVE_BIN = path.join(__dirname, 'index.js');

function runGrove(args: string[], cwd?: string, stdin?: string): string {
  try {
    const result = execSync(
      `node "${GROVE_BIN}" ${args.map(a => JSON.stringify(a)).join(' ')}`,
      {
        encoding: 'utf-8',
        cwd: cwd || process.cwd(),
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
        input: stdin,
        stdio: [stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      }
    );
    return result.trim();
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return ((e.stdout || '') + '\n' + (e.stderr || '')).trim() || String(e.message);
  }
}

const server = new Server(
  { name: 'grove', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'grove_init',
      description:
        'Initialize grove in a git repository. Scans for all ports used by the project (package.json, .env files, docker-compose, framework configs) and creates .grove/config.json with discovered ports and services.',
      inputSchema: {
        type: 'object',
        properties: {
          repo_path: {
            type: 'string',
            description:
              'Absolute path to the git repository root. Defaults to the current working directory.',
          },
          rescan: {
            type: 'boolean',
            description:
              'Re-run port discovery on an already-initialized repo and update config.',
          },
        },
      },
    },
    {
      name: 'grove_start',
      description:
        'Create a new isolated worktree agent with its own port block and environment, or relaunch an existing one. Supports isolating or sharing individual services. Returns the agent name, assigned ports, and worktree path.',
      inputSchema: {
        type: 'object',
        properties: {
          repo_path: {
            type: 'string',
            description: 'Absolute path to the git repository root.',
          },
          name: {
            type: 'string',
            description:
              'Agent name (letters, numbers, hyphens, underscores). Auto-generated if omitted.',
          },
          feature: {
            type: 'string',
            description:
              'Short feature description for this agent (e.g. "implement image gallery").',
          },
          isolate: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Service names to isolate (each gets a new port and process in the worktree).',
          },
          share: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Service names to share with the main branch (use original port, no new process).',
          },
          profile: {
            type: 'string',
            description:
              'Named isolation profile from .grove/config.json (e.g. "frontend-only").',
          },
        },
        required: ['repo_path'],
      },
    },
    {
      name: 'grove_status',
      description:
        'List all grove agents with their repo, worktree path, assigned port, and live status (running / stopped / orphaned).',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'grove_stop',
      description: 'Stop all processes running under a grove agent.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the agent to stop.' },
        },
        required: ['name'],
      },
    },
    {
      name: 'grove_stop_all',
      description: 'Stop every running grove agent.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'grove_restart',
      description: 'Restart a grove agent (stop then start its services).',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the agent to restart.' },
        },
        required: ['name'],
      },
    },
    {
      name: 'grove_logs',
      description: 'Return recent log output for a grove agent.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the agent.' },
          lines: {
            type: 'number',
            description: 'Number of recent lines to return per log file (default: 50).',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'grove_remove',
      description:
        'Remove a grove agent: stops its services, deletes the git worktree directory, and removes the local branch. Unsaved changes are discarded.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the agent to remove.' },
        },
        required: ['name'],
      },
    },
    {
      name: 'grove_get_config',
      description:
        'Read the current .grove/config.json for a repository, along with full schema documentation. Use this to understand the project\'s service configuration before modifying it. Returns the config JSON and a schema reference explaining every field, template variables, isolation modes, and examples.',
      inputSchema: {
        type: 'object',
        properties: {
          repo_path: {
            type: 'string',
            description: 'Absolute path to the git repository root.',
          },
        },
        required: ['repo_path'],
      },
    },
    {
      name: 'grove_update_config',
      description:
        'Write an updated .grove/config.json for a repository. Use this after grove_get_config to fix auto-detected services, add missing services, set original_port values, configure profiles, or adjust any config fields. The config must be valid JSON matching the grove config schema.',
      inputSchema: {
        type: 'object',
        properties: {
          repo_path: {
            type: 'string',
            description: 'Absolute path to the git repository root.',
          },
          config: {
            type: 'object',
            description: 'The complete grove config object to write. Must include all required fields (version, services, discovered_ports, port_range_start, port_block_size, port_strategy, port_step, profiles, ai_command).',
          },
        },
        required: ['repo_path', 'config'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const input = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case 'grove_init': {
        const repoPath = (input.repo_path as string | undefined) || process.cwd();
        const cmdArgs: string[] = ['init'];
        if (input.rescan) cmdArgs.push('--rescan');
        const output = runGrove(cmdArgs, repoPath);
        return { content: [{ type: 'text', text: output || 'Grove initialized.' }] };
      }

      case 'grove_start': {
        const repoPath = input.repo_path as string;
        const agentName = input.name as string | undefined;
        const feature = input.feature as string | undefined;
        const isolate = input.isolate as string[] | undefined;
        const share = input.share as string[] | undefined;
        const profile = input.profile as string | undefined;
        const cmdArgs: string[] = ['start'];
        if (agentName) cmdArgs.push(agentName);
        if (feature) cmdArgs.push(feature);
        if (isolate && isolate.length > 0) {
          cmdArgs.push('--isolate', ...isolate);
        }
        if (share && share.length > 0) {
          cmdArgs.push('--share', ...share);
        }
        if (profile) {
          cmdArgs.push('--profile', profile);
        }
        const output = runGrove(cmdArgs, repoPath);
        return { content: [{ type: 'text', text: output }] };
      }

      case 'grove_status': {
        const state = readState();
        const agents = Object.values(state.agents).map(agent => {
          let status: string;
          if (!existsSync(agent.path)) {
            status = 'orphaned';
          } else {
            let ports: number[] = [];
            try {
              const config = readConfig(agent.repo_root);
              ports = config.services
                .filter(s => s.managed !== false)
                .map(s => agent.base_port + s.port_offset);
            } catch {
              // repo may have been deleted
            }
            status = getProcessStatus(ports, agent.pids);
          }
          return {
            name: agent.id,
            repo: agent.repo,
            repo_path: agent.repo_root,
            worktree_path: agent.path,
            branch: agent.branch,
            port: agent.base_port,
            feature: agent.feature,
            status,
            created_at: agent.created_at,
            port_offset_index: agent.port_offset_index,
            isolation_map: agent.isolation_map,
          };
        });

        if (agents.length === 0) {
          return { content: [{ type: 'text', text: 'No grove agents found.' }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(agents, null, 2) }] };
      }

      case 'grove_stop': {
        const agentName = input.name as string;
        const output = runGrove(['stop', agentName]);
        return { content: [{ type: 'text', text: output }] };
      }

      case 'grove_stop_all': {
        const output = runGrove(['stop-all']);
        return { content: [{ type: 'text', text: output }] };
      }

      case 'grove_restart': {
        const agentName = input.name as string;
        const output = runGrove(['restart', agentName]);
        return { content: [{ type: 'text', text: output }] };
      }

      case 'grove_logs': {
        const agentName = input.name as string;
        const lineCount = (input.lines as number | undefined) ?? 50;

        const state = readState();
        const agent = state.agents[agentName];
        if (!agent) {
          return { content: [{ type: 'text', text: `Agent '${agentName}' not found.` }] };
        }

        const logDir = path.join(agent.repo_root, '.grove', 'logs');
        if (!existsSync(logDir)) {
          return { content: [{ type: 'text', text: 'No logs directory found.' }] };
        }

        const logFiles = readdirSync(logDir)
          .filter(f => f.startsWith(`${agentName}-`) && f.endsWith('.log'))
          .map(f => path.join(logDir, f));

        if (logFiles.length === 0) {
          return {
            content: [{ type: 'text', text: `No log files found for '${agentName}'.` }],
          };
        }

        const sections = logFiles.map(logFile => {
          const content = readFileSync(logFile, 'utf-8');
          const recent = content.split('\n').slice(-lineCount).join('\n');
          return `=== ${path.basename(logFile)} ===\n${recent}`;
        });

        return { content: [{ type: 'text', text: sections.join('\n\n') }] };
      }

      case 'grove_remove': {
        const agentName = input.name as string;
        const output = runGrove(['remove', agentName], undefined, 'N\n');
        return { content: [{ type: 'text', text: output }] };
      }

      case 'grove_get_config': {
        const repoPath = input.repo_path as string;
        if (!configExists(repoPath)) {
          return {
            content: [{ type: 'text', text: 'No grove config found at ' + repoPath + '. Run grove_init first.\n\n' + CONFIG_SCHEMA_DOCS }],
          };
        }
        const cfgPath = getConfigPath(repoPath);
        const rawConfig = readFileSync(cfgPath, 'utf-8');
        return {
          content: [{ type: 'text', text: '## Current config (' + cfgPath + ')\n\n```json\n' + rawConfig + '```\n\n' + CONFIG_SCHEMA_DOCS }],
        };
      }

      case 'grove_update_config': {
        const repoPath = input.repo_path as string;
        const newConfig = input.config as GroveConfig;

        if (!newConfig || typeof newConfig !== 'object') {
          return { content: [{ type: 'text', text: 'Error: config must be a valid object.' }], isError: true };
        }
        if (!Array.isArray(newConfig.services)) {
          return { content: [{ type: 'text', text: 'Error: config.services must be an array.' }], isError: true };
        }
        if (!newConfig.version) {
          newConfig.version = 3;
        }

        newConfig.discovered_ports = newConfig.discovered_ports ?? [];
        newConfig.port_range_start = newConfig.port_range_start ?? 54000;
        newConfig.port_block_size = newConfig.port_block_size ?? 10;
        newConfig.port_strategy = newConfig.port_strategy ?? 'sequential';
        newConfig.port_step = newConfig.port_step ?? 100;
        newConfig.profiles = newConfig.profiles ?? {};
        newConfig.ai_command = newConfig.ai_command ?? 'claude';

        for (const service of newConfig.services) {
          if (!service.name) {
            return { content: [{ type: 'text', text: 'Error: every service must have a "name" field.' }], isError: true };
          }
        }

        const cfgPath = getConfigPath(repoPath);
        writeFileSync(cfgPath, JSON.stringify(newConfig, null, 2) + '\n');
        return {
          content: [{ type: 'text', text: 'Config updated successfully at ' + cfgPath + '.\n\nServices: ' + newConfig.services.map(s => s.name).join(', ') }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
