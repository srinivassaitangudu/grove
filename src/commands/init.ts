import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { getRepoRoot } from '../lib/worktree.js';
import { configExists, writeConfig, readConfig, writeREADME, detectProjectType, GroveConfig, Service, DiscoveredPort } from '../lib/config.js';
import { ensureState } from '../lib/state.js';
import { discoverPorts } from '../lib/discovery.js';

function enrichServicesWithPorts(services: Service[], discovered: DiscoveredPort[]): void {
  for (const service of services) {
    if (service.original_port) continue;

    // Try to match a discovered port to this service by context
    const contextMap: Record<string, DiscoveredPort['context'][]> = {
      'vite': ['frontend'],
      'nextjs': ['frontend'],
      'python': ['backend'],
      'supabase': ['database'],
      'custom': ['frontend', 'backend', 'unknown'],
    };
    const matchContexts = contextMap[service.type] ?? ['unknown'];
    const match = discovered.find(p => matchContexts.includes(p.context));
    if (match) {
      service.original_port = match.port;
    }
  }
}

function printDiscoveredPorts(discovered: DiscoveredPort[]): void {
  if (discovered.length === 0) return;

  console.log('');
  console.log(chalk.blue('📡 Discovered ports:'));
  console.log(chalk.gray('  PORT   SOURCE                          CONTEXT      CONFIDENCE'));
  for (const p of discovered) {
    const port = String(p.port).padEnd(7);
    const source = p.source.padEnd(32);
    const context = p.context.padEnd(13);
    const conf = p.confidence;
    console.log(`  ${port}${source}${context}${conf}`);
  }
}

export function initCommand(options?: { rescan?: boolean }): void {
  const repoRoot = getRepoRoot();

  if (options?.rescan) {
    if (!configExists(repoRoot)) {
      console.log(chalk.red('❌ No grove config found. Run grove init first.'));
      return;
    }
    const config = readConfig(repoRoot);
    const discovered = discoverPorts(repoRoot);
    config.discovered_ports = discovered;
    enrichServicesWithPorts(config.services, discovered);
    writeConfig(repoRoot, config);
    printDiscoveredPorts(discovered);
    console.log('');
    console.log(chalk.green('✅ Port discovery updated.'));
    return;
  }

  if (configExists(repoRoot)) {
    console.log(chalk.yellow('⚠️  Grove already initialized in this repo.'));
    console.log(`   Config: ${path.join(repoRoot, '.grove', 'config.json')}`);
    return;
  }

  // Detect project type
  let detected = detectProjectType(repoRoot);

  if (detected.length > 0) {
    console.log(chalk.blue('🔍 Detected services:'));
    detected.forEach(s => console.log(`   - ${s.name} (${s.type})`));
  } else {
    console.log(chalk.blue('🔍 No known project type detected. Using generic config.'));
    detected = [{
      name: 'app',
      type: 'custom',
      dir: '.',
      start_cmd: 'npm run dev',
      install_cmd: 'npm install',
      port_offset: 0,
      env_file: '.env.local',
      env_vars: {
        'PORT': '${port}',
        'GROVE_AGENT': '${agent_name}',
      },
    }];
  }

  // Run port discovery
  const discovered = discoverPorts(repoRoot);
  enrichServicesWithPorts(detected, discovered);
  printDiscoveredPorts(discovered);

  const config: GroveConfig = {
    version: 3,
    services: detected,
    discovered_ports: discovered,
    port_range_start: 54000,
    port_block_size: 10,
    port_strategy: 'sequential',
    port_step: 100,
    profiles: {},
    ai_command: 'claude',
  };

  writeConfig(repoRoot, config);
  writeREADME(repoRoot);
  ensureState();

  // Update .gitignore
  const gitignorePath = path.join(repoRoot, '.gitignore');
  const entriesToAdd = ['.grove/logs/', '.env.local', '.env*.local'];

  let gitignoreContent = '';
  if (existsSync(gitignorePath)) {
    gitignoreContent = readFileSync(gitignorePath, 'utf-8');
  }

  const newEntries = entriesToAdd.filter(e => !gitignoreContent.includes(e));
  if (newEntries.length > 0) {
    const addition = '\n# grove\n' + newEntries.join('\n') + '\n';
    writeFileSync(gitignorePath, gitignoreContent + addition);
    console.log(chalk.green('📝 Updated .gitignore'));
  }

  console.log('');
  console.log(chalk.green('✅ Grove initialized'));
  console.log(chalk.gray('----------------------------------'));
  console.log(`📄 Config: .grove/config.json`);
  console.log(`📖 Guide:  .grove/README.md`);
  console.log(`📂 Logs:   .grove/logs/`);
  console.log(chalk.gray('----------------------------------'));
  console.log('');
  console.log(`👉 Next: ${chalk.cyan('grove start <name> <feature>')}`);
}
