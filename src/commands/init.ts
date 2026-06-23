import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { getRepoRoot } from '../lib/worktree.js';
import { configExists, writeConfig, writeREADME, detectProjectType, GroveConfig, Service } from '../lib/config.js';
import { ensureState } from '../lib/state.js';

export function initCommand(): void {
  const repoRoot = getRepoRoot();

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

  const config: GroveConfig = {
    version: 2,
    services: detected,
    port_range_start: 54000,
    port_block_size: 10,
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
