/**
 * Contrato del dispatcher `env-manager <acción>` (blueprint §1.7).
 * Espejo de tests/test_cli_main.py en el repo Python.
 */
import { execFileSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { beforeAll, describe, expect, it } from 'vitest';

import * as exitCodes from '../src/cli/exitCodes.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = join(repoRoot, 'dist', 'main.js');

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], input = ''): RunResult {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      encoding: 'utf-8',
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error: unknown) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

beforeAll(() => {
  if (!existsSync(cliPath)) {
    throw new Error(`dist/main.js no existe. Corre 'npm run build' antes de estos tests.`);
  }
});

describe('exit codes', () => {
  it('--help es éxito', () => {
    const result = runCli(['--help']);
    expect(result.code).toBe(exitCodes.OK);
    expect(result.stdout).toContain('env-manager');
    expect(result.stdout).toContain('--allow-empty');
  });

  it('sin acción es error de uso', () => {
    expect(runCli([]).code).toBe(exitCodes.USAGE);
  });

  it('acción desconocida es error de uso', () => {
    expect(runCli(['bogus']).code).toBe(exitCodes.USAGE);
  });

  it('--format inválido es error de uso', () => {
    expect(runCli(['encrypt', 'x', '--format', 'bogus']).code).toBe(exitCodes.USAGE);
  });

  it('archivo inexistente es error de operación', () => {
    const result = runCli(['decrypt', '/tmp/env-manager-does-not-exist.env']);
    expect(result.code).toBe(exitCodes.OPERATION);
    expect(result.stderr).toContain('File not found');
  });

  it.each([
    [['secrets']],
    [['secrets', 'set', 'app-config', '--key', 'K']],
    [['secrets', 'list', 'app-config']],
  ])('invocación incompleta de secrets (%j) es error de uso', (args) => {
    expect(runCli(args as string[]).code).toBe(exitCodes.USAGE);
  });

  it.each([
    ['encrypt', 'config.env', '--allow-empty'],
    ['decrypt', 'config.env', '--allow-empty'],
    ['secrets', 'list', 'app-config', '--project', 'project', '--allow-empty'],
  ])('rechaza --allow-empty fuera de secrets set (%j)', (...args) => {
    const result = runCli(args);

    expect(result.code).toBe(exitCodes.USAGE);
    expect(result.stderr).toContain("--allow-empty is only valid for 'secrets set'");
    expect(result.stdout).toBe('');
  });

  it('acepta --allow-empty en secrets set y continúa con la validación normal', () => {
    const result = runCli([
      'secrets',
      'set',
      'app-config',
      '--key',
      'K',
      '--allow-empty',
    ]);

    expect(result.code).toBe(exitCodes.USAGE);
    expect(result.stderr).toContain('--project is required');
    expect(result.stderr).not.toContain("only valid for 'secrets set'");
  });
});

describe('streams', () => {
  it('--version sale solo por stdout', () => {
    const result = runCli(['--version']);
    expect(result.code).toBe(exitCodes.OK);
    expect(result.stdout.trim()).not.toBe('');
    expect(result.stderr).toBe('');
  });

  it('los errores van a stderr, no a stdout', () => {
    const result = runCli(['decrypt', '/tmp/env-manager-does-not-exist.env']);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Error:');
  });
});

describe('alias deprecados', () => {
  it.each([
    ['legacy-encrypt.js', 'env-manager-encrypt'],
    ['legacy-decrypt.js', 'env-manager-decrypt'],
  ])('%s avisa por stderr y delega', (file, name) => {
    const result = spawnSync('node', [join(repoRoot, 'dist', file), '--help'], {
      encoding: 'utf-8',
    });
    expect(result.status).toBe(exitCodes.OK);
    expect(result.stderr).toContain('deprecated');
    expect(result.stderr).toContain(name);
    expect(result.stdout).toContain('env-manager');
  });
});
