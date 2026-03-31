# @notoriosti/env-manager

A TypeScript configuration manager that unifies local `.env` files and GCP Secret Manager behind a single declarative YAML config. Features type coercion, multi-environment support, per-variable source overrides, and a singleton API for app-wide access.

## Install

```bash
npm install @notoriosti/env-manager
# or
yarn add @notoriosti/env-manager
# or
pnpm add @notoriosti/env-manager
```

## Quick Start

**1. Create a `config.yaml`:**

```yaml
environments:
  development:
    origin: local
    dotenv_path: .env
    default: true
  production:
    origin: gcp
    gcp_project_id: my-gcp-project

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

validation:
  strict: true
  required:
    - DB_PASSWORD
```

**2. Initialize once at app startup:**

```ts
import { initConfig, getConfig } from '@notoriosti/env-manager';

async function main() {
  await initConfig('./config.yaml');

  const port = getConfig('PORT');        // 8080 (number)
  const pass = getConfig('DB_PASSWORD'); // value from .env or GCP
}

main();
```

After `await initConfig()` completes, all `getConfig()` calls are **synchronous** — values are fully loaded and cached.

---

## Async Behavior

In v0.1.2, `autoLoad` was removed. The constructor no longer fires `load()` automatically, and there is no `MaybePromise` return type. The loading model is now explicit and uniform:

- **`load()` is always `async`** — it returns `Promise<void>` regardless of whether the origin is local or GCP.
- **`get()` is always synchronous** — but only after `load()` has resolved. Calling `get()` before `load()` throws immediately.
- **`initConfig()` calls `load()` for you** and awaits it, so the singleton is fully ready when the promise resolves.

```ts
// Correct — always await initConfig()
await initConfig('./config.yaml');
const value = getConfig('MY_VAR'); // synchronous, safe

// Wrong — load() hasn't run yet
initConfig('./config.yaml');
getConfig('MY_VAR'); // throws: "ConfigManager not loaded. Call await initConfig()..."
```

**Rule:** call `await initConfig()` once at startup, then use `getConfig()` / `requireConfig()` synchronously everywhere else.

```ts
// app entry point
await initConfig('./config.yaml');

// anywhere else in the codebase
import { getConfig } from '@notoriosti/env-manager';
const timeout = getConfig('TIMEOUT') as number;
```

---

## Module-Wide Initialization

For apps with multiple modules, initialize once in a dedicated file and let every other module read config synchronously via `getConfig` / `requireConfig`.

**`src/config.ts`** — initialize and export typed accessors:

```ts
import { initConfig, requireConfig } from '@notoriosti/env-manager';

export const configReady = initConfig('./config.yaml');

export const getApiKey = () => requireConfig('API_KEY') as string;
export const getPort   = () => requireConfig('PORT') as number;
```

**`src/main.ts`** — await before starting the app:

```ts
import { configReady } from './config.js';

await configReady; // singleton is fully loaded from here on

import { startServer } from './server.js';
startServer();
```

**`src/server.ts`** — use `getConfig` / `requireConfig` directly, no prop-drilling:

```ts
import { requireConfig } from '@notoriosti/env-manager';

export function startServer() {
  const port = requireConfig('PORT') as number;
  // ...
}
```

This mirrors the Python `__init__.py` pattern: one module owns initialization, every other module reads the already-populated singleton.

> **Gotcha:** keep config reads inside functions, not at module top-level. Any `getConfig()` / `requireConfig()` call that runs at import time (before `await configReady`) will throw because the singleton isn't set yet.

---

## Config File Reference

The YAML config has three top-level sections: `variables`, `environments`, and `validation`.

### `variables`

Each key is the name you pass to `get()` / `getConfig()`.

| Field | Type | Description |
|-------|------|-------------|
| `source` | `string` | The key to look up in the loader (env var name or GCP secret ID). If omitted, only `default` is used — `process.env` is not checked. |
| `type` | `str \| int \| float \| bool` | Coerce the loaded value to this type. |
| `default` | any | Fallback when the source key is not found. |
| `required` | `boolean` | Throws if the value is missing and no default is defined. |
| `environment` | `string` | Pin this variable to a specific named environment. |
| `secret_origin` | `local \| gcp` | Override the secret origin for this variable only. |
| `dotenv_path` | `string` | Override the `.env` path for this variable (`local` origin only). |
| `gcp_project_id` | `string` | Override the GCP project ID for this variable (`gcp` origin only). |

```yaml
variables:
  # Loaded from source, coerced to int, falls back to 8080
  PORT:
    source: PORT
    type: int
    default: 8080

  # Required — throws if missing
  DB_PASSWORD:
    source: DB_PASSWORD
    type: str
    required: true

  # Default-only — never reads process.env, always returns the YAML default
  APP_NAME:
    default: my-app

  # Cross-origin override — always reads from GCP regardless of active env
  SHARED_TOKEN:
    source: SHARED_TOKEN
    type: str
    secret_origin: gcp
    gcp_project_id: shared-infra-project

  # Cross-env override — reads from a different .env file
  LEGACY_KEY:
    source: LEGACY_KEY
    type: str
    secret_origin: local
    dotenv_path: .env.legacy
```

### `environments`

Named environments, selected at runtime via `APP_ENV`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `origin` | `local \| gcp` | yes | Where this environment loads secrets from. |
| `gcp_project_id` | `string` | yes (if `origin: gcp`) | GCP project ID for this environment. |
| `dotenv_path` | `string` | no | Path to the `.env` file. Relative paths resolve from the project root (directory containing `package.json`). Defaults to `.env`. |
| `default` | `boolean` | no | Use this environment when `APP_ENV` is not set. Only one environment may be the default. |

**Active environment selection order:**

1. `process.env.APP_ENV` — must match a defined environment name exactly. Throws with available names if unknown.
2. The environment with `default: true`.
3. The environment named `default`.
4. No active environment (`null`).

```yaml
environments:
  local:
    origin: local
    dotenv_path: .env.local
    default: true
  staging:
    origin: gcp
    gcp_project_id: my-project-staging
  production:
    origin: gcp
    gcp_project_id: my-project-prod
```

```bash
# Selects "staging" environment
APP_ENV=staging node dist/app.js
```

> If your config has no `environments` section ("old format"), the manager looks for a `.env` file in the same directory as the config file.

### `validation`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `strict` | `boolean` | `false` | When `true`, any variable that resolves to `null` throws an error. Can be overridden by `ConfigManagerOptions.strict`. |
| `required` | `string[]` | `[]` | Variable names that must have a non-null value. |
| `optional` | `string[]` | `[]` | Variable names explicitly allowed to be `null`. Logs a warning when they resolve to `null`. |

```yaml
validation:
  strict: true
  required:
    - DB_PASSWORD
    - DB_HOST
  optional:
    - FEATURE_FLAG
```

---

## API Reference

### `initConfig(configPath, options?)`

Creates and stores a singleton `ConfigManager`, calls `await manager.load()`, and returns the instance. This is the recommended startup pattern.

If a singleton already exists, logs a warning and returns the existing instance without replacing it. Call `_resetSingleton()` first if you need to reinitialize.

```ts
const manager = await initConfig('./config.yaml');
const manager = await initConfig('./config.yaml', { debug: true });
```

### `getConfig(name?)`

- No argument: returns the singleton `ConfigManager` instance, or `null` if not initialized.
- With a name: returns `singleton.get(name)`. Returns `null` if the singleton is not initialized.

Always synchronous after `await initConfig()` completes.

```ts
const port = getConfig('PORT') as number;
const manager = getConfig(); // the ConfigManager instance
```

### `requireConfig(name?)`

Like `getConfig()`, but throws instead of returning `null`:

- No argument: returns the singleton or throws `"ConfigManager not initialized"`.
- With a name: returns the value or throws if it is `null` / `undefined`.

```ts
const pass = requireConfig('DB_PASSWORD') as string; // throws if missing
```

### `new ConfigManager(configPath, options?)`

Direct instantiation when you don't want the singleton. You must call `await manager.load()` manually before calling `get()`.

```ts
const manager = new ConfigManager('./config.yaml', options);
await manager.load();

const value = manager.get('MY_VAR');
```

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `activeEnvironment` | `EnvironmentConfig \| null` | The resolved active environment. |

**Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `load()` | `Promise<void>` | Fetch all variables. No-op if already loaded (idempotent). Must be awaited before calling `get()`. |
| `get(name)` | `unknown \| null` | Return a cached variable value. Throws if called before `load()` completes. Returns `null` for missing optional variables. Throws for required/strict variables that are missing. |

### `ConfigManagerOptions`

```ts
interface ConfigManagerOptions {
  secretOrigin?: 'local' | 'gcp'; // Override secret origin (highest priority in chain)
  gcpProjectId?: string | null;   // Override GCP project ID (highest priority in chain)
  dotenvPath?: string | null;     // Override .env file path
  strict?: boolean;               // Override strict validation (takes precedence over YAML)
  debug?: boolean;                // Log unmasked values during load. Never use in production.
}
```

### `_resetSingleton()`

Resets the singleton to `null`, clears the internal loader cache, and deletes all `process.env` keys written by any `ConfigManager` instance. Intended for test teardown.

```ts
import { _resetSingleton } from '@notoriosti/env-manager';

afterEach(() => {
  _resetSingleton();
});
```

---

## Loaders

### `DotEnvLoader`

Reads variables from a `.env` file without polluting `process.env`.

**Constructor:** `new DotEnvLoader(dotenvPath?: string | null)`

- If `dotenvPath` is omitted or `null`: auto-discovers the nearest `.env` by walking up from `cwd`.
- If `dotenvPath` points to an existing file: parses it immediately.
- If `dotenvPath` points to a missing file: defers the error. No error is thrown unless a key is actually looked up and is not already in `process.env`.

**`get()` precedence:** `process.env[key]` → parsed `.env` file → `null`

```ts
import { DotEnvLoader } from '@notoriosti/env-manager';

const loader = new DotEnvLoader('.env.local');
const value = await loader.get('MY_KEY');
```

### `GCPSecretLoader`

Reads variables from GCP Secret Manager (`projects/{id}/secrets/{key}/versions/latest`).

**Constructor:** `new GCPSecretLoader(gcpProjectId: string, options?)`

- `options.createClient?: () => GCPSecretClient` — injectable client factory for testing.

**Behavior:**
- Results are cached per-loader-instance (each key is fetched at most once).
- `NOT_FOUND` secrets (gRPC code 5) return `null` and log a `console.warn`. Other errors are re-thrown.
- `getMany()` fetches all keys in parallel via `Promise.all`.

```ts
import { GCPSecretLoader } from '@notoriosti/env-manager';

const loader = new GCPSecretLoader('my-gcp-project');
const value = await loader.get('MY_SECRET');
```

**GCP authentication:** uses Application Default Credentials (ADC). Run `gcloud auth application-default login` locally, or attach a service account with `roles/secretmanager.secretAccessor` in deployed environments.

---

## Secret Origin Resolution

Both `SECRET_ORIGIN` and `GCP_PROJECT_ID` resolve through a 5-level priority chain (highest to lowest):

| Priority | `SECRET_ORIGIN` | `GCP_PROJECT_ID` |
|----------|-----------------|------------------|
| 1 | `ConfigManagerOptions.secretOrigin` | `ConfigManagerOptions.gcpProjectId` |
| 2 | `process.env.SECRET_ORIGIN` | `process.env.GCP_PROJECT_ID` |
| 3 | `.env` file `SECRET_ORIGIN` key | `.env` file `GCP_PROJECT_ID` key |
| 4 | Active environment `origin` | Active environment `gcp_project_id` |
| 5 | `'local'` (hardcoded default) | `null` (hardcoded default) |

The `.env` path for a variable resolves as:
1. `ConfigManagerOptions.dotenvPath` (used as-is).
2. Active environment's `dotenv_path` (relative paths resolve from the project root).
3. Old-format default: `<config file directory>/.env`.

---

## Type Coercion

Values are coerced when `type` is specified in the variable definition.

| Type | Input → Output | Notes |
|------|----------------|-------|
| `str` | any → `string` | `true` → `"true"`, `false` → `"false"` |
| `int` | string → `number` | Uses `parseInt`. Throws on `NaN`. |
| `float` | string → `number` | Uses `parseFloat`. Throws on `NaN`. |
| `bool` | string → `boolean` | `"true"`, `"True"`, `"1"` → `true`; `"false"`, `"False"`, `"0"` → `false`. Throws on any other value. |

YAML booleans and numbers in `default:` values are handled correctly — `default: true` delivers a JS `boolean`, not the string `"true"`.

---

## process.env Write-Back

After `load()` completes, every non-null variable value is written back to `process.env` as a string (using its `source` key). This means any library that reads `process.env` directly (e.g., database clients, LangChain, etc.) will see the loaded values without any extra configuration.

---

## Multi-Environment Example

```yaml
# config.yaml
environments:
  development:
    origin: local
    dotenv_path: .env.development
    default: true
  staging:
    origin: gcp
    gcp_project_id: acme-staging-123
  production:
    origin: gcp
    gcp_project_id: acme-prod-456

variables:
  DATABASE_URL:
    source: DATABASE_URL
    type: str
    required: true
  API_KEY:
    source: API_KEY
    type: str
    required: true
  LOG_LEVEL:
    source: LOG_LEVEL
    type: str
    default: info
  MAX_CONNECTIONS:
    source: MAX_CONNECTIONS
    type: int
    default: 10

validation:
  strict: true
```

```ts
// app.ts
import { initConfig, getConfig } from '@notoriosti/env-manager';

await initConfig('./config.yaml');

const dbUrl = getConfig('DATABASE_URL') as string;
const apiKey = getConfig('API_KEY') as string;
const logLevel = getConfig('LOG_LEVEL') as string;
```

```bash
# development (uses .env.development)
node dist/app.js

# staging (uses GCP project acme-staging-123)
APP_ENV=staging node dist/app.js

# production (uses GCP project acme-prod-456)
APP_ENV=production node dist/app.js
```

---

## GCP Setup

1. **Install the peer dependency** (included as a direct dependency — no extra install needed).

2. **Grant access:** the service account or user running your app needs the `roles/secretmanager.secretAccessor` role on the GCP project.

3. **Authenticate:**
   - **Local development:** `gcloud auth application-default login`
   - **Cloud Run / GKE / GCE:** attach a service account with the required role — ADC picks it up automatically.
   - **CI/CD:** export `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`.

---

## Type Exports

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
} from '@notoriosti/env-manager';
```

---

## Development

```bash
npm test             # run tests (vitest)
npm run test:watch   # vitest in watch mode
npm run typecheck    # tsc --noEmit
npm run build        # ESM + CJS output to dist/
```

## License

ISC
