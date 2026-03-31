import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DotEnvLoader } from '../src/loaders/dotenv.js';
import { GCPSecretLoader } from '../src/loaders/gcp.js';
import { writeEnv } from './helpers.js';

// vi.mock('@google-cloud/secret-manager') does not intercept the live CJS binding
// in Vitest 4 ESM projects. We inject the mock client directly onto each loader
// instance instead (see GCPSecretLoader describe block below).
const mockClient = {
  accessSecretVersion: vi.fn(),
};

type ClientShape = { client: typeof mockClient };

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
  let loader: GCPSecretLoader;

  beforeEach(() => {
    mockClient.accessSecretVersion.mockReset();
    loader = new GCPSecretLoader(GCP_PROJECT_ID);
    // Bypass the broken CJS vi.mock by injecting mockClient directly
    (loader as unknown as ClientShape).client = mockClient;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches secret and caches result', async () => {
    mockClient.accessSecretVersion.mockResolvedValue([
      { payload: { data: Buffer.from('top-secret') } },
    ]);

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

    const val = await loader.get('MISSING_KEY');

    expect(val).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Secret 'MISSING_KEY' not found"),
    );
  });
});
