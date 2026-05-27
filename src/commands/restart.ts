import chalk from 'chalk';
import { stopCommand } from './stop.js';
import { startCommand } from './start.js';

export function restartCommand(name: string): void {
  console.log(chalk.blue(`🔄 Restarting agent: ${name}`));
  
  // Stop it first (this handles port-based killing if PIDs are lost)
  stopCommand(name);
  
  // Then start it (startCommand now handles existing agents by just relaunching services)
  startCommand(name, undefined);
}
