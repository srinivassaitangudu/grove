import chalk from 'chalk';
import { existsSync, readdirSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import process from 'process';
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
  
  // Find all log files for this agent
  const logFiles = readdirSync(logDir)
    .filter(f => f.startsWith(`${name}-`) && f.endsWith('.log'))
    .map(f => path.join(logDir, f));

  if (logFiles.length === 0) {
    // Check for legacy single log file
    const legacyLog = path.join(logDir, `${name}.log`);
    if (existsSync(legacyLog)) {
      logFiles.push(legacyLog);
    }
  }

  if (logFiles.length > 0) {
    // For now, stream the first one found (usually frontend or primary service)
    const logFile = logFiles[0];
    
    console.log(chalk.gray(`📋 Streaming logs for '${name}'...`));
    if (logFiles.length > 1) {
      console.log(chalk.gray(`ℹ️  Found ${logFiles.length} log files. Showing: ${path.basename(logFile)}`));
    }
    console.log(chalk.gray(`📂 Log file: ${logFile}`));
    console.log(chalk.gray('--- (Ctrl+C to stop) ---'));
    console.log('');

    const isWindows = os.platform() === 'win32';
    
    if (isWindows) {
      // Use PowerShell Get-Content -Wait
      const cmd = `powershell -NoProfile -Command "Get-Content \\"${logFile}\\" -Wait -Tail 20"`;
      spawn(cmd, {
        stdio: 'inherit',
        shell: true
      });
    } else {
      // Use tail -f
      spawn('tail', ['-f', '-n', '20', logFile], {
        stdio: 'inherit'
      });
    }
  } else {
    console.log(chalk.gray(`ℹ️  No log file found for '${name}'`));
    console.log(chalk.gray(`Expected pattern: ${name}-*.log`));
  }
}
