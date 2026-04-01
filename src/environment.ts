import type { EncryptedDotenvConfig, EnvironmentConfig, PrivateKeyConfig } from './types.js';

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

    const origin = rawOrigin.toLowerCase();

    if (origin !== 'local' && origin !== 'gcp') {
      throw new Error(
        `Invalid origin '${rawOrigin}' in environment '${name}'. Must be 'local' or 'gcp'`,
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

    if (origin === 'local') {
      environments[name] = {
        name,
        origin,
        dotenvPath: typeof rawEnvironment.dotenv_path === 'string' ? rawEnvironment.dotenv_path : '.env',
        gcpProjectId: null,
        isDefault,
        encryptedDotenv,
      };
      continue;
    }

    if (typeof rawEnvironment.gcp_project_id !== 'string' || rawEnvironment.gcp_project_id.length === 0) {
      throw new Error(`Missing 'gcp_project_id' for GCP environment '${name}'`);
    }

    environments[name] = {
      name,
      origin,
      dotenvPath: null,
      gcpProjectId: rawEnvironment.gcp_project_id,
      isDefault,
      encryptedDotenv,
    };
  }

  return environments;
}
