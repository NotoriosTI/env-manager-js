/**
 * Secreto JSON consolidado (blueprint §1.1).
 * Espejo de tests/test_consolidated_secret.py en el repo Python.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseEnvironments } from '../src/environment.js';
import { GCPSecretLoader } from '../src/loaders/gcp.js';
import { ConfigManager, _resetSingleton } from '../src/manager.js';

const tmpDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'env-manager-consolidated-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf8');
  tmpDirs.push(dir);
  return dir;
}

function payload(value: string) {
  return [{ payload: { data: Buffer.from(value, 'utf-8') } }] as [{ payload: { data: Buffer } }];
}

function notFound(): Error & { code: number } {
  const error = new Error('not found') as Error & { code: number };
  error.code = 5;
  return error;
}

/** Cliente falso: devuelve el payload registrado por nombre de secreto. */
function fakeClient(secrets: Record<string, string>) {
  const accessSecretVersion = vi.fn(async (request: { name: string }) => {
    const key = request.name.split('/secrets/')[1].split('/versions/')[0];
    if (!(key in secrets)) throw notFound();
    return payload(secrets[key]);
  });
  return { accessSecretVersion };
}

afterEach(() => {
  _resetSingleton();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  while (tmpDirs.length > 0) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('GCPSecretLoader con secreto consolidado', () => {
  it('precarga desde el JSON consolidado con un solo acceso', async () => {
    const client = fakeClient({ 'app-config': JSON.stringify({ A: '1', B: '2' }) });
    const loader = new GCPSecretLoader('proj', {
      createClient: () => client,
      consolidatedSecret: 'app-config',
    });

    await expect(loader.get('A')).resolves.toBe('1');
    await expect(loader.get('B')).resolves.toBe('2');

    // Un solo acceso a GSM en total: el del secreto consolidado.
    expect(client.accessSecretVersion).toHaveBeenCalledTimes(1);
  });

  it('serializa como JSON los valores que no son string', async () => {
    const client = fakeClient({
      'app-config': JSON.stringify({ PORT: 8080, FLAGS: { a: true } }),
    });
    const loader = new GCPSecretLoader('proj', {
      createClient: () => client,
      consolidatedSecret: 'app-config',
    });

    await expect(loader.get('PORT')).resolves.toBe('8080');
    await expect(loader.get('FLAGS')).resolves.toBe('{"a":true}');
  });

  it('getMany en paralelo hace un solo acceso, no uno por clave', async () => {
    // Regresión: la precarga guardaba un booleano, así que el primer get()
    // arrancaba el fetch y los demás seguían de largo sin esperarlo, cayendo a
    // búsqueda individual por cada clave. Lo destapó el test de integración
    // contra GSM real; acá queda cubierto sin credenciales.
    const client = fakeClient({
      'app-config': JSON.stringify({ A: '1', B: '2', C: '3' }),
    });
    const loader = new GCPSecretLoader('proj', {
      createClient: () => client,
      consolidatedSecret: 'app-config',
    });

    await expect(loader.getMany(['A', 'B', 'C'])).resolves.toEqual({
      A: '1',
      B: '2',
      C: '3',
    });

    expect(client.accessSecretVersion).toHaveBeenCalledTimes(1);
  });

  it('cae a secretos individuales para las claves ausentes', async () => {
    const client = fakeClient({
      'app-config': JSON.stringify({ A: '1' }),
      B: 'from-individual',
    });
    const loader = new GCPSecretLoader('proj', {
      createClient: () => client,
      consolidatedSecret: 'app-config',
    });

    await expect(loader.get('A')).resolves.toBe('1');
    await expect(loader.get('B')).resolves.toBe('from-individual');
    expect(client.accessSecretVersion).toHaveBeenCalledTimes(2);
  });

  it('un payload que no es JSON avisa y no rompe', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = fakeClient({ 'app-config': 'no soy json', A: 'individual' });
    const loader = new GCPSecretLoader('proj', {
      createClient: () => client,
      consolidatedSecret: 'app-config',
    });

    await expect(loader.get('A')).resolves.toBe('individual');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('is not valid JSON'));
  });

  it('un payload JSON que no es objeto avisa y no rompe', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = fakeClient({ 'app-config': '[1, 2, 3]', A: 'individual' });
    const loader = new GCPSecretLoader('proj', {
      createClient: () => client,
      consolidatedSecret: 'app-config',
    });

    await expect(loader.get('A')).resolves.toBe('individual');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('must be a JSON object'));
  });

  it('un consolidado inexistente avisa y cae a individuales', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = fakeClient({ A: 'individual' });
    const loader = new GCPSecretLoader('proj', {
      createClient: () => client,
      consolidatedSecret: 'app-config',
    });

    await expect(loader.get('A')).resolves.toBe('individual');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });
});

describe('parseEnvironments y consolidated_secret', () => {
  it('acepta consolidated_secret en un entorno gcp', () => {
    const parsed = parseEnvironments({
      environments: {
        production: {
          origin: 'gcp',
          gcp_project_id: 'proj',
          consolidated_secret: '  app-config  ',
        },
      },
    });
    expect(parsed.production.consolidatedSecret).toBe('app-config');
  });

  it('rechaza un consolidated_secret vacío', () => {
    expect(() =>
      parseEnvironments({
        environments: {
          production: { origin: 'gcp', gcp_project_id: 'proj', consolidated_secret: '   ' },
        },
      }),
    ).toThrow(/must be a non-empty string/);
  });

  it('deja consolidatedSecret en null cuando no se declara', () => {
    const parsed = parseEnvironments({
      environments: { production: { origin: 'gcp', gcp_project_id: 'proj' } },
    });
    expect(parsed.production.consolidatedSecret).toBeNull();
  });
});

describe('ConfigManager y consolidated_secret', () => {
  const configYaml = `
environments:
  production:
    origin: gcp
    gcp_project_id: proj
    consolidated_secret: app-config
    default: true

variables:
  A:
    source: A
    type: str
`;

  function writeConfig(dir: string, yaml: string): string {
    const configPath = join(dir, 'config.yaml');
    writeFileSync(configPath, yaml, 'utf8');
    return configPath;
  }

  it('toma el consolidated_secret del entorno activo', async () => {
    const dir = createTempDir();
    const configPath = writeConfig(dir, configYaml);
    const client = fakeClient({ 'app-config': JSON.stringify({ A: 'from-consolidated' }) });

    // El manager no permite inyectar el cliente de GSM, así que lo que se
    // verifica acá es la cadena de resolución: que el nombre llegue al
    // SourceContext, que es lo que el factory le pasa al loader.
    const manager = new ConfigManager(configPath);
    expect(manager._defaultSourceContext().consolidatedSecret).toBe('app-config');
    expect(client.accessSecretVersion).not.toHaveBeenCalled();
  });

  it('la env var CONSOLIDATED_SECRET gana sobre el entorno', async () => {
    const dir = createTempDir();
    const configPath = writeConfig(dir, configYaml);
    vi.stubEnv('CONSOLIDATED_SECRET', 'override-config');

    const manager = new ConfigManager(configPath);
    expect(manager._defaultSourceContext().consolidatedSecret).toBe('override-config');
  });

  it('la opción explícita gana sobre todo', async () => {
    const dir = createTempDir();
    const configPath = writeConfig(dir, configYaml);
    vi.stubEnv('CONSOLIDATED_SECRET', 'override-config');

    const manager = new ConfigManager(configPath, { consolidatedSecret: 'explicit-config' });
    expect(manager._defaultSourceContext().consolidatedSecret).toBe('explicit-config');
  });

  it('sin consolidated_secret el contexto queda en null', async () => {
    const dir = createTempDir();
    const configPath = writeConfig(
      dir,
      `
environments:
  production:
    origin: gcp
    gcp_project_id: proj
    default: true

variables:
  A:
    source: A
    type: str
`,
    );
    const manager = new ConfigManager(configPath);
    expect(manager._defaultSourceContext().consolidatedSecret).toBeNull();
  });
});
