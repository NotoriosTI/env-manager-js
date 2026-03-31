import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

import type { SecretLoader } from '../types.js';

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

  constructor(dotenvPath?: string | null) {
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
   * If the file is needed but was explicitly requested and is missing,
   * throw a descriptive error.
   */
  async get(key: string): Promise<string | null> {
    // process.env always wins (nullish — preserves empty string)
    if (process.env[key] !== undefined) {
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

    return this.parsedValues[key] !== undefined ? this.parsedValues[key] : null;
  }

  /**
   * Look up multiple keys.
   * Returns a record where missing keys map to null.
   */
  async getMany(keys: readonly string[]): Promise<Record<string, string | null>> {
    const result: Record<string, string | null> = {};
    for (const key of keys) {
      result[key] = await this.get(key);
    }
    return result;
  }
}
