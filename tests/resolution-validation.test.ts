import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as factory from '../src/factory.js';
import { ConfigManager } from '../src/manager.js';
import { writeRepoConfig } from './helpers.js';

const tempDirs: string[] = [];

function createRepoRoot(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'env-manager-validation-'));
  tempDirs.push(repoRoot);
  return repoRoot;
}

function writeText(path: string, content: string): string {
  writeFileSync(path, content, 'utf8');
  return path;
}

function createFakeLoader(values: Record<string, string | null>) {
  return {
    get: vi.fn((key: string) => values[key] ?? null),
    getMany: vi.fn((keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, values[key] ?? null])),
    ),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();

  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
});

describe('resolution validation', () => {
  it('required missing throws with env context and path', () => {
    const repoRoot = createRepoRoot();
    const dotenvPath = join(repoRoot, '.env');
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        default:
          origin: local
          dotenv_path: .env
          default: true
      variables:
        API_KEY:
          source: API_KEY
          type: str
          required: true
      `,
    );
    writeText(dotenvPath, '');
    vi.stubEnv('APP_ENV', 'default');

    const manager = new ConfigManager(configPath);

    expect(() => manager.get('API_KEY')).toThrow(
      `Required variable 'API_KEY' not found in source 'API_KEY' for environment 'default' using local .env '${dotenvPath}'.`,
    );
  });

  it('required with default warns "using YAML default"', () => {
    const repoRoot = createRepoRoot();
    const dotenvPath = join(repoRoot, '.env');
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        default:
          origin: local
          dotenv_path: .env
          default: true
      variables:
        API_KEY:
          source: API_KEY
          type: str
          required: true
          default: fallback-key
      `,
    );
    writeText(dotenvPath, '');
    vi.stubEnv('APP_ENV', 'default');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new ConfigManager(configPath);

    expect(manager.get('API_KEY')).toBe('fallback-key');
    expect(warnSpy).toHaveBeenCalledWith(
      `Required variable 'API_KEY' missing from source; using YAML default for source 'API_KEY' in environment 'default' using local .env '${dotenvPath}'.`,
    );
  });

  it('optional missing warns "resolved to None"', () => {
    const repoRoot = createRepoRoot();
    const dotenvPath = join(repoRoot, '.env');
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        default:
          origin: local
          dotenv_path: .env
          default: true
      variables:
        OPTIONAL_TOKEN:
          source: OPTIONAL_TOKEN
          type: str
          required: false
      `,
    );
    writeText(dotenvPath, '');
    vi.stubEnv('APP_ENV', 'default');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new ConfigManager(configPath);

    expect(manager.get('OPTIONAL_TOKEN')).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      `Optional variable 'OPTIONAL_TOKEN' resolved to None because source 'OPTIONAL_TOKEN' was unavailable in environment 'default' using local .env '${dotenvPath}'.`,
    );
  });

  it('optional with default is quiet', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        default:
          origin: local
          dotenv_path: .env
          default: true
      variables:
        OPTIONAL_TOKEN:
          source: OPTIONAL_TOKEN
          type: str
          required: false
          default: fallback-token
      `,
    );
    writeText(join(repoRoot, '.env'), '');
    vi.stubEnv('APP_ENV', 'default');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new ConfigManager(configPath);

    expect(manager.get('OPTIONAL_TOKEN')).toBe('fallback-token');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('strict mode throws before optional fallback', () => {
    const repoRoot = createRepoRoot();
    const dotenvPath = join(repoRoot, '.env');
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        default:
          origin: local
          dotenv_path: .env
          default: true
      variables:
        OPTIONAL_TOKEN:
          source: OPTIONAL_TOKEN
          type: str
          required: false
      `,
    );
    writeText(dotenvPath, '');
    vi.stubEnv('APP_ENV', 'default');

    const manager = new ConfigManager(configPath, { strict: true });

    expect(() => manager.get('OPTIONAL_TOKEN')).toThrow(
      `Strict mode: variable 'OPTIONAL_TOKEN' is missing from source 'OPTIONAL_TOKEN' in environment 'default' using local .env '${dotenvPath}'.`,
    );
  });

  it('GCP context in missing value messages', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        default:
          origin: gcp
          gcp_project_id: app-prod
          default: true
      variables:
        API_KEY:
          source: API_KEY
          type: str
          required: true
      `,
    );
    vi.stubEnv('APP_ENV', 'default');
    vi.spyOn(factory, 'createLoader').mockReturnValue(createFakeLoader({ API_KEY: null }) as never);

    const manager = new ConfigManager(configPath);

    expect(() => manager.get('API_KEY')).toThrow(
      "Required variable 'API_KEY' not found in source 'API_KEY' for environment 'default' using GCP project 'app-prod'.",
    );
  });

  it('missing per-variable dotenv raises only when lookup needs file', () => {
    const repoRoot = createRepoRoot();
    const missingPath = join(repoRoot, 'config/.missing.env');
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        default:
          origin: local
          dotenv_path: .env
          default: true
      variables:
        API_TOKEN:
          source: API_TOKEN
          type: str
          required: true
          dotenv_path: config/.missing.env
      `,
    );
    writeText(join(repoRoot, '.env'), 'API_TOKEN=active-env-token\n');
    vi.stubEnv('APP_ENV', 'default');

    const manager = new ConfigManager(configPath);

    expect(() => manager.get('API_TOKEN')).toThrow(missingPath);
  });

  it('missing per-variable dotenv bypassed by process.env', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        default:
          origin: local
          dotenv_path: .env
          default: true
      variables:
        API_TOKEN:
          source: API_TOKEN
          type: str
          required: true
          dotenv_path: config/.missing.env
      `,
    );
    writeText(join(repoRoot, '.env'), '');
    vi.stubEnv('APP_ENV', 'default');
    vi.stubEnv('API_TOKEN', 'from-process-env');

    const manager = new ConfigManager(configPath);

    expect(manager.get('API_TOKEN')).toBe('from-process-env');
  });

  it('empty dotenv_path throws with variable name', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      variables:
        DB_PASSWORD:
          source: DB_PASSWORD
          type: str
          dotenv_path: ""
      `,
    );

    expect(() => new ConfigManager(configPath)).toThrow(/DB_PASSWORD.*dotenv_path/i);
  });

  it('non-string source throws with variable name', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      variables:
        DB_PASSWORD:
          source: 123
          type: str
      `,
    );

    expect(() => new ConfigManager(configPath)).toThrow(/DB_PASSWORD.*source/i);
  });

  it('empty environment throws with variable name', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      variables:
        DB_PASSWORD:
          source: DB_PASSWORD
          type: str
          environment: ""
      `,
    );

    expect(() => new ConfigManager(configPath)).toThrow(/DB_PASSWORD.*environment/i);
  });

  it('variables as list throws "mapping"', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      variables:
        - DB_PASSWORD
      `,
    );

    expect(() => new ConfigManager(configPath)).toThrow(/variables.*mapping/i);
  });

  it('validation as string throws "mapping"', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      validation: strict
      variables:
        DB_PASSWORD:
          source: DB_PASSWORD
          type: str
      `,
    );

    expect(() => new ConfigManager(configPath)).toThrow(/validation.*mapping/i);
  });

  it('GCP origin with dotenv_path ignores dotenv', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        default:
          origin: local
          dotenv_path: .env
          default: true
      variables:
        API_KEY:
          source: API_KEY
          type: str
          origin: gcp
          gcp_project_id: app-prod
          dotenv_path: config/.ignored.env
      `,
    );
    writeText(join(repoRoot, '.env'), 'API_KEY=from-local-dotenv\n');
    const fakeLoader = createFakeLoader({ API_KEY: 'from-gcp-loader' });
    vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);

    const manager = new ConfigManager(configPath);

    expect(manager.get('API_KEY')).toBe('from-gcp-loader');
    expect(factory.createLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        secretOrigin: 'gcp',
        gcpProjectId: 'app-prod',
        dotenvPath: null,
      }),
    );
  });
});
