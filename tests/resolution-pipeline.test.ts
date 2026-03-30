import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { isAbsolute, join } from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as factory from '../src/factory.js';
import { ConfigManager } from '../src/manager.js';
import { writeRepoConfig } from './helpers.js';

const tempDirs: string[] = [];

function createRepoRoot(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'env-manager-resolution-'));
  tempDirs.push(repoRoot);
  return repoRoot;
}

function createFakeLoader(values: Record<string, string | null>) {
  const fakeLoader = {
    get: vi.fn((key: string) => values[key] ?? null),
    getMany: vi.fn((keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, values[key] ?? null])),
    ),
  };

  return fakeLoader;
}

function writeText(path: string, content: string): string {
  writeFileSync(path, content, 'utf8');
  return path;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();

  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
});

describe('resolution pipeline', () => {
  it('process.env beats active environment dotenv', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        staging:
          origin: local
          dotenv_path: .env.staging
          default: true
      variables:
        API_TOKEN:
          source: API_TOKEN
          type: str
      `,
    );
    writeText(join(repoRoot, '.env'), 'API_TOKEN=from-dotenv\n');
    writeText(join(repoRoot, '.env.staging'), 'API_TOKEN=from-staging-dotenv\n');
    vi.stubEnv('APP_ENV', 'staging');
    vi.stubEnv('API_TOKEN', 'from-process-env');

    const manager = new ConfigManager(configPath);

    expect(manager.get('API_TOKEN')).toBe('from-process-env');
  });

  it('active environment dotenv used when process.env missing', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        staging:
          origin: local
          dotenv_path: .env.staging
          default: true
      variables:
        API_TOKEN:
          source: API_TOKEN
          type: str
      `,
    );
    writeText(join(repoRoot, '.env.staging'), 'API_TOKEN=from-staging-dotenv\n');
    vi.stubEnv('APP_ENV', 'staging');

    const manager = new ConfigManager(configPath);

    expect(manager.get('API_TOKEN')).toBe('from-staging-dotenv');
  });

  it('YAML default is fallback after process.env and dotenv', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        staging:
          origin: local
          dotenv_path: .env.staging
          default: true
      variables:
        DEFAULT_TOKEN:
          source: DEFAULT_TOKEN
          type: str
          default: fallback-token
      `,
    );
    writeText(join(repoRoot, '.env.staging'), '');
    vi.stubEnv('APP_ENV', 'staging');

    const manager = new ConfigManager(configPath);

    expect(manager.get('DEFAULT_TOKEN')).toBe('fallback-token');
  });

  it('per-variable origin:gcp override uses GCP loader', () => {
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
          origin: gcp
          gcp_project_id: app-prod
      variables:
        GCP_SECRET:
          source: GCP_SECRET
          type: str
          environment: production
          origin: gcp
      `,
    );
    writeText(join(repoRoot, '.env.staging'), 'GCP_SECRET=from-local-dotenv\n');
    const fakeLoader = createFakeLoader({ GCP_SECRET: 'from-gcp-loader' });
    vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);
    vi.stubEnv('APP_ENV', 'staging');

    const manager = new ConfigManager(configPath);

    expect(manager.get('GCP_SECRET')).toBe('from-gcp-loader');
    expect(factory.createLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        secretOrigin: 'gcp',
        gcpProjectId: 'app-prod',
      }),
    );
  });

  it('process.env beats pinned environment lookup', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        development:
          origin: local
          dotenv_path: .env.dev
          default: true
        production:
          origin: local
          dotenv_path: .env.prod
      variables:
        PINNED_SECRET:
          source: PINNED_SECRET
          type: str
          environment: production
      `,
    );
    writeText(join(repoRoot, '.env.dev'), 'PINNED_SECRET=from-dev\n');
    writeText(join(repoRoot, '.env.prod'), 'PINNED_SECRET=from-prod-dotenv\n');
    vi.stubEnv('APP_ENV', 'development');
    vi.stubEnv('PINNED_SECRET', 'from-process-env');

    const manager = new ConfigManager(configPath);

    expect(manager.get('PINNED_SECRET')).toBe('from-process-env');
  });

  it('variables without overrides keep active environment behavior', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        development:
          origin: local
          dotenv_path: .env.dev
          default: true
        production:
          origin: local
          dotenv_path: .env.prod
      variables:
        SHARED_TOKEN:
          source: SHARED_TOKEN
          type: str
      `,
    );
    writeText(join(repoRoot, '.env.dev'), 'SHARED_TOKEN=from-dev-dotenv\n');
    writeText(join(repoRoot, '.env.prod'), 'SHARED_TOKEN=from-prod-dotenv\n');
    vi.stubEnv('APP_ENV', 'development');

    const manager = new ConfigManager(configPath);

    expect(manager.get('SHARED_TOKEN')).toBe('from-dev-dotenv');
  });

  it('dotenv_path override uses project-root-relative path', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        staging:
          origin: local
          dotenv_path: .env.staging
          default: true
      variables:
        OVERRIDDEN_TOKEN:
          source: OVERRIDDEN_TOKEN
          type: str
          dotenv_path: config/.env.override
      `,
    );
    writeText(join(repoRoot, '.env.staging'), 'OVERRIDDEN_TOKEN=from-active-env\n');
    writeText(join(repoRoot, 'config/.env.override'), 'OVERRIDDEN_TOKEN=from-override-dotenv\n');
    vi.stubEnv('APP_ENV', 'staging');

    const manager = new ConfigManager(configPath);

    expect(manager.get('OVERRIDDEN_TOKEN')).toBe('from-override-dotenv');
  });

  it('absolute dotenv_path loads from that exact file', () => {
    const repoRoot = createRepoRoot();
    const absoluteDotenvPath = join(repoRoot, 'absolute.env');
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        staging:
          origin: local
          dotenv_path: .env.staging
          default: true
      variables:
        LOCAL_ONLY_TOKEN:
          source: LOCAL_ONLY_TOKEN
          type: str
          dotenv_path: ${absoluteDotenvPath}
      `,
    );
    writeText(join(repoRoot, '.env.staging'), 'LOCAL_ONLY_TOKEN=from-active-env\n');
    writeText(absoluteDotenvPath, 'LOCAL_ONLY_TOKEN=from-absolute-dotenv\n');
    vi.stubEnv('APP_ENV', 'staging');

    const manager = new ConfigManager(configPath);

    expect(isAbsolute(absoluteDotenvPath)).toBe(true);
    expect(manager.get('LOCAL_ONLY_TOKEN')).toBe('from-absolute-dotenv');
  });

  it('pinned environment uses that environments defaults', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        development:
          origin: local
          dotenv_path: .env.dev
          default: true
        production:
          origin: local
          dotenv_path: .env.prod
      variables:
        PROD_LOCAL_TOKEN:
          source: PROD_LOCAL_TOKEN
          type: str
          environment: production
      `,
    );
    writeText(join(repoRoot, '.env.dev'), 'PROD_LOCAL_TOKEN=from-dev-dotenv\n');
    writeText(join(repoRoot, '.env.prod'), 'PROD_LOCAL_TOKEN=from-prod-dotenv\n');
    vi.stubEnv('APP_ENV', 'development');

    const manager = new ConfigManager(configPath);

    expect(manager.get('PROD_LOCAL_TOKEN')).toBe('from-prod-dotenv');
  });

  it('origin:local + dotenv_path independent of active GCP environment', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        staging:
          origin: gcp
          gcp_project_id: staging-project
          default: true
      variables:
        LOCAL_ONLY_TOKEN:
          source: LOCAL_ONLY_TOKEN
          type: str
          origin: local
          dotenv_path: config/.env.local-only
      `,
    );
    writeText(join(repoRoot, 'config/.env.local-only'), 'LOCAL_ONLY_TOKEN=from-local-override\n');
    const fakeLoader = createFakeLoader({ LOCAL_ONLY_TOKEN: 'from-gcp-loader' });
    vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);
    vi.stubEnv('APP_ENV', 'staging');

    const manager = new ConfigManager(configPath);

    expect(manager.get('LOCAL_ONLY_TOKEN')).toBe('from-local-override');
  });
});
