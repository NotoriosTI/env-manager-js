import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

import type { SecretLoader } from '../types.js';

interface SecretVersionResponse {
  payload?: {
    data?: string | Uint8Array | Buffer | null;
  } | null;
}

export interface GCPSecretClient {
  accessSecretVersion(request: { name: string }): Promise<[SecretVersionResponse, ...unknown[]]>;
}

export interface GCPSecretLoaderOptions {
  createClient?: () => GCPSecretClient;
}

export class GCPSecretLoader implements SecretLoader {
  readonly gcpProjectId: string;
  private readonly client: GCPSecretClient;
  private readonly cache: Map<string, string | null>;

  constructor(gcpProjectId: string, options: GCPSecretLoaderOptions = {}) {
    this.gcpProjectId = gcpProjectId;
    this.client = options.createClient?.() ?? new SecretManagerServiceClient();
    this.cache = new Map();
  }

  async get(key: string): Promise<string | null> {
    if (this.cache.has(key)) {
      return this.cache.get(key) as string | null;
    }

    const name = `projects/${this.gcpProjectId}/secrets/${key}/versions/latest`;

    try {
      const [response] = await this.client.accessSecretVersion({ name });
      const value = Buffer.from(response.payload?.data ?? '').toString('utf-8');
      this.cache.set(key, value);
      return value;
    } catch (error: unknown) {
      if (
        error !== null &&
        typeof error === 'object' &&
        (error as { code?: number }).code === 5
      ) {
        console.warn(`Secret '${key}' not found in project '${this.gcpProjectId}'.`);
        this.cache.set(key, null);
        return null;
      }
      throw error;
    }
  }

  async getMany(keys: readonly string[]): Promise<Record<string, string | null>> {
    const result: Record<string, string | null> = {};
    for (const key of keys) {
      result[key] = await this.get(key);
    }
    return result;
  }
}
