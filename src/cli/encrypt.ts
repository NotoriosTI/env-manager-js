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
  /** If provided, write the encrypted .env to this path instead of overwriting the input file. The input file is left unchanged. */
  outputPath?: string;
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
  const { filePath, force = false, env, outputPath } = options;

  const effectiveOutputPath = outputPath ?? filePath;
  const keysDir = path.dirname(effectiveOutputPath);
  const keysFilePath = path.join(keysDir, '.env.keys');

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
  const privateKeyHex = Buffer.from(key.secret).toString('hex'); // 64-char hex

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
      encryptedEntries[k] = 'encrypted:' + Buffer.from(cipherBuf).toString('base64');
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

  // Write the encrypted .env to effectiveOutputPath (overwrite input or separate output file)
  fs.writeFileSync(effectiveOutputPath, envContent, 'utf8');

  // Build .env.keys content
  const basename = path.basename(filePath);
  const privateKeyVarName = env != null && env !== ''
    ? `DOTENV_PRIVATE_KEY_${normalizeEnvName(env)}`
    : 'DOTENV_PRIVATE_KEY';
  const keysContent = `# ${basename}\n${privateKeyVarName}="${privateKeyHex}"\n`;

  // Write .env.keys
  fs.writeFileSync(keysFilePath, keysContent, 'utf8');
  console.warn(
    `[env-manager] Warning: .env.keys was written to the same directory as your encrypted file (${keysDir}). Move it to a secure location outside the project.`,
  );

  return { publicKeyHex, privateKeyHex, encryptedCount, skippedCount };
}
