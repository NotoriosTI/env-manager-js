import type { EnvironmentConfig } from './types.js';

export function parseEnvironments(
  config: Record<string, unknown>,
): Record<string, EnvironmentConfig> {
  void config;
  throw new Error('Not implemented');
}
