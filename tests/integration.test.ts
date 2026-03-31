/**
 * End-to-end integration tests
 *
 * These tests load variables from real fixture files and (optionally) real GCP Secret Manager.
 * No mocking — every assertion hits an actual file or network call.
 *
 * GCP tests are skipped by default. To run them:
 *
 *   RUN_REAL_GCP_TESTS=1 \
 *   GCP_PROJECT_ID=<your-project> \
 *   npm test
 *
 * NOTE: ConfigManager now resolves async loaders before returning loaded values.
 * The GCP tests below still exercise GCPSecretLoader directly, and also cover the
 * process.env pre-seed pattern because it remains a valid integration path.
 */

import { copyFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigManager as PublicConfigManager, ConfigValidationError } from '../src/index.js';
import { GCPSecretLoader } from '../src/loaders/gcp.js';
import { ConfigManager } from '../src/manager.js';
import { writeRepoConfig } from './helpers.js';

const __fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const repoRoots: string[] = [];

function createRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'env-manager-integration-'));
  repoRoots.push(root);
  return root;
}

function seedFixtures(root: string, ...names: string[]): void {
  for (const name of names) {
    copyFileSync(join(__fixturesDir, name), join(root, name));
  }
}

afterEach(() => {
  while (repoRoots.length > 0) {
    rmSync(repoRoots.pop()!, { force: true, recursive: true });
  }
});

// ─── .env.test ────────────────────────────────────────────────────────────────

describe('integration: .env.test file', () => {
  it('ConfigValidationError is exported from the public barrel for instanceof checks', async () => {
    const root = createRepoRoot();
    seedFixtures(root, '.env.test');

    const configPath = writeRepoConfig(
      root,
      `
      environments:
        test:
          origin: local
          dotenv_path: .env.test
          default: true
      variables:
        MISSING_VAR:
          source: MISSING_VAR
          type: str
          required: true
      `,
    );

    const manager = new PublicConfigManager(configPath);
    const error = await manager.load().catch((rejection: unknown) => rejection);

    expect(error).toBeInstanceOf(ConfigValidationError);
    expect(error).toMatchObject({
      name: 'ConfigValidationError',
      issues: [
        expect.objectContaining({
          variableName: 'MISSING_VAR',
          issueType: 'missing',
          sourceKey: 'MISSING_VAR',
        }),
      ],
    });
  });

  it('loads all DB variables with correct types', async () => {
    const root = createRepoRoot();
    seedFixtures(root, '.env.test');

    const configPath = writeRepoConfig(
      root,
      `
      environments:
        test:
          origin: local
          dotenv_path: .env.test
          default: true
      variables:
        DB_HOST:
          source: DB_HOST
          type: str
        DB_PORT:
          source: DB_PORT
          type: int
        DB_NAME:
          source: DB_NAME
          type: str
        DB_USER:
          source: DB_USER
          type: str
        DB_PASSWORD:
          source: DB_PASSWORD
          type: str
      `,
    );

    const manager = new ConfigManager(configPath);
    await manager.load();

    expect(manager.get('DB_HOST')).toBe('localhost');
    expect(manager.get('DB_PORT')).toBe(5432);
    expect(manager.get('DB_NAME')).toBe('app_test');
    expect(manager.get('DB_USER')).toBe('test_user');
    expect(manager.get('DB_PASSWORD')).toBe('test_password_123');
  });

  it('activeEnvironment reflects the test environment', () => {
    const root = createRepoRoot();
    seedFixtures(root, '.env.test');

    const configPath = writeRepoConfig(
      root,
      `
      environments:
        test:
          origin: local
          dotenv_path: .env.test
          default: true
      variables:
        DB_HOST:
          source: DB_HOST
          type: str
      `,
    );

    const manager = new ConfigManager(configPath);

    expect(manager.activeEnvironment?.name).toBe('test');
    expect(manager.activeEnvironment?.origin).toBe('local');
  });

  it('required variable present in .env.test does not throw', async () => {
    const root = createRepoRoot();
    seedFixtures(root, '.env.test');

    const configPath = writeRepoConfig(
      root,
      `
      environments:
        test:
          origin: local
          dotenv_path: .env.test
          default: true
      variables:
        DB_PASSWORD:
          source: DB_PASSWORD
          type: str
          required: true
      `,
    );

    const manager = new ConfigManager(configPath);
    await manager.load();

    expect(manager.get('DB_PASSWORD')).toBe('test_password_123');
  });

  it('required variable absent from .env.test throws at get() time', async () => {
    const root = createRepoRoot();
    seedFixtures(root, '.env.test');

    const configPath = writeRepoConfig(
      root,
      `
      environments:
        test:
          origin: local
          dotenv_path: .env.test
          default: true
      variables:
        MISSING_VAR:
          source: MISSING_VAR
          type: str
          required: true
      `,
    );

    const manager = new ConfigManager(configPath);
    await manager.load();

    expect(() => manager.get('MISSING_VAR')).toThrow(/Required variable 'MISSING_VAR'/);
  });
});

// ─── .env.prod ────────────────────────────────────────────────────────────────

describe('integration: .env.prod file', () => {
  it('loads all DB variables with correct types', async () => {
    const root = createRepoRoot();
    seedFixtures(root, '.env.prod');

    const configPath = writeRepoConfig(
      root,
      `
      environments:
        prod:
          origin: local
          dotenv_path: .env.prod
          default: true
      variables:
        DB_HOST:
          source: DB_HOST
          type: str
        DB_PORT:
          source: DB_PORT
          type: int
        DB_NAME:
          source: DB_NAME
          type: str
        DB_USER:
          source: DB_USER
          type: str
        DB_PASSWORD:
          source: DB_PASSWORD
          type: str
      `,
    );

    const manager = new ConfigManager(configPath);
    await manager.load();

    expect(manager.get('DB_HOST')).toBe('prod-db.internal');
    expect(manager.get('DB_PORT')).toBe(5432);
    expect(manager.get('DB_NAME')).toBe('app_prod');
    expect(manager.get('DB_USER')).toBe('prod_user');
    expect(manager.get('DB_PASSWORD')).toBe('prod_password_xyz');
  });

  it('strict mode throws on a variable missing from .env.prod', async () => {
    const root = createRepoRoot();
    seedFixtures(root, '.env.prod');

    const configPath = writeRepoConfig(
      root,
      `
      environments:
        prod:
          origin: local
          dotenv_path: .env.prod
          default: true
      variables:
        NONEXISTENT:
          source: NONEXISTENT
          type: str
      `,
    );

    const manager = new ConfigManager(configPath, { strict: true });
    await manager.load();

    expect(() => manager.get('NONEXISTENT')).toThrow(/Strict mode/);
  });

  it('default value is used when variable is absent and not required', async () => {
    const root = createRepoRoot();
    seedFixtures(root, '.env.prod');

    const configPath = writeRepoConfig(
      root,
      `
      environments:
        prod:
          origin: local
          dotenv_path: .env.prod
          default: true
      variables:
        DB_POOL_SIZE:
          source: DB_POOL_SIZE
          type: int
          default: 10
      `,
    );

    const manager = new ConfigManager(configPath);
    await manager.load();

    expect(manager.get('DB_POOL_SIZE')).toBe(10);
  });
});

// ─── Multi-environment switching ──────────────────────────────────────────────

describe('integration: multi-environment switching between .env.test and .env.prod', () => {
  it('selects .env.test values when APP_ENV=test', async () => {
    const root = createRepoRoot();
    seedFixtures(root, '.env.test', '.env.prod');

    const configPath = writeRepoConfig(
      root,
      `
      environments:
        test:
          origin: local
          dotenv_path: .env.test
        prod:
          origin: local
          dotenv_path: .env.prod
          default: true
      variables:
        DB_HOST:
          source: DB_HOST
          type: str
        DB_NAME:
          source: DB_NAME
          type: str
        DB_USER:
          source: DB_USER
          type: str
        DB_PORT:
          source: DB_PORT
          type: int
      `,
    );

    vi.stubEnv('APP_ENV', 'test');
    const manager = new ConfigManager(configPath);
    await manager.load();

    expect(manager.activeEnvironment?.name).toBe('test');
    expect(manager.get('DB_HOST')).toBe('localhost');
    expect(manager.get('DB_NAME')).toBe('app_test');
    expect(manager.get('DB_USER')).toBe('test_user');
    expect(manager.get('DB_PORT')).toBe(5432);
  });

  it('selects .env.prod values when APP_ENV=prod', async () => {
    const root = createRepoRoot();
    seedFixtures(root, '.env.test', '.env.prod');

    const configPath = writeRepoConfig(
      root,
      `
      environments:
        test:
          origin: local
          dotenv_path: .env.test
        prod:
          origin: local
          dotenv_path: .env.prod
          default: true
      variables:
        DB_HOST:
          source: DB_HOST
          type: str
        DB_NAME:
          source: DB_NAME
          type: str
        DB_USER:
          source: DB_USER
          type: str
        DB_PORT:
          source: DB_PORT
          type: int
      `,
    );

    vi.stubEnv('APP_ENV', 'prod');
    const manager = new ConfigManager(configPath);
    await manager.load();

    expect(manager.activeEnvironment?.name).toBe('prod');
    expect(manager.get('DB_HOST')).toBe('prod-db.internal');
    expect(manager.get('DB_NAME')).toBe('app_prod');
    expect(manager.get('DB_USER')).toBe('prod_user');
    expect(manager.get('DB_PORT')).toBe(5432);
  });

  it('defaults to .env.prod when APP_ENV is not set', async () => {
    const root = createRepoRoot();
    seedFixtures(root, '.env.test', '.env.prod');

    const configPath = writeRepoConfig(
      root,
      `
      environments:
        test:
          origin: local
          dotenv_path: .env.test
        prod:
          origin: local
          dotenv_path: .env.prod
          default: true
      variables:
        DB_HOST:
          source: DB_HOST
          type: str
      `,
    );

    const manager = new ConfigManager(configPath);
    await manager.load();

    expect(manager.activeEnvironment?.name).toBe('prod');
    expect(manager.get('DB_HOST')).toBe('prod-db.internal');
  });

  it('per-variable environment pin reads from pinned env regardless of APP_ENV', async () => {
    const root = createRepoRoot();
    seedFixtures(root, '.env.test', '.env.prod');

    const configPath = writeRepoConfig(
      root,
      `
      environments:
        test:
          origin: local
          dotenv_path: .env.test
          default: true
        prod:
          origin: local
          dotenv_path: .env.prod
      variables:
        DB_HOST:
          source: DB_HOST
          type: str
        PROD_DB_NAME:
          source: DB_NAME
          type: str
          environment: prod
      `,
    );

    vi.stubEnv('APP_ENV', 'test');
    const manager = new ConfigManager(configPath);
    await manager.load();

    // Active env is test → DB_HOST from .env.test
    expect(manager.get('DB_HOST')).toBe('localhost');
    // PROD_DB_NAME pinned to prod environment → reads from .env.prod
    expect(manager.get('PROD_DB_NAME')).toBe('app_prod');
  });

  it('process.env override wins over .env file values', async () => {
    const root = createRepoRoot();
    seedFixtures(root, '.env.test');

    const configPath = writeRepoConfig(
      root,
      `
      environments:
        test:
          origin: local
          dotenv_path: .env.test
          default: true
      variables:
        DB_HOST:
          source: DB_HOST
          type: str
      `,
    );

    vi.stubEnv('APP_ENV', 'test');
    vi.stubEnv('DB_HOST', 'injected-host');
    const manager = new ConfigManager(configPath);
    await manager.load();

    expect(manager.get('DB_HOST')).toBe('injected-host');
  });
});

// ─── GCP Secret Manager ───────────────────────────────────────────────────────

const RUN_GCP = process.env.RUN_REAL_GCP_TESTS === '1';
const GCP_PROJECT = process.env.GCP_PROJECT_ID ?? '';
const skipGcp = !RUN_GCP || !GCP_PROJECT;

const GCP_SECRETS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'] as const;

describe('integration: real GCP Secret Manager', () => {
  it.skipIf(skipGcp)(
    'GCPSecretLoader.get() returns a non-empty string for each DB secret',
    async () => {
      const loader = new GCPSecretLoader(GCP_PROJECT);

      for (const secret of GCP_SECRETS) {
        const value = await loader.get(secret);
        expect(value, `secret '${secret}' should exist`).not.toBeNull();
        expect(typeof value, `secret '${secret}' should be a string`).toBe('string');
        expect((value as string).length, `secret '${secret}' should be non-empty`).toBeGreaterThan(0);
      }
    },
    15000,
  );

  it.skipIf(skipGcp)(
    'GCPSecretLoader.getMany() fetches all DB secrets in one pass',
    async () => {
      const loader = new GCPSecretLoader(GCP_PROJECT);
      const results = await loader.getMany(GCP_SECRETS);

      for (const secret of GCP_SECRETS) {
        expect(results[secret], `secret '${secret}' should be present`).not.toBeNull();
        expect(typeof results[secret]).toBe('string');
      }
    },
    15000,
  );

  it.skipIf(skipGcp)(
    'GCPSecretLoader.get() returns null (not throws) for a non-existent secret',
    async () => {
      const loader = new GCPSecretLoader(GCP_PROJECT);
      const value = await loader.get('__env_manager_nonexistent__');

      expect(value).toBeNull();
    },
    15000,
  );

  it.skipIf(skipGcp)(
    'GCPSecretLoader caches repeated get() calls',
    async () => {
      const loader = new GCPSecretLoader(GCP_PROJECT);

      const first = await loader.get('DB_HOST');
      const second = await loader.get('DB_HOST');

      expect(first).toBe(second);
    },
    15000,
  );

  it.skipIf(skipGcp)(
    'DB_PORT secret value coerces to integer',
    async () => {
      const loader = new GCPSecretLoader(GCP_PROJECT);
      const raw = await loader.get('DB_PORT');

      expect(raw).not.toBeNull();
      const asInt = parseInt(raw as string, 10);
      expect(Number.isInteger(asInt)).toBe(true);
      expect(asInt).toBeGreaterThan(0);
    },
    15000,
  );

  it.skipIf(skipGcp)(
    'ConfigManager reads GCP secrets pre-seeded into process.env with correct types',
    async () => {
      // Pre-fetch with GCPSecretLoader, seed process.env, then let ConfigManager
      // consume those values through its highest-priority source.
      const loader = new GCPSecretLoader(GCP_PROJECT);
      const gcpValues = await loader.getMany(GCP_SECRETS);

      for (const secret of GCP_SECRETS) {
        if (gcpValues[secret] != null) {
          vi.stubEnv(secret, gcpValues[secret] as string);
        }
      }

      const root = createRepoRoot();
      const configPath = writeRepoConfig(
        root,
        `
        environments:
          prod:
            origin: gcp
            gcp_project_id: ${GCP_PROJECT}
            default: true
        variables:
          DB_HOST:
            source: DB_HOST
            type: str
          DB_PORT:
            source: DB_PORT
            type: int
          DB_NAME:
            source: DB_NAME
            type: str
          DB_USER:
            source: DB_USER
            type: str
          DB_PASSWORD:
            source: DB_PASSWORD
            type: str
        `,
      );

      const manager = new ConfigManager(configPath);
      await manager.load();

      // All values sourced from process.env (pre-seeded from GCP above)
      expect(manager.get('DB_HOST')).toBe(gcpValues['DB_HOST']);
      expect(manager.get('DB_PORT')).toBe(parseInt(gcpValues['DB_PORT'] as string, 10));
      expect(manager.get('DB_NAME')).toBe(gcpValues['DB_NAME']);
      expect(manager.get('DB_USER')).toBe(gcpValues['DB_USER']);
      expect(manager.get('DB_PASSWORD')).toBe(gcpValues['DB_PASSWORD']);
    },
    15000,
  );
});
