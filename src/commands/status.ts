import chalk from 'chalk';
import { existsSync } from 'fs';
import { getRepoRoot } from '../lib/worktree.js';
import { readConfig } from '../lib/config.js';
import { readState } from '../lib/state.js';
import { getProcessStatus } from '../lib/process.js';

export function statusCommand(): void {
  const repoRoot = getRepoRoot();
  const config = readConfig(repoRoot);
  const state = readState(repoRoot);
  const agentIds = Object.keys(state.agents);

  if (agentIds.length === 0) {
    console.log('');
    console.log(chalk.gray('📊 No agents found'));
    console.log(`👉 Run ${chalk.cyan('grove start <name>')} to create one.`);
    return;
  }

  console.log('');
  const header = `${'NAME'.padEnd(20)} ${'BRANCH'.padEnd(15)} ${'PORT'.padEnd(8)} ${'STATUS'.padEnd(10)} PATH`;
  console.log(chalk.bold(header));
  console.log(chalk.gray('─'.repeat(80)));

  for (const id of agentIds) {
    const agent = state.agents[id];
    let statusText: string;

    // Check all configured service ports
    const ports = config.services
      .filter(s => s.managed !== false)
      .map(s => agent.base_port + s.port_offset);
    
    const status = getProcessStatus(ports, agent.pids);

    if (!existsSync(agent.path)) {
      statusText = chalk.red('orphaned');
    } else if (status === 'running') {
      statusText = chalk.green('running');
    } else {
      statusText = chalk.yellow('stopped');
    }

    console.log(
      `${id.padEnd(20)} ${agent.branch.padEnd(15)} ${String(agent.base_port).padEnd(8)} ${statusText.padEnd(19)} ${chalk.gray(agent.path)}`
    );
  }

  console.log(chalk.gray('─'.repeat(80)));
}
