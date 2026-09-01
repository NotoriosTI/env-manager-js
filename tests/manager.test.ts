import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { isAbsolute, join } from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigManager, _resetSingleton, getConfig, initConfig, requireConfig } from '../src/manager.js';
import { maskSecret } from '../src/utils.js';
import { DOTENVX_PRIVATE_KEY, writeConfig, writeEncryptedEnv, writeEnv } from './helpers.js';

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
  vi.unstubAllEnvs();

  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop()!, { force: true, recursive: true });
  }
});

describe('ConfigManager', () => {
  it('loads local .env, coerces types, and writes process.env', async () => {
    const tmpDir = createTempDir();
    const configPath = createConfig(tmpDir);
    const dotenvPath = writeEnv(tmpDir, 'DB_PASSWORD=secret123\n');

    const manager = new ConfigManager(configPath, { dotenvPath });
    await manager.load();

    expect(manager.get('DB_PASSWORD')).toBe('secret123');
    expect(manager.get('PORT')).toBe(8080);
    expect(manager.get('DEBUG_MODE')).toBe(false);
    expect(manager.get('TIMEOUT')).toBe(1.5);
    expect(process.env.DB_PASSWORD).toBe('secret123');
    expect(process.env.PORT).toBe('8080');
  });

  it('throws on missing required variable', async () => {
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

    const manager = new ConfigManager(configPath, { dotenvPath });
    await expect(manager.load()).rejects.toMatchObject({
      name: 'ConfigValidationError',
      issues: [
        {
          variableName: 'DB_PASSWORD',
          issueType: 'missing',
          sourceKey: 'DB_PASSWORD',
          message: "Required variable 'DB_PASSWORD' not found in source",
        },
      ],
    });
  });

  it('ConfigValidationError aggregates every strict mode missing required variable from one old-format load attempt', async () => {
    const tmpDir = createTempDir();
    const configPath = writeConfig(
      tmpDir,
      `
variables:
  DB_PASSWORD:
    source: DB_PASSWORD
    type: str
  API_TOKEN:
    source: API_TOKEN
    type: str
`,
    );
    const dotenvPath = writeEnv(tmpDir, '');

    const manager = new ConfigManager(configPath, { dotenvPath, strict: true });
    const error = await manager.load().catch((rejection: unknown) => rejection);

    expect(error).toMatchObject({
      name: 'ConfigValidationError',
      issues: [
        {
          variableName: 'DB_PASSWORD',
          issueType: 'missing',
          sourceKey: 'DB_PASSWORD',
          message: "Strict mode: variable 'DB_PASSWORD' is missing",
        },
        {
          variableName: 'API_TOKEN',
          issueType: 'missing',
          sourceKey: 'API_TOKEN',
          message: "Strict mode: variable 'API_TOKEN' is missing",
        },
      ],
    });
  });

  it('ConfigValidationError aggregates old-format missing required and invalid issues without leaking invalid process.env writes', async () => {
    const tmpDir = createTempDir();
    const configPath = writeConfig(
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
`,
    );
    const dotenvPath = writeEnv(tmpDir, 'PORT=not-a-number\n');

    const manager = new ConfigManager(configPath, { dotenvPath });
    const error = await manager.load().catch((rejection: unknown) => rejection);

    expect(error).toMatchObject({
      name: 'ConfigValidationError',
      issues: [
        {
          variableName: 'DB_PASSWORD',
          issueType: 'missing',
          sourceKey: 'DB_PASSWORD',
          message: "Required variable 'DB_PASSWORD' not found in source",
        },
        {
          variableName: 'PORT',
          issueType: 'invalid',
          sourceKey: 'PORT',
          message: "Cannot convert 'PORT' value 'not-a-number' to int",
        },
      ],
    });
    expect(process.env.PORT).toBeUndefined();
  });

  it('optional variable with default is quiet', async () => {
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
    await manager.load();

    expect(manager.get('OPTIONAL')).toBe('fallback-value');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('old-format encrypted dotenv support can be enabled without an environments block', async () => {
    const tmpDir = createTempDir();
    const configPath = writeConfig(
      tmpDir,
      `
encrypted_dotenv:
  enabled: true
variables:
  hello_secret:
    source: HELLO
    type: str
    required: true
`,
    );
    writeEncryptedEnv(tmpDir);
    vi.stubEnv('DOTENV_PRIVATE_KEY', DOTENVX_PRIVATE_KEY);

    const manager = new ConfigManager(configPath);
    await manager.load();

    expect(manager.get('hello_secret')).toBe('Hello');
  });

  it('old-format encrypted dotenv failures aggregate into one DecryptionError', async () => {
    const tmpDir = createTempDir();
    const configPath = writeConfig(
      tmpDir,
      `
encrypted_dotenv:
  enabled: true
variables:
  hello_secret:
    source: HELLO
    type: str
    required: true
  api_token:
    source: API_TOKEN
    type: str
    required: true
`,
    );
    writeEncryptedEnv(tmpDir, ['API_TOKEN="encrypted:BAZb6wDPFaFeFzq8Ut48oiNFSPtYvJmv4AwVDFVcNKiIcGxrxuRIFGWxZ3xVjxOgOo6w65bWFTpAfbatSz52+VvwDYZ3nFUO828nzovH5ZhsIoxPuPb7K0ZphmNynR7Hxci4a+fB"']);

    const manager = new ConfigManager(configPath);
    const error = await manager.load().catch((rejection: unknown) => rejection);

    expect(error).toMatchObject({ name: 'DecryptionError' });
    expect(error).toHaveProperty('issues');
    expect(
      new Set(
        ((error as { issues: Array<Record<string, unknown>> }).issues ?? []).map((issue) =>
          String(issue.key ?? issue.sourceKey ?? issue.variableName),
        ),
      ),
    ).toEqual(new Set(['HELLO', 'API_TOKEN']));
  });

  it('old-format encrypted dotenv still uses the generic private key lookup path only', async () => {
    const tmpDir = createTempDir();
    const configPath = writeConfig(
      tmpDir,
      `
encrypted_dotenv:
  enabled: true
variables:
  hello_secret:
    source: HELLO
    type: str
    required: true
`,
    );
    writeEncryptedEnv(tmpDir);
    vi.stubEnv('DOTENV_PRIVATE_KEY_LEGACY', DOTENVX_PRIVATE_KEY);

    const manager = new ConfigManager(configPath);

    await expect(manager.load()).rejects.toMatchObject({
      name: 'DecryptionError',
    });
  });

  it('strict mode throws on any missing variable', async () => {
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

    const manager = new ConfigManager(configPath, { dotenvPath, strict: true });
    await expect(manager.load()).rejects.toMatchObject({
      name: 'ConfigValidationError',
      issues: [
        {
          variableName: 'DB_PASSWORD',
          issueType: 'missing',
          sourceKey: 'DB_PASSWORD',
          message: "Strict mode: variable 'DB_PASSWORD' is missing",
        },
      ],
    });
  });

  it('retry load() on the same manager after a rejected old-format attempt', async () => {
    const tmpDir = createTempDir();
    const configPath = writeConfig(
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
`,
    );
    const dotenvPath = writeEnv(tmpDir, 'PORT=bad-int\n');

    const manager = new ConfigManager(configPath, { dotenvPath });

    await expect(manager.load()).rejects.toMatchObject({
      name: 'ConfigValidationError',
      issues: [
        {
          variableName: 'DB_PASSWORD',
          issueType: 'missing',
        },
        {
          variableName: 'PORT',
          issueType: 'invalid',
        },
      ],
    });

    writeEnv(tmpDir, 'DB_PASSWORD=secret123\nPORT=5432\n');

    await expect(manager.load()).resolves.toBeUndefined();
    expect(manager.get('DB_PASSWORD')).toBe('secret123');
    expect(manager.get('PORT')).toBe(5432);
  });

  it('singleton API: initConfig, getConfig, requireConfig', async () => {
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

    await initConfig(configPath, { dotenvPath });

    expect(getConfig('DB_PASSWORD')).toBe('secret123');
    expect(requireConfig('DB_PASSWORD')).toBe('secret123');
    expect(() => requireConfig('NONEXISTENT')).toThrow("Required configuration 'NONEXISTENT' is missing");
  });

  it('re-init logs warning', async () => {
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

    await initConfig(configPath, { dotenvPath });
    await initConfig(configPath, { dotenvPath });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Configuration manager already initialised'));
  });

  it('re-init replaces the singleton, matching the Python runtime', async () => {
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

    const firstManager = await initConfig(firstConfigPath, { dotenvPath: firstDotenvPath });
    const secondManager = await initConfig(secondConfigPath, { dotenvPath: secondDotenvPath });

    // Paridad con Python: el segundo initConfig REEMPLAZA la instancia (D1).
    expect(secondManager).not.toBe(firstManager);

    // Pero el valor sigue siendo el primero: la primera carga exportó
    // DB_PASSWORD a process.env y process.env gana sobre el archivo. Python
    // hace exactamente lo mismo con os.environ — verificado contra el runtime
    // Python, no asumido. Las claves nuevas del segundo config sí se cargan.
    expect(getConfig('DB_PASSWORD')).toBe('first-secret');
    expect(requireConfig('DB_PASSWORD')).toBe('first-secret');
    expect(getConfig('SECOND_ONLY')).toBe('leaked-value');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Configuration manager already initialised'));
  });

  it('reset/recreate clears cached loader state before rebuilding the singleton', async () => {
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
    const dotenvPath = writeEnv(tmpDir, 'DB_PASSWORD=first-secret\n');

    await initConfig(configPath, { dotenvPath });
    expect(getConfig('DB_PASSWORD')).toBe('first-secret');

    writeEnv(tmpDir, 'DB_PASSWORD=second-secret\n');
    _resetSingleton();

    await initConfig(configPath, { dotenvPath });

    expect(getConfig('DB_PASSWORD')).toBe('second-secret');
    expect(process.env.DB_PASSWORD).toBe('second-secret');
  });

  it('debug mode disables masking in logs', async () => {
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
    // §1.7: el diagnóstico va a stderr; stdout queda para los resultados.
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const manager = new ConfigManager(configPath, { dotenvPath, debug: true });
    await manager.load();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Loaded DB_PASSWORD: secret123'));
  });

  it('normal mode logs masked loaded values using maskSecret semantics', async () => {
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
    const rawValue = 'secret-value-1234';
    const dotenvPath = writeEnv(tmpDir, `DB_PASSWORD=${rawValue}\n`);
    // §1.7: el diagnóstico va a stderr; stdout queda para los resultados.
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const manager = new ConfigManager(configPath, { dotenvPath });
    await manager.load();

    expect(logSpy).toHaveBeenCalledWith(`Loaded DB_PASSWORD: ${maskSecret(rawValue)}`);
    expect(logSpy).not.toHaveBeenCalledWith(`Loaded DB_PASSWORD: ${rawValue}`);
  });

  it('missing dotenv is deferred when process.env has value', async () => {
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
    await manager.load();

    expect(manager.get('DB_PASSWORD')).toBe('from-env');
  });

  it('missing dotenv throws with absolute path when lookup needed', async () => {
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

    const manager = new ConfigManager(configPath);
    try {
      await manager.load();
      expect.unreachable('Expected load() to throw for missing active environment dotenv');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      const match = message.match(/(\/[^"'\\s]+missing\.env)/);

      expect(match?.[1]).toBeDefined();
      expect(isAbsolute(match![1])).toBe(true);
      expect(message).toContain("environment 'default'");
    }
  });

  it('constructor does not call load() — autoLoad removed', async () => {
    const tmpDir = createTempDir();
    const configPath = createConfig(tmpDir);
    const dotenvPath = writeEnv(tmpDir, 'DB_PASSWORD=secret123\n');

    const manager = new ConfigManager(configPath, { dotenvPath });
    // Before load(), _loaded is false — get() should throw with "not loaded" message
    delete process.env.DB_PASSWORD;
    expect(() => manager.get('DB_PASSWORD')).toThrow('ConfigManager not loaded');

    // Now explicitly load
    await manager.load();
    expect(manager.get('DB_PASSWORD')).toBe('secret123');
  });
});

describe('D11: clave con la que se exporta a process.env', () => {
  // Python exporta con el NOMBRE de la variable. JS exportaba con su `source`,
  // así que un config con `PGHOST` / `source: JUAN_DB_HOST` dejaba `PGHOST` sin
  // definir y libpq nunca lo veía. Ahora exporta el nombre, y mantiene el
  // `source` como alias deprecado por una versión.
  it('exporta con el nombre de la variable', async () => {
    const tmpDir = createTempDir();
    const configPath = writeConfig(
      tmpDir,
      `
variables:
  PGHOST:
    source: JUAN_DB_HOST
    type: str
`,
    );
    const dotenvPath = writeEnv(tmpDir, 'JUAN_DB_HOST=db.internal\n');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new ConfigManager(configPath, { dotenvPath });
    await manager.load();

    expect(process.env.PGHOST).toBe('db.internal');
    delete process.env.PGHOST;
    delete process.env.JUAN_DB_HOST;
  });

  it('mantiene el source como alias transitorio y avisa una sola vez', async () => {
    const tmpDir = createTempDir();
    const configPath = writeConfig(
      tmpDir,
      `
variables:
  PGHOST:
    source: JUAN_DB_HOST
    type: str
  PGPORT:
    source: JUAN_DB_PORT
    type: int
`,
    );
    const dotenvPath = writeEnv(tmpDir, 'JUAN_DB_HOST=db.internal\nJUAN_DB_PORT=5432\n');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new ConfigManager(configPath, { dotenvPath });
    await manager.load();

    expect(process.env.JUAN_DB_HOST).toBe('db.internal');
    expect(process.env.JUAN_DB_PORT).toBe('5432');

    const aliasWarnings = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((message) => message.includes('is also exported to process.env'));
    expect(aliasWarnings).toHaveLength(2);
    expect(aliasWarnings[0]).toContain('removed in the next release');

    for (const key of ['PGHOST', 'PGPORT', 'JUAN_DB_HOST', 'JUAN_DB_PORT']) {
      delete process.env[key];
    }
  });

  it('no duplica ni avisa cuando el nombre y el source coinciden', async () => {
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
    const dotenvPath = writeEnv(tmpDir, 'DB_PASSWORD=secret123\n');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new ConfigManager(configPath, { dotenvPath });
    await manager.load();

    expect(process.env.DB_PASSWORD).toBe('secret123');
    expect(
      warnSpy.mock.calls.filter((call) =>
        String(call[0]).includes('is also exported to process.env'),
      ),
    ).toHaveLength(0);

    delete process.env.DB_PASSWORD;
  });
});
