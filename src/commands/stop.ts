import chalk from 'chalk';
import { getRepoRoot } from '../lib/worktree.js';
import { readConfig } from '../lib/config.js';
import { readState, getAgent } from '../lib/state.js';
import { isPortInUse, killPort } from '../lib/process.js';

function getServicePorts(basePort: number, config: ReturnType<typeof readConfig>): number[] {
  return config.services
    .filter(s => s.managed !== false)
    .map(s => basePort + s.port_offset);
}

export function stopCommand(name: string): void {
  const repoRoot = getRepoRoot();
  const config = readConfig(repoRoot);
  const agent = getAgent(repoRoot, name);

  if (!agent) {
    console.log(chalk.red(`❌ Agent '${name}' not found`));
    process.exit(1);
  }

  const ports = getServicePorts(agent.base_port, config);
  let stopped = 0;

  for (const port of ports) {
    if (isPortInUse(port)) {
      console.log(chalk.gray(`🔪 Killing process on port ${port}...`));
      killPort(port);
      stopped++;
    }
  }

  if (stopped === 0) {
    console.log(chalk.gray(`ℹ️  No running processes for '${name}'`));
  } else {
    console.log(chalk.green(`🛑 Stopped: ${name} (${stopped} process(es) killed)`));
  }
}

export function stopAllCommand(): void {
  const repoRoot = getRepoRoot();
  const config = readConfig(repoRoot);
  const state = readState(repoRoot);
  const agentIds = Object.keys(state.agents);

  if (agentIds.length === 0) {
    console.log(chalk.gray('ℹ️  No agents found'));
    return;
  }

  console.log(chalk.blue('🛑 Stopping all agents...'));

  for (const id of agentIds) {
    const agent = state.agents[id];
    const ports = getServicePorts(agent.base_port, config);

    for (const port of ports) {
      if (isPortInUse(port)) {
        killPort(port);
      }
    }
    console.log(chalk.gray(`   ✔ ${id}`));
  }

  console.log(chalk.green('✅ All agents stopped'));
}
