/**
 * Integración real contra Google Secret Manager (blueprint §1.1).
 *
 * Espejo de tests/test_consolidated_secret_gsm_integration.py en el repo Python:
 * crea un secreto JSON consolidado de mentira, comprueba que env-manager lo lee
 * y que, una vez leído, cada valor se comporta igual que cualquier secreto
 * individual.
 *
 * No corre por defecto. Necesita credenciales reales:
 *
 *   RUN_REAL_GCP_TESTS=1 GCP_PROJECT_ID=notorios npx vitest run \
 *     tests/consolidated-secret-gsm-integration.test.ts
 *
 * Los secretos que crea llevan prefijo `env-manager-itest-` y se borran en el
 * teardown, pasen o fallen los tests.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigManager, _resetSingleton } from '../src/manager.js';
import { GCPSecretLoader } from '../src/loaders/gcp.js';
import { setKey, type SecretsClient } from '../src/cli/secrets.js';

const RUN_GCP = process.env.RUN_REAL_GCP_TESTS === '1';
const PROJECT = process.env.GCP_PROJECT_ID ?? process.env.ENV_MANAGER_ITEST_PROJECT ?? '';
const skipGcp = !RUN_GCP || PROJECT === '';

/** Contenido del secreto consolidado. Todo inventado: ningún valor real. */
const CONSOLIDATED_PAYLOAD = {
  ITEST_STR: 'hello-from-consolidated',
  ITEST_INT: '4242',
  ITEST_BOOL: 'true',
  ITEST_NESTED: { a: 1, b: [2, 3] },
};

/** Secreto suelto, del formato de siempre: una clave, un secreto, un valor. */
const INDIVIDUAL_VALUE = 'hello-from-individual';

const TIMEOUT = 30000;

let consolidatedName = '';
let individualName = '';
let rotationName = '';
let tmpDir = '';
let configPath = '';
type IntegrationClient = SecretsClient & {
  createSecret(request: unknown): Promise<unknown>;
  disableSecretVersion(request: { name: string }): Promise<unknown>;
  deleteSecret(request: { name: string }): Promise<unknown>;
};
let client: IntegrationClient;
const createdPaths: string[] = [];

beforeAll(async () => {
  if (skipGcp) return;

  const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
  client = new SecretManagerServiceClient() as unknown as typeof client;

  const parent = `projects/${PROJECT}`;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  consolidatedName = `env-manager-itest-${suffix}-config`;
  individualName = `env-manager-itest-${suffix}-ITEST_INDIVIDUAL`;
  rotationName = `env-manager-itest-${suffix}-rotation`;

  const create = async (secretId: string, payload: string): Promise<void> => {
    await client.createSecret({
      parent,
      secretId,
      secret: { replication: { automatic: {} } },
    });
    createdPaths.push(`${parent}/secrets/${secretId}`);
    await client.addSecretVersion({
      parent: `${parent}/secrets/${secretId}`,
      payload: { data: Buffer.from(payload, 'utf-8') },
    });
  };

  await create(consolidatedName, JSON.stringify(CONSOLIDATED_PAYLOAD));
  await create(individualName, INDIVIDUAL_VALUE);
  await client.createSecret({
    parent,
    secretId: rotationName,
    secret: { replication: { automatic: {} } },
  });
  createdPaths.push(`${parent}/secrets/${rotationName}`);

  tmpDir = mkdtempSync(join(tmpdir(), 'env-manager-itest-'));
  writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'itest' }), 'utf8');
  configPath = join(tmpDir, 'config.yaml');
  writeFileSync(
    configPath,
    `environments:
  production:
    origin: gcp
    gcp_project_id: ${PROJECT}
    consolidated_secret: ${consolidatedName}
    default: true

variables:
  ITEST_STR:
    source: ITEST_STR
    type: str
  ITEST_INT:
    source: ITEST_INT
    type: int
  ITEST_BOOL:
    source: ITEST_BOOL
    type: bool
  ITEST_NESTED:
    source: ITEST_NESTED
    type: str
  ITEST_INDIVIDUAL:
    source: ${individualName}
    type: str
  ITEST_WITH_DEFAULT:
    source: ITEST_NOT_ANYWHERE
    type: int
    default: 7
`,
    'utf8',
  );
}, TIMEOUT);

afterAll(async () => {
  // El teardown no se salta ni aunque los tests fallen: un secreto huérfano se
  // sigue facturando por versión habilitada (§1.1).
  for (const name of createdPaths) {
    await client.deleteSecret({ name });
  }
  if (tmpDir !== '') rmSync(tmpDir, { recursive: true, force: true });
  _resetSingleton();
  for (const key of [
    'ITEST_STR',
    'ITEST_INT',
    'ITEST_BOOL',
    'ITEST_NESTED',
    'ITEST_INDIVIDUAL',
    'ITEST_WITH_DEFAULT',
  ]) {
    delete process.env[key];
  }
}, TIMEOUT);

async function loadManager(): Promise<ConfigManager> {
  _resetSingleton();
  const manager = new ConfigManager(configPath);
  await manager.load();
  return manager;
}

describe('lee el secreto consolidado', () => {
  it.skipIf(skipGcp)(
    'el string llega intacto',
    async () => {
      const manager = await loadManager();
      expect(manager.get('ITEST_STR')).toBe('hello-from-consolidated');
    },
    TIMEOUT,
  );

  it.skipIf(skipGcp)(
    'los tipos declarados se coercionan',
    async () => {
      const manager = await loadManager();
      expect(manager.get('ITEST_INT')).toBe(4242);
      expect(manager.get('ITEST_BOOL')).toBe(true);
    },
    TIMEOUT,
  );

  it.skipIf(skipGcp)(
    'los valores JSON que no son string llegan serializados',
    async () => {
      const manager = await loadManager();
      expect(JSON.parse(manager.get('ITEST_NESTED') as string)).toEqual({ a: 1, b: [2, 3] });
    },
    TIMEOUT,
  );

  it.skipIf(skipGcp)(
    'una sola llamada a la API sirve todas las claves consolidadas',
    async () => {
      const loader = new GCPSecretLoader(PROJECT, { consolidatedSecret: consolidatedName });
      const inner = loader as unknown as {
        client: { accessSecretVersion: (req: { name: string }, opts?: unknown) => Promise<unknown> };
      };
      const realAccess = inner.client.accessSecretVersion.bind(inner.client);
      const calls: string[] = [];
      inner.client.accessSecretVersion = async (req, opts) => {
        calls.push(req.name);
        return realAccess(req, opts);
      };

      await expect(loader.get('ITEST_STR')).resolves.toBe('hello-from-consolidated');
      await expect(loader.get('ITEST_INT')).resolves.toBe('4242');
      await expect(loader.get('ITEST_BOOL')).resolves.toBe('true');

      // Tres claves, un solo viaje a GSM: el del secreto consolidado.
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain(consolidatedName);
    },
    TIMEOUT,
  );
});

describe('se comporta como cualquier otro secreto', () => {
  it.skipIf(skipGcp)(
    'consolidado e individual se resuelven lado a lado',
    async () => {
      const manager = await loadManager();
      expect(manager.get('ITEST_STR')).toBe('hello-from-consolidated');
      expect(manager.get('ITEST_INDIVIDUAL')).toBe('hello-from-individual');
    },
    TIMEOUT,
  );

  it.skipIf(skipGcp)(
    'los dos quedan en process.env',
    async () => {
      await loadManager();
      // Cuando el nombre de la variable coincide con su `source`, los dos
      // runtimes exportan lo mismo.
      expect(process.env.ITEST_STR).toBe('hello-from-consolidated');
      // Cuando difieren, se exporta con el NOMBRE, igual que Python (D11).
      expect(process.env.ITEST_INDIVIDUAL).toBe('hello-from-individual');
      // Y además, por una versión, bajo el `source` como alias deprecado.
      expect(process.env[individualName]).toBe('hello-from-individual');
    },
    TIMEOUT,
  );

  it.skipIf(skipGcp)(
    'require funciona con los dos',
    async () => {
      const manager = await loadManager();
      expect(manager.require('ITEST_STR')).toBe('hello-from-consolidated');
      expect(manager.require('ITEST_INDIVIDUAL')).toBe('hello-from-individual');
    },
    TIMEOUT,
  );

  it.skipIf(skipGcp)(
    'values expone los dos',
    async () => {
      const manager = await loadManager();
      const values = manager.values;
      expect(values.ITEST_STR).toBe('hello-from-consolidated');
      expect(values.ITEST_INDIVIDUAL).toBe('hello-from-individual');
    },
    TIMEOUT,
  );

  it.skipIf(skipGcp)(
    'una clave que no está en ningún lado cae a su default',
    async () => {
      const manager = await loadManager();
      expect(manager.get('ITEST_WITH_DEFAULT')).toBe(7);
    },
    TIMEOUT,
  );
});

describe('comportamiento a nivel de loader', () => {
  it.skipIf(skipGcp)(
    'una clave ausente del payload cae a búsqueda individual',
    async () => {
      const loader = new GCPSecretLoader(PROJECT, { consolidatedSecret: consolidatedName });
      await expect(loader.get(individualName)).resolves.toBe('hello-from-individual');
    },
    TIMEOUT,
  );

  it.skipIf(skipGcp)(
    'un secreto inexistente es null, no un error',
    async () => {
      const loader = new GCPSecretLoader(PROJECT, { consolidatedSecret: consolidatedName });
      await expect(
        loader.get(`env-manager-itest-${randomUUID().replace(/-/g, '')}`),
      ).resolves.toBeNull();
    },
    TIMEOUT,
  );

  it.skipIf(skipGcp)(
    'getMany mezcla las dos fuentes',
    async () => {
      const loader = new GCPSecretLoader(PROJECT, { consolidatedSecret: consolidatedName });
      await expect(loader.getMany(['ITEST_STR', individualName])).resolves.toEqual({
        ITEST_STR: 'hello-from-consolidated',
        [individualName]: 'hello-from-individual',
      });
    },
    TIMEOUT,
  );
});

describe('rotación sobre un secreto descartable', () => {
  it.skipIf(skipGcp)(
    'crea la primera versión y destruye versiones previas ENABLED y DISABLED',
    async () => {
      const parent = `projects/${PROJECT}/secrets/${rotationName}`;

      // El recurso se creó sin versiones en beforeAll. setKey debe poder
      // inicializarlo sin confundirlo con un recurso inexistente.
      const first = await setKey(PROJECT, rotationName, 'FIRST', 'one', client);
      expect(first.createdVersion).toMatch(/\/versions\/1$/);
      expect(first.destroyedVersions).toEqual([]);
      if (first.createdVersion === null) {
        throw new Error('Expected setKey to create the first disposable version');
      }

      // Deja una versión DISABLED antigua y una latest ENABLED legible. La
      // siguiente rotación debe destruir ambas por ser facturables.
      const [secondVersion] = await client.addSecretVersion({
        parent,
        payload: {
          data: Buffer.from(JSON.stringify({ FIRST: 'one', SECOND: 'two' }), 'utf-8'),
        },
      });
      await client.disableSecretVersion({ name: first.createdVersion });

      const rotated = await setKey(PROJECT, rotationName, 'THIRD', 'three', client);
      expect(rotated.destroyedVersions.sort()).toEqual(
        [first.createdVersion, secondVersion.name].sort(),
      );
      expect(rotated.createdVersion).not.toBeNull();

      const [versions] = await client.listSecretVersions({ parent });
      const billable = versions
        .filter(
          (version) =>
            version.state === 'ENABLED' ||
            version.state === 'DISABLED' ||
            version.state === 1 ||
            version.state === 2,
        )
        .map((version) => version.name);
      expect(billable).toEqual([rotated.createdVersion]);
    },
    TIMEOUT,
  );
});
