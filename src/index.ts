#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { startCommand } from './commands/start.js';
import { stopCommand, stopAllCommand } from './commands/stop.js';
import { restartCommand } from './commands/restart.js';
import { statusCommand } from './commands/status.js';
import { logsCommand } from './commands/logs.js';
import { removeCommand } from './commands/remove.js';
import { runCommand } from './commands/run.js';

const program = new Command();

program
  .name('grove')
  .description('Git worktree manager for parallel development with AI coding agents')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize grove in the current repo')
  .action(() => initCommand());

program
  .command('start [name] [feature]')
  .description('Create a new worktree with isolated ports and env')
  .action((name?: string, feature?: string) => startCommand(name, feature));

program
  .command('stop <name>')
  .description('Stop processes running on an agent\'s ports')
  .action((name: string) => stopCommand(name));

program
  .command('stop-all')
  .description('Stop all running agent processes')
  .action(() => stopAllCommand());

program
  .command('restart <name>')
  .description('Restart an existing agent (stop then start)')
  .action((name: string) => restartCommand(name));

program
  .command('status')
  .description('Show all agents with ports and liveness')
  .action(() => statusCommand());

program
  .command('logs <name>')
  .description('View logs for an agent')
  .action((name: string) => logsCommand(name));

program
  .command('remove <name>')
  .description('Stop, remove worktree, and delete branch')
  .action((name: string) => removeCommand(name));

program
  .command('run <name> [prompt]')
  .description('Launch an AI coding agent in the worktree')
  .option('--ai <command>', 'AI CLI to use (claude, gemini, codex, aider)')
  .action((name: string, prompt: string | undefined, options: { ai?: string }) => {
    runCommand(name, prompt, options);
  });

program.parse();
