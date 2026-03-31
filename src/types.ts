export type SecretOrigin = 'local' | 'gcp';

export type VariableType = 'str' | 'int' | 'float' | 'bool';

export interface SecretLoader {
  get(key: string): Promise<string | null>;
  getMany(keys: readonly string[]): Promise<Record<string, string | null>>;
}

export interface EnvironmentConfig {
  name: string;
  origin: SecretOrigin;
  dotenvPath: string | null;
  gcpProjectId: string | null;
  isDefault: boolean;
}

export interface VariableDefinition {
  source?: string | null;
  default?: unknown;
  environment?: string | null;
  origin?: SecretOrigin | null;
  secretOrigin?: SecretOrigin | null;
  dotenvPath?: string | null;
  gcpProjectId?: string | null;
  required?: boolean;
  type?: VariableType;
}

export interface ValidationConfig {
  strict?: boolean;
  required?: string[];
  optional?: string[];
}

export interface SourceContext {
  environmentName: string;
  secretOrigin: SecretOrigin;
  gcpProjectId: string | null;
  dotenvPath: string | null;
}

export interface ConfigManagerOptions {
  secretOrigin?: SecretOrigin;
  gcpProjectId?: string | null;
  dotenvPath?: string | null;
  strict?: boolean;
  debug?: boolean;
}
