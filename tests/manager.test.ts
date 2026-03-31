import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { isAbsolute, join } from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigManager, getConfig, initConfig, requireConfig } from '../src/manager.js';
import { writeConfig, writeEnv } from './helpers.js';

const tmpDirs: string[] = [];

function createTempDir(): string {
  const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-manager-'));
  tmpDirs.push(tmpDir);
  return tmpDir;
}

function createConfig(tmpDir: string): string {
  return writeConfig(
    tmpDir,
    `
variables:
  DB_PASSWORD:
    source: DB_PASSWORD
    type: str
    required: true
  PORT:
    source: PORT
    type: int
    default: 8080
  DEBUG_MODE:
    source: DEBUG_MODE
    type: bool
    default: false
  TIMEOUT:
    source: TIMEOUT
    type: float
    default: 1.5
`,
  );
}

afterEach(() => {
  vi.restoreAllMocks();

  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop()!, { force: true, recursive: true });
  }
});

describe('ConfigManager', () => {
  it('loads local .env, coerces types, and writes process.env', () => {
    const tmpDir = createTempDir();
    const configPath = createConfig(tmpDir);
    const dotenvPath = writeEnv(tmpDir, 'DB_PASSWORD=secret123\n');

    const manager = new ConfigManager(configPath, { dotenvPath });

    expect(manager.get('DB_PASSWORD')).toBe('secret123');
    expect(manager.get('PORT')).toBe(8080);
    expect(manager.get('DEBUG_MODE')).toBe(false);
    expect(manager.get('TIMEOUT')).toBe(1.5);
    expect(process.env.DB_PASSWORD).toBe('secret123');
    expect(process.env.PORT).toBe('8080');
  });

  it('throws on missing required variable', () => {
    const tmpDir = createTempDir();
    const configPath = writeConfig(
      tmpDir,
      `
variables:
  DB_PASSWORD:
    source: DB_PASSWORD
    type: str
    required: true
`,
    );
    const dotenvPath = writeEnv(tmpDir, '');

    expect(() => new ConfigManager(configPath, { dotenvPath })).toThrow(
      "Required variable 'DB_PASSWORD' not found in source",
    );
  });

  it('optional variable with default is quiet', () => {
    const tmpDir = createTempDir();
    const configPath = writeConfig(
      tmpDir,
      `
variables:
  OPTIONAL:
    source: OPTIONAL
    type: str
    default: fallback-value
`,
    );
    const dotenvPath = writeEnv(tmpDir, '');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new ConfigManager(configPath, { dotenvPath });

    expect(manager.get('OPTIONAL')).toBe('fallback-value');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('strict mode throws on any missing variable', () => {
    const tmpDir = createTempDir();
    const configPath = writeConfig(
      tmpDir,
      `
variables:
  DB_PASSWORD:
    source: DB_PASSWORD
    type: str
`,
    );
    const dotenvPath = writeEnv(tmpDir, '');

    expect(() => new ConfigManager(configPath, { dotenvPath, strict: true })).toThrow(
      "Strict mode: variable 'DB_PASSWORD' is missing",
    );
  });

  it('singleton API: initConfig, getConfig, requireConfig', () => {
    const tmpDir = createTempDir();
    const configPath = writeConfig(
      tmpDir,
      `
variables:
  DB_PASSWORD:
    source: DB_PASSWORD
    type: str
    required: true
`,
    );
    const dotenvPath = writeEnv(tmpDir, 'DB_PASSWORD=secret123\n');

    expect(() => requireConfig('X')).toThrow('Configuration manager not initialised. Call initConfig().');

    initConfig(configPath, { dotenvPath });

    expect(getConfig('DB_PASSWORD')).toBe('secret123');
    expect(requireConfig('DB_PASSWORD')).toBe('secret123');
    expect(() => requireConfig('NONEXISTENT')).toThrow("Required configuration 'NONEXISTENT' is missing");
  });

  it('re-init logs warning', () => {
    const tmpDir = createTempDir();
    const configPath = writeConfig(
      tmpDir,
      `
variables:
  DB_PASSWORD:
    source: DB_PASSWORD
    type: str
    required: true
`,
    );
    const dotenvPath = writeEnv(tmpDir, 'DB_PASSWORD=secret123\n');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    initConfig(configPath, { dotenvPath });
    initConfig(configPath, { dotenvPath });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Configuration manager already initialised'));
  });

  it('re-init keeps the original singleton instance and loaded state', () => {
    const firstTmpDir = createTempDir();
    const firstConfigPath = writeConfig(
      firstTmpDir,
      `
variables:
  DB_PASSWORD:
    source: DB_PASSWORD
    type: str
    required: true
`,
    );
    const firstDotenvPath = writeEnv(firstTmpDir, 'DB_PASSWORD=first-secret\n');

    const secondTmpDir = createTempDir();
    const secondConfigPath = writeConfig(
      secondTmpDir,
      `
variables:
  DB_PASSWORD:
    source: DB_PASSWORD
    type: str
    required: true
  SECOND_ONLY:
    source: SECOND_ONLY
    type: str
`,
    );
    const secondDotenvPath = writeEnv(secondTmpDir, 'DB_PASSWORD=second-secret\nSECOND_ONLY=leaked-value\n');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const firstManager = initConfig(firstConfigPath, { dotenvPath: firstDotenvPath });
    const secondManager = initConfig(secondConfigPath, { dotenvPath: secondDotenvPath });

    expect(secondManager).toBe(firstManager);
    expect(getConfig('DB_PASSWORD')).toBe('first-secret');
    expect(requireConfig('DB_PASSWORD')).toBe('first-secret');
    expect(process.env.SECOND_ONLY).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Configuration manager already initialised'));
  });

  it('debug mode disables masking in logs', () => {
    const tmpDir = createTempDir();
    const configPath = writeConfig(
      tmpDir,
      `
variables:
  DB_PASSWORD:
    source: DB_PASSWORD
    type: str
    required: true
`,
    );
    const dotenvPath = writeEnv(tmpDir, 'DB_PASSWORD=secret123\n');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    new ConfigManager(configPath, { dotenvPath, debug: true });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Loaded DB_PASSWORD: secret123'));
  });

  it('missing dotenv is deferred when process.env has value', () => {
    const tmpDir = createTempDir();
    const configPath = writeConfig(
      tmpDir,
      `
environments:
  default:
    origin: local
    default: true
    dotenv_path: missing.env
variables:
  DB_PASSWORD:
    source: DB_PASSWORD
    type: str
    required: true
`,
    );

    process.env.DB_PASSWORD = 'from-env';

    const manager = new ConfigManager(configPath);

    expect(manager.get('DB_PASSWORD')).toBe('from-env');
  });

  it('missing dotenv throws with absolute path when lookup needed', () => {
    const tmpDir = createTempDir();
    const configPath = writeConfig(
      tmpDir,
      `
environments:
  default:
    origin: local
    default: true
    dotenv_path: missing.env
variables:
  DB_PASSWORD:
    source: DB_PASSWORD
    type: str
    required: true
`,
    );

    try {
      new ConfigManager(configPath);
      expect.unreachable('Expected ConfigManager to throw for missing active environment dotenv');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      const match = message.match(/(\/[^"'\\s]+missing\.env)/);

      expect(match?.[1]).toBeDefined();
      expect(isAbsolute(match![1])).toBe(true);
      expect(message).toContain("environment 'default'");
    }
  });
});
