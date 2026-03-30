import type { SecretLoader } from '../types.js';

export class DotEnvLoader implements SecretLoader {
  readonly dotenvPath: string;

  constructor(dotenvPath: string) {
    this.dotenvPath = dotenvPath;
  }

  get(key: string): string | null {
    void key;
    throw new Error('Not implemented');
  }

  getMany(keys: readonly string[]): Record<string, string | null> {
    void keys;
    throw new Error('Not implemented');
  }
}
