import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as factory from '../src/factory.js';
import { ConfigManager, getConfig, initConfig, requireConfig } from '../src/manager.js';
import { writeConfig, writeEnv, writeRepoConfig } from './helpers.js';

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

  it('environment origin used for secret_origin', () => {
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
            required: true
        `,
      );
      const fakeLoader = {
        load: vi.fn().mockReturnValue('staging-secret'),
      };
      vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);

      const manager = new ConfigManager(configPath);
      manager.get('api_key');

      expect(factory.createLoader).toHaveBeenCalledWith(
        expect.objectContaining({
          secretOrigin: 'gcp',
        }),
      );
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('environment gcp_project_id propagated', () => {
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
            required: true
        `,
      );
      const fakeLoader = {
        load: vi.fn().mockReturnValue('staging-secret'),
      };
      vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);

      const manager = new ConfigManager(configPath);
      manager.get('api_key');

      expect(factory.createLoader).toHaveBeenCalledWith(
        expect.objectContaining({
          gcpProjectId: 'staging-project',
        }),
      );
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('variable environment pin uses pinned context', () => {
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
            required: true
            environment: production
        `,
      );
      const fakeLoader = {
        load: vi.fn().mockReturnValue('payment-token'),
      };
      vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);

      const manager = new ConfigManager(configPath);
      manager.get('payment_token');

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

  it('variable origin override replaces only origin on pinned environment', () => {
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
            required: true
            environment: production
            secret_origin: local
        `,
      );
      const fakeLoader = {
        load: vi.fn().mockReturnValue('payment-token'),
      };
      vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);

      const manager = new ConfigManager(configPath);
      manager.get('payment_token');

      expect(factory.createLoader).toHaveBeenCalledWith(
        expect.objectContaining({
          secretOrigin: 'local',
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

      await expect(manager.get('payment_token')).resolves.toBe('payment-token');
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
  it('old format loads from dotenv', () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeConfig(
        repoRoot,
        `
        variables:
          db_password:
            required: true
        `,
      );
      writeEnv(repoRoot, 'DB_PASSWORD=dotenv-secret\n');
      const fakeLoader = {
        load: vi.fn().mockReturnValue('dotenv-secret'),
      };
      vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);

      const manager = new ConfigManager(configPath);

      expect(manager.get('db_password')).toBe('dotenv-secret');
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('old format: process.env beats dotenv', () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeConfig(
        repoRoot,
        `
        variables:
          db_password:
            required: true
        `,
      );
      writeEnv(repoRoot, 'DB_PASSWORD=dotenv-secret\n');
      vi.stubEnv('DB_PASSWORD', 'process-secret');

      const manager = new ConfigManager(configPath);

      expect(manager.get('db_password')).toBe('process-secret');
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('old format: YAML default is fallback', () => {
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

      expect(manager.get('db_password')).toBe('yaml-default');
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('old format: required missing throws', () => {
    const repoRoot = createTempDir();
    try {
      const configPath = writeConfig(
        repoRoot,
        `
        variables:
          db_password:
            required: true
        `,
      );

      const manager = new ConfigManager(configPath);

      expect(() => manager.get('db_password')).toThrow(
        "Required variable 'db_password' is not set",
      );
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('old format: optional missing warns', () => {
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

      expect(manager.get('optional_value')).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        "Optional variable 'optional_value' is not set",
      );
    } finally {
      cleanupTempDir(repoRoot);
    }
  });
});

describe('TestParamOverrides', () => {
  it('secret_origin param overrides env config', () => {
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
            required: true
        `,
      );
      const fakeLoader = {
        load: vi.fn().mockReturnValue('override-secret'),
      };
      vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);

      const manager = new ConfigManager(configPath, { secretOrigin: 'local' });
      manager.get('api_key');

      expect(factory.createLoader).toHaveBeenCalledWith(
        expect.objectContaining({
          secretOrigin: 'local',
        }),
      );
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('gcp_project_id param overrides env config', () => {
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
            required: true
        `,
      );
      const fakeLoader = {
        load: vi.fn().mockReturnValue('override-secret'),
      };
      vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);

      const manager = new ConfigManager(configPath, { gcpProjectId: 'override-project' });
      manager.get('api_key');

      expect(factory.createLoader).toHaveBeenCalledWith(
        expect.objectContaining({
          gcpProjectId: 'override-project',
        }),
      );
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('dotenv_path param overrides env config', () => {
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
        variables:
          api_key:
            required: true
        `,
      );
      const fakeLoader = {
        load: vi.fn().mockReturnValue('override-secret'),
      };
      vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);

      const manager = new ConfigManager(configPath, { dotenvPath: '.env.override' });
      manager.get('api_key');

      expect(factory.createLoader).toHaveBeenCalledWith(
        expect.objectContaining({
          dotenvPath: '.env.override',
        }),
      );
    } finally {
      cleanupTempDir(repoRoot);
    }
  });
});

describe('TestSingletonWithEnvironments', () => {
  it('initConfig works with environment YAML', () => {
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

      initConfig(configPath);

      expect(getConfig()).toBeDefined();
      expect(requireConfig()).toBeDefined();
    } finally {
      cleanupTempDir(repoRoot);
    }
  });

  it('initConfig signature accepts all params', () => {
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

      expect(() =>
        initConfig(configPath, {
          secretOrigin: 'local',
          gcpProjectId: 'override-project',
          dotenvPath: '.env.override',
        }),
      ).not.toThrow();
    } finally {
      cleanupTempDir(repoRoot);
    }
  });
});
