import { execSync, spawn } from 'child_process';
import { mkdirSync, openSync } from 'fs';
import path from 'path';
import os from 'os';
import process from 'process';

const isWindows = os.platform() === 'win32';

export function isPortInUse(port: number): boolean {
  try {
    if (isWindows) {
      const cmd = `netstat -ano | findstr LISTENING | findstr :${port}`;
      const result = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      return result.trim().length > 0;
    } else {
      const result = execSync(`lsof -ti :${port}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      return result.trim().length > 0;
    }
  } catch {
    return false;
  }
}

export function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

export function killPid(pid: number): boolean {
  try {
    if (isWindows) {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
    } else {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already dead
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function killPort(port: number): boolean {
  try {
    if (isWindows) {
      const cmd = `netstat -ano | findstr LISTENING | findstr :${port}`;
      const output = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const lines = output.split('\n');
      let killed = false;
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && !isNaN(parseInt(pid))) {
          killPid(parseInt(pid));
          killed = true;
        }
      }
      return killed;
    } else {
      const pids = execSync(`lsof -ti :${port}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (!pids) return false;
      const pidList = pids.split('\n');
      for (const pid of pidList) {
        killPid(parseInt(pid));
      }
      return true;
    }
  } catch {
    return false;
  }
}

export function getProcessStatus(ports: number[], pids?: number[]): 'running' | 'stopped' {
  // 1. Check if any of the expected ports are in use
  // This is the most reliable check for "is the service alive?"
  for (const port of ports) {
    if (isPortInUse(port)) return 'running';
  }

  // 2. Check PIDs as a secondary signal
  // On Windows, PID reuse is common, so we only trust it if we have no ports to check
  // or if we're willing to accept a potential false positive during startup.
  if (pids && pids.length > 0) {
    const anyRunning = pids.some(pid => isPidRunning(pid));
    
    // If we have ports and NONE are in use, but a PID is "running",
    // it's likely a stale PID/reused PID, especially on Windows.
    // However, if we JUST started (within a few seconds), it might be valid.
    // For now, if we have ports, we trust the port status.
    if (ports.length === 0 && anyRunning) return 'running';
  }

  return 'stopped';
}

export function spawnBackground(
  fullCommand: string,
  cwd: string,
  logFile: string
): number {
  mkdirSync(path.dirname(logFile), { recursive: true });

  if (isWindows) {
    // On Windows, Node.js 'detached' processes often fail to write to inherited file handles
    // when unref() is called. Shell redirection is more reliable for background logs.
    // We use >> to append to logs instead of > to overwrite, which is safer.
    const cmd = `${fullCommand} >> "${logFile}" 2>&1`;
    const child = spawn(cmd, {
      cwd,
      detached: true,
      stdio: 'ignore',
      shell: true,
      windowsHide: true,
      env: { ...process.env }
    });
    child.unref();
    if (!child.pid) throw new Error('Failed to spawn background process');
    return child.pid;
  } else {
    const out = openSync(logFile, 'a');
    const child = spawn(fullCommand, {
      cwd,
      detached: true,
      stdio: ['ignore', out, out],
      shell: true,
      env: { ...process.env }
    });
    child.unref();
    if (!child.pid) throw new Error('Failed to spawn background process');
    return child.pid;
  }
}
