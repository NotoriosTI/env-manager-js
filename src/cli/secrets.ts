/**
 * Rotación del secreto JSON consolidado de una app (blueprint §1.1).
 *
 * Regla del blueprint: cada app tiene **un** secreto JSON consolidado en Google
 * Secret Manager y el guardado de una actualización no puede dejar versiones
 * viejas facturables (`ENABLED` o `DISABLED`). Este módulo es la única
 * pieza que escribe en GSM, y lo hace en un orden que nunca deja la app sin
 * secreto legible:
 *
 * 1. inventariar las versiones facturables actuales;
 * 2. leer el JSON de la versión `latest` (o `{}` si aún no hay versiones);
 * 3. mezclar la clave nueva;
 * 4. si el contenido no cambió, no se crea versión (idempotente);
 * 5. agregar la versión nueva;
 * 6. **verificar** que la versión nueva se lee y trae la clave;
 * 7. recién entonces destruir el snapshot de versiones facturables.
 *
 * Si el paso 7 falla, el comando lo dice con el número de versión que quedó
 * colgando y sale con código de error. Nada de `.catch(() => null)`.
 *
 * El valor nunca entra por argumento: se lee de stdin. Un valor en `argv` queda
 * en `ps` y en el historial del shell.
 *
 * Contrato idéntico a `env_manager/cli/secrets.py`.
 */
import { logger } from '../utils.js';

export class SecretsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretsError';
  }
}

export class SecretDestroyError extends SecretsError {
  constructor(message: string) {
    super(message);
    this.name = 'SecretDestroyError';
  }
}

interface AccessResponse {
  payload?: { data?: string | Uint8Array | Buffer | null } | null;
}

interface VersionInfo {
  name: string;
  state?: string | number | null;
}

export interface SecretsClient {
  accessSecretVersion(request: { name: string }): Promise<[AccessResponse, ...unknown[]]>;
  listSecretVersions(request: { parent: string }): Promise<[VersionInfo[], ...unknown[]]>;
  addSecretVersion(request: {
    parent: string;
    payload: { data: Buffer };
  }): Promise<[{ name: string }, ...unknown[]]>;
  destroySecretVersion(request: { name: string }): Promise<unknown>;
}

export interface SetKeyResult {
  secret: string;
  key: string;
  createdVersion: string | null;
  destroyedVersions: string[];
  unchanged: boolean;
}

async function defaultClient(): Promise<SecretsClient> {
  const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
  return new SecretManagerServiceClient() as unknown as SecretsClient;
}

function secretPath(projectId: string, secretName: string): string {
  return `projects/${projectId}/secrets/${secretName}`;
}

function grpcCode(error: unknown): number | null {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'number') return code;
  }
  return null;
}

async function readLatest(
  client: SecretsClient,
  projectId: string,
  secretName: string,
  resourceExists = false,
): Promise<Record<string, unknown>> {
  const name = `${secretPath(projectId, secretName)}/versions/latest`;

  let response: AccessResponse;
  try {
    [response] = await client.accessSecretVersion({ name });
  } catch (error: unknown) {
    const code = grpcCode(error);
    if (code === 5) {
      if (resourceExists) {
        throw new SecretsError(
          `Secret '${secretName}' exists in project '${projectId}', but its latest ` +
            'version could not be read. Refusing to write a new version.',
        );
      }
      throw new SecretsError(
        `Secret '${secretName}' does not exist in project '${projectId}'. ` +
          'Create it empty first; env-manager does not create secrets.',
      );
    }
    if (code === 7) {
      throw new SecretsError(
        `Permission denied reading '${secretName}' in project '${projectId}'. ` +
          'Retrying will not help; check IAM.',
      );
    }
    throw error;
  }

  const raw = Buffer.from(response.payload?.data ?? '')
    .toString('utf-8')
    .trim();
  if (raw === '') return {};

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new SecretsError(
      `Secret '${secretName}' does not contain valid JSON. Refusing to overwrite it: ` +
        'fix the payload by hand first.',
    );
  }

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new SecretsError(
      `Secret '${secretName}' must contain a JSON object, got ` +
        `${Array.isArray(data) ? 'array' : typeof data}. Refusing to overwrite it.`,
    );
  }

  return data as Record<string, unknown>;
}

function isBillableState(state: VersionInfo['state']): boolean {
  return state === 'ENABLED' || state === 'DISABLED' || state === 1 || state === 2;
}

interface VersionSnapshot {
  billable: string[];
  total: number;
}

async function snapshotVersions(
  client: SecretsClient,
  projectId: string,
  secretName: string,
): Promise<VersionSnapshot> {
  const parent = secretPath(projectId, secretName);
  try {
    const [versions] = await client.listSecretVersions({ parent });
    return {
      billable: versions
        .filter((version) => isBillableState(version.state))
        .map((version) => version.name),
      total: versions.length,
    };
  } catch (error: unknown) {
    const code = grpcCode(error);
    if (code === 5) {
      throw new SecretsError(
        `Secret '${secretName}' does not exist in project '${projectId}'. ` +
          'Create the secret resource first; env-manager does not create secrets.',
      );
    }
    if (code === 7) {
      throw new SecretsError(
        `Permission denied listing versions for '${secretName}' in project '${projectId}'. ` +
          'Retrying will not help; check IAM.',
      );
    }
    throw error;
  }
}

/** Nombres de las claves del secreto consolidado. Nunca los valores. */
export async function listKeys(
  projectId: string,
  secretName: string,
  client?: SecretsClient,
): Promise<string[]> {
  const c = client ?? (await defaultClient());
  return Object.keys(await readLatest(c, projectId, secretName)).sort();
}

/**
 * Escribe `key` en el secreto consolidado y destruye las versiones facturables
 * que existían al comenzar la operación.
 *
 * Cuando el valor ya estaba, no crea versión y lo informa.
 */
export async function setKey(
  projectId: string,
  secretName: string,
  key: string,
  value: string,
  client?: SecretsClient,
): Promise<SetKeyResult> {
  if (key === '') {
    throw new SecretsError('A key name is required.');
  }

  const c = client ?? (await defaultClient());
  const parent = secretPath(projectId, secretName);

  // Snapshot first: cleanup must never destroy a version created by another
  // writer after this operation began.
  const snapshot = await snapshotVersions(c, projectId, secretName);
  const current =
    snapshot.total === 0
      ? {}
      : await readLatest(c, projectId, secretName, true);

  if (current[key] === value) {
    // §1.5: no se paga una versión nueva por escribir lo mismo.
    return {
      secret: secretName,
      key,
      createdVersion: null,
      destroyedVersions: [],
      unchanged: true,
    };
  }

  const updated = { ...current, [key]: value };
  const sortedUpdated = Object.fromEntries(
    Object.keys(updated)
      .sort()
      .map((updatedKey) => [updatedKey, updated[updatedKey]]),
  );
  const payload = Buffer.from(
    JSON.stringify(sortedUpdated, null, 2),
    'utf-8',
  );

  const [added] = await c.addSecretVersion({ parent, payload: { data: payload } });
  const newVersion = added.name;

  // Verificación antes de destruir nada: si la versión nueva no se puede leer,
  // destruir la vieja dejaría la app sin secreto.
  const [verify] = await c.accessSecretVersion({ name: newVersion });
  const verifiedPayload = Buffer.from(verify.payload?.data ?? '').toString('utf-8');
  if (verifiedPayload !== payload.toString('utf-8')) {
    throw new SecretsError(
      `Wrote version ${newVersion} but reading it back did not return the complete ` +
        'expected payload. Nothing was destroyed; inspect the secret by hand.',
    );
  }

  const destroyed: string[] = [];
  for (const versionName of snapshot.billable) {
    if (versionName === newVersion) continue;
    try {
      await c.destroySecretVersion({ name: versionName });
    } catch (error: unknown) {
      throw new SecretDestroyError(
        `New version ${newVersion} is live, but destroying ${versionName} failed: ` +
          `${String(error)}. That version is still billable — destroy it by hand.`,
      );
    }
    destroyed.push(versionName);
  }

  logger.info(
    `Set '${key}' in '${secretName}': created ${newVersion}, ` +
      `destroyed ${destroyed.length} previous version(s).`,
  );

  return {
    secret: secretName,
    key,
    createdVersion: newVersion,
    destroyedVersions: destroyed,
    unchanged: false,
  };
}

/**
 * Lee el valor desde stdin.
 *
 * El valor nunca viaja por `argv`: quedaría en `ps` y en el historial.
 */
export async function readValueFromStdin(
  stream: AsyncIterable<string | Buffer> = process.stdin,
  options: { allowEmpty?: boolean } = {},
): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
  }
  let value = chunks.join('');
  if (value.endsWith('\n')) value = value.slice(0, -1);
  if (value === '' && options.allowEmpty !== true) {
    throw new SecretsError('No value provided on stdin.');
  }
  return value;
}
