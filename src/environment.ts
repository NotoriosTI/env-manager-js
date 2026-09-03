import type { EncryptedDotenvConfig, EnvironmentConfig, PrivateKeyConfig } from './types.js';

export const ORIGIN_ALIASES: Record<string, 'local' | 'gcp'> = {
  dotenv:               'local',
  'env-file':           'local',
  '.env':               'local',
  'gcp-secretmanager':  'gcp',
  'gcp-secret-manager': 'gcp',
  secretmanager:        'gcp',
};
export const CANONICAL_ORIGINS = new Set<string>(['local', 'gcp']);

type ConfigMap = Record<string, unknown>;

function isConfigMap(value: unknown): value is ConfigMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseEnvironments(
  config: Record<string, unknown>,
): Record<string, EnvironmentConfig> {
  const environmentsValue = config.environments;

  if (environmentsValue === undefined) {
    return {};
  }

  if (!isConfigMap(environmentsValue)) {
    throw new Error("Expected 'environments' to be a mapping");
  }

  const environments: Record<string, EnvironmentConfig> = {};
  let defaultEnvironmentName: string | null = null;

  for (const [name, rawEnvironment] of Object.entries(environmentsValue)) {
    if (!isConfigMap(rawEnvironment)) {
      throw new Error(`Expected environment '${name}' to be a mapping`);
    }

    const rawOrigin = rawEnvironment.origin;

    if (rawOrigin === undefined) {
      throw new Error(`Missing 'origin' key in environment '${name}'`);
    }

    if (typeof rawOrigin !== 'string') {
      throw new Error(
        `Invalid origin '${String(rawOrigin)}' in environment '${name}'. Must be 'local' or 'gcp'`,
      );
    }

    const rawLower = rawOrigin.toLowerCase();
    const origin = (ORIGIN_ALIASES[rawLower] ?? rawLower) as 'local' | 'gcp';

    if (!CANONICAL_ORIGINS.has(origin)) {
      throw new Error(
        `Invalid origin '${rawOrigin}' in environment '${name}'. Must be 'local' or 'gcp' (or an alias)`,
      );
    }

    const isDefault = rawEnvironment.default === true;

    if (isDefault) {
      if (defaultEnvironmentName !== null) {
        throw new Error(
          `Multiple default environments configured: '${defaultEnvironmentName}' and '${name}'`,
        );
      }

      defaultEnvironmentName = name;
    }

    // Parse optional encrypted_dotenv block
    const rawEncrypted = rawEnvironment.encrypted_dotenv;
    let encryptedDotenv: EncryptedDotenvConfig | undefined;

    if (isConfigMap(rawEncrypted) && rawEncrypted.enabled === true) {
      let privateKey: PrivateKeyConfig | undefined;

      const rawPrivateKey = rawEncrypted.private_key;
      if (isConfigMap(rawPrivateKey)) {
        const rawSource = rawPrivateKey.source;
        const rawSecretOrigin = rawPrivateKey.secret_origin;

        if (typeof rawSource === 'string' && rawSource.length > 0) {
          const keyOrigin =
            typeof rawSecretOrigin === 'string' &&
            (rawSecretOrigin === 'local' || rawSecretOrigin === 'gcp')
              ? (rawSecretOrigin as 'local' | 'gcp')
              : 'local';

          privateKey = {
            source: rawSource,
            secretOrigin: keyOrigin,
            dotenvPath:
              typeof rawPrivateKey.dotenv_path === 'string' ? rawPrivateKey.dotenv_path : null,
            gcpProjectId:
              typeof rawPrivateKey.gcp_project_id === 'string' ? rawPrivateKey.gcp_project_id : null,
          };
        }
      }

      encryptedDotenv = { enabled: true, ...(privateKey != null ? { privateKey } : {}) };
    }

    const rawFallback = rawEnvironment.fallback_to_individual;
    if (rawFallback !== undefined && typeof rawFallback !== 'boolean') {
      throw new Error(
        `Environment '${name}': 'fallback_to_individual' must be a boolean when provided`,
      );
    }

    if (origin === 'local') {
      if (rawFallback === false) {
        throw new Error(
          `Environment '${name}': 'fallback_to_individual' cannot be false without 'consolidated_secret'`,
        );
      }
      environments[name] = {
        name,
        origin,
        dotenvPath: typeof rawEnvironment.dotenv_path === 'string' ? rawEnvironment.dotenv_path : '.env',
        gcpProjectId: null,
        isDefault,
        encryptedDotenv,
        fallbackToIndividual: true,
      };
      continue;
    }

    if (typeof rawEnvironment.gcp_project_id !== 'string' || rawEnvironment.gcp_project_id.length === 0) {
      throw new Error(`Missing 'gcp_project_id' for GCP environment '${name}'`);
    }

    // Secreto JSON consolidado (§1.1): un solo acceso a GSM al boot.
    let consolidatedSecret: string | null = null;
    const rawConsolidated = rawEnvironment.consolidated_secret;
    if (rawConsolidated !== undefined && rawConsolidated !== null) {
      if (typeof rawConsolidated !== 'string' || rawConsolidated.trim().length === 0) {
        throw new Error(
          `Environment '${name}': 'consolidated_secret' must be a non-empty string when provided`,
        );
      }
      consolidatedSecret = rawConsolidated.trim();
    }

    const fallbackToIndividual = rawFallback ?? true;
    if (!fallbackToIndividual && consolidatedSecret === null) {
      throw new Error(
        `Environment '${name}': 'fallback_to_individual' cannot be false without 'consolidated_secret'`,
      );
    }

    environments[name] = {
      name,
      origin,
      dotenvPath: null,
      gcpProjectId: rawEnvironment.gcp_project_id,
      isDefault,
      encryptedDotenv,
      consolidatedSecret,
      fallbackToIndividual,
    };
  }

  return environments;
}
