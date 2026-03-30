import type { SecretLoader } from '../types.js';

export class GCPSecretLoader implements SecretLoader {
  readonly gcpProjectId: string;

  constructor(gcpProjectId: string) {
    this.gcpProjectId = gcpProjectId;
  }

  async get(key: string): Promise<string | null> {
    void key;
    throw new Error('Not implemented');
  }

  async getMany(keys: readonly string[]): Promise<Record<string, string | null>> {
    void keys;
    throw new Error('Not implemented');
  }
}
