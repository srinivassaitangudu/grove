import { createHash } from 'crypto';

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
