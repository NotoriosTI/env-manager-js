import type { EnvironmentConfig } from './types.js';

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

    if (origin === 'local') {
      environments[name] = {
        name,
        origin,
        dotenvPath: typeof rawEnvironment.dotenv_path === 'string' ? rawEnvironment.dotenv_path : '.env',
        gcpProjectId: null,
        isDefault,
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
    };
  }

  return environments;
}
