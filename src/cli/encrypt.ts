import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrivateKey, encrypt } from 'eciesjs';

export interface EncryptOptions {
  /** Path to the .env file to encrypt */
  filePath: string;
  /** Overwrite existing .env.keys if present */
  force?: boolean;
  /** Environment name — if set, private key is written as DOTENV_PRIVATE_KEY_<NORMALIZED> */
  env?: string;
}

export interface EncryptResult {
  publicKeyHex: string;
  privateKeyHex: string;
  encryptedCount: number;
  skippedCount: number;
}

/**
 * Normalize an environment name to a valid env-var suffix.
 * e.g. "prod.us-east-1" → "PROD_US_EAST_1"
 *      "staging.blue"   → "STAGING_BLUE"
 */
function normalizeEnvName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

const DOTENVX_HEADER = [
  '#/-------------------[DOTENV_PUBLIC_KEY]--------------------/',
  '#/            public-key encryption for .env files          /',
  '#/       [how it works](https://dotenvx.com/encryption)     /',
  '#/----------------------------------------------------------/',
].join('\n');

/**
 * Encrypt all plaintext values in a dotenv file using ECIES (secp256k1),
 * producing a dotenvx-compatible encrypted `.env` file and a colocated `.env.keys` file.
 *
 * Behavior:
 * - Generates a fresh secp256k1 key pair.
 * - Rewrites each plaintext value as `encrypted:<base64>`.
 * - Skips values already prefixed with `encrypted:`.
 * - Skips (never encrypts) the DOTENV_PUBLIC_KEY variable.
 * - Refuses if `.env.keys` already exists unless `force` is set.
 * - Refuses if the file already contains DOTENV_PUBLIC_KEY (already encrypted).
 * - Writes the private key to `.env.keys` in the same directory.
 */
export async function encryptDotenvFile(options: EncryptOptions): Promise<EncryptResult> {
  const { filePath, force = false, env } = options;

  const fileDir = path.dirname(filePath);
  const keysFilePath = path.join(fileDir, '.env.keys');

  // Guard: refuse if .env.keys exists and force is not set
  if (fs.existsSync(keysFilePath) && !force) {
    throw new Error(
      `.env.keys already exists at ${keysFilePath}. Use force to overwrite.`,
    );
  }

  // Parse the existing .env file
  const raw = fs.readFileSync(filePath);
  const parsed = dotenv.parse(raw);

  // Guard: refuse if file already has DOTENV_PUBLIC_KEY (pitfall 2 — would invalidate existing encrypted values)
  if (parsed['DOTENV_PUBLIC_KEY'] != null) {
    throw new Error(
      'File already has DOTENV_PUBLIC_KEY — encryption already applied. Use --rotate to re-encrypt.',
    );
  }

  // Generate a new secp256k1 key pair
  const key = new PrivateKey();
  const publicKeyHex = key.publicKey.toHex(); // 66-char compressed hex
  const privateKeyHex = key.secret.toString('hex'); // 64-char hex

  let encryptedCount = 0;
  let skippedCount = 0;

  // Encrypt each entry
  const encryptedEntries: Record<string, string> = {};
  for (const [k, value] of Object.entries(parsed)) {
    if (k === 'DOTENV_PUBLIC_KEY') {
      // Should not occur after guard above, but be defensive
      encryptedEntries[k] = value;
      skippedCount++;
    } else if (value.startsWith('encrypted:')) {
      encryptedEntries[k] = value;
      skippedCount++;
    } else {
      const cipherBuf = encrypt(publicKeyHex, Buffer.from(value, 'utf8'));
      encryptedEntries[k] = 'encrypted:' + cipherBuf.toString('base64');
      encryptedCount++;
    }
  }

  // Build the output .env content
  const headerBlock = DOTENVX_HEADER + '\n';
  const publicKeyLine = `DOTENV_PUBLIC_KEY="${publicKeyHex}"`;
  const bodyLines = Object.entries(encryptedEntries)
    .map(([k, v]) => `${k}="${v}"`)
    .join('\n');
  const envContent = headerBlock + publicKeyLine + '\n' + bodyLines + '\n';

  // Write the encrypted .env back (overwrite)
  fs.writeFileSync(filePath, envContent, 'utf8');

  // Build .env.keys content
  const basename = path.basename(filePath);
  const privateKeyVarName = env != null && env !== ''
    ? `DOTENV_PRIVATE_KEY_${normalizeEnvName(env)}`
    : 'DOTENV_PRIVATE_KEY';
  const keysContent = `# ${basename}\n${privateKeyVarName}="${privateKeyHex}"\n`;

  // Write .env.keys
  fs.writeFileSync(keysFilePath, keysContent, 'utf8');

  return { publicKeyHex, privateKeyHex, encryptedCount, skippedCount };
}

function printUsage(): void {
  console.log(`Usage: env-manager-encrypt <file> [options]

Encrypt a .env file using dotenvx-compatible ECIES encryption.

Arguments:
  file            Path to the .env file to encrypt

Options:
  --env <name>    Environment name (writes DOTENV_PRIVATE_KEY_<NAME> in .env.keys)
  --force         Overwrite existing .env.keys file
  --help          Show this help message`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.length === 0) {
    printUsage();
    process.exit(args.includes('--help') ? 0 : 1);
    return;
  }

  // Parse arguments
  let filePath: string | undefined;
  let env: string | undefined;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env' && i + 1 < args.length) {
      env = args[++i];
    } else if (args[i] === '--force') {
      force = true;
    } else if (!args[i].startsWith('--')) {
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
    const result = await encryptDotenvFile({ filePath, env, force });
    console.log(`Encrypted ${result.encryptedCount} value(s), skipped ${result.skippedCount} already-encrypted value(s)`);
    console.log(`Public key:  ${result.publicKeyHex}`);
    console.log(`Private key written to .env.keys`);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// Only run main() when this file is the direct entry point (not when imported by tests or library consumers)
const isMain = process.argv[1] != null && (
  import.meta.url === `file://${process.argv[1]}` ||
  // Fallback for symlinked npm bin entries (process.argv[1] is the symlink, not the resolved path)
  process.argv[1].endsWith('/env-manager-encrypt') ||
  process.argv[1].endsWith('\\env-manager-encrypt')
);

if (isMain) {
  main();
}
