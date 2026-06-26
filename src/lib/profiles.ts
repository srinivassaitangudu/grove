import { GroveConfig } from './config.js';

export type IsolationMode = 'isolate' | 'share';
export type IsolationMap = Record<string, IsolationMode>;

export function resolveIsolationMap(
  config: GroveConfig,
  options: { isolate?: string[]; share?: string[]; profile?: string }
): IsolationMap {
  const map: IsolationMap = {};

  // Default: all managed services are isolated, unmanaged are shared
  for (const service of config.services) {
    map[service.name] = service.managed === false ? 'share' : 'isolate';
  }

  // Apply profile if specified
  if (options.profile && config.profiles?.[options.profile]) {
    const profile = config.profiles[options.profile];
    for (const name of profile.isolate) {
      if (name in map) map[name] = 'isolate';
    }
    for (const name of profile.share) {
      if (name in map) map[name] = 'share';
    }
  }

  // Explicit flags override profile
  if (options.isolate) {
    for (const name of options.isolate) {
      if (name in map) map[name] = 'isolate';
    }
  }
  if (options.share) {
    for (const name of options.share) {
      if (name in map) map[name] = 'share';
    }
  }

  return map;
}
