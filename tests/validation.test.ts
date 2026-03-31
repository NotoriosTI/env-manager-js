import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { ConfigManager } from '../src/manager.js';
import { writeConfig, writeEnv } from './helpers.js';

const tmpDirs: string[] = [];

function createTempDir(): string {
  const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-validation-'));
  tmpDirs.push(tmpDir);
  return tmpDir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop()!, { force: true, recursive: true });
  }
});

describe('validation', () => {
  it('constructor strict=false overrides YAML strict=true', async () => {
    const tmpDir = createTempDir();
    const configPath = writeConfig(
      tmpDir,
      `
validation:
  strict: true
  required:
    - DB_PASSWORD
variables:
  DB_PASSWORD:
    source: DB_PASSWORD
    type: str
`,
    );
    const dotenvPath = writeEnv(tmpDir, '');

    const manager = new ConfigManager(configPath, { dotenvPath, strict: false });
    await manager.load();

    expect(manager.get('DB_PASSWORD')).toBeNull();
  });
});
