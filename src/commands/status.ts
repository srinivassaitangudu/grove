import chalk from 'chalk';
import { existsSync } from 'fs';
import { readConfig } from '../lib/config.js';
import { readState } from '../lib/state.js';
import { getProcessStatus } from '../lib/process.js';

function padEndVisible(str: string, len: number): string {
  const visibleLen = str.replace(/\x1b\[[0-9;]*m/g, '').length;
  return str + ' '.repeat(Math.max(0, len - visibleLen));
}

export function statusCommand(): void {
  const state = readState();
  const agentIds = Object.keys(state.agents);

  if (agentIds.length === 0) {
    console.log('');
    console.log(chalk.gray('📊 No agents found'));
    console.log(`👉 Run ${chalk.cyan('grove start <name>')} to create one.`);
    return;
  }

  console.log('');
  const header = `${'NAME'.padEnd(20)} ${'PROJECT'.padEnd(15)} ${'PORTS'.padEnd(25)} ${'STATUS'.padEnd(10)} PATH`;
  console.log(chalk.bold(header));
  console.log(chalk.gray('─'.repeat(95)));

  for (const id of agentIds) {
    const agent = state.agents[id];
    let statusText: string;

    let ports: number[] = [];
    let portDisplay = String(agent.base_port);
    try {
      const config = readConfig(agent.repo_root);
      ports = config.services
        .filter(s => {
          if (s.managed === false) return false;
          if (agent.isolation_map && agent.isolation_map[s.name] === 'share') return false;
          return true;
        })
        .map(s => agent.base_port + s.port_offset);

      // Build port display with isolation info
      const portParts: string[] = [];
      for (const service of config.services) {
        if (service.managed === false) continue;
        const mode = agent.isolation_map?.[service.name];
        if (mode === 'share') {
          const origPort = service.original_port || (3000 + service.port_offset);
          portParts.push(`${origPort}${chalk.cyan('S')}`);
        } else {
          const port = agent.base_port + service.port_offset;
          portParts.push(`${port}${chalk.green('I')}`);
        }
      }
      if (portParts.length > 0) {
        portDisplay = portParts.join(' ');
      }
    } catch {
      // If config can't be read, we'll rely on PIDs
    }

    const status = getProcessStatus(ports, agent.pids);

    if (!existsSync(agent.path)) {
      statusText = chalk.red('orphaned');
    } else if (status === 'running') {
      statusText = chalk.green('running');
    } else {
      statusText = chalk.yellow('stopped');
    }

    console.log(
      `${id.padEnd(20)} ${agent.repo.padEnd(15)} ${padEndVisible(portDisplay, 25)} ${padEndVisible(statusText, 10)} ${chalk.gray(agent.path)}`
    );
  }

  console.log(chalk.gray('─'.repeat(95)));
  console.log(chalk.gray(`  ${chalk.green('I')}=isolated  ${chalk.cyan('S')}=shared`));
}
