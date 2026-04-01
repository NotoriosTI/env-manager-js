import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotImplementedError } from '../src/errors.js';
import { ConfigManager } from '../src/manager.js';

const tmpDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'env-manager-notimpl-'));
  tmpDirs.push(dir);
  return dir;
}

function writeConfig(dir: string, yaml: string): string {
  // Write a minimal package.json so discoverProjectRoot stops here.
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf8');
  const configPath = join(dir, 'config.yaml');
  writeFileSync(configPath, yaml, 'utf8');
  return configPath;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe('NotImplementedError for encrypted dotenv with non-local origin', () => {
  it('new-format: encrypted_dotenv.enabled + origin=gcp throws NotImplementedError', async () => {
    const dir = createTempDir();
    const configPath = writeConfig(
      dir,
      `
environments:
  production:
    origin: gcp
    gcp_project_id: my-project
    default: true
    encrypted_dotenv:
      enabled: true
      dotenv_path: .env.enc
variables:
  API_KEY:
    source: API_KEY
    required: true
`,
    );

    vi.stubEnv('APP_ENV', 'production');
    const manager = new ConfigManager(configPath);

    await expect(manager.load()).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('old-format: encrypted_dotenv.enabled + secretOrigin=gcp throws NotImplementedError', async () => {
    const dir = createTempDir();
    const configPath = writeConfig(
      dir,
      `
encrypted_dotenv:
  enabled: true
variables:
  API_KEY:
    source: API_KEY
    required: true
`,
    );

    const manager = new ConfigManager(configPath, { secretOrigin: 'gcp', gcpProjectId: 'my-project' });

    await expect(manager.load()).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('new-format: encrypted_dotenv.enabled + origin=local does NOT throw NotImplementedError', async () => {
    const dir = createTempDir();
    // Write a real .env.enc file (even if empty — it won't be decrypted without a key;
    // we just want to confirm the guard is not triggered)
    writeFileSync(join(dir, '.env.enc'), '', 'utf8');
    const configPath = writeConfig(
      dir,
      `
environments:
  local:
    origin: local
    dotenv_path: .env.enc
    default: true
    encrypted_dotenv:
      enabled: true
variables:
  API_KEY:
    source: API_KEY
    required: false
`,
    );

    vi.stubEnv('APP_ENV', 'local');
    const manager = new ConfigManager(configPath);

    // Should NOT throw NotImplementedError (local origin is supported).
    // load() may resolve or reject for other reasons — we only care that
    // NotImplementedError is not thrown.
    let thrownError: unknown = undefined;
    try {
      await manager.load();
    } catch (err) {
      thrownError = err;
    }
    expect(thrownError).not.toBeInstanceOf(NotImplementedError);
  });
});
