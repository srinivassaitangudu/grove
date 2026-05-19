import chalk from 'chalk';
import { getRepoRoot } from '../lib/worktree.js';
import { readConfig } from '../lib/config.js';
import { getAgent, removeAgent } from '../lib/state.js';
import { isPortInUse, killPort } from '../lib/process.js';
import { removeWorktree } from '../lib/worktree.js';
import { unlinkSync, existsSync } from 'fs';
import path from 'path';

export function removeCommand(name: string): void {
  const repoRoot = getRepoRoot();
  const config = readConfig(repoRoot);
  const agent = getAgent(repoRoot, name);

  if (!agent) {
    console.log(chalk.red(`❌ Agent '${name}' not found`));
    process.exit(1);
  }

  // Stop any running processes (only managed services)
  for (const service of config.services) {
    if (service.managed === false) continue;
    const port = agent.base_port + service.port_offset;
    if (isPortInUse(port)) {
      console.log(chalk.gray(`🔪 Killing process on port ${port}...`));
      killPort(port);
    }
  }

  // Remove worktree + branch
  console.log(chalk.gray(`🗑️  Removing worktree...`));
  removeWorktree(repoRoot, agent.path, agent.branch);

  // Clean up log files
  const logDir = path.join(repoRoot, '.grove', 'logs');
  const logFiles = [`${name}.log`, `${name}-install.log`];
  for (const f of logFiles) {
    const logPath = path.join(logDir, f);
    if (existsSync(logPath)) {
      unlinkSync(logPath);
    }
  }

  // Remove from state
  removeAgent(repoRoot, name);

  console.log(chalk.green(`✅ Removed: ${name}`));
}
