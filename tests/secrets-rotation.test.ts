/**
 * Rotación del secreto consolidado con destrucción de la versión anterior.
 *
 * Blueprint §1.1: guardar una actualización no puede dejar versiones viejas
 * habilitadas. Espejo de tests/test_secrets_rotation.py en el repo Python.
 */
import { describe, expect, it } from 'vitest';

import {
  SecretDestroyError,
  SecretsError,
  type SecretsClient,
  listKeys,
  readValueFromStdin,
  setKey,
} from '../src/cli/secrets.js';

const PROJECT = 'proj';
const SECRET = 'app-config';

function grpcError(code: number, message = 'boom'): Error & { code: number } {
  const error = new Error(message) as Error & { code: number };
  error.code = code;
  return error;
}

/** Cliente de GSM en memoria: versiones numeradas y estado por versión. */
class FakeClient implements SecretsClient {
  payloads: Record<string, string> = {};
  states: Record<string, string> = {};
  destroyError: Error | null = null;
  added: string[] = [];
  destroyed: string[] = [];

  constructor(
    payload = '{}',
    options: { versions?: string[]; missing?: boolean } = {},
  ) {
    this.missing = options.missing ?? false;
    for (const v of options.versions ?? ['1']) {
      this.payloads[v] = payload;
      this.states[v] = 'ENABLED';
    }
  }

  private missing: boolean;

  private versionId(name: string): string {
    return name.split('/').pop() as string;
  }

  async accessSecretVersion(request: { name: string }) {
    if (this.missing) throw grpcError(5, 'no such secret');
    let version = this.versionId(request.name);
    if (version === 'latest') {
      version = Object.keys(this.payloads).sort((a, b) => Number(b) - Number(a))[0];
    }
    return [{ payload: { data: Buffer.from(this.payloads[version], 'utf-8') } }] as [
      { payload: { data: Buffer } },
    ];
  }

  async listSecretVersions(request: { parent: string }) {
    const versions = Object.keys(this.payloads)
      .sort((a, b) => Number(b) - Number(a))
      .map((v) => ({ name: `${request.parent}/versions/${v}`, state: this.states[v] }));
    return [versions] as [typeof versions];
  }

  async addSecretVersion(request: { parent: string; payload: { data: Buffer } }) {
    const ids = Object.keys(this.payloads).map(Number);
    const newId = String((ids.length > 0 ? Math.max(...ids) : 0) + 1);
    this.payloads[newId] = request.payload.data.toString('utf-8');
    this.states[newId] = 'ENABLED';
    const name = `${request.parent}/versions/${newId}`;
    this.added.push(name);
    return [{ name }] as [{ name: string }];
  }

  async destroySecretVersion(request: { name: string }) {
    if (this.destroyError !== null) throw this.destroyError;
    this.states[this.versionId(request.name)] = 'DESTROYED';
    this.destroyed.push(request.name);
    return { name: request.name };
  }
}

async function* streamOf(...chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) yield chunk;
}

describe('setKey', () => {
  it('crea una versión nueva y destruye la anterior', async () => {
    const client = new FakeClient(JSON.stringify({ A: '1' }), { versions: ['1'] });

    const result = await setKey(PROJECT, SECRET, 'B', '2', client);

    expect(result.unchanged).toBe(false);
    expect(result.createdVersion).toMatch(/\/versions\/2$/);
    expect(result.destroyedVersions).toEqual([
      `projects/${PROJECT}/secrets/${SECRET}/versions/1`,
    ]);
    expect(client.states['1']).toBe('DESTROYED');
    expect(client.states['2']).toBe('ENABLED');
  });

  it('mezcla en vez de reemplazar el payload', async () => {
    const client = new FakeClient(JSON.stringify({ A: '1' }), { versions: ['1'] });

    await setKey(PROJECT, SECRET, 'B', '2', client);

    expect(JSON.parse(client.payloads['2'])).toEqual({ A: '1', B: '2' });
  });

  it('escribir el mismo valor no crea versión', async () => {
    const client = new FakeClient(JSON.stringify({ A: '1' }), { versions: ['1'] });

    const result = await setKey(PROJECT, SECRET, 'A', '1', client);

    expect(result.unchanged).toBe(true);
    expect(result.createdVersion).toBeNull();
    expect(client.added).toEqual([]);
    expect(client.destroyed).toEqual([]);
  });

  it('destruye todas las versiones que estaban habilitadas', async () => {
    const client = new FakeClient(JSON.stringify({ A: '1' }), {
      versions: ['1', '2', '3'],
    });

    const result = await setKey(PROJECT, SECRET, 'B', '2', client);

    expect(result.destroyedVersions).toHaveLength(3);
    expect(
      Object.entries(client.states)
        .filter(([, state]) => state === 'ENABLED')
        .map(([v]) => v),
    ).toEqual(['4']);
  });

  it('si la destrucción falla, nombra la versión que quedó colgando', async () => {
    const client = new FakeClient(JSON.stringify({ A: '1' }), { versions: ['1'] });
    client.destroyError = grpcError(7, 'nope');

    await expect(setKey(PROJECT, SECRET, 'B', '2', client)).rejects.toThrow(
      SecretDestroyError,
    );
    await expect(
      setKey(PROJECT, SECRET, 'C', '3', client),
    ).rejects.toThrow(/still billable/);

    // La versión nueva quedó viva: la app nunca se queda sin secreto.
    expect(client.states['2']).toBe('ENABLED');
  });

  it('un secreto inexistente es error, no una creación', async () => {
    const client = new FakeClient('{}', { missing: true });

    await expect(setKey(PROJECT, SECRET, 'A', '1', client)).rejects.toThrow(
      /does not create secrets/,
    );
    expect(client.added).toEqual([]);
  });

  it('se niega a sobrescribir un payload que no es JSON', async () => {
    const client = new FakeClient('no soy json', { versions: ['1'] });

    await expect(setKey(PROJECT, SECRET, 'A', '1', client)).rejects.toThrow(/valid JSON/);
    expect(client.added).toEqual([]);
  });

  it('se niega a sobrescribir un payload que no es objeto', async () => {
    const client = new FakeClient('[1, 2, 3]', { versions: ['1'] });

    await expect(setKey(PROJECT, SECRET, 'A', '1', client)).rejects.toThrow(
      /must contain a JSON object/,
    );
  });

  it('un payload vacío se trata como objeto vacío', async () => {
    const client = new FakeClient('', { versions: ['1'] });

    await setKey(PROJECT, SECRET, 'A', '1', client);

    expect(JSON.parse(client.payloads['2'])).toEqual({ A: '1' });
  });

  it('exige un nombre de clave', async () => {
    const client = new FakeClient('{}', { versions: ['1'] });

    await expect(setKey(PROJECT, SECRET, '', '1', client)).rejects.toThrow(
      SecretsError,
    );
  });
});

describe('listKeys', () => {
  it('devuelve los nombres ordenados', async () => {
    const client = new FakeClient(JSON.stringify({ B: '2', A: '1' }), { versions: ['1'] });

    await expect(listKeys(PROJECT, SECRET, client)).resolves.toEqual(['A', 'B']);
  });

  it('nunca devuelve valores', async () => {
    const client = new FakeClient(JSON.stringify({ A: 'super-secret' }), {
      versions: ['1'],
    });

    const keys = await listKeys(PROJECT, SECRET, client);
    expect(keys.join(',')).not.toContain('super-secret');
  });
});

describe('readValueFromStdin', () => {
  it('lee el valor y saca un solo salto de línea final', async () => {
    await expect(readValueFromStdin(streamOf('hola\n'))).resolves.toBe('hola');
  });

  it('conserva los saltos internos', async () => {
    await expect(readValueFromStdin(streamOf('a\n', 'b\n'))).resolves.toBe('a\nb');
  });

  it('stdin vacío es error', async () => {
    await expect(readValueFromStdin(streamOf())).rejects.toThrow(/No value provided/);
  });
});
