import { execSync } from 'child_process';

export function isPortInUse(port: number): boolean {
  try {
    const result = execSync(`lsof -ti :${port}`, { encoding: 'utf-8', stdio: 'pipe' });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

export function killPort(port: number): boolean {
  try {
    const pids = execSync(`lsof -ti :${port}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
    if (!pids) return false;

    // SIGTERM first
    execSync(`echo "${pids}" | xargs kill -TERM`, { stdio: 'pipe' });

    // Wait briefly then check
    execSync('sleep 1', { stdio: 'pipe' });

    // Force kill if still alive
    try {
      const remaining = execSync(`lsof -ti :${port}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
      if (remaining) {
        execSync(`echo "${remaining}" | xargs kill -KILL`, { stdio: 'pipe' });
      }
    } catch {
      // Process already gone
    }

    return true;
  } catch {
    return false;
  }
}

export function getProcessStatus(port: number): 'running' | 'stopped' {
  return isPortInUse(port) ? 'running' : 'stopped';
}
