import type { DecryptionIssue } from './types.js';

/**
 * Thrown when one or more `encrypted:` dotenv values cannot be decrypted
 * during a single load attempt.
 *
 * Each element of `issues` describes one failed key. Callers can inspect
 * `issues[n].key` to identify which source keys could not be decrypted.
 */
export class DecryptionError extends Error {
  readonly issues: readonly DecryptionIssue[];

  constructor(issues: readonly DecryptionIssue[]) {
    const count = issues.length;
    const keyList = issues.map((i) => `'${i.key}'`).join(', ');
    super(
      `Decryption failed for ${count} key${count === 1 ? '' : 's'}: ${keyList}.`,
    );
    this.name = 'DecryptionError';
    this.issues = [...issues];
  }
}
