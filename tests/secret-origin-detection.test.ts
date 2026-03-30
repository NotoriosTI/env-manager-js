import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as factory from '../src/factory.js';
import { ConfigManager } from '../src/manager.js';
import { writeRepoConfig } from './helpers.js';

const tempDirs: string[] = [];

function createRepoRoot(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'env-manager-secret-origin-'));
  tempDirs.push(repoRoot);
  return repoRoot;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();

  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
});

describe('secret origin detection', () => {
  it('reads SECRET_ORIGIN and GCP_PROJECT_ID from .env file', () => {
    const repoRoot = createRepoRoot();
    const configPath = writeRepoConfig(
      repoRoot,
      `
      environments:
        local:
          origin: local
          dotenv_path: .env
          default: true
        production:
          origin: gcp
          gcp_project_id: fallback-project
      variables:
        TEST_VAR:
          source: TEST_VAR
          type: str
          required: true
      `,
    );
    writeFileSync(
      join(repoRoot, '.env'),
      'SECRET_ORIGIN=gcp\nGCP_PROJECT_ID=my-project\nTEST_VAR=from-dotenv\n',
      'utf8',
    );
    const fakeLoader = {
      get: vi.fn().mockReturnValue('from-gcp-loader'),
      getMany: vi.fn().mockReturnValue({ TEST_VAR: 'from-gcp-loader' }),
    };
    vi.spyOn(factory, 'createLoader').mockReturnValue(fakeLoader as never);

    const manager = new ConfigManager(configPath);

    expect(manager.get('TEST_VAR')).toBe('from-gcp-loader');
    expect(factory.createLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        secretOrigin: 'gcp',
        gcpProjectId: 'my-project',
      }),
    );
  });
});
