import { existsSync, readFileSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';

import dotenv from 'dotenv';

import type {
  ConfigValidationIssue,
  ConfigValidationIssueType,
  ConfigManagerOptions,
  EnvironmentConfig,
  SecretOrigin,
  SourceContext,
  ValidationConfig,
  VariableDefinition,
} from './types.js';
import { CANONICAL_ORIGINS, ORIGIN_ALIASES, parseEnvironments } from './environment.js';
import { NotImplementedError } from './errors.js';
import { _resetLoaderCache, createLoader } from './factory.js';
import { DotEnvLoader } from './loaders/dotenv.js';
import { coerceType, loadYaml, logger, maskSecret } from './utils.js';

let singleton: ConfigManager | null = null;

/** Track all keys written to process.env by any ConfigManager, for cleanup in _resetSingleton. */
const _processEnvWrites = new Set<string>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Raíz del proyecto: sube desde el directorio del config buscando el marcador
 * del lenguaje (`package.json`), sin cruzar el límite del repositorio.
 *
 * Paridad con Python (`_discover_project_root`): si aparece un `.git` antes que
 * el marcador, ese es el techo — no se sigue subiendo hacia el home del usuario,
 * donde un `package.json` ajeno haría que `dotenv_path` resolviera fuera del
 * repo. Si no hay ninguno de los dos, la raíz es el directorio del config.
 */
function discoverProjectRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    if (existsSync(join(dir, '.git'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return startDir;
    }
    dir = parent;
  }
}

/**
 * Normalize a raw variable definition (YAML uses snake_case, TS interface uses camelCase).
 * Returns a normalized copy with camelCase keys.
 */
function normalizeVarDef(raw: Record<string, unknown>): VariableDefinition {
  const def = { ...raw } as Record<string, unknown>;

  // secret_origin → secretOrigin
  if ('secret_origin' in def && !('secretOrigin' in def)) {
    def['secretOrigin'] = def['secret_origin'];
  }
  // gcp_project_id → gcpProjectId
  if ('gcp_project_id' in def && !('gcpProjectId' in def)) {
    def['gcpProjectId'] = def['gcp_project_id'];
  }
  // dotenv_path → dotenvPath
  if ('dotenv_path' in def && !('dotenvPath' in def)) {
    def['dotenvPath'] = def['dotenv_path'];
  }

  return def as unknown as VariableDefinition;
}

/**
 * Build a context label string for error messages.
 * e.g. "environment 'staging' using local .env '/path/.env'"
 *     "environment 'prod' using GCP project 'my-project'"
 */
function buildContextLabel(ctx: SourceContext): string {
  let label = ctx.environmentName ? `environment '${ctx.environmentName}'` : 'no environment';
  if (ctx.secretOrigin === 'gcp' && ctx.gcpProjectId) {
    label += ` using GCP project '${ctx.gcpProjectId}'`;
  } else if (ctx.dotenvPath) {
    label += ` using local .env '${ctx.dotenvPath}'`;
  }
  return label;
}

/** Resolve a relative path against projectRoot; return as-is if absolute. */
function resolvePath(p: string, projectRoot: string): string {
  return isAbsolute(p) ? p : join(projectRoot, p);
}

function createConfigValidationIssue(
  variableName: string,
  sourceKey: string,
  issueType: ConfigValidationIssueType,
  message: string,
  context: SourceContext,
): ConfigValidationIssue {
  return {
    variableName,
    issueType,
    message,
    sourceKey,
    context,
  };
}

export class ConfigValidationError extends Error {
  readonly issues: readonly ConfigValidationIssue[];

  constructor(issues: readonly ConfigValidationIssue[]) {
    super(
      `Config validation failed with ${issues.length} issue${issues.length === 1 ? '' : 's'}.`,
    );
    this.name = 'ConfigValidationError';
    this.issues = [...issues];
  }
}

export class ConfigManager {
  readonly activeEnvironment: EnvironmentConfig | null = null;

  private readonly _configPath: string;
  private readonly _projectRoot: string;
  private readonly _rawConfig: Record<string, unknown>;
  private readonly _variables: Record<string, VariableDefinition>;
  private readonly _validation: ValidationConfig | undefined;
  private readonly _environments: Record<string, EnvironmentConfig>;
  private readonly _dotenvPath: string | null;
  private readonly _secretOrigin: SecretOrigin;
  private readonly _gcpProjectId: string | null;
  private readonly _consolidatedSecret: string | null;
  private readonly _fallbackToIndividualOverride: boolean | undefined;
  private readonly _fallbackToIndividual: boolean;
  private readonly _strict: boolean;
  private readonly _debug: boolean;
  private readonly _hasEnvironments: boolean;
  private readonly _dotenvValues: Record<string, string>;
  /** Whether old-format top-level encrypted_dotenv support is enabled. */
  private readonly _encryptedDotenvEnabled: boolean;
  /** `source` ya avisados como alias deprecado, para no repetir el warning. */
  private readonly _aliasWarned = new Set<string>();
  private _values: Record<string, unknown> = {};
  private _loaded = false;
  private _loadingPromise: Promise<void> | null = null;
  private _loadAttemptValues: Record<string, unknown> | null = null;
  private _loadAttemptEnvWrites: Map<string, string> | null = null;

  constructor(configPath: string, options?: ConfigManagerOptions) {
    // 1. Resolve configPath to absolute
    this._configPath = resolve(configPath);

    // 2. Discover projectRoot by walking up for package.json
    const configDir = dirname(this._configPath);
    this._projectRoot = discoverProjectRoot(configDir);

    // 3. Load YAML
    this._rawConfig = loadYaml(this._configPath);

    // 4. Extract and validate variables section
    const rawVariables = this._rawConfig.variables;
    if (rawVariables !== undefined && !isPlainObject(rawVariables)) {
      throw new Error('variables must be a mapping');
    }

    // Normalize variable definitions (YAML snake_case → camelCase)
    const rawVarsObj = (rawVariables as Record<string, unknown> | undefined) ?? {};
    const variables: Record<string, VariableDefinition> = {};
    for (const [name, rawDef] of Object.entries(rawVarsObj)) {
      if (!isPlainObject(rawDef)) {
        throw new Error(
          `Invalid configuration for '${name}'. Expected a mapping.`,
        );
      }
      variables[name] = normalizeVarDef(rawDef as Record<string, unknown>);
    }
    this._variables = variables;

    // 5. Extract and validate validation section
    const rawValidation = this._rawConfig.validation;
    if (rawValidation !== undefined && !isPlainObject(rawValidation)) {
      throw new Error('validation must be a mapping');
    }
    this._validation = rawValidation as ValidationConfig | undefined;

    // 6. Validate variable definitions
    for (const [name, def] of Object.entries(this._variables)) {
      // Neither source nor default nor required: truly invalid definition
      const hasRequired = 'required' in (def as Record<string, unknown>);
      if (def.source == null && def.default === undefined && !hasRequired) {
        throw new Error(
          `Variable '${name}' must define either 'source' or 'default' (or both).`,
        );
      }

      // Non-string source
      if (def.source !== undefined && def.source !== null && typeof def.source !== 'string') {
        throw new Error(
          `Variable '${name}': 'source' must be a string if provided.`,
        );
      }

      // Empty environment key
      if ('environment' in (def as Record<string, unknown>)) {
        const envVal = (def as Record<string, unknown>)['environment'];
        if (envVal !== null && envVal !== undefined && typeof envVal === 'string' && envVal.trim() === '') {
          throw new Error(
            `Variable '${name}': 'environment' must be a non-empty string.`,
          );
        }
      }

      // Empty dotenvPath
      if (def.dotenvPath !== undefined && def.dotenvPath !== null) {
        if (typeof def.dotenvPath !== 'string' || def.dotenvPath.trim() === '') {
          throw new Error(
            `Variable '${name}': 'dotenv_path' must be a non-empty string.`,
          );
        }
      }
    }

    // 7. Parse environments
    this._environments = parseEnvironments(this._rawConfig);
    this._hasEnvironments = Object.keys(this._environments).length > 0;

    // 8. Select active environment via APP_ENV
    const appEnv = process.env.APP_ENV;
    if (appEnv) {
      if (this._environments[appEnv]) {
        (this as { activeEnvironment: EnvironmentConfig | null }).activeEnvironment =
          this._environments[appEnv];
      } else {
        const available = Object.keys(this._environments).sort().join(', ');
        throw new Error(`Unknown environment '${appEnv}'. Available environments: ${available}`);
      }
    } else {
      const defaultEnv = Object.values(this._environments).find((e) => e.isDefault);
      if (defaultEnv) {
        (this as { activeEnvironment: EnvironmentConfig | null }).activeEnvironment = defaultEnv;
      } else if (this._environments['default']) {
        (this as { activeEnvironment: EnvironmentConfig | null }).activeEnvironment =
          this._environments['default'];
      } else {
        (this as { activeEnvironment: EnvironmentConfig | null }).activeEnvironment = null;
      }
    }

    // Validate variable-level environment references and origin overrides
    for (const [varName, varDef] of Object.entries(this._variables)) {
      if (
        varDef.environment != null &&
        varDef.environment !== '' &&
        !this._environments[varDef.environment]
      ) {
        throw new Error(
          `Unknown environment '${varDef.environment}' referenced by variable '${varName}'`,
        );
      }
      const rawOverride = varDef.secretOrigin ?? varDef.origin;
      const originOverride = rawOverride != null
        ? ((ORIGIN_ALIASES[rawOverride.toLowerCase()] ?? rawOverride.toLowerCase()) as SecretOrigin)
        : null;
      if (originOverride != null && !CANONICAL_ORIGINS.has(originOverride)) {
        throw new Error(
          `Invalid secret_origin '${rawOverride}' for variable '${varName}'. Must be 'local' or 'gcp' (or an alias)`,
        );
      }
    }

    // --- Resolution chains ---

    // Resolve dotenv path
    let resolvedDotenvPath: string | null = null;
    if (options?.dotenvPath != null) {
      // Use as-is (caller provides the path they intend, e.g. for test assertions)
      resolvedDotenvPath = options.dotenvPath;
    } else if (this.activeEnvironment?.dotenvPath != null) {
      // Resolve relative paths from active environment against projectRoot
      const envPath = this.activeEnvironment.dotenvPath;
      resolvedDotenvPath = resolvePath(envPath, this._projectRoot);
    } else if (!this._hasEnvironments) {
      // Old format: default to configDir/.env
      resolvedDotenvPath = join(configDir, '.env');
    }
    this._dotenvPath = resolvedDotenvPath;

    // Pre-read dotenv for SECRET_ORIGIN / GCP_PROJECT_ID detection and old-format values
    // Use dotenv.parse() which reads the FILE only (not process.env)
    this._dotenvValues = {};
    if (this._dotenvPath != null && existsSync(this._dotenvPath)) {
      try {
        this._dotenvValues = dotenv.parse(readFileSync(this._dotenvPath));
      } catch (error: unknown) {
        // §1.5.5: existsSync dijo que el archivo está. Que no se pueda leer es
        // permisos o disco, no ausencia, y tiene que ser audible.
        logger.warn(
          `Dotenv file ${this._dotenvPath} exists but could not be read: ${String(error)}`,
        );
      }
    }

    // Resolve secret origin (5-level chain)
    if (options?.secretOrigin != null) {
      this._secretOrigin = options.secretOrigin;
    } else if (process.env.SECRET_ORIGIN === 'local' || process.env.SECRET_ORIGIN === 'gcp') {
      this._secretOrigin = process.env.SECRET_ORIGIN;
    } else if (
      this._dotenvValues['SECRET_ORIGIN'] === 'local' ||
      this._dotenvValues['SECRET_ORIGIN'] === 'gcp'
    ) {
      this._secretOrigin = this._dotenvValues['SECRET_ORIGIN'] as SecretOrigin;
    } else if (this.activeEnvironment?.origin != null) {
      this._secretOrigin = this.activeEnvironment.origin;
    } else {
      this._secretOrigin = 'local';
    }

    // Resolve GCP project ID (5-level chain, default null)
    if (options?.gcpProjectId != null) {
      this._gcpProjectId = options.gcpProjectId;
    } else if (process.env.GCP_PROJECT_ID != null) {
      this._gcpProjectId = process.env.GCP_PROJECT_ID;
    } else if (this._dotenvValues['GCP_PROJECT_ID'] != null) {
      this._gcpProjectId = this._dotenvValues['GCP_PROJECT_ID'];
    } else if (this.activeEnvironment?.gcpProjectId != null) {
      this._gcpProjectId = this.activeEnvironment.gcpProjectId;
    } else {
      this._gcpProjectId = null;
    }

    // Resolve consolidated secret (§1.1). Mismo orden que gcpProjectId:
    // 1. parámetro explícito  2. CONSOLIDATED_SECRET del proceso
    // 3. valor del .env       4. config del entorno activo  5. null
    const consolidatedCandidate =
      options?.consolidatedSecret ??
      process.env.CONSOLIDATED_SECRET ??
      this._dotenvValues['CONSOLIDATED_SECRET'] ??
      null;
    if (consolidatedCandidate != null && String(consolidatedCandidate).trim() !== '') {
      this._consolidatedSecret = String(consolidatedCandidate).trim();
    } else {
      this._consolidatedSecret = this.activeEnvironment?.consolidatedSecret ?? null;
    }

    if (
      options?.fallbackToIndividual !== undefined &&
      typeof options.fallbackToIndividual !== 'boolean'
    ) {
      throw new Error('ConfigManager: fallbackToIndividual must be a boolean');
    }
    this._fallbackToIndividualOverride = options?.fallbackToIndividual;
    this._fallbackToIndividual =
      this._fallbackToIndividualOverride ?? this.activeEnvironment?.fallbackToIndividual ?? true;
    if (!this._fallbackToIndividual && this._consolidatedSecret === null) {
      throw new Error(
        "ConfigManager: fallbackToIndividual cannot be false without consolidatedSecret",
      );
    }

    // Resolve strict mode (constructor param always wins, then YAML, then false)
    if (options?.strict !== undefined) {
      this._strict = options.strict;
    } else if (this._validation?.strict !== undefined) {
      this._strict = this._validation.strict;
    } else {
      this._strict = false;
    }

    // Set debug
    this._debug = options?.debug ?? false;

    // Parse old-format top-level encrypted_dotenv config
    const rawEncryptedDotenv = this._rawConfig.encrypted_dotenv;
    if (
      isPlainObject(rawEncryptedDotenv) &&
      (rawEncryptedDotenv as Record<string, unknown>).enabled === true
    ) {
      this._encryptedDotenvEnabled = true;
    } else {
      this._encryptedDotenvEnabled = false;
    }

  }

  _defaultSourceContext(): SourceContext {
    return {
      environmentName: this.activeEnvironment?.name ?? '',
      secretOrigin: this._secretOrigin,
      gcpProjectId: this._gcpProjectId,
      dotenvPath: this._dotenvPath,
      consolidatedSecret: this._consolidatedSecret,
      fallbackToIndividual: this._fallbackToIndividual,
    };
  }

  private _effectiveSourceContext(varName: string): SourceContext {
    const base = this._defaultSourceContext();
    const varDef = this._variables[varName];
    if (!varDef) return base;

    let ctx = { ...base };

    // Apply environment pin
    if (varDef.environment != null && varDef.environment !== '') {
      const pinnedEnv = this._environments[varDef.environment];
      const pinnedDotenvPath = pinnedEnv.dotenvPath != null
        ? resolvePath(pinnedEnv.dotenvPath, this._projectRoot)
        : null;
      ctx = {
        environmentName: pinnedEnv.name,
        secretOrigin: pinnedEnv.origin,
        gcpProjectId: pinnedEnv.gcpProjectId,
        dotenvPath: pinnedDotenvPath,
        // El secreto consolidado pertenece al entorno al que la variable
        // apunta, no al activo.
        consolidatedSecret: pinnedEnv.consolidatedSecret ?? null,
        fallbackToIndividual:
          this._fallbackToIndividualOverride ?? pinnedEnv.fallbackToIndividual ?? true,
      };
    }

    // Apply origin override (secretOrigin or origin key)
    const rawOriginOverride = varDef.secretOrigin ?? varDef.origin;
    const originOverride = rawOriginOverride != null
      ? (ORIGIN_ALIASES[rawOriginOverride.toLowerCase()] ?? rawOriginOverride.toLowerCase()) as SecretOrigin
      : null;
    if (originOverride != null) {
      const origin = originOverride;
      ctx = { ...ctx, secretOrigin: origin };
      if (origin === 'gcp') {
        // GCP origin: dotenvPath is always null (dotenv is irrelevant for GCP secrets)
        ctx = { ...ctx, dotenvPath: null };
      } else if (origin === 'local' && ctx.dotenvPath === null) {
        ctx = { ...ctx, dotenvPath: this._dotenvPath };
      }
    }

    // Apply gcpProjectId override from variable def
    const varGcpProjectId = varDef.gcpProjectId;
    if (varGcpProjectId != null) {
      ctx = { ...ctx, gcpProjectId: varGcpProjectId };
    }

    // Apply dotenvPath override from variable def ONLY for local origin
    // (GCP origin ignores dotenv_path even if specified on the variable)
    if (varDef.dotenvPath != null && varDef.dotenvPath !== '' && ctx.secretOrigin === 'local') {
      ctx = { ...ctx, dotenvPath: resolvePath(varDef.dotenvPath, this._projectRoot) };
    }

    return ctx;
  }

  /**
   * Validate a single variable definition.
   * Throws on empty dotenv_path, non-string source, empty environment key.
   * Also triggers environment/origin validation via _effectiveSourceContext.
   */
  private _validateVariableDefinition(varName: string, varDef: VariableDefinition): void {
    // Empty dotenv_path
    if (varDef.dotenvPath !== undefined && varDef.dotenvPath !== null) {
      if (typeof varDef.dotenvPath !== 'string' || varDef.dotenvPath.trim() === '') {
        throw new Error(`Variable '${varName}': 'dotenv_path' must be a non-empty string.`);
      }
    }

    // Non-string source
    if (varDef.source !== undefined && varDef.source !== null && typeof varDef.source !== 'string') {
      throw new Error(`Variable '${varName}': 'source' must be a string if provided.`);
    }

    // Empty environment key
    if ('environment' in (varDef as Record<string, unknown>)) {
      const envVal = (varDef as Record<string, unknown>)['environment'];
      if (envVal !== null && envVal !== undefined && typeof envVal === 'string' && envVal.trim() === '') {
        throw new Error(`Variable '${varName}': 'environment' must be a non-empty string.`);
      }
    }

    // Trigger environment/origin validation
    this._effectiveSourceContext(varName);
  }

  private _writeProcessEnv(key: string, value: string): void {
    if (this._loadAttemptEnvWrites !== null) {
      this._loadAttemptEnvWrites.set(key, value);
      return;
    }
    process.env[key] = value;
    _processEnvWrites.add(key);
  }

  private _storeLoadedValue(name: string, value: unknown): void {
    if (this._loadAttemptValues !== null) {
      this._loadAttemptValues[name] = value;
      return;
    }

    this._values[name] = value;
  }

  private _beginLoadAttempt(): void {
    this._loadAttemptValues = {};
    this._loadAttemptEnvWrites = new Map();
  }

  private _commitLoadAttempt(): void {
    if (this._loadAttemptValues === null || this._loadAttemptEnvWrites === null) {
      return;
    }

    this._values = this._loadAttemptValues;
    for (const [key, value] of this._loadAttemptEnvWrites.entries()) {
      process.env[key] = value;
      _processEnvWrites.add(key);
    }
  }

  private _clearLoadAttempt(): void {
    this._loadAttemptValues = null;
    this._loadAttemptEnvWrites = null;
  }

  private _createMissingIssue(
    name: string,
    def: VariableDefinition,
    ctx: SourceContext,
    sourceKey: string,
    ctxLabel: string = buildContextLabel(ctx),
  ): ConfigValidationIssue | null {
    if (this._strict) {
      return createConfigValidationIssue(
        name,
        sourceKey,
        'missing',
        `Strict mode: variable '${name}' is missing from source '${sourceKey}' in ${ctxLabel}.`,
        ctx,
      );
    }

    if (def.required === true && def.default === undefined) {
      return createConfigValidationIssue(
        name,
        sourceKey,
        'missing',
        `Required variable '${name}' not found in source '${sourceKey}' for ${ctxLabel}.`,
        ctx,
      );
    }

    return null;
  }

  private _createInvalidIssue(
    name: string,
    sourceKey: string,
    ctx: SourceContext,
    error: unknown,
  ): ConfigValidationIssue {
    const message = error instanceof Error ? error.message : String(error);
    return createConfigValidationIssue(name, sourceKey, 'invalid', message, ctx);
  }

  private _createOldFormatMissingIssue(
    name: string,
    def: VariableDefinition,
    sourceKey: string,
  ): ConfigValidationIssue | null {
    const ctx = this._defaultSourceContext();

    if (this._strict) {
      return createConfigValidationIssue(
        name,
        sourceKey,
        'missing',
        `Strict mode: variable '${name}' is missing`,
        ctx,
      );
    }

    if (def.required === true) {
      return createConfigValidationIssue(
        name,
        sourceKey,
        'missing',
        `Required variable '${name}' not found in source`,
        ctx,
      );
    }

    return null;
  }

  private _isDeferredPerVariableDotenvMissing(
    def: VariableDefinition,
    ctx: SourceContext,
  ): boolean {
    return (
      def.dotenvPath != null &&
      def.dotenvPath !== '' &&
      ctx.secretOrigin === 'local' &&
      ctx.dotenvPath != null &&
      !existsSync(ctx.dotenvPath)
    );
  }

  private _getDeferredPerVariableDotenvError(
    def: VariableDefinition,
    ctx: SourceContext,
  ): Error | null {
    if (!this._isDeferredPerVariableDotenvMissing(def, ctx)) {
      return null;
    }

    return new Error(`DotEnvLoader: dotenv file not found: ${ctx.dotenvPath}`);
  }

  private _finalizeLoadedValue(
    name: string,
    sourceKey: string,
    def: VariableDefinition,
    rawValue: unknown,
  ): unknown {
    let coerced: unknown = rawValue;
    if (rawValue !== null && rawValue !== undefined && def.type != null) {
      coerced = coerceType(rawValue, def.type, name);
    }

    this._storeLoadedValue(name, coerced);

    if (coerced !== null && coerced !== undefined) {
      const value = String(coerced);
      // Se exporta con el NOMBRE de la variable, igual que Python
      // (`os.environ[var_name]`, manager.py:503). El nombre es el contrato con
      // el mundo exterior: un config que declara `PGHOST` con
      // `source: JUAN_DB_HOST` quiere que libpq encuentre `PGHOST`. Antes JS
      // exportaba bajo el `source` y esa variable nunca aparecía. Ver D11 en
      // PARITY.md.
      this._writeProcessEnv(name, value);

      // Alias transitorio: se sigue exportando también bajo el `source` durante
      // una versión, para no romper a quien dependa de la conducta vieja. Se
      // elimina en la release siguiente.
      if (sourceKey !== name) {
        this._writeProcessEnv(sourceKey, value);
        if (!this._aliasWarned.has(sourceKey)) {
          this._aliasWarned.add(sourceKey);
          logger.warn(
            `Deprecated: '${name}' is also exported to process.env as '${sourceKey}' ` +
              'because its `source` differs from its name. This alias is removed in the ' +
              `next release — read '${name}' instead.`,
          );
        }
      }
      logger.info(`Loaded ${name}: ${this._debug ? value : maskSecret(value)}`);
    }

    return coerced;
  }

  async load(): Promise<void> {
    if (this._loaded) return;
    if (this._loadingPromise !== null) return this._loadingPromise;
    this._loadingPromise = (async () => {
      _resetLoaderCache();
      this._beginLoadAttempt();
      try {
        if (this._hasEnvironments) {
          await this._loadNewFormat();
        } else {
          await this._loadOldFormat();
        }
        this._commitLoadAttempt();
        this._loaded = true;
      } finally {
        this._clearLoadAttempt();
        this._loadingPromise = null;
      }
    })();
    return this._loadingPromise;
  }

  private async _loadNewFormat(): Promise<void> {
    if (this._hasEnvironments) {
      // Classify variables: sourced (have explicit source key) vs default-only (no source key)
    }

    interface SourcingInfo {
      name: string;
      def: VariableDefinition;
      sourceKey: string;
      ctx: SourceContext;
      hasPerVarDotenvPath: boolean;
    }

    const sourcedVars: SourcingInfo[] = [];

    for (const [name, def] of Object.entries(this._variables)) {
      if (def.source == null) {
        // Default-only: store default value (or leave unset for lazy)
        if (def.default !== undefined) {
          this._storeLoadedValue(name, def.default);
        }
        continue;
      }

      const ctx = this._effectiveSourceContext(name);
      const hasPerVarDotenvPath = def.dotenvPath != null && def.dotenvPath !== '';
      sourcedVars.push({ name, def, sourceKey: def.source, ctx, hasPerVarDotenvPath });
    }

    // Group sourced variables by loader context key
    const groups = new Map<string, SourcingInfo[]>();
    for (const info of sourcedVars) {
      const {
        secretOrigin,
        gcpProjectId,
        dotenvPath,
        consolidatedSecret,
        fallbackToIndividual,
      } = info.ctx;
      const key =
        `${secretOrigin}:${gcpProjectId ?? ''}:${dotenvPath ?? ''}:` +
        `${consolidatedSecret ?? ''}:${String(fallbackToIndividual)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(info);
    }

    const groupLoads: Promise<ConfigValidationIssue[]>[] = [];

    // Fetch each group
    for (const [, groupInfos] of groups) {
      const {
        secretOrigin,
        gcpProjectId,
        dotenvPath,
        consolidatedSecret,
        fallbackToIndividual,
      } = groupInfos[0].ctx;

      // Pre-flight: separate vars that can be resolved from process.env
      const fromProcessEnv = new Map<string, string>();
      const needFile: SourcingInfo[] = [];

      for (const info of groupInfos) {
        if (process.env[info.sourceKey] !== undefined) {
          fromProcessEnv.set(info.name, process.env[info.sourceKey]!);
        } else {
          needFile.push(info);
        }
      }

      // Fetch remaining vars from file/GCP
      const storeGroupResults = (fileResults: Record<string, string | null>): ConfigValidationIssue[] => {
        const groupIssues: ConfigValidationIssue[] = [];

        for (const info of groupInfos) {
          const { name, def, sourceKey, ctx } = info;

          let rawValue: unknown = null;
          if (fromProcessEnv.has(name)) {
            rawValue = fromProcessEnv.get(name)!;
          } else {
            const fileVal = fileResults[sourceKey];
            if (fileVal !== null && fileVal !== undefined) {
              rawValue = fileVal;
            }
          }

          if (rawValue === null && def.default !== undefined && def.required !== true) {
            rawValue = def.default;
          }

          if (rawValue === null) {
            if (this._isDeferredPerVariableDotenvMissing(def, ctx)) {
              this._storeLoadedValue(name, null);
              continue;
            }

            const issue = this._createMissingIssue(name, def, ctx, sourceKey);
            if (issue !== null) {
              groupIssues.push(issue);
              continue;
            }
          }

          try {
            this._finalizeLoadedValue(name, sourceKey, def, rawValue);
          } catch (error) {
            groupIssues.push(this._createInvalidIssue(name, sourceKey, ctx, error));
          }
        }

        return groupIssues;
      };

      // Determine if encrypted dotenv is enabled for the active environment of this group.
      const groupEnvName = groupInfos[0].ctx.environmentName;
      const groupEnvConfig = this._environments[groupEnvName];
      const groupEncryptedEnabled = groupEnvConfig?.encryptedDotenv?.enabled === true;

      const resolveFileResults = async (): Promise<Record<string, string | null>> => {
        if (needFile.length === 0) {
          return Promise.resolve({} as Record<string, string | null>);
        }

        if (groupEncryptedEnabled && secretOrigin !== 'local') {
          throw new NotImplementedError(
            `Encrypted dotenv is only supported for local-origin environments. ` +
            `Environment "${groupEnvName}" has origin "${secretOrigin}".`,
          );
        }

        if (secretOrigin === 'local') {
          if (groupEncryptedEnabled && dotenvPath != null) {
            // Encrypted dotenv mode: delegate to DotEnvLoader.
            // DecryptionError propagates directly (not wrapped in ConfigValidationError).
            const privateKeyConfig = groupEnvConfig?.encryptedDotenv?.privateKey;
            let explicitPrivateKey: string | null = null;

            if (privateKeyConfig != null) {
              // Resolve the dedicated private key before constructing the loader.
              const keyLoader = createLoader({
                secretOrigin: privateKeyConfig.secretOrigin,
                gcpProjectId: privateKeyConfig.gcpProjectId ?? null,
                dotenvPath: privateKeyConfig.dotenvPath != null
                  ? resolvePath(privateKeyConfig.dotenvPath, this._projectRoot)
                  : null,
              });
              explicitPrivateKey = await keyLoader.get(privateKeyConfig.source);
            }

            const loader = new DotEnvLoader(dotenvPath, {
              encrypted: true,
              environmentName: groupEnvName,
              ...(explicitPrivateKey != null ? { explicitPrivateKey } : {}),
            });
            return loader.getMany(needFile.map((i) => i.sourceKey));
          }

          const fileResults: Record<string, string | null> = {};
          if (dotenvPath != null && existsSync(dotenvPath)) {
            try {
              const parsed = dotenv.parse(readFileSync(dotenvPath));
              for (const info of needFile) {
                fileResults[info.sourceKey] = parsed[info.sourceKey] ?? null;
              }
            } catch (error: unknown) {
              // §1.5.5: no se silencia. Se dice qué archivo falló antes de
              // degradar a null, si no un disco malo se ve igual que un .env
              // sin la clave.
              logger.warn(
                `Dotenv file ${dotenvPath} exists but could not be parsed: ${String(error)}. ` +
                  `Treating ${needFile.length} variable(s) as unset.`,
              );
              for (const info of needFile) {
                fileResults[info.sourceKey] = null;
              }
            }
          } else if (dotenvPath != null) {
            const envLevelVars = needFile.filter((i) => !i.hasPerVarDotenvPath);
            if (envLevelVars.length > 0) {
              const ctx = envLevelVars[0].ctx;
              const ctxLabel = buildContextLabel(ctx);
              throw new Error(
                `DotEnvLoader: dotenv file not found: ${dotenvPath} (${ctxLabel})`,
              );
            }
            for (const info of needFile) {
              fileResults[info.sourceKey] = null;
            }
          } else {
            for (const info of needFile) {
              fileResults[info.sourceKey] = null;
            }
          }
          return fileResults;
        }

        const loader = createLoader({
          secretOrigin,
          gcpProjectId,
          dotenvPath,
          consolidatedSecret,
          fallbackToIndividual,
        });
        return loader.getMany(needFile.map((i) => i.sourceKey));
      };

      groupLoads.push(resolveFileResults().then((resolved) => storeGroupResults(resolved)));
    }

    const issues = (await Promise.all(groupLoads)).flat();

    if (issues.length > 0) {
      throw new ConfigValidationError(issues);
    }
  }

  private async _loadOldFormat(): Promise<void> {
    // OLD FORMAT (no environments section): use createLoader for explicit-source vars.
    // Validation (required/strict) happens here in load(), not deferred to get().

    interface OldFormatInfo {
      name: string;
      def: VariableDefinition;
      sourceKey: string;
      ctx: SourceContext;
    }

    const ctx = this._defaultSourceContext();
    const {
      secretOrigin,
      gcpProjectId,
      dotenvPath,
      consolidatedSecret,
      fallbackToIndividual,
    } = ctx;

    // Classify vars
    const sourcedVars: OldFormatInfo[] = [];

    for (const [name, def] of Object.entries(this._variables)) {
      if (def.source == null) {
        // Default-only: store default value
        if (def.default !== undefined) {
          this._storeLoadedValue(name, def.default);
        }
        continue;
      }
      sourcedVars.push({ name, def, sourceKey: def.source, ctx });
    }

    if (sourcedVars.length === 0) return;

    // Separate process.env covered vars from those needing loader
    const fromProcessEnv = new Map<string, string>();
    const needLoader: OldFormatInfo[] = [];

    for (const info of sourcedVars) {
      if (process.env[info.sourceKey] !== undefined) {
        fromProcessEnv.set(info.name, process.env[info.sourceKey]!);
      } else {
        needLoader.push(info);
      }
    }

    // Batch-fetch remaining via createLoader (DotEnvLoader or GCPSecretLoader)
    const issues: ConfigValidationIssue[] = [];

    const storeLoaderResults = (loaderResults: Record<string, string | null>): void => {
      for (const info of sourcedVars) {
        const { name, def, sourceKey, ctx: infoCtx } = info;

        let rawValue: unknown = null;
        if (fromProcessEnv.has(name)) {
          rawValue = fromProcessEnv.get(name)!;
        } else {
          const loaderVal = loaderResults[sourceKey];
          if (loaderVal !== null && loaderVal !== undefined) {
            rawValue = loaderVal;
          }
        }

        if (rawValue === null && def.default !== undefined) {
          rawValue = def.default;
        }

        if (rawValue === null) {
          const issue = this._createOldFormatMissingIssue(name, def, sourceKey);
          if (issue !== null) {
            issues.push(issue);
            continue;
          }

          this._storeLoadedValue(name, null);
          continue;
        }

        try {
          this._finalizeLoadedValue(name, sourceKey, def, rawValue);
        } catch (error) {
          issues.push(this._createInvalidIssue(name, sourceKey, infoCtx, error));
        }
      }
    };

    let loaderResults: Record<string, string | null> = {};
    if (needLoader.length > 0) {
      const loaderSourceKeys = needLoader.map((i) => i.sourceKey);

      if (this._encryptedDotenvEnabled && secretOrigin !== 'local') {
        throw new NotImplementedError(
          `Encrypted dotenv is only supported for local-origin environments. ` +
          `Current secretOrigin is "${secretOrigin}".`,
        );
      } else if (this._encryptedDotenvEnabled) {
        // Encrypted old-format: use DotEnvLoader with encrypted mode.
        // Old-format configs have no environment name — only the generic key chain is used.
        // DecryptionError propagates directly (not wrapped in ConfigValidationError).
        const loader = new DotEnvLoader(dotenvPath, { encrypted: true });
        loaderResults = await loader.getMany(loaderSourceKeys);
      } else {
        const loader = createLoader({
          secretOrigin,
          gcpProjectId,
          dotenvPath,
          consolidatedSecret,
          fallbackToIndividual,
        });
        loaderResults = await loader.getMany(loaderSourceKeys);
      }
    }

    storeLoaderResults(loaderResults);

    if (issues.length > 0) {
      throw new ConfigValidationError(issues);
    }
  }

  /**
   * Valor obligatorio. Paridad con `ConfigManager.require` de Python.
   */
  require(name: string): unknown {
    const value = this.get(name);
    if (value === null || value === undefined) {
      throw new Error(
        `Required configuration '${name}' is missing. Call initConfig or set a default.`,
      );
    }
    return value;
  }

  /**
   * Copia de los valores cargados. Paridad con la propiedad `values` de Python.
   */
  get values(): Record<string, unknown> {
    if (!this._loaded) {
      throw new Error(
        `ConfigManager not loaded. Call \`await initConfig()\` before reading values.`,
      );
    }
    return { ...this._values };
  }

  get(name: string): unknown | null {
    if (!this._loaded) {
      throw new Error(
        `ConfigManager not loaded. Call \`await initConfig()\` before reading values.`,
      );
    }

    const def = this._variables[name];

    // If value was loaded (cached in _values), validate and return
    if (Object.prototype.hasOwnProperty.call(this._values, name)) {
      const cached = this._values[name];

      if (this._hasEnvironments && def?.source != null) {
        // NEW FORMAT sourced variable: check process.env override at get() time
        const sourceKey = def.source;
        if (process.env[sourceKey] !== undefined && process.env[sourceKey] !== this._values[name]) {
          // process.env was updated since load(); use new value
          const override = process.env[sourceKey]!;
          let coerced: unknown = override;
          if (def.type != null) coerced = coerceType(override, def.type, name);
          return coerced as unknown;
        }
      }

      if (cached === null || cached === undefined) {
        // Null cached: apply required/strict checks (NEW FORMAT only; OLD FORMAT already threw)
        if (this._hasEnvironments && def?.source != null) {
          const ctx = this._effectiveSourceContext(name);
          const ctxLabel = buildContextLabel(ctx);
          const sourceKey = def.source;

          // process.env override at get() time
          if (process.env[sourceKey] !== undefined) {
            const envVal = process.env[sourceKey]!;
            return this._finalizeLoadedValue(name, sourceKey, def, envVal) as unknown;
          }

          const deferredDotenvError = this._getDeferredPerVariableDotenvError(def, ctx);
          if (deferredDotenvError !== null) {
            throw deferredDotenvError;
          }

          return this._handleMissingLoadedValue(name, def, ctx, sourceKey, ctxLabel);
        } else {
          // OLD FORMAT or default-only var: simple required/optional check
          if (def?.required === true) {
            throw new Error(`Required variable '${name}' is not set`);
          }
          if (def?.required === false) {
            logger.warn(`Optional variable '${name}' is not set`);
          }
        }
        return null;
      }

      return cached as unknown;
    }

    // Not in cache: variable defined but not populated during load()
    // (e.g., required-only with no source/default, or old-format implicit key)
    if (!def) return null;

    if (def.source == null) {
      // No explicit source key
      if (!this._hasEnvironments) {
        // OLD FORMAT, no source: use uppercase varname as source key
        const sourceKey = name.toUpperCase();
        let rawValue: unknown = null;

        // process.env wins
        if (process.env[sourceKey] !== undefined) {
          rawValue = process.env[sourceKey];
        } else if (this._dotenvValues[sourceKey] !== undefined) {
          rawValue = this._dotenvValues[sourceKey];
        }

        if (rawValue === null && def.default !== undefined) {
          rawValue = def.default;
        }

        if (rawValue === null) {
          if (def.required === true) {
            throw new Error(`Required variable '${name}' is not set`);
          }
          if (def.required === false) {
            logger.warn(`Optional variable '${name}' is not set`);
          }
          return null;
        }

        return this._finalizeLoadedValue(name, sourceKey, def, rawValue) as unknown;
      } else {
        // NEW FORMAT, no explicit source: check process.env only.
        // Variables should have been loaded during await manager.load().
        const sourceKey = name;

        let rawValue: unknown = null;
        if (process.env[sourceKey] !== undefined) {
          rawValue = process.env[sourceKey];
        }

        if (rawValue === null && def.default !== undefined) {
          rawValue = def.default;
        }

        if (rawValue === null) {
          if (def.required === true) {
            throw new Error(`Required variable '${name}' is not set`);
          }
          if (def.required === false) {
            logger.warn(`Optional variable '${name}' is not set`);
          }
          return null;
        }

        return this._finalizeLoadedValue(name, sourceKey, def, rawValue) as unknown;
      }
    }

    // New format with explicit source but not in cache (should have been loaded during init).
    // Only check process.env override; GCP vars are expected in cache after await manager.load().
    const ctx = this._effectiveSourceContext(name);
    const sourceKey = def.source;

    let rawValue: unknown = null;
    if (process.env[sourceKey] !== undefined) {
      rawValue = process.env[sourceKey];
    }

    if (rawValue === null && def.default !== undefined) {
      rawValue = def.default;
    }

    if (rawValue === null) {
      const ctxLabel = buildContextLabel(ctx);
      const deferredDotenvError = this._getDeferredPerVariableDotenvError(def, ctx);
      if (deferredDotenvError !== null) {
        throw deferredDotenvError;
      }
      if (this._strict) {
        throw new Error(
          `Strict mode: variable '${name}' is missing from source '${sourceKey}' in ${ctxLabel}.`,
        );
      }
      if (def.required === true) {
        throw new Error(
          `Required variable '${name}' not found in source '${sourceKey}' for ${ctxLabel}.`,
        );
      }
      if (def.required === false) {
        logger.warn(
          `Optional variable '${name}' resolved to None because source '${sourceKey}' was unavailable in ${ctxLabel}.`,
        );
      }
      return null;
    }

    return this._finalizeLoadedValue(name, sourceKey, def, rawValue) as unknown;
  }

  private _handleMissingLoadedValue(
    name: string,
    def: VariableDefinition,
    ctx: SourceContext,
    sourceKey: string,
    ctxLabel: string = buildContextLabel(ctx),
  ): unknown | null {
    if (this._strict) {
      throw new Error(
        `Strict mode: variable '${name}' is missing from source '${sourceKey}' in ${ctxLabel}.`,
      );
    }
    if (def.required === true) {
      if (def.default !== undefined) {
        logger.warn(
          `Required variable '${name}' missing from source; using YAML default for source '${sourceKey}' in ${ctxLabel}.`,
        );
        return def.default as unknown;
      }
      throw new Error(
        `Required variable '${name}' not found in source '${sourceKey}' for ${ctxLabel}.`,
      );
    }
    if (def.required === false) {
      logger.warn(
        `Optional variable '${name}' resolved to None because source '${sourceKey}' was unavailable in ${ctxLabel}.`,
      );
    }
    return null;
  }

}

export async function initConfig(
  configPath: string,
  options?: ConfigManagerOptions,
): Promise<ConfigManager> {
  if (singleton !== null) {
    // Paridad con Python (`init_config`): re-inicializar REEMPLAZA la instancia.
    // Devolver la vieja hacía que un segundo initConfig con otro config fuera
    // un no-op silencioso.
    logger.warn('Configuration manager already initialised. Replacing existing instance.');
  }
  singleton = new ConfigManager(configPath, options);
  await singleton.load();
  return singleton;
}

export function getConfig(name?: string, defaultValue: unknown = null): unknown | ConfigManager {
  if (singleton === null) {
    // Paridad con Python: no inicializado es un error, no un `null` que el
    // consumidor confunde con "la variable no existe".
    throw new Error('Configuration manager not initialised. Call initConfig().');
  }
  if (name === undefined) {
    // Extensión propia de JS, sin equivalente en Python: sin nombre devuelve el
    // manager. Declarada en PARITY.md.
    return singleton;
  }
  const value = singleton.get(name);
  return value === null || value === undefined ? defaultValue : value;
}

export function requireConfig(name?: string): unknown | ConfigManager {
  if (singleton === null) {
    throw new Error('Configuration manager not initialised. Call initConfig().');
  }
  if (name === undefined) {
    return singleton;
  }
  const value = singleton.get(name);
  if (value === null || value === undefined) {
    throw new Error(`Required configuration '${name}' is missing`);
  }
  return value;
}

export function _resetSingleton(): void {
  singleton = null;
  _resetLoaderCache();
  // Clean up all process.env keys written by ConfigManager instances
  for (const key of _processEnvWrites) {
    delete process.env[key];
  }
  _processEnvWrites.clear();
}
