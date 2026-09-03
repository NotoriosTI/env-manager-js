export type SecretOrigin = 'local' | 'gcp';

export type VariableType = 'str' | 'int' | 'float' | 'bool';

export interface SecretLoader {
  get(key: string): Promise<string | null>;
  getMany(keys: readonly string[]): Promise<Record<string, string | null>>;
}

/**
 * Configuration for a dedicated private-key source.
 * When present, the manager fetches the private key from this source before
 * constructing the encrypted DotEnvLoader, bypassing the default key-chain lookup.
 */
export interface PrivateKeyConfig {
  /** Source key name to look up in the loader. */
  source: string;
  /** Whether to fetch from a local dotenv file or GCP Secret Manager. */
  secretOrigin: SecretOrigin;
  /** Path to the dotenv file containing the key (only for local origin). */
  dotenvPath?: string | null;
  /** GCP project ID to fetch from (only for gcp origin). */
  gcpProjectId?: string | null;
}

export interface EncryptedDotenvConfig {
  /** Whether encrypted dotenv support is enabled for this environment. */
  enabled: boolean;
  /**
   * Optional dedicated private-key source.
   * When present, the key is fetched from this source before falling back
   * to the default DOTENV_PRIVATE_KEY chain.
   */
  privateKey?: PrivateKeyConfig;
}

export interface EnvironmentConfig {
  name: string;
  origin: SecretOrigin;
  dotenvPath: string | null;
  gcpProjectId: string | null;
  isDefault: boolean;
  /** Optional encrypted dotenv configuration for this environment. */
  encryptedDotenv?: EncryptedDotenvConfig;
  /**
   * Nombre del secreto JSON consolidado de la app en GSM (blueprint §1.1).
   * Solo aplica a entornos con origin 'gcp'.
   */
  consolidatedSecret?: string | null;
  /** Whether missing consolidated keys may fall back to per-secret GSM reads. */
  fallbackToIndividual?: boolean;
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
  consolidatedSecret?: string | null;
  fallbackToIndividual?: boolean;
}

export type ConfigValidationIssueType = 'missing' | 'invalid';

export interface ConfigValidationIssue {
  variableName: string;
  issueType: ConfigValidationIssueType;
  message: string;
  sourceKey: string;
  context: SourceContext;
}

/**
 * Describes a single key that failed ECIES decryption during a load attempt.
 */
export interface DecryptionIssue {
  /** The source key (dotenv variable name) that failed to decrypt. */
  key: string;
  /** Human-readable failure reason. */
  message: string;
}

export interface ConfigManagerOptions {
  secretOrigin?: SecretOrigin;
  gcpProjectId?: string | null;
  dotenvPath?: string | null;
  strict?: boolean;
  debug?: boolean;
  /** Secreto JSON consolidado de la app en GSM (blueprint §1.1). */
  consolidatedSecret?: string | null;
  /** Defaults to true for backward compatibility. */
  fallbackToIndividual?: boolean;
}
