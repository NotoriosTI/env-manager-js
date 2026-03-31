import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it, test } from 'vitest';

import { ConfigManager } from '../src/manager.js';
import { writeConfig, writeEnv } from './helpers.js';

const tmpDirs: string[] = [];

function createTmpDir(): string {
  const tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-js-'));
  tmpDirs.push(tmpDir);
  return tmpDir;
}

async function createManager(yamlText: string): Promise<ConfigManager> {
  const tmpDir = createTmpDir();
  const configPath = writeConfig(tmpDir, yamlText);
  const dotenvPath = writeEnv(tmpDir, '');

  const manager = new ConfigManager(configPath, { dotenvPath });
  await manager.load();
  return manager;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop()!, { force: true, recursive: true });
  }
});

describe('bool to string coercion', () => {
  test.each([
    [true, 'true'],
    [false, 'false'],
  ])('YAML bool %s coerced to string "%s"', async (yamlValue, expected) => {
    const manager = await createManager(`
variables:
  FEATURE_FLAG:
    source: FEATURE_FLAG
    type: str
    default: ${yamlValue}
`);

    expect(manager.get('FEATURE_FLAG')).toBe(expected);
  });

  it('YAML int 8080 coerced to string "8080"', async () => {
    const manager = await createManager(`
variables:
  PORT:
    source: PORT
    type: str
    default: 8080
`);

    expect(manager.get('PORT')).toBe('8080');
  });
});
