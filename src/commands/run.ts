import chalk from 'chalk';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { getRepoRoot } from '../lib/worktree.js';
import { readConfig } from '../lib/config.js';
import { getAgent } from '../lib/state.js';
import { startCommand } from './start.js';
import { getProcessStatus } from '../lib/process.js';

export function runCommand(name: string, prompt: string | undefined, options: { ai?: string }): void {
  // Try to find existing agent first
  let agent = getAgent(name);
  
  let repoRoot: string | undefined;
  try {
    repoRoot = getRepoRoot();
  } catch {
    // Not in a repo
  }

  if (!agent) {
    if (!repoRoot) {
      console.log(chalk.red(`❌ Agent '${name}' not found and not inside a git repository to create it.`));
      process.exit(1);
    }
    console.log(chalk.blue(`Creating worktree '${name}'...`));
    startCommand(name, prompt || undefined);
    agent = getAgent(name);
    if (!agent) {
      console.log(chalk.red('❌ Failed to create worktree'));
      process.exit(1);
    }
  }

  // Load config from the agent's repo root
  const config = readConfig(agent.repo_root);

  // If agent exists, check if it's running
  const ports = config.services
    .filter(s => s.managed !== false)
    .map(s => agent!.base_port + s.port_offset);
  const status = getProcessStatus(ports, agent.pids);

  if (status !== 'running') {
    console.log(chalk.yellow(`⚠️  Services are not running for agent '${name}'`));
    startCommand(name, undefined);
    agent = getAgent(name);
  }

  if (!agent) {
    console.log(chalk.red(`❌ Agent '${name}' not found or failed to start.`));
    process.exit(1);
  }

  if (!existsSync(agent.path)) {
    console.log(chalk.red(`❌ Worktree directory missing: ${agent.path}`));
    console.log(`👉 Run ${chalk.cyan(`grove remove ${name}`)} and try again.`);
    process.exit(1);
  }

  // Determine AI command
  const aiCommand = options.ai || config.ai_command || 'claude';

  // Build the command
  const args: string[] = [];
  if (prompt) {
    args.push(prompt);
  }

  console.log('');
  console.log(chalk.blue(`🤖 Launching ${aiCommand} in ${agent.path}`));
  if (prompt) {
    console.log(chalk.gray(`   Prompt: "${prompt}"`));
  }
  console.log(chalk.gray('----------------------------------'));
  console.log('');

  // Spawn AI CLI in the worktree directory (foreground, interactive)
  const result = spawnSync(aiCommand, args, {
    cwd: agent.path,
    stdio: 'inherit',
    shell: true,
  });

  if (result.status !== 0 && result.error) {
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('');
      console.log(chalk.red(`❌ '${aiCommand}' not found.`));
      console.log('');
      console.log('Available AI CLIs:');
      console.log(chalk.gray('   claude    — Anthropic Claude Code'));
      console.log(chalk.gray('   gemini    — Google Gemini CLI'));
      console.log(chalk.gray('   codex     — OpenAI Codex CLI'));
      console.log(chalk.gray('   aider     — Aider (open source)'));
      console.log('');
      console.log(`Set your preferred CLI: edit .grove/config.json → "ai_command"`);
      console.log(`Or use: ${chalk.cyan(`grove run ${name} --ai <command> "prompt"`)}`);
    } else {
      console.log(chalk.red(`❌ ${aiCommand} exited with error`));
    }
    process.exit(1);
  }
}
