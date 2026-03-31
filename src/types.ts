export type SecretOrigin = 'local' | 'gcp';

export type VariableType = 'str' | 'int' | 'float' | 'bool';

export interface SecretLoader {
  get(key: string): Promise<string | null>;
  getMany(keys: readonly string[]): Promise<Record<string, string | null>>;
}

export interface EncryptedDotenvConfig {
  /** Whether encrypted dotenv support is enabled for this environment. */
  enabled: boolean;
}

export interface EnvironmentConfig {
  name: string;
  origin: SecretOrigin;
  dotenvPath: string | null;
  gcpProjectId: string | null;
  isDefault: boolean;
  /** Optional encrypted dotenv configuration for this environment. */
  encryptedDotenv?: EncryptedDotenvConfig;
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
}
