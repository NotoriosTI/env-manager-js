import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as factory from '../src/factory.js';
import { ConfigManager, getConfig, initConfig, requireConfig } from '../src/manager.js';
import { writeRepoConfig } from './helpers.js';

const repoRoots: string[] = [];

function createRepoRoot(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'env-manager-e2e-'));
  repoRoots.push(repoRoot);
  return repoRoot;
}

function createFakeLoader(values: Record<string, string | null>) {
  return {
    get: vi.fn((key: string) => Promise.resolve(values[key] ?? null)),
    getMany: vi.fn((keys: string[]) =>
      Promise.resolve(Object.fromEntries(keys.map((key) => [key, values[key] ?? null]))),
    ),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();

  while (repoRoots.length > 0) {
    rmSync(repoRoots.pop()!, { force: true, recursive: true });
  }
});

describe('end-to-end', () => {
  it.skip('production-like flow with real GCP', () => {
    // Requires real GCP credentials and RUN_REAL_GCP_TESTS=1.
    // Coverage is intentionally deferred in the JS port the same way the Python test is skipped.
    expect([ConfigManager, initConfig, getConfig, requireConfig]).toBeDefined();
  });

  it('loads mixed sources in one eager pass', async () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        staging:
          origin: local
          dotenv_path: .env.staging
          default: true
        production:
          origin: local
          dotenv_path: .env.production
        override:
          origin: local
          dotenv_path: .env.override
        gcp_env:
          origin: gcp
          gcp_project_id: test-project
      variables:
        DEFAULT_TOKEN:
          source: DEFAULT_TOKEN
          type: str
        OVERRIDE_TOKEN:
          source: OVERRIDE_TOKEN
          type: str
          dotenv_path: .env.override
        PINNED_SECRET:
          source: PINNED_SECRET
          type: str
          environment: production
        GCP_SECRET:
          source: GCP_SECRET
          type: str
          environment: gcp_env
          origin: gcp
      `,
    );

    writeFileSync(join(repoRoot, '.env.staging'), 'DEFAULT_TOKEN=staging-value\n', 'utf8');
    writeFileSync(join(repoRoot, '.env.production'), 'PINNED_SECRET=prod-value\n', 'utf8');
    writeFileSync(join(repoRoot, '.env.override'), 'OVERRIDE_TOKEN=override-value\n', 'utf8');

    const fakeLoader = createFakeLoader({ GCP_SECRET: 'gcp-value' });
    vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);
    vi.stubEnv('APP_ENV', 'staging');

    const manager = new ConfigManager(configPath);
    await manager.load();

    expect(manager.get('DEFAULT_TOKEN')).toBe('staging-value');
    expect(manager.get('OVERRIDE_TOKEN')).toBe('override-value');
    expect(manager.get('PINNED_SECRET')).toBe('prod-value');
    expect(manager.get('GCP_SECRET')).toBe('gcp-value');
  });
});
