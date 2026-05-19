import chalk from 'chalk';
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { getRepoRoot, getRepoName, getWorktreeDir, createWorktree } from '../lib/worktree.js';
import { readConfig } from '../lib/config.js';
import { readState, addAgent, getAgent } from '../lib/state.js';
import { computePortBlock } from '../lib/ports.js';
import { generateEnvFiles } from '../lib/env.js';

export function startCommand(name: string | undefined, feature: string | undefined): void {
  const repoRoot = getRepoRoot();
  const config = readConfig(repoRoot);
  const repoName = getRepoName(repoRoot);

  // Auto-generate name if not provided
  const agentId = name || `agent-${Date.now().toString(36).slice(-6)}`;

  // Validate name
  if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
    console.log(chalk.red('❌ Invalid name. Use only letters, numbers, hyphens, and underscores.'));
    process.exit(1);
  }

  // Check if already exists
  const existing = getAgent(repoRoot, agentId);
  if (existing) {
    const worktreeDir = existing.path;
    if (existsSync(worktreeDir)) {
      console.log('');
      console.log(chalk.yellow(`⚠️  '${agentId}' already exists`));
      console.log(`📂 Path: ${worktreeDir}`);
      console.log(`👉 Use ${chalk.cyan(`grove remove ${agentId}`)} first to recreate.`);
      return;
    }
    // Stale entry — clean it up silently
  }

  // Check how many agents are running
  const state = readState(repoRoot);
  const agentCount = Object.keys(state.agents).length;
  if (agentCount > 0) {
    console.log(chalk.yellow(`⚠️  ${agentCount} agent(s) already exist`));
  }

  console.log('');
  console.log(chalk.blue(`🚀 Starting: ${agentId}`));

  // Compute deterministic port
  const basePort = computePortBlock(agentId, config.port_range_start, config.port_block_size);
  const worktreeDir = getWorktreeDir(repoRoot, agentId);
  const branch = agentId;

  console.log(chalk.gray(`🔌 Assigned Port: ${basePort}`));

  // Create worktree
  createWorktree(repoRoot, worktreeDir, branch);

  // Generate env files
  generateEnvFiles(worktreeDir, basePort, agentId, config);

  // Install dependencies (only managed services)
  for (const service of config.services) {
    if (service.managed === false) continue;
    if (service.install_cmd) {
      const serviceDir = path.join(worktreeDir, service.dir);
      const nodeModulesPath = path.join(serviceDir, 'node_modules');

      if (existsSync(serviceDir) && !existsSync(nodeModulesPath)) {
        console.log(chalk.gray(`📦 Installing dependencies (${service.name})...`));
        try {
          const logDir = path.join(repoRoot, '.grove', 'logs');
          mkdirSync(logDir, { recursive: true });
          execSync(service.install_cmd, {
            cwd: serviceDir,
            stdio: 'pipe',
          });
          console.log(chalk.green(`✅ Dependencies installed`));
        } catch (err) {
          console.log(chalk.yellow(`⚠️  Install failed for ${service.name}. Run manually.`));
        }
      }
    }
  }

  // Save to state
  addAgent(repoRoot, {
    id: agentId,
    branch,
    path: worktreeDir,
    feature: feature || '',
    repo: repoName,
    base_port: basePort,
    created_at: new Date().toISOString(),
  });

  // Print summary
  console.log('');
  console.log(chalk.green('✅ Ready'));
  console.log(chalk.gray('----------------------------------'));
  console.log(`🆔 Name    : ${agentId}`);
  console.log(`🌿 Branch  : ${branch}`);
  console.log(`🔌 Port    : ${basePort}`);
  console.log(`📂 Path    : ${worktreeDir}`);
  console.log(chalk.gray('----------------------------------'));
  console.log('');
  console.log('👉 Next steps:');
  console.log(chalk.cyan(`   cd ${worktreeDir}`));
  console.log(chalk.cyan(`   ${config.services[0]?.start_cmd || 'npm run dev'}`));
}
