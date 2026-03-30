import type { ConfigManagerOptions, EnvironmentConfig } from './types.js';

let singleton: ConfigManager | null = null;

export class ConfigManager {
  readonly activeEnvironment: EnvironmentConfig | null = null;

  constructor(configPath: string, options?: ConfigManagerOptions) {
    void configPath;
    void options;
    throw new Error('Not implemented');
  }

  get(name: string): unknown | null {
    void name;
    throw new Error('Not implemented');
  }
}

export function initConfig(configPath: string, options?: ConfigManagerOptions): ConfigManager {
  void configPath;
  void options;
  throw new Error('Not implemented');
}

export function getConfig(name?: string): unknown | null {
  void name;
  throw new Error('Not implemented');
}

export function requireConfig(name?: string): unknown {
  void name;
  throw new Error('Not implemented');
}

export function _resetSingleton(): void {
  singleton = null;
}
