import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as factory from '../src/factory.js';
import { ConfigManager } from '../src/manager.js';
import { writeRepoConfig } from './helpers.js';

const tempDirs: string[] = [];

function createRepoRoot(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'env-manager-optional-'));
  tempDirs.push(repoRoot);
  return repoRoot;
}

function createFakeLoader(values: Record<string, string | null>) {
  return {
    get: vi.fn((key: string) => values[key] ?? null),
    getMany: vi.fn((keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, values[key] ?? null])),
    ),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();

  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
});

describe('optional source handling', () => {
  it('default-only vars resolve from YAML without creating a loader', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      variables:
        LOG_LEVEL:
          type: str
          default: info
      `,
    );
    const loaderSpy = vi.spyOn(factory, 'createLoader');

    const manager = new ConfigManager(configPath);

    expect(manager.get('LOG_LEVEL')).toBe('info');
    expect(loaderSpy).not.toHaveBeenCalled();
  });

  it('default-only var ignores same-named process.env', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      variables:
        LOG_LEVEL:
          type: str
          default: info
      `,
    );
    vi.stubEnv('LOG_LEVEL', 'debug');

    const manager = new ConfigManager(configPath);

    expect(manager.get('LOG_LEVEL')).toBe('info');
  });

  it('source+default uses loader value when present', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      variables:
        API_TOKEN:
          source: API_TOKEN
          type: str
          default: fallback-token
      `,
    );
    vi.spyOn(factory, 'createLoader').mockReturnValue(
      createFakeLoader({ API_TOKEN: 'from-loader' }) as never,
    );

    const manager = new ConfigManager(configPath);

    expect(manager.get('API_TOKEN')).toBe('from-loader');
  });

  it('source+default falls back to default when source missing', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      variables:
        API_TOKEN:
          source: API_TOKEN
          type: str
          default: fallback-token
      `,
    );
    vi.spyOn(factory, 'createLoader').mockReturnValue(createFakeLoader({ API_TOKEN: null }) as never);

    const manager = new ConfigManager(configPath);

    expect(manager.get('API_TOKEN')).toBe('fallback-token');
  });

  it('mixed config only fetches sourced variables from loader', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      variables:
        LOG_LEVEL:
          type: str
          default: info
        API_TOKEN:
          source: API_TOKEN
          type: str
        WORKERS:
          type: int
          default: 4
      `,
    );
    const fakeLoader = createFakeLoader({ API_TOKEN: 'from-loader' });
    vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);

    const manager = new ConfigManager(configPath);

    expect(manager.get('LOG_LEVEL')).toBe('info');
    expect(manager.get('API_TOKEN')).toBe('from-loader');
    expect(manager.get('WORKERS')).toBe(4);
    expect(fakeLoader.getMany).toHaveBeenCalledWith(['API_TOKEN']);
  });

  it('neither source nor default throws ValueError', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      variables:
        TEST_VAR:
          type: str
      `,
    );

    expect(() => new ConfigManager(configPath)).toThrow("must define either 'source' or 'default'");
  });
});
