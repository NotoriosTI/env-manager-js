/**
 * Rotación del secreto JSON consolidado de una app (blueprint §1.1).
 *
 * Regla del blueprint: cada app tiene **un** secreto JSON consolidado en Google
 * Secret Manager y el guardado de una actualización no puede dejar versiones
 * viejas activas — se paga por versión habilitada. Este módulo es la única
 * pieza que escribe en GSM, y lo hace en un orden que nunca deja la app sin
 * secreto legible:
 *
 * 1. leer el JSON de la versión `latest`;
 * 2. mezclar la clave nueva;
 * 3. si el contenido no cambió, no se crea versión (idempotente);
 * 4. agregar la versión nueva;
 * 5. **verificar** que la versión nueva se lee y trae la clave;
 * 6. recién entonces destruir las demás versiones habilitadas.
 *
 * Si el paso 6 falla, el comando lo dice con el número de versión que quedó
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
): Promise<Record<string, unknown>> {
  const name = `${secretPath(projectId, secretName)}/versions/latest`;

  let response: AccessResponse;
  try {
    [response] = await client.accessSecretVersion({ name });
  } catch (error: unknown) {
    const code = grpcCode(error);
    if (code === 5) {
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

async function enabledVersions(
  client: SecretsClient,
  projectId: string,
  secretName: string,
): Promise<string[]> {
  const parent = secretPath(projectId, secretName);
  const [versions] = await client.listSecretVersions({ parent });
  return versions
    .filter((version) => String(version.state) === 'ENABLED')
    .map((version) => version.name);
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
 * Escribe `key` en el secreto consolidado y destruye la versión anterior.
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

  const current = await readLatest(c, projectId, secretName);

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

  const previousVersions = await enabledVersions(c, projectId, secretName);

  const updated = { ...current, [key]: value };
  const payload = Buffer.from(
    JSON.stringify(updated, Object.keys(updated).sort(), 2),
    'utf-8',
  );

  const [added] = await c.addSecretVersion({ parent, payload: { data: payload } });
  const newVersion = added.name;

  // Verificación antes de destruir nada: si la versión nueva no se puede leer,
  // destruir la vieja dejaría la app sin secreto.
  const [verify] = await c.accessSecretVersion({ name: newVersion });
  const verified = JSON.parse(
    Buffer.from(verify.payload?.data ?? '').toString('utf-8'),
  ) as Record<string, unknown>;
  if (verified[key] !== value) {
    throw new SecretsError(
      `Wrote version ${newVersion} but reading it back did not return the expected ` +
        'value. Nothing was destroyed; inspect the secret by hand.',
    );
  }

  const destroyed: string[] = [];
  for (const versionName of previousVersions) {
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
): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
  }
  let value = chunks.join('');
  if (value.endsWith('\n')) value = value.slice(0, -1);
  if (value === '') {
    throw new SecretsError('No value provided on stdin.');
  }
  return value;
}
