import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { decrypt } from 'eciesjs';

import { DecryptionError } from '../errors.js';
import type { DecryptionIssue, SecretLoader } from '../types.js';

/**
 * Walk upward from `startDir` looking for a `.env` file.
 * Returns the first `.env` path found, or null if none is found before
 * reaching the filesystem root.
 */
function findDotenv(startDir: string = process.cwd()): string | null {
  let current = path.resolve(startDir);

  while (true) {
    const candidate = path.join(current, '.env');
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      // Reached filesystem root with no .env found
      return null;
    }
    current = parent;
  }
}

const ENCRYPTED_PREFIX = 'encrypted:';

function isEncryptedValue(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Normalize an environment name to a valid env-var suffix.
 * e.g. "prod.us-east-1" → "PROD_US_EAST_1"
 *      "staging.blue"   → "STAGING_BLUE"
 */
function normalizeEnvName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

/**
 * Resolve the private key for ECIES decryption using the default lookup chain.
 *
 * Chain (first hit wins):
 *   1. DOTENV_PRIVATE_KEY_<NORMALIZED_ENV>  (only when environmentName is non-empty)
 *   2. DOTENV_PRIVATE_KEY
 *   3. DOTENV_PRIVATE_KEY entry in colocated .env.keys file
 *
 * Old-format (no environmentName): only steps 2 and 3 are checked.
 */
function resolvePrivateKey(
  environmentName: string | undefined,
  dotenvFilePath: string,
): string | null {
  // Step 1: env-specific key (only when environmentName is present)
  if (environmentName != null && environmentName !== '') {
    const suffix = normalizeEnvName(environmentName);
    const envSpecificKey = `DOTENV_PRIVATE_KEY_${suffix}`;
    if (process.env[envSpecificKey] != null) {
      return process.env[envSpecificKey]!;
    }
  }

  // Step 2: generic key
  if (process.env.DOTENV_PRIVATE_KEY != null) {
    return process.env.DOTENV_PRIVATE_KEY;
  }

  // Step 3: colocated .env.keys file (relative to the actual dotenv file location)
  const dotenvDir = path.dirname(dotenvFilePath);
  const keysFilePath = path.join(dotenvDir, '.env.keys');
  if (fs.existsSync(keysFilePath)) {
    console.warn(
      '[env-manager] Warning: .env.keys found in the same directory as your encrypted file. Move it to a secure location outside the project.',
    );
    try {
      const keysContent = fs.readFileSync(keysFilePath);
      const keysValues = dotenv.parse(keysContent);
      if (keysValues.DOTENV_PRIVATE_KEY != null) {
        return keysValues.DOTENV_PRIVATE_KEY;
      }
    } catch {
      // Silently ignore unreadable .env.keys
    }
  }

  return null;
}

/**
 * Attempt ECIES decryption of a dotenvx-compatible `encrypted:` base64 payload.
 *
 * Throws on decryption failure (wrong key, corrupted payload, etc).
 */
function decryptEcies(cipherB64: string, privateKeyHex: string): string {
  const cipherBuf = Buffer.from(cipherB64, 'base64');
  const privateKeyBuf = Buffer.from(privateKeyHex, 'hex');
  return Buffer.from(decrypt(privateKeyBuf, cipherBuf)).toString('utf8');
}

export interface DotEnvLoaderOptions {
  /**
   * Enable encrypted dotenv support.
   * When true, `encrypted:` prefixed values are decrypted on demand.
   * Plaintext values and files with no encrypted entries are unaffected.
   */
  encrypted?: boolean;
  /**
   * Environment name used to derive an env-specific private key name.
   * e.g. "staging.blue" → looks up DOTENV_PRIVATE_KEY_STAGING_BLUE first.
   * When absent, only DOTENV_PRIVATE_KEY and the .env.keys fallback are checked.
   */
  environmentName?: string;
  /**
   * Pre-resolved private key hex string.
   * When present, this key is used directly for decryption, bypassing
   * the default DOTENV_PRIVATE_KEY chain entirely.
   */
  explicitPrivateKey?: string | null;
}

export class DotEnvLoader implements SecretLoader {
  readonly dotenvPath: string | null;

  /**
   * `parsedValues` holds the file-backed snapshot.
   * It is null when:
   *   - no explicit path was provided AND discovery found nothing
   *   - the explicit path does not exist (deferred-error case)
   */
  private readonly parsedValues: Record<string, string> | null;

  /**
   * When an explicit path was requested but the file did not exist at
   * construction time we remember that intent so we can throw a useful
   * error the first time a lookup would need the file-backed data.
   */
  private readonly missingExplicitFile: boolean;

  /** Whether encrypted dotenv decryption is enabled. */
  private readonly encryptedEnabled: boolean;

  /** Optional environment name for env-specific private key derivation. */
  private readonly environmentName: string | undefined;

  /**
   * Pre-resolved private key. When non-null, bypasses the default key-chain
   * lookup inside _tryDecrypt.
   */
  private readonly explicitPrivateKey: string | null;

  constructor(dotenvPath?: string | null, options?: DotEnvLoaderOptions) {
    this.encryptedEnabled = options?.encrypted === true;
    this.environmentName = options?.environmentName;
    this.explicitPrivateKey = options?.explicitPrivateKey ?? null;

    if (dotenvPath != null) {
      // Explicit path supplied
      this.dotenvPath = dotenvPath;

      if (fs.existsSync(dotenvPath)) {
        const raw = fs.readFileSync(dotenvPath);
        this.parsedValues = dotenv.parse(raw);
        this.missingExplicitFile = false;
      } else {
        // File does not exist yet — defer the error
        this.parsedValues = null;
        this.missingExplicitFile = true;
      }
    } else {
      // Auto-discover
      const discovered = findDotenv();
      this.dotenvPath = discovered;

      if (discovered !== null) {
        const raw = fs.readFileSync(discovered);
        this.parsedValues = dotenv.parse(raw);
      } else {
        this.parsedValues = null;
      }
      this.missingExplicitFile = false;
    }
  }

  /**
   * Look up a single key.
   *
   * Precedence: process.env > file-backed values > null
   *
   * If `process.env[key]` is defined (even as empty string) it wins.
   * If the file is needed but was explicitly requested and is missing, throw.
   *
   * When encrypted mode is enabled, `encrypted:` prefixed values are decrypted
   * lazily. A DecryptionError with one issue is thrown when decryption fails.
   */
  async get(key: string): Promise<string | null> {
    // process.env always wins (nullish — preserves empty string)
    if (process.env[key] !== undefined) {
      // Warn only when the key also exists in the encrypted file, to avoid noise
      // from keys that were never in the file.
      if (this.parsedValues !== null && key in this.parsedValues) {
        console.warn(`[env-manager] Key "${key}" is being overridden by process.env`);
      }
      return process.env[key] as string;
    }

    // Need file-backed data from here on
    if (this.parsedValues === null) {
      if (this.missingExplicitFile) {
        throw new Error(
          `DotEnvLoader: dotenv file not found: ${this.dotenvPath}`,
        );
      }
      // No file and no explicit request — treat as missing key
      return null;
    }

    const rawValue = this.parsedValues[key] !== undefined ? this.parsedValues[key] : null;

    if (rawValue === null) {
      return null;
    }

    if (this.encryptedEnabled && isEncryptedValue(rawValue)) {
      return this._decryptSingleOrThrow(key, rawValue);
    }

    return rawValue;
  }

  /**
   * Look up multiple keys.
   * Returns a record where missing keys map to null.
   *
   * When encrypted mode is enabled, all encrypted values are decrypted.
   * If any decryption fails, a single DecryptionError is thrown that aggregates
   * all failed keys for the batch.
   */
  async getMany(keys: readonly string[]): Promise<Record<string, string | null>> {
    if (!this.encryptedEnabled) {
      // Fast path: no encryption — delegate to plain get() for each key
      const result: Record<string, string | null> = {};
      for (const key of keys) {
        result[key] = await this.get(key);
      }
      return result;
    }

    // Encrypted path: resolve raw values, collect all decryption issues before throwing.
    const result: Record<string, string | null> = {};
    const issues: DecryptionIssue[] = [];

    for (const key of keys) {
      // process.env wins
      if (process.env[key] !== undefined) {
        result[key] = process.env[key] as string;
        continue;
      }

      if (this.parsedValues === null) {
        if (this.missingExplicitFile) {
          throw new Error(`DotEnvLoader: dotenv file not found: ${this.dotenvPath}`);
        }
        result[key] = null;
        continue;
      }

      const rawValue = this.parsedValues[key] !== undefined ? this.parsedValues[key] : null;

      if (rawValue === null) {
        result[key] = null;
        continue;
      }

      if (isEncryptedValue(rawValue)) {
        const issue = this._tryDecrypt(key, rawValue);
        if (issue.error != null) {
          issues.push({ key, message: issue.error });
          result[key] = null;
        } else {
          result[key] = issue.value!;
        }
      } else {
        result[key] = rawValue;
      }
    }

    if (issues.length > 0) {
      throw new DecryptionError(issues);
    }

    return result;
  }

  /**
   * Attempt to decrypt a single encrypted value, returning either the plaintext
   * or a structured error description (never throws).
   */
  private _tryDecrypt(
    key: string,
    rawValue: string,
  ): { value: string; error: null } | { value: null; error: string } {
    const cipherB64 = rawValue.slice(ENCRYPTED_PREFIX.length);
    const effectivePath = this.dotenvPath ?? process.cwd();
    const privateKey =
      this.explicitPrivateKey != null
        ? this.explicitPrivateKey
        : resolvePrivateKey(this.environmentName, effectivePath);

    if (privateKey == null) {
      return { value: null, error: 'No private key found for decryption' };
    }

    try {
      const plaintext = decryptEcies(cipherB64, privateKey);
      return { value: plaintext, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { value: null, error: message };
    }
  }

  /**
   * Decrypt a single encrypted value, throwing a DecryptionError (with one issue)
   * on failure. Used by `get()` for single-key lookups.
   */
  private _decryptSingleOrThrow(key: string, rawValue: string): string {
    const result = this._tryDecrypt(key, rawValue);
    if (result.error != null) {
      throw new DecryptionError([{ key, message: result.error }]);
    }
    return result.value;
  }
}
