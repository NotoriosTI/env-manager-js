import { existsSync, readFileSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';

import dotenv from 'dotenv';

import type {
  ConfigManagerOptions,
  EnvironmentConfig,
  SecretOrigin,
  SourceContext,
  ValidationConfig,
  VariableDefinition,
} from './types.js';
import { parseEnvironments } from './environment.js';
import { createLoader } from './factory.js';
import { coerceType, loadYaml } from './utils.js';

let singleton: ConfigManager | null = null;

/** Track all keys written to process.env by any ConfigManager, for cleanup in _resetSingleton. */
const _processEnvWrites = new Set<string>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function discoverProjectRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, 'package.json'))) {
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
  private readonly _strict: boolean;
  private readonly _debug: boolean;
  private readonly _hasEnvironments: boolean;
  private readonly _dotenvValues: Record<string, string>;
  private _values: Record<string, unknown> = {};
  private _loaded = false;

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
      const originOverride = varDef.secretOrigin ?? varDef.origin;
      if (originOverride != null && originOverride !== 'local' && originOverride !== 'gcp') {
        throw new Error(
          `Invalid secret_origin '${originOverride}' for variable '${varName}'. Must be 'local' or 'gcp'`,
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
      } catch {
        // Silently ignore unreadable dotenv
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

    // autoLoad guard
    if (options?.autoLoad !== false) {
      this.load();
    }
  }

  _defaultSourceContext(): SourceContext {
    return {
      environmentName: this.activeEnvironment?.name ?? '',
      secretOrigin: this._secretOrigin,
      gcpProjectId: this._gcpProjectId,
      dotenvPath: this._dotenvPath,
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
      };
    }

    // Apply origin override (secretOrigin or origin key)
    const originOverride = varDef.secretOrigin ?? varDef.origin;
    if (originOverride != null) {
      const origin = originOverride as SecretOrigin;
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
    process.env[key] = value;
    _processEnvWrites.add(key);
  }

  load(): void {
    if (this._loaded) return;

    if (this._hasEnvironments) {
      // NEW FORMAT: Group sourced variables by loader context and batch-fetch via getMany().
      // Validation (required/strict) is deferred to get().
      this._loadNewFormat();
    } else {
      // OLD FORMAT: Use pre-read _dotenvValues + direct process.env check.
      // Validation (required/strict) happens here in load().
      this._loadOldFormat();
    }

    this._loaded = true;
  }

  private _loadNewFormat(): void {
    // Classify variables: sourced (have explicit source key) vs default-only (no source key)
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
          this._values[name] = def.default;
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
      const { secretOrigin, gcpProjectId, dotenvPath } = info.ctx;
      const key = `${secretOrigin}:${gcpProjectId ?? ''}:${dotenvPath ?? ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(info);
    }

    // Fetch each group
    for (const [, groupInfos] of groups) {
      const { secretOrigin, gcpProjectId, dotenvPath } = groupInfos[0].ctx;

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
      let fileResults: Record<string, string | null> = {};

      if (needFile.length > 0) {
        if (secretOrigin === 'local') {
          // LOCAL ORIGIN: read dotenv file directly — do NOT go through createLoader
          if (dotenvPath != null && existsSync(dotenvPath)) {
            // File exists: parse it
            try {
              const parsed = dotenv.parse(readFileSync(dotenvPath));
              for (const info of needFile) {
                fileResults[info.sourceKey] = parsed[info.sourceKey] ?? null;
              }
            } catch {
              for (const info of needFile) {
                fileResults[info.sourceKey] = null;
              }
            }
          } else if (dotenvPath != null) {
            // File is missing: determine whether to throw now or defer
            // Per-variable dotenv_path overrides: defer to get()
            // Environment-level dotenv_path: fail now if any var lacks a per-variable override
            const envLevelVars = needFile.filter((i) => !i.hasPerVarDotenvPath);
            if (envLevelVars.length > 0) {
              // At least one var depends on the missing env-level file: throw now with context
              const ctx = envLevelVars[0].ctx;
              const ctxLabel = buildContextLabel(ctx);
              throw new Error(
                `DotEnvLoader: dotenv file not found: ${dotenvPath} (${ctxLabel})`,
              );
            }
            // All vars have per-variable overrides: defer (store null, throw at get() time)
            for (const info of needFile) {
              fileResults[info.sourceKey] = null;
            }
          } else {
            // No dotenvPath (local with no file path): all null
            for (const info of needFile) {
              fileResults[info.sourceKey] = null;
            }
          }
        } else {
          // GCP origin: use createLoader
          const loader = createLoader({ secretOrigin, gcpProjectId, dotenvPath });
          const loaderSourceKeys = needFile.map((i) => i.sourceKey);
          fileResults = loader.getMany(loaderSourceKeys) as Record<string, string | null>;
        }
      }

      // Merge results and store
      for (const info of groupInfos) {
        const { name, def, sourceKey } = info;

        let rawValue: unknown = null;
        if (fromProcessEnv.has(name)) {
          rawValue = fromProcessEnv.get(name)!;
        } else {
          const fileVal = fileResults[sourceKey];
          if (fileVal !== null && fileVal !== undefined) {
            rawValue = fileVal;
          }
        }

        // Apply default if null — but NOT for required:true vars
        // (get() handles required+default by emitting a warning before returning the default)
        if (rawValue === null && def.default !== undefined && def.required !== true) {
          rawValue = def.default;
        }

        // Coerce type
        let coerced: unknown = rawValue;
        if (rawValue !== null && def.type != null) {
          coerced = coerceType(rawValue, def.type, name);
        }

        this._values[name] = coerced;

        // Write non-null values to process.env
        if (coerced !== null) {
          this._writeProcessEnv(sourceKey, String(coerced));
          if (this._debug) {
            console.log(`Loaded ${name}: ${String(coerced)}`);
          }
        }
      }
    }
  }

  private _loadOldFormat(): void {
    // OLD FORMAT (no environments section): use createLoader for explicit-source vars.
    // Validation (required/strict) happens here in load(), not deferred to get().

    interface OldFormatInfo {
      name: string;
      def: VariableDefinition;
      sourceKey: string;
    }

    const ctx = this._defaultSourceContext();
    const { secretOrigin, gcpProjectId, dotenvPath } = ctx;

    // Classify vars
    const sourcedVars: OldFormatInfo[] = [];

    for (const [name, def] of Object.entries(this._variables)) {
      if (def.source == null) {
        // Default-only: store default value
        if (def.default !== undefined) {
          this._values[name] = def.default;
        }
        continue;
      }
      sourcedVars.push({ name, def, sourceKey: def.source });
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
    let loaderResults: Record<string, string | null> = {};
    if (needLoader.length > 0) {
      const loader = createLoader({ secretOrigin, gcpProjectId, dotenvPath });
      const loaderSourceKeys = needLoader.map((i) => i.sourceKey);
      loaderResults = loader.getMany(loaderSourceKeys) as Record<string, string | null>;
    }

    // Store results
    for (const info of sourcedVars) {
      const { name, def, sourceKey } = info;

      let rawValue: unknown = null;
      if (fromProcessEnv.has(name)) {
        rawValue = fromProcessEnv.get(name)!;
      } else {
        const loaderVal = loaderResults[sourceKey];
        if (loaderVal !== null && loaderVal !== undefined) {
          rawValue = loaderVal;
        }
      }

      // Apply default if null
      if (rawValue === null && def.default !== undefined) {
        rawValue = def.default;
      }

      // OLD FORMAT: validate missing here (not deferred to get())
      if (rawValue === null) {
        if (this._strict) {
          throw new Error(`Strict mode: variable '${name}' is missing`);
        }
        if (def.required === true) {
          throw new Error(`Required variable '${name}' not found in source`);
        }
        this._values[name] = null;
        continue;
      }

      // Coerce type
      let coerced: unknown = rawValue;
      if (def.type != null) {
        coerced = coerceType(rawValue, def.type, name);
      }

      this._values[name] = coerced;

      // Write to process.env
      if (coerced !== null) {
        this._writeProcessEnv(sourceKey, String(coerced));
        if (this._debug) {
          console.log(`Loaded ${name}: ${String(coerced)}`);
        }
      }
    }
  }

  get(name: string): unknown | null {
    if (!this._loaded) {
      this.load();
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

          // For local-origin with per-variable dotenvPath: try to re-fetch (may throw for missing file)
          // This defers per-variable dotenv missing-file errors to get() time.
          if (ctx.secretOrigin === 'local' && def.dotenvPath != null && def.dotenvPath !== '') {
            // process.env check first (may bypass missing file entirely)
            if (process.env[sourceKey] !== undefined) {
              const envVal = process.env[sourceKey]!;
              let coerced: unknown = envVal;
              if (def.type != null) coerced = coerceType(envVal, def.type, name);
              this._values[name] = coerced;
              if (coerced !== null) this._writeProcessEnv(sourceKey, String(coerced));
              return coerced as unknown;
            }
            // Try to read the file (may throw DotEnvLoader error with file path)
            const loader = createLoader({ secretOrigin: ctx.secretOrigin, gcpProjectId: ctx.gcpProjectId, dotenvPath: ctx.dotenvPath });
            const result = loader.get(sourceKey); // throws if file missing
            if (result !== null) {
              let coerced: unknown = result;
              if (def.type != null) coerced = coerceType(result, def.type, name);
              this._values[name] = coerced;
              if (coerced !== null) this._writeProcessEnv(sourceKey, String(coerced));
              return coerced as unknown;
            }
            // Still null after re-fetch: fall through to required/strict checks
          }

          if (this._strict) {
            throw new Error(
              `Strict mode: variable '${name}' is missing from source '${sourceKey}' in ${ctxLabel}.`,
            );
          }
          if (def.required === true) {
            if (def.default !== undefined) {
              // Required but has default and was missing from source → warn and return default
              console.warn(
                `Required variable '${name}' missing from source; using YAML default for source '${sourceKey}' in ${ctxLabel}.`,
              );
              return def.default as unknown;
            }
            throw new Error(
              `Required variable '${name}' not found in source '${sourceKey}' for ${ctxLabel}.`,
            );
          }
          if (def.required === false) {
            console.warn(
              `Optional variable '${name}' resolved to None because source '${sourceKey}' was unavailable in ${ctxLabel}.`,
            );
            return null;
          }
        } else {
          // OLD FORMAT or default-only var: simple required/optional check
          if (def?.required === true) {
            throw new Error(`Required variable '${name}' is not set`);
          }
          if (def?.required === false) {
            console.warn(`Optional variable '${name}' is not set`);
          }
        }
        return null;
      }

      return cached as unknown;
    }

    // Not in cache: lazy-load
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
            console.warn(`Optional variable '${name}' is not set`);
          }
          return null;
        }

        let coerced: unknown = rawValue;
        if (def.type != null) coerced = coerceType(rawValue, def.type, name);
        this._values[name] = coerced;
        if (coerced !== null) this._writeProcessEnv(sourceKey, String(coerced));
        return coerced as unknown;
      } else {
        // NEW FORMAT, no explicit source: use varname as implicit source, call createLoader lazily
        const ctx = this._effectiveSourceContext(name);
        const sourceKey = name; // implicit source = varname

        let rawValue: unknown = null;
        if (process.env[sourceKey] !== undefined) {
          rawValue = process.env[sourceKey];
        } else {
          try {
            const loader = createLoader({
              secretOrigin: ctx.secretOrigin,
              gcpProjectId: ctx.gcpProjectId,
              dotenvPath: ctx.dotenvPath,
            });
            const result = loader.get(sourceKey);
            if (result !== null && result !== undefined) {
              rawValue = result as string;
            }
          } catch {
            // Loader unavailable (test mock without get(), missing file, etc.)
            // Return null without required throw (loader error ≠ key not found)
            if (def.default !== undefined) return def.default as unknown;
            return null;
          }
        }

        if (rawValue === null && def.default !== undefined) {
          rawValue = def.default;
        }

        if (rawValue === null) {
          if (def.required === true) {
            throw new Error(`Required variable '${name}' is not set`);
          }
          if (def.required === false) {
            console.warn(`Optional variable '${name}' is not set`);
          }
          return null;
        }

        let coerced: unknown = rawValue;
        if (def.type != null) coerced = coerceType(rawValue, def.type, name);
        this._values[name] = coerced;
        if (coerced !== null) this._writeProcessEnv(sourceKey, String(coerced));
        return coerced as unknown;
      }
    }

    // For new format lazy sourced vars that somehow weren't loaded
    const ctx = this._effectiveSourceContext(name);
    const sourceKey = def.source;

    // Check process.env first
    let rawValue: unknown = null;
    if (process.env[sourceKey] !== undefined) {
      rawValue = process.env[sourceKey];
    } else {
      try {
        const loader = createLoader({
          secretOrigin: ctx.secretOrigin,
          gcpProjectId: ctx.gcpProjectId,
          dotenvPath: ctx.dotenvPath,
        });
        const result = loader.get(sourceKey);
        if (result !== null && result !== undefined) {
          rawValue = result as string;
        }
      } catch {
        rawValue = null;
      }
    }

    if (rawValue === null && def.default !== undefined) {
      rawValue = def.default;
    }

    if (rawValue === null) {
      const ctxLabel = buildContextLabel(ctx);
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
        console.warn(
          `Optional variable '${name}' resolved to None because source '${sourceKey}' was unavailable in ${ctxLabel}.`,
        );
      }
      return null;
    }

    let coerced: unknown = rawValue;
    if (def.type != null) coerced = coerceType(rawValue, def.type, name);

    this._values[name] = coerced;
    if (coerced !== null) {
      this._writeProcessEnv(sourceKey, String(coerced));
    }

    return coerced as unknown;
  }
}

export function initConfig(configPath: string, options?: ConfigManagerOptions): ConfigManager {
  if (singleton !== null) {
    console.warn('Configuration manager already initialised. Call _resetSingleton() to reset.');
  }
  singleton = new ConfigManager(configPath, options);
  return singleton;
}

export function getConfig(name?: string): unknown | null {
  if (singleton === null) {
    return null;
  }
  if (name === undefined) {
    return singleton;
  }
  return singleton.get(name);
}

export function requireConfig(name?: string): unknown {
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
  // Clean up all process.env keys written by ConfigManager instances
  for (const key of _processEnvWrites) {
    delete process.env[key];
  }
  _processEnvWrites.clear();
}
