import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export const DOTENVX_PUBLIC_KEY =
  '037cfbfc90234cfdab7eb54050566293789efaa1a35dc420749662db400dc9c4b2';
export const DOTENVX_PRIVATE_KEY =
  '81dac4d2c42e67a2c6542d3b943a4674a05c4be5e7e5a40a689be7a3bd49a07e';
export const DOTENVX_ENCRYPTED_HELLO =
  'encrypted:BAZb6wDPFaFeFzq8Ut48oiNFSPtYvJmv4AwVDFVcNKiIcGxrxuRIFGWxZ3xVjxOgOo6w65bWFTpAfbatSz52+VvwDYZ3nFUO828nzovH5ZhsIoxPuPb7K0ZphmNynR7Hxci4a+fB';

/**
 * Write dedented YAML text to tmpDir/config.yaml and return the path.
 * Mirrors Python's write_config() helper in conftest.py.
 */
export function writeConfig(tmpDir: string, yamlText: string): string {
  const configPath = join(tmpDir, 'config.yaml');
  writeFileSync(configPath, yamlText, 'utf8');
  return configPath;
}

/**
 * Write content to tmpDir/.env and return the path.
 * Mirrors Python's write_env() helper in conftest.py.
 */
export function writeEnv(tmpDir: string, content = 'DB_PASSWORD=secret123\n'): string {
  const envPath = join(tmpDir, '.env');
  writeFileSync(envPath, content, 'utf8');
  return envPath;
}

export function writeText(path: string, content: string): string {
  writeFileSync(path, content, 'utf8');
  return path;
}

export function buildEncryptedEnvText(lines: string[] = []): string {
  return [
    '#/-------------------[DOTENV_PUBLIC_KEY]--------------------/',
    '#/            public-key encryption for .env files          /',
    '#/----------------------------------------------------------/',
    `DOTENV_PUBLIC_KEY="${DOTENVX_PUBLIC_KEY}"`,
    `HELLO="${DOTENVX_ENCRYPTED_HELLO}"`,
    'PLAIN=still-plain',
    ...lines,
    '',
  ].join('\n');
}

export function writeEncryptedEnv(tmpDir: string, lines: string[] = []): string {
  return writeEnv(
    tmpDir,
    buildEncryptedEnvText(lines),
  );
}

/**
 * Write a minimal package.json to repoRoot (NOT pyproject.toml -- this is the TS adaptation),
 * create repoRoot/config/, write dedented YAML to config.yaml, and return the config path.
 *
 * Mirrors Python's write_repo_config() which writes pyproject.toml.
 * The TS port uses package.json for project root discovery (locked decision -- STATE.md).
 */
export function writeRepoConfig(repoRoot: string, yamlText: string): string {
  writeFileSync(
    join(repoRoot, 'package.json'),
    JSON.stringify({ name: 'test-app', version: '0.0.1' }, null, 2),
    'utf8',
  );
  const configDir = join(repoRoot, 'config');
  mkdirSync(configDir, { recursive: true });
  return writeConfig(configDir, yamlText);
}
