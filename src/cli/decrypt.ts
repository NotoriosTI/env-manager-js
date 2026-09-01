import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrivateKey, decrypt } from 'eciesjs';

export interface DecryptOptions {
  /** Path to the encrypted .env file */
  filePath: string;
  /** Hex private key — if omitted, read from colocated .env.keys */
  privateKeyHex?: string;
  /** Write decrypted output here instead of overwriting the input file */
  outputPath?: string;
}

export interface DecryptResult {
  decryptedCount: number;
  skippedCount: number;
}

function loadPrivateKeyFromKeysFile(envFilePath: string, envName?: string): string {
  const keysFilePath = path.join(path.dirname(envFilePath), '.env.keys');
  if (!fs.existsSync(keysFilePath)) {
    throw new Error(`.env.keys not found at ${keysFilePath}. Provide a key with --key.`);
  }
  const parsed = dotenv.parse(fs.readFileSync(keysFilePath));
  if (envName != null && envName !== '') {
    const normalized = envName.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    const varName = `DOTENV_PRIVATE_KEY_${normalized}`;
    const key = parsed[varName];
    if (!key) throw new Error(`${varName} not found in .env.keys`);
    return key;
  }
  const key = parsed['DOTENV_PRIVATE_KEY'];
  if (!key) throw new Error('DOTENV_PRIVATE_KEY not found in .env.keys');
  return key;
}

/**
 * Decrypt all `encrypted:` prefixed values in a dotenvx-compatible .env file,
 * restoring the original plaintext values.
 *
 * Behavior:
 * - Reads the private key from .env.keys unless --key is provided.
 * - Strips the DOTENV_PUBLIC_KEY line from the output.
 * - Strips the dotenvx header comment block from the output.
 * - Skips values not prefixed with `encrypted:`.
 * - Writes plaintext to outputPath (or overwrites the input file).
 */
export async function decryptDotenvFile(options: DecryptOptions, envName?: string): Promise<DecryptResult> {
  const { filePath, outputPath } = options;
  let { privateKeyHex } = options;

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath);
  const parsed = dotenv.parse(raw);

  if (!privateKeyHex) {
    privateKeyHex = loadPrivateKeyFromKeysFile(filePath, envName);
  }

  const privateKeyBuf = Buffer.from(privateKeyHex, 'hex');

  let decryptedCount = 0;
  let skippedCount = 0;

  const decryptedEntries: Record<string, string> = {};
  for (const [k, value] of Object.entries(parsed)) {
    if (k === 'DOTENV_PUBLIC_KEY') {
      // Strip from output — no longer needed after decryption
      continue;
    }
    if (value.startsWith('encrypted:')) {
      const cipherB64 = value.slice('encrypted:'.length);
      const cipherBuf = Buffer.from(cipherB64, 'base64');
      const plaintext = Buffer.from(decrypt(privateKeyBuf, cipherBuf)).toString('utf8');
      decryptedEntries[k] = plaintext;
      decryptedCount++;
    } else {
      decryptedEntries[k] = value;
      skippedCount++;
    }
  }

  const bodyLines = Object.entries(decryptedEntries)
    .map(([k, v]) => `${k}="${v}"`)
    .join('\n');
  const envContent = bodyLines + '\n';

  const effectiveOutputPath = outputPath ?? filePath;
  fs.writeFileSync(effectiveOutputPath, envContent, 'utf8');

  return { decryptedCount, skippedCount };
}
