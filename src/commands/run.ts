import chalk from 'chalk';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { getRepoRoot } from '../lib/worktree.js';
import { readConfig } from '../lib/config.js';
import { getAgent } from '../lib/state.js';
import { startCommand } from './start.js';

export function runCommand(name: string, prompt: string | undefined, options: { ai?: string }): void {
  const repoRoot = getRepoRoot();
  const config = readConfig(repoRoot);

  // If agent doesn't exist, create it first
  let agent = getAgent(repoRoot, name);
  if (!agent) {
    console.log(chalk.blue(`Creating worktree '${name}'...`));
    startCommand(name, prompt || undefined);
    agent = getAgent(repoRoot, name);
    if (!agent) {
      console.log(chalk.red('❌ Failed to create worktree'));
      process.exit(1);
    }
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
