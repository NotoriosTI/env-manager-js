import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

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
