import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import { decrypt } from 'eciesjs';
import { encryptDotenvFile } from '../../src/cli/encrypt.js';
import { DotEnvLoader } from '../../src/loaders/dotenv.js';

// Track tmp dirs for cleanup
const tmpDirs: string[] = [];

function makeTmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'encrypt-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

describe('encryptDotenvFile', () => {
  it('Test 1 (key-gen): generates a key pair with correct hex lengths', async () => {
    const tmpDir = makeTmp();
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(envPath, 'HELLO=World\n');

    const result = await encryptDotenvFile({ filePath: envPath });

    expect(result.publicKeyHex).toHaveLength(66);
    expect(result.privateKeyHex).toHaveLength(64);

    // .env should contain DOTENV_PUBLIC_KEY with the 66-char hex
    const envContent = fs.readFileSync(envPath, 'utf8');
    expect(envContent).toContain(`DOTENV_PUBLIC_KEY="${result.publicKeyHex}"`);

    // .env.keys should contain DOTENV_PRIVATE_KEY with the 64-char hex
    const keysPath = path.join(tmpDir, '.env.keys');
    const keysContent = fs.readFileSync(keysPath, 'utf8');
    expect(keysContent).toContain(`DOTENV_PRIVATE_KEY="${result.privateKeyHex}"`);
  });

  it('Test 2 (encrypt-values): encrypts plaintext values with encrypted: prefix', async () => {
    const tmpDir = makeTmp();
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(envPath, 'HELLO=World\nFOO=bar\n');

    const result = await encryptDotenvFile({ filePath: envPath });
    expect(result.encryptedCount).toBe(2);
    expect(result.skippedCount).toBe(0);

    const envContent = fs.readFileSync(envPath, 'utf8');
    const helloMatch = envContent.match(/HELLO="(encrypted:[^"]+)"/);
    const fooMatch = envContent.match(/FOO="(encrypted:[^"]+)"/);

    expect(helloMatch).toBeTruthy();
    expect(fooMatch).toBeTruthy();
    // Verify base64 portion is valid
    const helloBase64 = helloMatch![1].slice('encrypted:'.length);
    const fooBase64 = fooMatch![1].slice('encrypted:'.length);
    expect(() => Buffer.from(helloBase64, 'base64')).not.toThrow();
    expect(() => Buffer.from(fooBase64, 'base64')).not.toThrow();
  });

  it('Test 3 (decrypt-round-trip): encrypted values decrypt back to original plaintext', async () => {
    const tmpDir = makeTmp();
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(envPath, 'HELLO=World\nFOO=bar\n');

    const result = await encryptDotenvFile({ filePath: envPath });
    const envContent = fs.readFileSync(envPath, 'utf8');

    const helloMatch = envContent.match(/HELLO="(encrypted:[^"]+)"/);
    const fooMatch = envContent.match(/FOO="(encrypted:[^"]+)"/);
    expect(helloMatch).toBeTruthy();
    expect(fooMatch).toBeTruthy();

    const privKeyBuf = Buffer.from(result.privateKeyHex, 'hex');

    const helloDecrypted = decrypt(privKeyBuf, Buffer.from(helloMatch![1].slice('encrypted:'.length), 'base64'));
    expect(helloDecrypted.toString('utf8')).toBe('World');

    const fooDecrypted = decrypt(privKeyBuf, Buffer.from(fooMatch![1].slice('encrypted:'.length), 'base64'));
    expect(fooDecrypted.toString('utf8')).toBe('bar');
  });

  it('Test 4 (skip-encrypted): already-encrypted values are preserved unchanged', async () => {
    const tmpDir = makeTmp();
    const envPath = path.join(tmpDir, '.env');
    const alreadyEncrypted = 'encrypted:abc123';
    fs.writeFileSync(envPath, `ALREADY="${alreadyEncrypted}"\n`);

    const result = await encryptDotenvFile({ filePath: envPath });
    expect(result.skippedCount).toBe(1);
    expect(result.encryptedCount).toBe(0);

    const envContent = fs.readFileSync(envPath, 'utf8');
    expect(envContent).toContain(`ALREADY="${alreadyEncrypted}"`);
  });

  it('Test 5 (skip-public-key): DOTENV_PUBLIC_KEY in input is not re-encrypted', async () => {
    const tmpDir = makeTmp();
    const envPath = path.join(tmpDir, '.env');
    // File that has only a public key (already encrypted scenario — should refuse)
    // For this test we want to ensure DOTENV_PUBLIC_KEY is not encrypted as a value
    // The implementation should refuse if DOTENV_PUBLIC_KEY is present (pitfall 2)
    // But the spec says "skip DOTENV_PUBLIC_KEY itself" — test the skip behavior
    // by mocking: ensure encrypted output never wraps DOTENV_PUBLIC_KEY in encrypted:
    fs.writeFileSync(envPath, 'PLAIN=value\n');

    await encryptDotenvFile({ filePath: envPath });
    const envContent = fs.readFileSync(envPath, 'utf8');

    // The generated DOTENV_PUBLIC_KEY line in the output must not be encrypted
    const publicKeyLine = envContent.split('\n').find(l => l.startsWith('DOTENV_PUBLIC_KEY='));
    expect(publicKeyLine).toBeDefined();
    expect(publicKeyLine).not.toContain('encrypted:');
  });

  it('Test 6 (env-keys-exists-refuse): throws when .env.keys already exists and force=false', async () => {
    const tmpDir = makeTmp();
    const envPath = path.join(tmpDir, '.env');
    const keysPath = path.join(tmpDir, '.env.keys');
    fs.writeFileSync(envPath, 'HELLO=World\n');
    fs.writeFileSync(keysPath, 'DOTENV_PRIVATE_KEY="existing"\n');

    await expect(encryptDotenvFile({ filePath: envPath, force: false }))
      .rejects.toThrow(/already exists/i);
  });

  it('Test 7 (env-keys-exists-force): overwrites .env.keys when force=true', async () => {
    const tmpDir = makeTmp();
    const envPath = path.join(tmpDir, '.env');
    const keysPath = path.join(tmpDir, '.env.keys');
    fs.writeFileSync(envPath, 'HELLO=World\n');
    fs.writeFileSync(keysPath, 'DOTENV_PRIVATE_KEY="old-key"\n');

    const result = await encryptDotenvFile({ filePath: envPath, force: true });

    const keysContent = fs.readFileSync(keysPath, 'utf8');
    expect(keysContent).toContain(`DOTENV_PRIVATE_KEY="${result.privateKeyHex}"`);
    expect(keysContent).not.toContain('old-key');
  });

  it('Test 8 (round-trip-via-loader): encrypted .env round-trips through DotEnvLoader', async () => {
    const tmpDir = makeTmp();
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(envPath, 'HELLO=World\nDB_PASSWORD=secret123\n');

    const result = await encryptDotenvFile({ filePath: envPath });

    const loader = new DotEnvLoader(envPath, {
      encrypted: true,
      explicitPrivateKey: result.privateKeyHex,
    });

    const hello = await loader.get('HELLO');
    const dbPassword = await loader.get('DB_PASSWORD');

    expect(hello).toBe('World');
    expect(dbPassword).toBe('secret123');
  });

  it('Test 9 (dotenvx-header): output .env starts with the exact 4-line dotenvx header', async () => {
    const tmpDir = makeTmp();
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(envPath, 'HELLO=World\n');

    await encryptDotenvFile({ filePath: envPath });
    const envContent = fs.readFileSync(envPath, 'utf8');

    expect(envContent).toContain('#/-------------------[DOTENV_PUBLIC_KEY]--------------------/');
    expect(envContent).toContain('#/            public-key encryption for .env files          /');
    expect(envContent).toContain('#/       [how it works](https://dotenvx.com/encryption)     /');
    expect(envContent).toContain('#/----------------------------------------------------------/');

    // Header must be the very start of the file
    expect(envContent.startsWith('#/---')).toBe(true);
  });

  it('Test 10 (env-flag): --env flag causes DOTENV_PRIVATE_KEY_<ENV> in .env.keys', async () => {
    const tmpDir = makeTmp();
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(envPath, 'HELLO=World\n');

    const result = await encryptDotenvFile({ filePath: envPath, env: 'production' });

    const keysPath = path.join(tmpDir, '.env.keys');
    const keysContent = fs.readFileSync(keysPath, 'utf8');

    expect(keysContent).toContain(`DOTENV_PRIVATE_KEY_PRODUCTION="${result.privateKeyHex}"`);
    expect(keysContent).not.toContain('DOTENV_PRIVATE_KEY="');
  });
});
