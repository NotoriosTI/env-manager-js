import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrivateKey, decrypt } from 'eciesjs';

export interface DecryptOptions {
  /** Path to the encrypted .env file */
  filePath: string;
  /** Hex private key for programmatic use — CLI always uses DOTENV_PRIVATE_KEY env var or .env.keys */
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
    throw new Error(`.env.keys not found at ${keysFilePath}.`);
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
 * - Reads the private key from DOTENV_PRIVATE_KEY env var or .env.keys file.
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
    // Prefer environment variable over .env.keys file
    privateKeyHex = process.env.DOTENV_PRIVATE_KEY;
  }

  if (!privateKeyHex) {
    try {
      privateKeyHex = loadPrivateKeyFromKeysFile(filePath, envName);
    } catch {
      throw new Error(
        'No private key found. Set DOTENV_PRIVATE_KEY environment variable or provide a .env.keys file.'
      );
    }
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

function printUsage(): void {
  console.log(`Usage: env-manager-decrypt <file> [options]

Decrypt a dotenvx-compatible encrypted .env file back to plaintext.

Arguments:
  file               Path to the encrypted .env file

Options:
  --env <name>       Environment name (reads DOTENV_PRIVATE_KEY_<NAME> from .env.keys)
  -o, --output <file>  Write decrypted output to this file instead of overwriting the input
  --help             Show this help message

Key resolution order:
  1. DOTENV_PRIVATE_KEY environment variable
  2. .env.keys file co-located with the encrypted file`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.length === 0) {
    printUsage();
    process.exit(args.includes('--help') ? 0 : 1);
    return;
  }

  let filePath: string | undefined;
  let env: string | undefined;
  let outputPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env' && i + 1 < args.length) {
      env = args[++i];
    } else if ((args[i] === '-o' || args[i] === '--output') && i + 1 < args.length) {
      outputPath = args[++i];
    } else if (!args[i].startsWith('--') && !args[i].startsWith('-')) {
      filePath = args[i];
    }
  }

  if (!filePath) {
    console.error('Error: No file path provided');
    printUsage();
    process.exit(1);
    return;
  }

  try {
    const result = await decryptDotenvFile({ filePath, outputPath }, env);
    console.log(`Decrypted ${result.decryptedCount} value(s), skipped ${result.skippedCount} plaintext value(s)`);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

const isMain = process.argv[1] != null && (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1].endsWith('/env-manager-decrypt') ||
  process.argv[1].endsWith('\\env-manager-decrypt')
);

if (isMain) {
  main();
}
