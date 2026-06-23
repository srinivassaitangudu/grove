import chalk from 'chalk';
import readline from 'readline';
import { execSync } from 'child_process';
import process from 'process';
import { getRepoRoot } from '../lib/worktree.js';
import { readConfig } from '../lib/config.js';
import { getAgent, removeAgent } from '../lib/state.js';
import { isPortInUse, killPort } from '../lib/process.js';
import { removeWorktree, checkWorktreeChanges } from '../lib/worktree.js';
import { unlinkSync, existsSync, readdirSync } from 'fs';
import path from 'path';

function askQuestion(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function removeCommand(name: string): Promise<void> {
  const agent = getAgent(name);

  if (!agent) {
    console.log(chalk.red(`❌ Agent '${name}' not found`));
    process.exit(1);
    return;
  }

  const repoRoot = agent.repo_root;

  // Check for unsaved work before doing anything destructive
  if (existsSync(agent.path)) {
    const changes = checkWorktreeChanges(agent.path, agent.branch);
    const hasChanges = changes.hasUncommitted || changes.hasUntracked || changes.hasUnpushed;

    if (hasChanges) {
      console.log('');
      console.log(chalk.yellow('⚠️  Changes detected in this branch.'));
      if (changes.hasUncommitted) console.log(chalk.gray('   • Uncommitted changes'));
      if (changes.hasUntracked) console.log(chalk.gray('   • Untracked files'));
      if (changes.hasUnpushed) console.log(chalk.gray('   • Commits not pushed to remote'));
      console.log('');
      console.log('Push changes before removing?');
      console.log('');
      console.log(chalk.cyan('[Y]') + ' Push & Remove');
      console.log(chalk.cyan('[N]') + ' Remove Anyway');
      console.log(chalk.cyan('[C]') + ' Cancel');
      console.log('');

      const answer = await askQuestion('> ');
      const choice = answer.trim().toUpperCase();

      if (choice === 'C' || choice === '') {
        console.log(chalk.gray('Cancelled.'));
        return;
      }

      if (choice === 'Y') {
        console.log(chalk.blue('📤 Pushing branch...'));
        try {
          execSync(`git -C "${agent.path}" push origin "${agent.branch}"`, { stdio: 'inherit' });
          console.log(chalk.green('✅ Pushed successfully.'));
        } catch {
          console.log(chalk.red('❌ Push failed. Aborting removal.'));
          process.exit(1);
        }
      }
      // 'N' falls through to removal
    }
  }

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

  // Clean up log files (pattern: <name>-<service>.log)
  const logDir = path.join(repoRoot, '.grove', 'logs');
  if (existsSync(logDir)) {
    const logFiles = readdirSync(logDir).filter(
      f => f.startsWith(`${name}-`) && f.endsWith('.log')
    );
    for (const f of logFiles) {
      try {
        unlinkSync(path.join(logDir, f));
      } catch {
        // Ignore log deletion errors
      }
    }
  }

  // Remove from state
  removeAgent(name);

  console.log(chalk.green(`✅ Removed: ${name}`));
}
