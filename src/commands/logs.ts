import chalk from 'chalk';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { getRepoRoot } from '../lib/worktree.js';
import { readConfig } from '../lib/config.js';
import { getAgent } from '../lib/state.js';

export function logsCommand(name: string): void {
  const repoRoot = getRepoRoot();
  const config = readConfig(repoRoot);
  const agent = getAgent(repoRoot, name);

  if (!agent) {
    console.log(chalk.red(`❌ Agent '${name}' not found`));
    process.exit(1);
  }

  const logDir = path.join(repoRoot, '.grove', 'logs');
  const logFile = path.join(logDir, `${name}.log`);

  if (existsSync(logFile)) {
    // Stream logs in foreground
    try {
      execSync(`tail -f "${logFile}"`, { stdio: 'inherit' });
    } catch {
      // User hit Ctrl+C
    }
  } else {
    console.log(chalk.gray(`ℹ️  No log file found for '${name}'`));
    console.log('');
    console.log('👉 To capture logs, start the server with:');
    const startCmd = config.services[0]?.start_cmd || 'npm run dev';
    console.log(chalk.cyan(`   cd ${agent.path} && ${startCmd} 2>&1 | tee ${logFile}`));
  }
}
