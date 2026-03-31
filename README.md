# env-manager

A TypeScript configuration manager that loads secrets from local `.env` files or GCP Secret Manager, with YAML-based variable definitions, type coercion, validation, and multi-environment support.

## Features

- YAML-based configuration with variable definitions
- Multiple secret origins: local `.env` files and GCP Secret Manager
- Type coercion (`str`, `int`, `float`, `bool`)
- Multi-environment support via `APP_ENV`
- Validation (strict mode, required/optional variables)
- Singleton pattern for app-wide config access
- ESM and CJS dual-format output

## Installation

```bash
npm install @notoriosti/env-manager
```

## Quick Start

1. Create a `config.yaml` file:

```yaml
variables:
  DB_PASSWORD:
    source: DB_PASSWORD
    type: str
  PORT:
    source: PORT
    type: int
    default: 8080
  DEBUG_MODE:
    source: DEBUG_MODE
    type: bool
    default: false
```

2. Use the singleton API in your application:

```ts
import { initConfig, getConfig } from 'env-manager';

// Initialize once at startup
initConfig('./config.yaml');

// Retrieve values anywhere
const port = getConfig('PORT');       // 8080 (number, from default)
const dbPass = getConfig('DB_PASSWORD'); // value from .env or GCP
```

3. Values are also written to `process.env` after loading, so libraries that read `process.env` directly will see them.

## Configuration File

The configuration file is a YAML document with three top-level sections: `variables`, `environments`, and `validation`.

### `variables`

Each key defines a variable to load. Fields:

| Field | Type | Description |
|-------|------|-------------|
| `source` | `string` | The secret key to look up (e.g., env var name or GCP secret ID). If omitted, only `default` is used. |
| `type` | `str \| int \| float \| bool` | Coerce the loaded value to this type. |
| `default` | any | Fallback value when the source key is not found. |
| `required` | `boolean` | If `true`, throws when the value is missing and no default is set. |
| `environment` | `string` | Pin this variable to a specific named environment (overrides the active environment). |
| `secret_origin` | `local \| gcp` | Override the secret origin for this variable only. |
| `dotenv_path` | `string` | Override the `.env` file path for this variable (local origin only). |
| `gcp_project_id` | `string` | Override the GCP project ID for this variable (GCP origin only). |

Example:

```yaml
variables:
  DB_PASSWORD:
    source: DB_PASSWORD
    type: str
  PORT:
    source: PORT
    type: int
    default: 8080
  DEBUG_MODE:
    source: DEBUG_MODE
    type: bool
    default: false
  TIMEOUT:
    source: TIMEOUT
    type: float
    default: 1.5
```

### `environments`

Define named environments with their own origin and connection settings. Each environment key is a name:

| Field | Type | Description |
|-------|------|-------------|
| `origin` | `local \| gcp` | Where this environment loads secrets from. |
| `gcp_project_id` | `string` | GCP project ID (required when `origin: gcp`). |
| `dotenv_path` | `string` | Path to the `.env` file (for `origin: local`). Relative paths resolve from the project root. |
| `default` | `boolean` | If `true`, this environment is used when `APP_ENV` is not set. Only one environment may be the default. |

Example:

```yaml
environments:
  development:
    origin: local
    dotenv_path: .env.development
    default: true
  staging:
    origin: gcp
    gcp_project_id: my-project-staging
  production:
    origin: gcp
    gcp_project_id: my-project-prod
```

### `validation`

| Field | Type | Description |
|-------|------|-------------|
| `strict` | `boolean` | When `true`, any variable that resolves to `null` throws an error. Defaults to `false`. |
| `required` | `string[]` | List of variable names that must have a non-null value. |
| `optional` | `string[]` | List of variable names that are explicitly allowed to be `null`. |

Example:

```yaml
validation:
  strict: true
  required:
    - DB_PASSWORD
    - DB_HOST
  optional:
    - DEBUG_MODE
```

## Environment Selection

The active environment is selected by the `APP_ENV` environment variable:

```bash
APP_ENV=staging node app.js
```

If `APP_ENV` is not set, the fallback order is:

1. The environment with `default: true`
2. The environment named `default`
3. No active environment (`null`)

If `APP_ENV` is set to an unknown environment name, an error is thrown listing the available environments.

When no `environments` section is present in the YAML, the manager operates in "old format" mode: it looks for a `.env` file next to the config file by default.

## Secret Origins

Secrets can be loaded from two origins:

- **`local`** -- Reads values from a `.env` file using the `dotenv` library. The file is parsed directly (not merged into `process.env`).
- **`gcp`** -- Reads values from Google Cloud Secret Manager using `@google-cloud/secret-manager`. Requires `gcp_project_id` to be set.

### Resolution Chain

Both `SECRET_ORIGIN` and `GCP_PROJECT_ID` follow a 5-level resolution chain (highest priority first):

| Priority | `SECRET_ORIGIN` | `GCP_PROJECT_ID` |
|----------|-----------------|-------------------|
| 1 | `ConfigManagerOptions.secretOrigin` | `ConfigManagerOptions.gcpProjectId` |
| 2 | `process.env.SECRET_ORIGIN` | `process.env.GCP_PROJECT_ID` |
| 3 | `.env` file `SECRET_ORIGIN` | `.env` file `GCP_PROJECT_ID` |
| 4 | Active environment `origin` | Active environment `gcp_project_id` |
| 5 | `'local'` (default) | `null` (default) |

## Per-Variable Overrides

Individual variables can override their loading context independently of the active environment:

```yaml
variables:
  SHARED_KEY:
    source: SHARED_KEY
    type: str
    environment: production        # pin to a specific environment
    secret_origin: gcp             # override origin
    gcp_project_id: shared-project # override GCP project
  LOCAL_SECRET:
    source: LOCAL_SECRET
    type: str
    secret_origin: local
    dotenv_path: .env.local        # override dotenv file path
```

These overrides let you mix origins within a single configuration file -- for example, pulling most secrets from GCP while reading a few from a local `.env` file.

## API Reference

### `ConfigManager`

The core class. Loads and manages configuration.

```ts
import { ConfigManager } from 'env-manager';

const config = new ConfigManager('./config.yaml', options?);
```

**Constructor parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `configPath` | `string` | Path to the YAML configuration file. |
| `options` | `ConfigManagerOptions` | Optional settings (see below). |

By default, the constructor calls `load()` automatically. Pass `autoLoad: false` to defer loading.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `activeEnvironment` | `EnvironmentConfig \| null` | The resolved active environment, or `null` if none. |

**Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `load()` | `void` | Load all variables. No-op if already loaded. Called automatically unless `autoLoad: false`. |
| `get(name)` | `unknown \| null` | Get a loaded variable value. Returns `null` if not found (unless `required` or `strict`). |

### `ConfigManagerOptions`

```ts
interface ConfigManagerOptions {
  secretOrigin?: 'local' | 'gcp';  // Override secret origin
  gcpProjectId?: string | null;     // Override GCP project ID
  dotenvPath?: string | null;       // Override .env file path
  strict?: boolean;                 // Override strict validation mode
  debug?: boolean;                  // Log loaded values to console
  autoLoad?: boolean;               // Auto-call load() in constructor (default: true)
}
```

### Singleton API

For app-wide configuration access without passing instances around:

```ts
import { initConfig, getConfig, requireConfig, _resetSingleton } from 'env-manager';
```

#### `initConfig(configPath, options?)`

Create and store a singleton `ConfigManager`. If a singleton already exists, logs a warning and returns the existing instance instead of replacing it.

#### `getConfig(name?)`

- Without arguments: returns the singleton `ConfigManager` instance, or `null` if not initialized.
- With a variable name: returns `singleton.get(name)`, or `null` if singleton is not initialized.

#### `requireConfig(name?)`

- Without arguments: returns the singleton `ConfigManager` instance, or throws if not initialized.
- With a variable name: returns the value or throws if the value is `null`/`undefined` or the singleton is not initialized.

#### `_resetSingleton()`

Resets the singleton to `null` and cleans up all `process.env` keys written by any `ConfigManager` instance. Intended for test teardown.

### Utility Exports

```ts
import { coerceType, loadYaml, maskSecret } from 'env-manager';
```

| Function | Description |
|----------|-------------|
| `coerceType(value, type, name?)` | Coerce a value to a `VariableType` (`str`, `int`, `float`, `bool`). |
| `loadYaml(filePath)` | Load and parse a YAML file. Validates it is a root mapping. |
| `maskSecret(value)` | Mask a secret string for safe logging. |

### Environment and Loader Exports

```ts
import { parseEnvironments, createLoader } from 'env-manager';
import { DotEnvLoader, GCPSecretLoader } from 'env-manager';
```

| Export | Description |
|--------|-------------|
| `parseEnvironments(rawConfig)` | Parse the `environments` section from a raw YAML config object. |
| `createLoader(options)` | Factory that returns a `DotEnvLoader` or `GCPSecretLoader` based on the origin. Memoized by context. |
| `DotEnvLoader` | Loader class for `.env` files. Implements `SecretLoader`. |
| `GCPSecretLoader` | Loader class for GCP Secret Manager. Implements `SecretLoader`. |

### Type Exports

All interfaces and types are exported for TypeScript consumers:

```ts
import type {
  ConfigManagerOptions,
  EnvironmentConfig,
  SecretLoader,
  SecretOrigin,       // 'local' | 'gcp'
  SourceContext,
  ValidationConfig,
  VariableDefinition,
  VariableType,       // 'str' | 'int' | 'float' | 'bool'
} from 'env-manager';
```

## Development

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Type-check without emitting
npm run typecheck

# Build (ESM + CJS)
npm run build
```

## License

ISC
