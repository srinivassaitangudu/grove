import chalk from 'chalk';
import process from 'process';
import { getRepoRoot } from '../lib/worktree.js';
import { readConfig } from '../lib/config.js';
import { getAgent, removeAgent } from '../lib/state.js';
import { isPortInUse, killPort } from '../lib/process.js';
import { removeWorktree } from '../lib/worktree.js';
import { unlinkSync, existsSync } from 'fs';
import path from 'path';

export function removeCommand(name: string): void {
  const agent = getAgent(name);

  if (!agent) {
    console.log(chalk.red(`❌ Agent '${name}' not found`));
    process.exit(1);
    return;
  }

  const repoRoot = agent.repo_root;

  // Load project-specific config to find ports
  try {
    const config = readConfig(repoRoot);
    // Stop any running processes (only managed services)
    for (const service of config.services) {
      if (service.managed === false) continue;
      const port = agent.base_port + service.port_offset;
      if (isPortInUse(port)) {
        console.log(chalk.gray(`🔪 Killing process on port ${port}...`));
        killPort(port);
      }
    }
  } catch {
    // Repo might be deleted, skip port killing
  }

  // Remove worktree + branch
  console.log(chalk.gray(`🗑️  Removing worktree...`));
  try {
    removeWorktree(repoRoot, agent.path, agent.branch);
  } catch (err) {
    console.log(chalk.yellow(`⚠️  Failed to remove worktree via git. You may need to delete it manually.`));
  }

  // Clean up log files
  const logDir = path.join(repoRoot, '.grove', 'logs');
  if (existsSync(logDir)) {
    const logFiles = [`${name}.log`, `${name}-install.log`];
    for (const f of logFiles) {
      const logPath = path.join(logDir, f);
      if (existsSync(logPath)) {
        try {
          unlinkSync(logPath);
        } catch {
          // Ignore log deletion errors
        }
      }
    }
  }

  // Remove from state
  removeAgent(name);

  console.log(chalk.green(`✅ Removed: ${name}`));
}
