import { createHash } from 'crypto';
import { readState } from './state.js';

export function computePortBlock(name: string, rangeStart: number, blockSize: number): number {
  const hash = createHash('sha256').update(name).digest('hex');
  const hashSlice = hash.slice(0, 8);
  const hashDec = parseInt(hashSlice, 16);
  const blockIndex = hashDec % 1000;
  return rangeStart + blockIndex * blockSize;
}

export function getPortsForServices(basePort: number, serviceCount: number): number[] {
  return Array.from({ length: serviceCount }, (_, i) => basePort + i);
}

export function computeSequentialPort(originalPort: number, agentIndex: number, step: number): number {
  return originalPort + (agentIndex * step);
}

export function getNextAgentIndex(repoRoot: string): number {
  const state = readState();
  let maxIndex = 0;
  for (const agent of Object.values(state.agents)) {
    if (agent.repo_root === repoRoot && agent.port_offset_index !== undefined) {
      maxIndex = Math.max(maxIndex, agent.port_offset_index);
    }
  }
  return maxIndex + 1;
}
