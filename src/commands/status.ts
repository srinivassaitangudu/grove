import chalk from 'chalk';
import { existsSync } from 'fs';
import { getRepoRoot } from '../lib/worktree.js';
import { readConfig } from '../lib/config.js';
import { readState } from '../lib/state.js';
import { isPortInUse } from '../lib/process.js';

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
    let status: string;

    if (!existsSync(agent.path)) {
      status = chalk.red('orphaned');
    } else if (isPortInUse(agent.base_port)) {
      status = chalk.green('running');
    } else {
      status = chalk.yellow('stopped');
    }

    console.log(
      `${id.padEnd(20)} ${agent.branch.padEnd(15)} ${String(agent.base_port).padEnd(8)} ${status.padEnd(19)} ${chalk.gray(agent.path)}`
    );
  }

  console.log(chalk.gray('─'.repeat(80)));
}
