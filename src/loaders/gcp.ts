import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

import type { SecretLoader } from '../types.js';
import { logger } from '../utils.js';

interface SecretVersionResponse {
  payload?: {
    data?: string | Uint8Array | Buffer | null;
  } | null;
}

/** Opciones de llamada gax: timeout por request, en milisegundos. */
export interface GCPCallOptions {
  timeout?: number;
}

export interface GCPSecretClient {
  accessSecretVersion(
    request: { name: string },
    options?: GCPCallOptions,
  ): Promise<[SecretVersionResponse, ...unknown[]]>;
}

export interface GCPSecretLoaderOptions {
  createClient?: () => GCPSecretClient;
  /**
   * Nombre del secreto JSON consolidado de la app (blueprint §1.1). Cuando está
   * puesto, se busca una sola vez al arrancar y precarga la caché.
   */
  consolidatedSecret?: string | null;
  /**
   * Whether keys absent from the consolidated payload may be fetched from
   * individual GSM secrets. Defaults to true for backward compatibility.
   */
  fallbackToIndividual?: boolean;
  /** Timeout por llamada, en segundos. Precede a ENV_MANAGER_GCP_TIMEOUT. */
  timeout?: number;
  /** Espera entre reintentos, en ms. Solo para tests. */
  retryBaseDelayMs?: number;
}

/**
 * Timeout por llamada a GSM, en segundos. Blueprint §1.5.3: todo proceso remoto
 * tiene timeout. Nunca se deja el default de la librería cliente.
 */
export const DEFAULT_GCP_TIMEOUT = 10.0;

/** Tope de intentos. §1.5.3: todo reintento tiene tope. */
export const MAX_RETRY_ATTEMPTS = 3;

/** gRPC NOT_FOUND: el secreto no existe. No es error, es ausencia. */
const NOT_FOUND = 5;

/**
 * §1.5.4: solo lo transitorio se reintenta.
 * UNAVAILABLE, DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED, INTERNAL, ABORTED.
 */
export const TRANSIENT_CODES = new Set([14, 4, 8, 13, 10]);

/**
 * Errores deterministas: reintentarlos quema tiempo para morir igual.
 * INVALID_ARGUMENT, PERMISSION_DENIED, UNAUTHENTICATED, FAILED_PRECONDITION.
 */
export const DETERMINISTIC_CODES = new Set([3, 7, 16, 9]);

/** Resuelve el timeout por llamada: argumento > env var > default. */
export function resolveTimeout(provided?: number): number {
  if (provided !== undefined && provided !== null) {
    return provided;
  }

  const raw = process.env.ENV_MANAGER_GCP_TIMEOUT;
  if (raw !== undefined && raw !== '') {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      logger.warn(
        `ENV_MANAGER_GCP_TIMEOUT='${raw}' is not a number; falling back to ${DEFAULT_GCP_TIMEOUT}s.`,
      );
      return DEFAULT_GCP_TIMEOUT;
    }
    if (value <= 0) {
      logger.warn(
        `ENV_MANAGER_GCP_TIMEOUT='${raw}' must be positive; falling back to ${DEFAULT_GCP_TIMEOUT}s.`,
      );
      return DEFAULT_GCP_TIMEOUT;
    }
    return value;
  }

  return DEFAULT_GCP_TIMEOUT;
}

function errorCode(error: unknown): number | null {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'number') return code;
  }
  return null;
}

export function isTransient(error: unknown): boolean {
  const code = errorCode(error);
  return code !== null && TRANSIENT_CODES.has(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GCPSecretLoader implements SecretLoader {
  readonly gcpProjectId: string;
  readonly timeout: number;
  private readonly client: GCPSecretClient;
  private readonly cache: Map<string, string | null>;
  private readonly retryBaseDelayMs: number;
  private readonly consolidatedSecret: string | null;
  private readonly fallbackToIndividual: boolean;
  private consolidatedPreloadedCount = 0;
  private readonly cacheSource = new Map<string, 'consolidated' | 'individual'>();
  /**
   * La precarga en vuelo. Se guarda la promesa, no un booleano: `get()` se
   * llama en paralelo desde `getMany()`, y con un flag el primer llamador
   * arrancaba el fetch y los demás seguían de largo sin esperarlo, cayendo a
   * búsquedas individuales por cada clave. En Python no pasa porque es
   * síncrono; acá hay que esperar la misma promesa.
   */
  private consolidatedPromise: Promise<void> | null = null;

  constructor(gcpProjectId: string, options: GCPSecretLoaderOptions = {}) {
    this.gcpProjectId = gcpProjectId;
    this.client = options.createClient?.() ?? new SecretManagerServiceClient();
    this.cache = new Map();
    this.timeout = resolveTimeout(options.timeout);
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.consolidatedSecret = options.consolidatedSecret ?? null;
    if (
      options.fallbackToIndividual !== undefined &&
      typeof options.fallbackToIndividual !== 'boolean'
    ) {
      throw new Error('GCPSecretLoader: fallbackToIndividual must be a boolean');
    }
    this.fallbackToIndividual = options.fallbackToIndividual ?? true;
    if (!this.fallbackToIndividual && this.consolidatedSecret === null) {
      throw new Error(
        'GCPSecretLoader: fallbackToIndividual cannot be false without consolidatedSecret',
      );
    }
  }

  /**
   * Trae el secreto JSON consolidado una sola vez y precarga la caché.
   *
   * Blueprint §1.1: un acceso a GSM al boot en vez de uno por clave. Si el
   * secreto no está, no es JSON o no es un objeto, el modo compatible avisa y
   * cae al camino individual; el modo estricto falla antes de leer otra clave.
   */
  private preloadConsolidated(): Promise<void> {
    if (this.consolidatedSecret === null) return Promise.resolve();
    this.consolidatedPromise ??= this.fetchConsolidated(this.consolidatedSecret);
    return this.consolidatedPromise;
  }

  private async fetchConsolidated(secretName: string): Promise<void> {
    const raw = await this.access(secretName, false);
    if (raw === null) {
      if (!this.fallbackToIndividual) {
        throw new Error(
          `Consolidated secret '${secretName}' not found in project ` +
            `'${this.gcpProjectId}' and fallbackToIndividual is disabled.`,
        );
      }
      logger.warn(
        `Consolidated secret '${secretName}' not found; ` +
          'falling back to individual secret lookups.',
      );
      return;
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      if (!this.fallbackToIndividual) {
        throw new Error(
          `Consolidated secret '${secretName}' is not valid JSON and ` +
            'fallbackToIndividual is disabled.',
        );
      }
      logger.warn(
        `Consolidated secret '${secretName}' is not valid JSON; ` +
          'falling back to individual secret lookups.',
      );
      return;
    }

    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      if (!this.fallbackToIndividual) {
        throw new Error(
          `Consolidated secret '${secretName}' must be a JSON object and ` +
            'fallbackToIndividual is disabled.',
        );
      }
      logger.warn(
        `Consolidated secret '${secretName}' must be a JSON object; ` +
          'falling back to individual secret lookups.',
      );
      return;
    }

    const entries = Object.entries(data as Record<string, unknown>);
    this.consolidatedPreloadedCount = entries.length;
    for (const [key, value] of entries) {
      if (!this.cache.has(key)) {
        this.cache.set(key, typeof value === 'string' ? value : JSON.stringify(value));
        this.cacheSource.set(key, 'consolidated');
      }
    }
    logger.info(
      `Preloaded ${entries.length} values from consolidated secret '${secretName}'.`,
    );
  }

  async get(key: string): Promise<string | null> {
    await this.preloadConsolidated();

    if (this.cache.has(key)) {
      return this.cache.get(key) as string | null;
    }

    if (!this.fallbackToIndividual) {
      return null;
    }

    const value = await this.access(key, true);
    this.cache.set(key, value);
    this.cacheSource.set(key, 'individual');
    return value;
  }

  /** Una lectura a GSM, con timeout, taxonomía y reintentos acotados. */
  private async access(key: string, warnNotFound: boolean): Promise<string | null> {
    const name = `projects/${this.gcpProjectId}/secrets/${key}/versions/latest`;
    const timeoutMs = this.timeout * 1000;

    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const [response] = await this.client.accessSecretVersion(
          { name },
          { timeout: timeoutMs },
        );
        return Buffer.from(response.payload?.data ?? '').toString('utf-8');
      } catch (error: unknown) {
        const code = errorCode(error);

        if (code === NOT_FOUND) {
          if (warnNotFound) {
            logger.warn(`Secret '${key}' not found in project '${this.gcpProjectId}'.`);
          }
          return null;
        }

        if (code !== null && DETERMINISTIC_CODES.has(code)) {
          // §1.5.4: determinista. No se reintenta y se dice por qué.
          throw new Error(
            `Deterministic failure accessing secret '${key}' in GCP project ` +
              `'${this.gcpProjectId}' (gRPC code ${code}): ${String(error)}. ` +
              'Retrying will not help; check IAM permissions, credentials and the secret name.',
          );
        }

        if (!isTransient(error)) {
          // §1.5.5: lo que no sabemos clasificar se propaga tal cual, ruidoso.
          throw error;
        }

        lastError = error;
        if (attempt < MAX_RETRY_ATTEMPTS) {
          await sleep(this.retryBaseDelayMs * 2 ** (attempt - 1));
        }
      }
    }

    throw new Error(
      `Retries exhausted after ${MAX_RETRY_ATTEMPTS} attempts accessing secret ` +
        `'${key}' in GCP project '${this.gcpProjectId}': ${String(lastError)}`,
    );
  }

  async getMany(keys: readonly string[]): Promise<Record<string, string | null>> {
    const uniqueKeys = [...new Set(keys)];
    await this.preloadConsolidated();

    let resolvedFromConsolidated = 0;
    let individualAccesses = 0;
    const pairs = await Promise.all(
      uniqueKeys.map(async (key) => {
        if (this.cache.has(key)) {
          if (this.cacheSource.get(key) === 'consolidated') {
            resolvedFromConsolidated += 1;
          }
          return [key, this.cache.get(key) as string | null] as const;
        }

        if (!this.fallbackToIndividual) {
          return [key, null] as const;
        }

        individualAccesses += 1;
        const value = await this.access(key, false);
        this.cache.set(key, value);
        this.cacheSource.set(key, 'individual');
        return [key, value] as const;
      }),
    );
    const results = Object.fromEntries(pairs);

    const missing = Object.values(results).filter((value) => value === null).length;
    const message =
      `GCP secret load summary: preloaded=${this.consolidatedPreloadedCount}, ` +
      `resolved_from_consolidated=${resolvedFromConsolidated}, ` +
      `individual_accesses=${individualAccesses}, missing=${missing}, ` +
      `fallback_to_individual=${String(this.fallbackToIndividual)}.`;
    if (resolvedFromConsolidated !== uniqueKeys.length || missing > 0) {
      logger.warn(message);
    } else {
      logger.info(message);
    }

    return results;
  }
}
