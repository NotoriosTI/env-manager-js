import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { encryptDotenvFile } from '../../src/cli/encrypt.js';
import { decryptDotenvFile } from '../../src/cli/decrypt.js';

// Track tmp dirs for cleanup
const tmpDirs: string[] = [];

function makeTmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decrypt-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
  delete process.env.DOTENV_PRIVATE_KEY;
});

describe('decryptDotenvFile', () => {
  it('Test 1 (env-var-key): reads private key from DOTENV_PRIVATE_KEY env var', async () => {
    const tmpDir = makeTmp();
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(envPath, 'SECRET=hello\n');

    const encResult = await encryptDotenvFile({ filePath: envPath });

    // Remove the .env.keys file so only env var works
    const keysPath = path.join(tmpDir, '.env.keys');
    fs.rmSync(keysPath);

    // Set the env var
    process.env.DOTENV_PRIVATE_KEY = encResult.privateKeyHex;

    const outputPath = path.join(tmpDir, '.env.out');
    const decResult = await decryptDotenvFile({ filePath: envPath, outputPath });

    expect(decResult.decryptedCount).toBe(1);
    const content = fs.readFileSync(outputPath, 'utf8');
    expect(content).toContain('SECRET="hello"');
  });

  it('Test 2 (keys-file): reads private key from .env.keys when env var is absent', async () => {
    const tmpDir = makeTmp();
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(envPath, 'SECRET=world\n');

    await encryptDotenvFile({ filePath: envPath });

    // Ensure DOTENV_PRIVATE_KEY is not set
    delete process.env.DOTENV_PRIVATE_KEY;

    const outputPath = path.join(tmpDir, '.env.out');
    const decResult = await decryptDotenvFile({ filePath: envPath, outputPath });

    expect(decResult.decryptedCount).toBe(1);
    const content = fs.readFileSync(outputPath, 'utf8');
    expect(content).toContain('SECRET="world"');
  });

  it('Test 3 (no-key-error): throws clear error when no key source is available', async () => {
    const tmpDir = makeTmp();
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(envPath, 'SECRET=encrypted:fakeciphertext\n');

    delete process.env.DOTENV_PRIVATE_KEY;
    // No .env.keys file present

    await expect(decryptDotenvFile({ filePath: envPath })).rejects.toThrow(
      'No private key found. Set DOTENV_PRIVATE_KEY environment variable or provide a .env.keys file.'
    );
  });

  it('Test 4 (env-var-priority): DOTENV_PRIVATE_KEY env var takes priority over .env.keys', async () => {
    const tmpDir = makeTmp();
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(envPath, 'SECRET=priority\n');

    // Encrypt and capture the real private key
    const encResult = await encryptDotenvFile({ filePath: envPath });

    // Overwrite .env.keys with a bad key so we can verify env var is used instead
    const keysPath = path.join(tmpDir, '.env.keys');
    fs.writeFileSync(keysPath, 'DOTENV_PRIVATE_KEY="0000000000000000000000000000000000000000000000000000000000000001"\n');

    process.env.DOTENV_PRIVATE_KEY = encResult.privateKeyHex;

    const outputPath = path.join(tmpDir, '.env.out');
    const decResult = await decryptDotenvFile({ filePath: envPath, outputPath });

    expect(decResult.decryptedCount).toBe(1);
    const content = fs.readFileSync(outputPath, 'utf8');
    expect(content).toContain('SECRET="priority"');
  });

  it('Test 5 (no-cli-key-flag): --key flag is not parsed by main arg parser (programmatic api still accepts privateKeyHex)', async () => {
    // Verify that the programmatic API still works with explicit privateKeyHex
    const tmpDir = makeTmp();
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(envPath, 'SECRET=programmatic\n');

    const encResult = await encryptDotenvFile({ filePath: envPath });
    // Remove .env.keys
    fs.rmSync(path.join(tmpDir, '.env.keys'));
    delete process.env.DOTENV_PRIVATE_KEY;

    const outputPath = path.join(tmpDir, '.env.out');
    const decResult = await decryptDotenvFile({
      filePath: envPath,
      outputPath,
      privateKeyHex: encResult.privateKeyHex,
    });

    expect(decResult.decryptedCount).toBe(1);
    const content = fs.readFileSync(outputPath, 'utf8');
    expect(content).toContain('SECRET="programmatic"');
  });

  it('Test 6 (round-trip): encrypt then decrypt restores all original values', async () => {
    const tmpDir = makeTmp();
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(envPath, 'ALPHA=one\nBETA=two\nGAMMA=three\n');

    await encryptDotenvFile({ filePath: envPath });
    delete process.env.DOTENV_PRIVATE_KEY;

    const outputPath = path.join(tmpDir, '.env.out');
    const decResult = await decryptDotenvFile({ filePath: envPath, outputPath });

    expect(decResult.decryptedCount).toBe(3);
    expect(decResult.skippedCount).toBe(0);

    const content = fs.readFileSync(outputPath, 'utf8');
    expect(content).toContain('ALPHA="one"');
    expect(content).toContain('BETA="two"');
    expect(content).toContain('GAMMA="three"');
    // Public key should be stripped from output
    expect(content).not.toContain('DOTENV_PUBLIC_KEY');
  });
});
