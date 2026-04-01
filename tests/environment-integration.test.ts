import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as factory from '../src/factory.js';
import { ConfigManager, getConfig, initConfig, requireConfig } from '../src/manager.js';
import {
  DOTENVX_PRIVATE_KEY,
  buildEncryptedEnvText,
  writeConfig,
  writeEnv,
  writeRepoConfig,
  writeText,
} from './helpers.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'env-manager-environment-'));
}

function cleanupTempDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('TestEnvironmentSelection', () => {
  it('APP_ENV selects staging environment', () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeRepoConfig(
        repoRoot,
        `
        environments:
          development:
            origin: local
            dotenv_path: .env.dev
            default: true
          staging:
            origin: gcp
            gcp_project_id: staging-project
        variables:
          db_password:
            required: true
        `,
      );
      vi.stubEnv('APP_ENV', 'staging');

      const manager = new ConfigManager(configPath);

      expect(manager.activeEnvironment?.origin).toBe('gcp');
      expect(manager.activeEnvironment?.gcpProjectId).toBe('staging-project');
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('unset APP_ENV falls back to default environment', () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeRepoConfig(
        repoRoot,
        `
        environments:
          development:
            origin: local
            dotenv_path: .env.dev
            default: true
          staging:
            origin: gcp
            gcp_project_id: staging-project
        `,
      );

      const manager = new ConfigManager(configPath);

      expect(manager.activeEnvironment?.origin).toBe('local');
      expect(manager.activeEnvironment?.dotenvPath).toBe('.env.dev');
      expect(manager.activeEnvironment?.isDefault).toBe(true);
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('unknown APP_ENV throws with available environments', () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeRepoConfig(
        repoRoot,
        `
        environments:
          development:
            origin: local
            default: true
          staging:
            origin: gcp
            gcp_project_id: staging-project
        `,
      );
      vi.stubEnv('APP_ENV', 'qa');

      expect(() => new ConfigManager(configPath)).toThrow(
        "Unknown environment 'qa'. Available environments: development, staging",
      );
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('environment origin used for secret_origin', async () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeRepoConfig(
        repoRoot,
        `
        environments:
          staging:
            origin: gcp
            gcp_project_id: staging-project
            default: true
        variables:
          api_key:
            source: api_key
            required: true
        `,
      );
      const fakeLoader = {
        get: vi.fn().mockResolvedValue('staging-secret'),
        getMany: vi.fn().mockResolvedValue({ api_key: 'staging-secret' }),
      };
      vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);

      const manager = new ConfigManager(configPath);
      await manager.load();

      expect(factory.createLoader).toHaveBeenCalledWith(
        expect.objectContaining({
          secretOrigin: 'gcp',
        }),
      );
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('environment gcp_project_id propagated', async () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeRepoConfig(
        repoRoot,
        `
        environments:
          staging:
            origin: gcp
            gcp_project_id: staging-project
            default: true
        variables:
          api_key:
            source: api_key
            required: true
        `,
      );
      const fakeLoader = {
        get: vi.fn().mockResolvedValue('staging-secret'),
        getMany: vi.fn().mockResolvedValue({ api_key: 'staging-secret' }),
      };
      vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);

      const manager = new ConfigManager(configPath);
      await manager.load();

      expect(factory.createLoader).toHaveBeenCalledWith(
        expect.objectContaining({
          gcpProjectId: 'staging-project',
        }),
      );
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('variable environment pin uses pinned context', async () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeRepoConfig(
        repoRoot,
        `
        environments:
          development:
            origin: local
            dotenv_path: .env.dev
            default: true
          production:
            origin: gcp
            gcp_project_id: prod-project
        variables:
          payment_token:
            source: payment_token
            required: true
            environment: production
        `,
      );
      const fakeLoader = {
        get: vi.fn().mockResolvedValue('payment-token'),
        getMany: vi.fn().mockResolvedValue({ payment_token: 'payment-token' }),
      };
      vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);

      const manager = new ConfigManager(configPath);
      await manager.load();

      expect(factory.createLoader).toHaveBeenCalledWith(
        expect.objectContaining({
          secretOrigin: 'gcp',
          gcpProjectId: 'prod-project',
        }),
      );
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('variable origin override replaces only origin on pinned environment', async () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeRepoConfig(
        repoRoot,
        `
        environments:
          production:
            origin: gcp
            gcp_project_id: prod-project
            default: true
        variables:
          payment_token:
            source: PAYMENT_TOKEN
            required: true
            environment: production
            secret_origin: gcp
        `,
      );
      const fakeLoader = {
        get: vi.fn().mockResolvedValue('payment-token'),
        getMany: vi.fn().mockResolvedValue({ PAYMENT_TOKEN: 'payment-token' }),
      };
      vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);

      const manager = new ConfigManager(configPath);
      await manager.load();

      expect(factory.createLoader).toHaveBeenCalledWith(
        expect.objectContaining({
          secretOrigin: 'gcp',
          gcpProjectId: 'prod-project',
        }),
      );
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('manager-driven GCP selection resolves async loader results before returning required values', async () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeRepoConfig(
        repoRoot,
        `
        environments:
          development:
            origin: local
            dotenv_path: .env.dev
            default: true
          production:
            origin: gcp
            gcp_project_id: prod-project
        variables:
          payment_token:
            source: PAYMENT_TOKEN
            type: str
            required: true
            environment: production
            secret_origin: gcp
        `,
      );
      const fakeLoader = {
        get: vi.fn(async () => 'payment-token'),
        getMany: vi.fn(async () => ({ PAYMENT_TOKEN: 'payment-token' })),
      };
      vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);
      vi.stubEnv('APP_ENV', 'development');

      const manager = new ConfigManager(configPath);
      await manager.load();

      expect(manager.get('payment_token')).toBe('payment-token');
      expect(process.env.PAYMENT_TOKEN).toBe('payment-token');
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('rejects unknown environment in variable override', () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeRepoConfig(
        repoRoot,
        `
        environments:
          development:
            origin: local
            default: true
        variables:
          payment_token:
            required: true
            environment: production
        `,
      );

      expect(() => new ConfigManager(configPath)).toThrow(
        "Unknown environment 'production' referenced by variable 'payment_token'",
      );
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('rejects invalid origin in variable override', () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeRepoConfig(
        repoRoot,
        `
        environments:
          development:
            origin: local
            default: true
        variables:
          payment_token:
            required: true
            secret_origin: vault
        `,
      );

      expect(() => new ConfigManager(configPath)).toThrow(
        "Invalid secret_origin 'vault' for variable 'payment_token'. Must be 'local' or 'gcp'",
      );
    } finally {
      cleanupTempDir(repoRoot);
    }
  });
});

describe('TestNoDefaultEnvironment', () => {
  it('no default + no APP_ENV returns null active environment', () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeRepoConfig(
        repoRoot,
        `
        environments:
          development:
            origin: local
          production:
            origin: gcp
            gcp_project_id: prod-project
        `,
      );

      const manager = new ConfigManager(configPath);

      expect(manager.activeEnvironment).toBeNull();
    } finally {
      cleanupTempDir(repoRoot);
    }
  });
});

describe('TestBackwardsCompatibility', () => {
  it('old format loads from dotenv', async () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeConfig(
        repoRoot,
        `
        variables:
          db_password:
            source: DB_PASSWORD
            required: true
        `,
      );
      writeEnv(repoRoot, 'DB_PASSWORD=dotenv-secret\n');

      const manager = new ConfigManager(configPath);
      await manager.load();

      expect(manager.get('db_password')).toBe('dotenv-secret');
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('old format: process.env beats dotenv', async () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeConfig(
        repoRoot,
        `
        variables:
          db_password:
            source: DB_PASSWORD
            required: true
        `,
      );
      writeEnv(repoRoot, 'DB_PASSWORD=dotenv-secret\n');
      vi.stubEnv('DB_PASSWORD', 'process-secret');

      const manager = new ConfigManager(configPath);
      await manager.load();

      expect(manager.get('db_password')).toBe('process-secret');
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('old format: YAML default is fallback', async () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeConfig(
        repoRoot,
        `
        variables:
          db_password:
            required: true
            default: yaml-default
        `,
      );

      const manager = new ConfigManager(configPath);
      await manager.load();

      expect(manager.get('db_password')).toBe('yaml-default');
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('old format: required missing throws', async () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeConfig(
        repoRoot,
        `
        variables:
          db_password:
            source: DB_PASSWORD
            required: true
        `,
      );
      // Write an empty dotenv so the loader does not throw "file not found"
      writeEnv(repoRoot, '');

      const manager = new ConfigManager(configPath);
      await expect(manager.load()).rejects.toMatchObject({
        name: 'ConfigValidationError',
        issues: [
          {
            variableName: 'db_password',
            issueType: 'missing',
            sourceKey: 'DB_PASSWORD',
            message: "Required variable 'db_password' not found in source",
          },
        ],
      });
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('old format: optional missing warns', async () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeConfig(
        repoRoot,
        `
        variables:
          optional_value:
            required: false
        `,
      );
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const manager = new ConfigManager(configPath);
      await manager.load();

      expect(manager.get('optional_value')).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        "Optional variable 'optional_value' is not set",
      );
    } finally {
      cleanupTempDir(repoRoot);
    }
  });
});

describe('TestEncryptedDotenvEnvironments', () => {
  it('encrypted dotenv activation is per-environment and decrypts when enabled', async () => {
    const repoRoot = createTempDir();
    try {
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
            dotenv_path: .env.production
            encrypted_dotenv:
              enabled: true
        variables:
          hello_secret:
            source: HELLO
            type: str
            required: true
        `,
      );
      writeText(join(repoRoot, '.env.dev'), 'HELLO=dev-plain\n');
      writeText(join(repoRoot, '.env.production'), buildEncryptedEnvText());
      vi.stubEnv('APP_ENV', 'production');
      vi.stubEnv('DOTENV_PRIVATE_KEY', DOTENVX_PRIVATE_KEY);

      const manager = new ConfigManager(configPath);
      await manager.load();

      expect(manager.get('hello_secret')).toBe('Hello');
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('plaintext environments keep current dotenv behavior when encrypted dotenv support is unused', async () => {
    const repoRoot = createTempDir();
    try {
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
            dotenv_path: .env.production
            encrypted_dotenv:
              enabled: true
        variables:
          hello_secret:
            source: HELLO
            type: str
            required: true
        `,
      );
      writeText(join(repoRoot, '.env.dev'), 'HELLO=dev-plain\n');
      writeText(join(repoRoot, '.env.production'), buildEncryptedEnvText());
      vi.stubEnv('APP_ENV', 'development');

      const manager = new ConfigManager(configPath);
      await manager.load();

      expect(manager.get('hello_secret')).toBe('dev-plain');
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('encrypted dotenv private key can come from a dedicated local dotenv source before the fallback private key chain', async () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeRepoConfig(
        repoRoot,
        `
        environments:
          production:
            origin: local
            dotenv_path: .env.production
            default: true
            encrypted_dotenv:
              enabled: true
              private_key:
                source: CUSTOM_PRIVATE_KEY
                secret_origin: local
                dotenv_path: .env.production.keys
        variables:
          hello_secret:
            source: HELLO
            type: str
            required: true
        `,
      );
      writeText(join(repoRoot, '.env.production'), buildEncryptedEnvText());
      writeText(
        join(repoRoot, '.env.production.keys'),
        `CUSTOM_PRIVATE_KEY=${DOTENVX_PRIVATE_KEY}\n`,
      );
      vi.stubEnv('DOTENV_PRIVATE_KEY', 'deadbeef');

      const manager = new ConfigManager(configPath);
      await manager.load();

      expect(manager.get('hello_secret')).toBe('Hello');
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('encrypted dotenv private key can come from a dedicated gcp source before the fallback private key chain', async () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeRepoConfig(
        repoRoot,
        `
        environments:
          production:
            origin: local
            dotenv_path: .env.production
            default: true
            encrypted_dotenv:
              enabled: true
              private_key:
                source: ENCRYPTION_PRIVATE_KEY
                secret_origin: gcp
                gcp_project_id: encryption-project
        variables:
          hello_secret:
            source: HELLO
            type: str
            required: true
        `,
      );
      writeText(join(repoRoot, '.env.production'), buildEncryptedEnvText());
      const gcpLoader = {
        get: vi.fn().mockResolvedValue(DOTENVX_PRIVATE_KEY),
        getMany: vi.fn().mockResolvedValue({
          ENCRYPTION_PRIVATE_KEY: DOTENVX_PRIVATE_KEY,
        }),
      };
      vi.spyOn(factory, 'createLoader').mockReturnValue(gcpLoader as never);

      const manager = new ConfigManager(configPath);
      await manager.load();

      expect(factory.createLoader).toHaveBeenCalledWith(
        expect.objectContaining({
          secretOrigin: 'gcp',
          gcpProjectId: 'encryption-project',
        }),
      );
      expect(manager.get('hello_secret')).toBe('Hello');
    } finally {
      cleanupTempDir(repoRoot);
    }
  });
});

describe('TestParamOverrides', () => {
  it('secret_origin param overrides env config', async () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeRepoConfig(
        repoRoot,
        `
        environments:
          staging:
            origin: local
            gcp_project_id: staging-project
            default: true
        variables:
          api_key:
            source: api_key
            required: true
        `,
      );
      const fakeLoader = {
        get: vi.fn().mockResolvedValue('override-secret'),
        getMany: vi.fn().mockResolvedValue({ api_key: 'override-secret' }),
      };
      vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);

      const manager = new ConfigManager(configPath, { secretOrigin: 'gcp', gcpProjectId: 'override-project' });
      await manager.load();

      expect(factory.createLoader).toHaveBeenCalledWith(
        expect.objectContaining({
          secretOrigin: 'gcp',
          gcpProjectId: 'override-project',
        }),
      );
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('gcp_project_id param overrides env config', async () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeRepoConfig(
        repoRoot,
        `
        environments:
          staging:
            origin: gcp
            gcp_project_id: staging-project
            default: true
        variables:
          api_key:
            source: api_key
            required: true
        `,
      );
      const fakeLoader = {
        get: vi.fn().mockResolvedValue('override-secret'),
        getMany: vi.fn().mockResolvedValue({ api_key: 'override-secret' }),
      };
      vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);

      const manager = new ConfigManager(configPath, { gcpProjectId: 'override-project' });
      await manager.load();

      expect(factory.createLoader).toHaveBeenCalledWith(
        expect.objectContaining({
          gcpProjectId: 'override-project',
        }),
      );
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('dotenv_path param overrides env config', async () => {
    const repoRoot = createTempDir();
    try {
      const overrideDotenvPath = join(repoRoot, '.env.override');
      writeEnv(repoRoot, 'api_key=dev-value\n');
      // Write an override dotenv at a different path
      const { writeFileSync } = await import('fs');
      writeFileSync(overrideDotenvPath, 'api_key=override-value\n', 'utf8');

      const configPath = writeRepoConfig(
        repoRoot,
        `
        environments:
          development:
            origin: local
            dotenv_path: .env
            default: true
        variables:
          api_key:
            source: api_key
            type: str
        `,
      );

      const manager = new ConfigManager(configPath, { dotenvPath: overrideDotenvPath });
      await manager.load();

      expect(manager.get('api_key')).toBe('override-value');
    } finally {
      cleanupTempDir(repoRoot);
    }
  });
});

describe('TestSingletonWithEnvironments', () => {
  it('initConfig works with environment YAML', async () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeRepoConfig(
        repoRoot,
        `
        environments:
          development:
            origin: local
            default: true
        variables:
          api_key:
            required: false
            default: default-key
        `,
      );

      await initConfig(configPath);

      expect(getConfig()).toBeDefined();
      expect(requireConfig()).toBeDefined();
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('initConfig signature accepts all params', async () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeRepoConfig(
        repoRoot,
        `
        environments:
          staging:
            origin: gcp
            gcp_project_id: staging-project
            default: true
        `,
      );

      await expect(
        initConfig(configPath, {
          secretOrigin: 'local',
          gcpProjectId: 'override-project',
          dotenvPath: '.env.override',
        }),
      ).resolves.not.toThrow();
    } finally {
      cleanupTempDir(repoRoot);
    }
  });
});
