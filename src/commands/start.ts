import chalk from 'chalk';
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import process from 'process';
import { getRepoRoot, getRepoName, getWorktreeDir, createWorktree } from '../lib/worktree.js';
import { GroveConfig, readConfig } from '../lib/config.js';
import { readState, addAgent, getAgent } from '../lib/state.js';
import { computePortBlock } from '../lib/ports.js';
import { generateEnvFiles, buildServicePortMap } from '../lib/env.js';
import { spawnBackground, getProcessStatus } from '../lib/process.js';
import { resolveTemplate, TemplateVars } from '../lib/templates.js';

export function launchServices(agentId: string, worktreeDir: string, config: GroveConfig, basePort: number, repoRoot: string): number[] {
  const pids: number[] = [];
  const logDir = path.join(repoRoot, '.grove', 'logs');
  mkdirSync(logDir, { recursive: true });

  const serviceMap = buildServicePortMap(basePort, config);

  console.log(chalk.gray(`📡 Launching services...`));
  for (const service of config.services) {
    if (service.managed === false) continue;
    
    const serviceDir = path.join(worktreeDir, service.dir);
    const serviceLogFile = path.join(logDir, `${agentId}-${service.name}.log`);
    
    const servicePort = basePort + service.port_offset;
    const vars: TemplateVars = {
      port: servicePort,
      agent_name: agentId,
      base_port: basePort,
      services: serviceMap,
    };

    const resolvedCmd = resolveTemplate(service.start_cmd, vars);
    
    try {
      const pid = spawnBackground(resolvedCmd, serviceDir, serviceLogFile);
      pids.push(pid);
      console.log(chalk.gray(`   ✔ ${service.name} (pid: ${pid})`));
    } catch (err) {
      console.log(chalk.red(`❌ Failed to start ${service.name}`));
    }
  }
  return pids;
}

export function startCommand(name: string | undefined, feature: string | undefined): void {
  let repoRoot: string;
  try {
    repoRoot = getRepoRoot();
  } catch (err) {
    // If we're not in a repo, we MUST have an existing agent name to look up its repo_root
    if (!name) {
      console.log(chalk.red('❌ Not inside a git repository. Provide an agent name to restart an existing one.'));
      process.exit(1);
    }
    const agent = getAgent(name);
    if (!agent) {
      console.log(chalk.red(`❌ Agent '${name}' not found and not inside a git repository to create it.`));
      process.exit(1);
    }
    repoRoot = agent.repo_root;
  }

  const config = readConfig(repoRoot);
  const repoName = getRepoName(repoRoot);

  // Auto-generate name if not provided
  const agentId = name || `agent-${Date.now().toString(36).slice(-6)}`;

  // Validate name
  if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
    console.log(chalk.red('❌ Invalid name. Use only letters, numbers, hyphens, and underscores.'));
    process.exit(1);
  }

  const basePort = computePortBlock(agentId, config.port_range_start, config.port_block_size);
  const worktreeDir = getWorktreeDir(repoRoot, agentId);
  const branch = agentId;

  // Check if already exists in state
  let agent = getAgent(agentId);
  const dirExists = existsSync(worktreeDir);

  if (agent || dirExists) {
    if (dirExists) {
      // It exists on disk - check if it's already running
      const ports = config.services
        .filter(s => s.managed !== false)
        .map(s => basePort + s.port_offset);
      const status = getProcessStatus(ports, agent?.pids);

      if (status === 'running') {
        console.log('');
        console.log(chalk.yellow(`⚠️  '${agentId}' is already running`));
        console.log(`📂 Path: ${worktreeDir}`);
        console.log(`🔌 Port: ${basePort}`);
        console.log(`👉 Use ${chalk.cyan(`grove status`)} to check details.`);
        return;
      }

      // If stopped, relaunch
      console.log(chalk.blue(`🔄 Relaunching: ${agentId}`));
      
      // Re-generate env files (config might have changed)
      generateEnvFiles(worktreeDir, basePort, agentId, config);

      // Check/Install dependencies
      installDependencies(worktreeDir, config);

      // Launch services
      const pids = launchServices(agentId, worktreeDir, config, basePort, repoRoot);
      
      // Update/Create state entry
      const now = new Date().toISOString();
      agent = {
        id: agentId,
        branch,
        path: worktreeDir,
        feature: feature || agent?.feature || '',
        repo: repoName,
        repo_root: repoRoot,
        base_port: basePort,
        created_at: agent?.created_at || now,
        pids,
      };
      addAgent(agent);

      printSummary(agentId, branch, basePort, worktreeDir);
      return;
    } else {
      // Stale entry in state — clean it up silently and proceed to create
    }
  }

  // New Agent flow
  const state = readState();
  const agentCount = Object.keys(state.agents).length;
  if (agentCount > 0) {
    console.log(chalk.yellow(`⚠️  ${agentCount} agent(s) already exist`));
  }

  console.log('');
  console.log(chalk.blue(`🚀 Starting: ${agentId}`));
  console.log(chalk.gray(`🔌 Assigned Port: ${basePort}`));

  // Create worktree
  createWorktree(repoRoot, worktreeDir, branch);

  // Generate env files
  generateEnvFiles(worktreeDir, basePort, agentId, config);

  // Install dependencies
  installDependencies(worktreeDir, config);

  // Launch services
  const pids = launchServices(agentId, worktreeDir, config, basePort, repoRoot);

  // Save to state
  agent = {
    id: agentId,
    branch,
    path: worktreeDir,
    feature: feature || '',
    repo: repoName,
    repo_root: repoRoot,
    base_port: basePort,
    created_at: new Date().toISOString(),
    pids,
  };
  addAgent(agent);

  printSummary(agentId, branch, basePort, worktreeDir);
}

function installDependencies(worktreeDir: string, config: GroveConfig): void {
  for (const service of config.services) {
    if (service.managed === false) continue;
    if (service.install_cmd) {
      const serviceDir = path.join(worktreeDir, service.dir);
      const nodeModulesPath = path.join(serviceDir, 'node_modules');

      if (existsSync(serviceDir) && !existsSync(nodeModulesPath)) {
        console.log(chalk.gray(`📦 Installing dependencies (${service.name})...`));
        try {
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
}

function printSummary(agentId: string, branch: string, basePort: number, worktreeDir: string): void {
  console.log('');
  console.log(chalk.green('✅ Ready'));
  console.log(chalk.gray('----------------------------------'));
  console.log(`🆔 Name    : ${agentId}`);
  console.log(`🌿 Branch  : ${branch}`);
  console.log(`🔌 Port    : ${basePort}`);
  console.log(`📂 Path    : ${worktreeDir}`);
  console.log(`📝 Logs    : grove logs ${agentId}`);
  console.log(chalk.gray('----------------------------------'));
  console.log('');
  console.log('👉 Next steps:');
  console.log(chalk.cyan(`   grove status`));
  console.log(chalk.cyan(`   grove run ${agentId} "your prompt"`));
}
