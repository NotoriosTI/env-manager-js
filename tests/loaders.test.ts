import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DotEnvLoader } from '../src/loaders/dotenv.js';
import { GCPSecretLoader } from '../src/loaders/gcp.js';
import { writeEnv } from './helpers.js';

const mockClient = {
  accessSecretVersion: vi.fn(),
};

type SecretManagerClientLike = typeof mockClient;
type GCPSecretLoaderCtor = new (
  gcpProjectId: string,
  options?: { createClient?: () => SecretManagerClientLike },
) => GCPSecretLoader;

function createGcpLoader(
  gcpProjectId: string,
  createClient: () => SecretManagerClientLike = () => mockClient,
): GCPSecretLoader {
  const TestableGCPSecretLoader = GCPSecretLoader as unknown as GCPSecretLoaderCtor;
  return new TestableGCPSecretLoader(gcpProjectId, { createClient });
}

describe('DotEnvLoader', () => {
  const originalDbPassword = process.env.DB_PASSWORD;

  beforeEach(() => {
    delete process.env.DB_PASSWORD;
  });

  afterEach(() => {
    if (originalDbPassword === undefined) {
      delete process.env.DB_PASSWORD;
      return;
    }

    process.env.DB_PASSWORD = originalDbPassword;
  });

  it('reads KEY=VALUE from .env file', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEnv(tmpDir, 'DB_PASSWORD=secret123\n');

    const loader = new DotEnvLoader(envPath);

    expect(loader.get('DB_PASSWORD')).toBe('secret123');
  });

  it('returns null for missing keys', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEnv(tmpDir, 'DB_PASSWORD=secret123\n');

    const loader = new DotEnvLoader(envPath);

    expect(loader.get('NONEXISTENT')).toBeNull();
  });

  it('process.env overrides .env file value', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEnv(tmpDir, 'DB_PASSWORD=secret123\n');
    process.env.DB_PASSWORD = 'from_env';

    const loader = new DotEnvLoader(envPath);

    expect(loader.get('DB_PASSWORD')).toBe('from_env');
  });

  it('getMany returns map with present and missing keys', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEnv(tmpDir, 'DB_PASSWORD=secret123\n');

    const loader = new DotEnvLoader(envPath);

    expect(loader.getMany(['DB_PASSWORD', 'NONEXISTENT'])).toEqual({
      DB_PASSWORD: 'secret123',
      NONEXISTENT: null,
    });
  });
});

// Captured at module load time — beforeEach in setup.ts deletes GCP_PROJECT_ID
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID ?? 'my-project';

describe('GCPSecretLoader', () => {
  beforeEach(() => {
    mockClient.accessSecretVersion.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches secret and caches result', async () => {
    mockClient.accessSecretVersion.mockResolvedValue([
      { payload: { data: Buffer.from('top-secret') } },
    ]);
    const loader = createGcpLoader(GCP_PROJECT_ID);

    const val1 = await loader.get('API_KEY');
    const val2 = await loader.get('API_KEY');

    expect(val1).toBe('top-secret');
    expect(val2).toBe('top-secret');
    expect(mockClient.accessSecretVersion).toHaveBeenCalledTimes(1);
  });

  it('returns null and warns for NotFound secret', async () => {
    mockClient.accessSecretVersion.mockRejectedValueOnce(
      Object.assign(new Error('not found'), { code: 5 }),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = createGcpLoader(GCP_PROJECT_ID);

    const val = await loader.get('MISSING_KEY');

    expect(val).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Secret 'MISSING_KEY' not found"),
    );
  });
});
