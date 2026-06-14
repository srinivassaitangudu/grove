#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { readState } from './lib/state.js';
import { getProcessStatus } from './lib/process.js';
import { readConfig } from './lib/config.js';

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
        'Initialize grove in a git repository. Detects the project type (Vite, Next.js, Python, Supabase) and creates .grove/config.json.',
      inputSchema: {
        type: 'object',
        properties: {
          repo_path: {
            type: 'string',
            description:
              'Absolute path to the git repository root. Defaults to the current working directory.',
          },
        },
      },
    },
    {
      name: 'grove_start',
      description:
        'Create a new isolated worktree agent with its own port block and environment, or relaunch an existing one. Returns the agent name, assigned port, and worktree path.',
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
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const input = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case 'grove_init': {
        const repoPath = (input.repo_path as string | undefined) || process.cwd();
        const output = runGrove(['init'], repoPath);
        return { content: [{ type: 'text', text: output || 'Grove initialized.' }] };
      }

      case 'grove_start': {
        const repoPath = input.repo_path as string;
        const agentName = input.name as string | undefined;
        const feature = input.feature as string | undefined;
        const cmdArgs: string[] = ['start'];
        if (agentName) cmdArgs.push(agentName);
        if (feature) cmdArgs.push(feature);
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
        // Pass 'N\n' as stdin so the interactive "push before remove?" prompt is answered
        // with "N" (remove anyway without pushing).
        const output = runGrove(['remove', agentName], undefined, 'N\n');
        return { content: [{ type: 'text', text: output }] };
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
