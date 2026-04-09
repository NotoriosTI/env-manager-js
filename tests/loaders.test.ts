import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivateKey, encrypt } from 'eciesjs';

import { DotEnvLoader } from '../src/loaders/dotenv.js';
import { GCPSecretLoader, type GCPSecretClient } from '../src/loaders/gcp.js';
import { writeEnv, writeText } from './helpers.js';

const mockClient = {
  accessSecretVersion: vi.fn(),
};

function createGcpLoader(
  gcpProjectId: string,
  createClient: () => GCPSecretClient = () => mockClient,
): GCPSecretLoader {
  return new GCPSecretLoader(gcpProjectId, { createClient });
}

function createDotEnvLoader(dotenvPath: string, options?: Record<string, unknown>): DotEnvLoader {
  return Reflect.construct(
    DotEnvLoader as unknown as new (...args: unknown[]) => DotEnvLoader,
    [dotenvPath, options],
  );
}

// Ephemeral keypair and ciphertext — generated at test runtime, never committed.
let DOTENVX_PUBLIC_KEY: string;
let DOTENVX_PRIVATE_KEY: string;
let DOTENVX_ENCRYPTED_HELLO: string;

beforeAll(() => {
  const ephemeralKey = new PrivateKey();
  DOTENVX_PUBLIC_KEY = ephemeralKey.publicKey.toHex();
  DOTENVX_PRIVATE_KEY = ephemeralKey.secret.toString('hex');
  const cipherBytes = encrypt(ephemeralKey.publicKey.toBytes(), Buffer.from('Hello'));
  DOTENVX_ENCRYPTED_HELLO = 'encrypted:' + Buffer.from(cipherBytes).toString('base64');
});

function writeEncryptedEnv(
  tmpDir: string,
  extraLines: string[] = [],
): string {
  return writeEnv(
    tmpDir,
    [
      '#/-------------------[DOTENV_PUBLIC_KEY]--------------------/',
      '#/            public-key encryption for .env files          /',
      '#/----------------------------------------------------------/',
      `DOTENV_PUBLIC_KEY="${DOTENVX_PUBLIC_KEY}"`,
      `HELLO="${DOTENVX_ENCRYPTED_HELLO}"`,
      'PLAIN=still-plain',
      ...extraLines,
      '',
    ].join('\n'),
  );
}

describe('DotEnvLoader', () => {
  beforeEach(() => {
    delete process.env.DB_PASSWORD;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads KEY=VALUE from .env file', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEnv(tmpDir, 'DB_PASSWORD=secret123\n');

    const loader = new DotEnvLoader(envPath);

    expect(await loader.get('DB_PASSWORD')).toBe('secret123');
  });

  it('returns null for missing keys', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEnv(tmpDir, 'DB_PASSWORD=secret123\n');

    const loader = new DotEnvLoader(envPath);

    expect(await loader.get('NONEXISTENT')).toBeNull();
  });

  it('process.env overrides .env file value', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEnv(tmpDir, 'DB_PASSWORD=secret123\n');
    process.env.DB_PASSWORD = 'from_env';

    const loader = new DotEnvLoader(envPath);

    expect(await loader.get('DB_PASSWORD')).toBe('from_env');
  });

  it('getMany returns map with present and missing keys', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEnv(tmpDir, 'DB_PASSWORD=secret123\n');

    const loader = new DotEnvLoader(envPath);

    expect(await loader.getMany(['DB_PASSWORD', 'NONEXISTENT'])).toEqual({
      DB_PASSWORD: 'secret123',
      NONEXISTENT: null,
    });
  });

  it('encrypted dotenv mode stays quiet for plaintext-only files', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEnv(tmpDir, 'HELLO=plaintext\n');

    const loader = createDotEnvLoader(envPath, { encrypted: true });

    await expect(loader.get('HELLO')).resolves.toBe('plaintext');
  });

  it('decrypts encrypted entries while leaving plaintext values untouched in mixed dotenv files', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEncryptedEnv(tmpDir);
    vi.stubEnv('DOTENV_PRIVATE_KEY', DOTENVX_PRIVATE_KEY);

    const loader = createDotEnvLoader(envPath, {
      encrypted: true,
      environmentName: 'development',
    });

    await expect(loader.get('HELLO')).resolves.toBe('Hello');
    await expect(loader.get('PLAIN')).resolves.toBe('still-plain');
  });

  it('process.env still overrides encrypted dotenv values for the same key', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEncryptedEnv(tmpDir);
    vi.stubEnv('HELLO', 'from-process-env');
    vi.stubEnv('DOTENV_PRIVATE_KEY', DOTENVX_PRIVATE_KEY);

    const loader = createDotEnvLoader(envPath, { encrypted: true });

    await expect(loader.get('HELLO')).resolves.toBe('from-process-env');
    await expect(loader.get('PLAIN')).resolves.toBe('still-plain');
  });

  it('emits a warning when process.env overrides a key that exists in the encrypted file', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEncryptedEnv(tmpDir);
    vi.stubEnv('HELLO', 'from-process-env');
    vi.stubEnv('DOTENV_PRIVATE_KEY', DOTENVX_PRIVATE_KEY);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const loader = createDotEnvLoader(envPath, { encrypted: true });
    await loader.get('HELLO');

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"HELLO"'),
    );
    // Value must NOT appear in the warning
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('from-process-env'),
    );

    warnSpy.mockRestore();
  });

  it('does not warn when process.env key is absent from the dotenv file', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEnv(tmpDir, 'DB_PASSWORD=secret123\n');
    vi.stubEnv('SOME_OTHER_KEY', 'injected');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const loader = new DotEnvLoader(envPath);
    await loader.get('SOME_OTHER_KEY');

    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('warns when process.env overrides a key that exists in a plain dotenv file', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEnv(tmpDir, 'DB_PASSWORD=secret123\n');
    vi.stubEnv('DB_PASSWORD', 'from-env');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const loader = new DotEnvLoader(envPath);
    await loader.get('DB_PASSWORD');

    // Warning fires for plain files too (key exists in parsedValues)
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"DB_PASSWORD"'),
    );

    warnSpy.mockRestore();
  });

  it('normalizes environment names before deriving the env-specific private key name', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEncryptedEnv(tmpDir);
    vi.stubEnv('DOTENV_PRIVATE_KEY_PROD_US_EAST_1', DOTENVX_PRIVATE_KEY);

    const loader = createDotEnvLoader(envPath, {
      encrypted: true,
      environmentName: 'prod.us-east-1',
    });

    await expect(loader.get('HELLO')).resolves.toBe('Hello');
  });

  it('old-format encrypted dotenv lookup falls back to generic DOTENV_PRIVATE_KEY only', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEncryptedEnv(tmpDir);
    vi.stubEnv('DOTENV_PRIVATE_KEY', DOTENVX_PRIVATE_KEY);

    const loader = createDotEnvLoader(envPath, { encrypted: true });

    await expect(loader.get('HELLO')).resolves.toBe('Hello');
  });

  it('prefers the normalized env-specific private key before the generic fallback', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEncryptedEnv(tmpDir);
    vi.stubEnv('DOTENV_PRIVATE_KEY_STAGING_BLUE', DOTENVX_PRIVATE_KEY);
    vi.stubEnv('DOTENV_PRIVATE_KEY', 'deadbeef');

    const loader = createDotEnvLoader(envPath, {
      encrypted: true,
      environmentName: 'staging.blue',
    });

    await expect(loader.get('HELLO')).resolves.toBe('Hello');
  });

  it('uses the generic private key before the colocated .env.keys fallback', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEncryptedEnv(tmpDir);
    writeText(join(tmpDir, '.env.keys'), 'DOTENV_PRIVATE_KEY=deadbeef\n');
    vi.stubEnv('DOTENV_PRIVATE_KEY', DOTENVX_PRIVATE_KEY);

    const loader = createDotEnvLoader(envPath, { encrypted: true });

    await expect(loader.get('HELLO')).resolves.toBe('Hello');
  });

  it('falls back to a colocated .env.keys file with a generic private key entry', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEncryptedEnv(tmpDir);
    writeText(join(tmpDir, '.env.keys'), `DOTENV_PRIVATE_KEY=${DOTENVX_PRIVATE_KEY}\n`);

    const loader = createDotEnvLoader(envPath, { encrypted: true });

    await expect(loader.get('HELLO')).resolves.toBe('Hello');
  });

  it('raises one structured DecryptionError when an encrypted value cannot be decrypted', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-loaders-'));
    const envPath = writeEncryptedEnv(tmpDir);

    const loader = createDotEnvLoader(envPath, {
      encrypted: true,
      environmentName: 'qa',
    });

    await expect(loader.get('HELLO')).rejects.toMatchObject({
      name: 'DecryptionError',
      issues: [
        expect.objectContaining({
          key: 'HELLO',
        }),
      ],
    });
  });
});

// Captured at module load time — beforeEach in setup.ts deletes GCP_PROJECT_ID
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID ?? 'my-project';

describe('GCPSecretLoader', () => {
  beforeEach(() => {
    mockClient.accessSecretVersion.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches secret and caches result', async () => {
    mockClient.accessSecretVersion.mockResolvedValue([
      { payload: { data: Buffer.from('top-secret') } },
    ]);
    const loader = createGcpLoader(GCP_PROJECT_ID);

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
    const loader = createGcpLoader(GCP_PROJECT_ID);

    const val = await loader.get('MISSING_KEY');

    expect(val).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Secret 'MISSING_KEY' not found"),
    );
  });
});
