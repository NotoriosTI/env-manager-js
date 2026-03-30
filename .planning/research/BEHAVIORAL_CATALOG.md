# Behavioral Catalog: env-manager Python Library
Generated: 2026-03-30
Source: Python repo at ../env-manager/
Research: .planning/phases/02-python-analysis-behavioral-catalog/02-RESEARCH.md

---

## Critical Findings

### APP_ENV vs ENVIRONMENT

**VERIFIED at manager.py line 199:** The Python manager reads `os.environ.get("APP_ENV")` exclusively.

The error message at line 204 confirms: `"APP_ENV='{env_name}' is not defined in the config."`.

**Discrepancy:** All Python test files (`test_environment_integration.py`, `test_resolution_pipeline.py`, `test_end_to_end.py`, `test_resolution_validation.py`) call `monkeypatch.setenv("ENVIRONMENT", ...)` -- they set a variable the manager never reads. The Python `conftest.py` cleanup list includes `"ENVIRONMENT"` but NOT `"APP_ENV"`. Commit 52cd065 renamed the source variable from `ENVIRONMENT` to `APP_ENV` but the test suite was never updated.

**Live verification:** Running `test_environment_var_selects_staging` produces `AssertionError: assert 'default' == 'staging'` because `monkeypatch.setenv("ENVIRONMENT", "staging")` has no effect on `os.environ.get("APP_ENV")`.

**Decision for JS port:**
- Implementation code reads `process.env.APP_ENV` (matching Python source)
- All JS tests use `APP_ENV` (not `ENVIRONMENT`) to actually exercise environment selection
- `tests/setup.ts` cleans `APP_ENV` in env var teardown

### YAML Schema: 1.2 Is Fine

**Python uses YAML 1.1:** `yaml.safe_load()` via PyYAML uses YAML 1.1 semantics where `true`, `false`, `yes`, `no`, `on`, `off` are all boolean values.

**JS `yaml` npm package defaults to YAML 1.2:** In 1.2, only `true` and `false` are booleans.

**Fixture analysis confirms no conflict:** All three YAML fixture files use only `true`/`false` for booleans, decimal integers (no octal), and standard floats. No `yes`/`no`/`on`/`off` constructs appear anywhere. The `yaml` npm default (1.2 core schema) handles everything without needing `schema: 'yaml-1.1'`.

**Decision:** No schema override needed in `loadYaml()`.

### gRPC NotFound Error Shape

**Python:** Catches `gcp_exceptions.NotFound` (a high-level exception class from `google.api_core.exceptions`, NOT a raw gRPC status code). The test file `test_loaders.py` imports and uses `google.api_core.exceptions.NotFound`.

**JS port:** The `@google-cloud/secret-manager` v6 throws errors with `error.code === 5` for NotFound (gRPC NOT_FOUND status). The JS port catches `error.code === 5` rather than using an exception class.

**Warning message format (VERIFIED from source and test):**
`"Secret '{key}' not found in GCP project '{self._project_id}'."`
Example: `"Secret 'MISSING' not found in GCP project 'project-123'."`

**Note:** The exact JS error shape for `@google-cloud/secret-manager` v6 must be validated during Phase 6 implementation.

### mask_secret Has No Python Tests

**VERIFIED:** There are ZERO explicit `mask_secret` test cases in the Python test suite. No test file exercises the `mask_secret` function directly. The function `test_debug_parameter_disables_masking` in `test_manager.py` tests `debug=True` (which bypasses masking) but does not test the masking logic itself.

**ROADMAP discrepancy:** Plan 3.1 in the ROADMAP claims "17 coerceType cases + 3 maskSecret cases" -- this is WRONG. The actual Python counts are 7 coerceType tests and 0 maskSecret tests.

**Decision:** JS port writes maskSecret tests from scratch, derived from the behavioral specification in this catalog (not ported from Python tests).

---

## Module: utils

### coerce_type(raw_value, target_type, variable_name)

Coerces a raw value to the specified type. Used by `_store_loaded_value` in ConfigManager.

**Signature:** `coerceType(rawValue: unknown, targetType: string, variableName: string): unknown`

**Check order (VERIFIED from source):**

| Step | Condition | Result |
|------|-----------|--------|
| 1 | `target_type not in {"str", "int", "float", "bool"}` | `ValueError("Unsupported type '{target_type}' for variable '{variable_name}'")` |
| 2 | `raw_value is None` | Return `None` (null passthrough) |
| 3a | `target_type == "str"` AND `isinstance(raw_value, bool)` | Return `"true"` if truthy, else `"false"` (lowercase!) |
| 3b | `target_type == "str"` AND not bool | Return `str(raw_value)` |
| 4 | Convert: `value_str = str(raw_value)` | (for int/float/bool branches) |
| 5 | `target_type == "int"` | `int(value_str)` or `ValueError("Cannot convert '{variable_name}' value '{value_str}' to int")` |
| 6 | `target_type == "float"` | `float(value_str)` or `ValueError("Cannot convert '{variable_name}' value '{value_str}' to float")` |
| 7 | `target_type == "bool"` | See bool table below |

**Bool coercion accepted values:**

| Input string | Result |
|-------------|--------|
| `"true"` | `true` |
| `"True"` | `true` |
| `"1"` | `true` |
| `"false"` | `false` |
| `"False"` | `false` |
| `"0"` | `false` |
| anything else | `ValueError("Invalid boolean value for '{variable_name}': '{value_str}'. Must be one of: 'true', 'True', '1', 'false', 'False', '0'")` |

**YAML pitfall (bool-to-str):** YAML parses unquoted `true`/`false` as boolean. So `raw_value` can be `True` (Python bool) or `true` (JS boolean). The bool branch in the `"str"` type runs BEFORE `str()` conversion, producing `"true"` not `"True"`. JS must check `typeof rawValue === "boolean"` before calling `String()`.

**YAML pitfall (int-to-str):** YAML parses `8080` as integer. `str(8080)` produces `"8080"`. JS: `String(8080)` produces `"8080"`. Same behavior, no special handling needed.

**Python test coverage:** `test_type_coercion.py` (7 tests):
- `test_coerce_str_returns_string` -- str passthrough
- `test_coerce_int_returns_integer` -- int conversion
- `test_coerce_float_returns_float` -- float conversion
- `test_coerce_bool_true` -- bool `"true"` -> True
- `test_coerce_bool_false` -- bool `"false"` -> False
- `test_coerce_bool_invalid_value` -- `"yes"` -> ValueError
- `test_coerce_invalid_type` -- `"date"` -> ValueError

**Python test coverage:** `test_bool_to_string_coercion.py` (2 tests):
- `test_bool_yaml_value_coerced_to_string` -- YAML bool true -> str `"true"` via ConfigManager
- `test_number_yaml_value_coerced_to_string` -- YAML int 8080 -> str `"8080"` via ConfigManager

### mask_secret(value)

Masks a secret value for safe logging. Called by `_store_loaded_value` when `debug=False`.

**Signature:** `maskSecret(value: string): string`

**Trigger-output table:**

| Trigger | Output |
|---------|--------|
| `len(value) < 10` | `"**********"` (exactly 10 asterisks) |
| `len(value) >= 10` | `value[:2] + "****" + value[-4:]` (first 2 chars + 4 asterisks + last 4 chars) |

**Examples:**
- `maskSecret("short")` -> `"**********"` (length 5 < 10)
- `maskSecret("password123")` -> `"pa****d123"` (length 11 >= 10)
- `maskSecret("ab")` -> `"**********"` (length 2 < 10)
- `maskSecret("")` -> `"**********"` (length 0 < 10)
- `maskSecret("1234567890")` -> `"12****7890"` (length 10 >= 10, boundary)

**Edge case:** Does NOT handle `None` input. Callers must ensure non-None. In `_store_loaded_value`, `str(coerced_value)` is always called before `mask_secret()`.

**Python test coverage:** ZERO explicit tests. JS port writes tests from this catalog.

### load_yaml(path)

Loads and parses a YAML configuration file. Returns the parsed dict.

**Signature:** `loadYaml(path: string): Record<string, unknown>`

**Trigger-output table:**

| Trigger | Output |
|---------|--------|
| File exists, root is dict/mapping | Returns parsed object |
| File does not exist | `FileNotFoundError("Configuration file '{config_path}' does not exist.")` |
| File exists, root is not dict | `ValueError("Configuration file '{config_path}' must define a mapping at the root.")` |
| File exists, empty content | Returns `{}` (empty object -- Python uses `or {}` to handle `None` from `yaml.safe_load`) |

**Implementation note:** Python uses `yaml.safe_load()` (PyYAML). JS port uses `yaml.parse()` from `yaml` npm package.

**Python test coverage:** No direct tests. Tested indirectly via ConfigManager integration tests.

### PrettyLogger

Utility logger used by ConfigManager for formatted output. Not a core behavioral component -- the JS port uses `console.log`/`console.warn` matching the same message formats.

---

## Module: base

### SecretLoader Protocol

Structural interface (Python Protocol) for all secret loaders.

**Methods:**
- `get(key: string): string | null`
- `getMany(keys: string[]): Record<string, string | null>`

**JS port:** TypeScript interface. Return type is `string | null`, never `string | undefined`.

---

## Module: environment

### EnvironmentConfig dataclass

Data class representing a parsed environment configuration.

**Fields:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `name` | `string` | (required) | Environment name from YAML key |
| `origin` | `string` | (required) | Always lowercase after `parse_environments` |
| `dotenv_path` | `string \| null` | `null` | Raw path string from YAML, NOT resolved |
| `gcp_project_id` | `string \| null` | `null` | Required when origin is `"gcp"` |
| `is_default` | `boolean` | `false` | Set by `default: true` in YAML |

**Key behavior:** `dotenv_path` is stored as-is from YAML (not resolved to absolute). Resolution happens later in `ConfigManager._resolve_project_path()`.

### parse_environments(raw_config, project_root)

Parses the `environments` section from a YAML config into a dict of EnvironmentConfig objects.

**Signature:** `parseEnvironments(rawConfig: Record<string, unknown>, projectRoot?: string): Record<string, EnvironmentConfig>`

**Trigger sequence (VERIFIED from source):**

| Step | Condition | Result |
|------|-----------|--------|
| 1 | No `"environments"` key in raw_config | Return `{}` (empty dict) |
| 2 | `environments` value is not a dict/mapping | `ValueError("The 'environments' section must be a mapping, got {type_name}")` |
| 3a | `env_data` for an env is not a dict | `ValueError("Environment '{env_name}' must be a mapping, got {type_name}")` |
| 3b | No `origin` key in env_data | `ValueError("Environment '{env_name}' is missing the required 'origin' field")` |
| 3c | `origin.lower()` not in `{"local", "gcp"}` | `ValueError("Environment '{env_name}' has invalid origin '{origin}'; expected one of ['gcp', 'local']")` |
| 3d | `origin == "gcp"` and no `gcp_project_id` | `ValueError("Environment '{env_name}' with origin 'gcp' requires 'gcp_project_id'")` |
| 4 | Multiple envs with `default: true` | `ValueError("Only one environment may set 'default: true', but found multiple: {list}")` |

**Origin normalization:** `str(raw_origin).lower()` -- always lowercase in result.

**Local origin defaults:** `dotenv_path` defaults to `".env"` when `origin == "local"`.

**GCP ignores dotenv_path:** When `origin == "gcp"`, no dotenv_path is set regardless of what appears in YAML.

**Local ignores gcp_project_id:** When `origin == "local"`, no gcp_project_id is set.

**Python test coverage:** `test_environment.py` (17 tests):
- `test_no_environments_key` -- returns empty dict
- `test_empty_environments` -- returns empty dict
- `test_single_local_environment` -- local origin with defaults
- `test_single_gcp_environment` -- gcp origin with project_id
- `test_multiple_environments` -- local + gcp combo
- `test_default_dotenv_path_for_local` -- dotenv_path defaults to ".env"
- `test_custom_dotenv_path` -- explicit dotenv_path
- `test_missing_origin_raises` -- ValueError for missing origin
- `test_invalid_origin_raises` -- ValueError for invalid origin
- `test_gcp_requires_project_id` -- ValueError when gcp_project_id missing
- `test_environments_not_a_mapping` -- ValueError when not dict
- `test_environment_entry_not_a_mapping` -- ValueError when env not dict
- `test_origin_normalization` -- "GCP" -> "gcp" lowercase
- `test_default_flag` -- is_default field
- `test_multiple_defaults_raises` -- ValueError for duplicate defaults
- `test_environment_config_fields` -- dataclass field checks
- `test_environment_config_defaults` -- default values

---

## Module: loaders/dotenv

### DotEnvLoader

Loads secrets from a `.env` file using python-dotenv (Python) or `dotenv.parse()` (JS).

**Constructor:**
```
DotEnvLoader(dotenv_path?: string)
```

- `_explicit_path`: set to `true` if `dotenv_path` argument was provided (not `null`/`undefined`)
- `_dotenv_path`: resolved absolute path via `Path(dotenv_path).expanduser().resolve()` (if provided), or auto-discovery via `find_dotenv(usecwd=True)` (Python), or `cwd/.env` if it exists, or `null`
- `_values`: loaded key-value pairs from the `.env` file (empty dict if file missing or path is null)

**JS port note:** Use `dotenv.parse(fs.readFileSync(path))` instead of `dotenv.config()`. Python's `load_dotenv()` mutates `os.environ`; the JS port MUST NOT mutate `process.env` during loading.

**get(key):**

| Step | Behavior |
|------|----------|
| 1 | Call `_ensure_file_backed_lookup_available([key])` -- may raise FileNotFoundError |
| 2 | Return `os.environ.get(key, self._values.get(key))` -- os.environ takes priority |

**get_many(keys):**

| Step | Behavior |
|------|----------|
| 1 | Call `_ensure_file_backed_lookup_available(keys)` |
| 2 | Return `{key: self.get(key) for key in keys}` |

**_ensure_file_backed_lookup_available(keys) -- deferred error mechanics:**

| Condition | Result |
|-----------|--------|
| `_explicit_path` is false (auto-discovery mode) | Return immediately (no error) |
| `_dotenv_path` is null | Return immediately |
| File at `_dotenv_path` exists | Return immediately |
| All requested keys are in `os.environ` | Return immediately (keys satisfied without file) |
| Some keys NOT in `os.environ` AND file missing | `FileNotFoundError(_dotenv_path)` |

**Key insight:** The deferred error only fires when (a) an explicit path was given, (b) the file does not exist, AND (c) some requested keys cannot be found in `os.environ`. If all keys happen to be in `os.environ`, no error is raised even with a missing file.

**Python test coverage:** `test_loaders.py` (1 DotEnvLoader test):
- `test_dotenv_loader_reads_and_returns_values` -- reads values, env override, returns None for missing

---

## Module: loaders/gcp

### GCPSecretLoader

Loads secrets from Google Cloud Secret Manager with caching.

**Constructor:**
```
GCPSecretLoader(project_id: string)
```

- Validates `project_id` is truthy: `ValueError("GCP project ID is required when using the GCP secret loader.")`
- Creates `SecretManagerServiceClient` instance
- Initializes empty cache `_cache: Record<string, string | null>`

**get(key):**

| Step | Condition | Result |
|------|-----------|--------|
| 1 | `key in _cache` | Return cached value (including `null` -- missing secrets are cached) |
| 2 | Build resource name | `"projects/{project_id}/secrets/{key}/versions/latest"` |
| 3 | Call `client.accessSecretVersion({name})` | |
| 4a | `gcp_exceptions.NotFound` | Log warning, cache `null`, return `null` |
| 4b | `gcp_exceptions.GoogleAPICallError` | `RuntimeError("Failed to access secret '{key}' in GCP project '{project_id}': {exc}")` |
| 4c | `gcp_exceptions.RetryError` | `RuntimeError("Retry exhausted when accessing secret '{key}' in GCP project '{project_id}': {exc}")` |
| 5 | Success | Decode `response.payload.data` as UTF-8, cache, return |

**Warning message for NotFound (exact):**
`"Secret '{key}' not found in GCP project '{project_id}'."`

**Caching behavior (VERIFIED from test):** Second `get()` for the same key does NOT call the API -- `accessSecretVersion` is called exactly once per unique key. `null` values (missing secrets) ARE cached.

**JS port error handling:** Python catches `gcp_exceptions.NotFound`; JS catches `error.code === 5`. `GoogleAPICallError` and `RetryError` map to generic `Error` catches in JS.

**get_many(keys):**
Returns `{key: self.get(key) for key in keys}` -- sequential calls, not batched.

**Python test coverage:** `test_loaders.py` (2 GCPSecretLoader tests):
- `test_gcp_loader_fetches_and_caches_secret` -- fetch, cache hit, `assert_called_once()`
- `test_gcp_loader_handles_missing_secret` -- NotFound -> warning printed, returns None

---

## Module: factory

### create_loader(secret_origin, gcp_project_id, dotenv_path)

Factory function that creates the appropriate SecretLoader based on origin.

**Signature:** `createLoader(secretOrigin: string, options?: { gcpProjectId?: string, dotenvPath?: string }): SecretLoader`

**Behavior (VERIFIED from source):**

| Step | Condition | Result |
|------|-----------|--------|
| 1 | Normalize: `origin = (secret_origin or "local").strip().lower()` | |
| 2a | `origin == "local"` | Return `DotEnvLoader(dotenv_path)` |
| 2b | `origin == "gcp"` AND no `gcp_project_id` | `ValueError("GCP project ID must be provided when SECRET_ORIGIN is 'gcp'.")` |
| 2c | `origin == "gcp"` AND `gcp_project_id` provided | Return `GCPSecretLoader(project_id=gcp_project_id)` |
| 3 | Any other origin | `ValueError("Unsupported SECRET_ORIGIN '{secret_origin}'. Expected 'local' or 'gcp'.")` |

**No caching in factory.py itself.** Caching is done in `ConfigManager._loaders` dict with key `(origin, gcp_project_id, dotenv_path)`.

---

## Module: manager

### SourceContext dataclass (frozen)

Value object for passing source configuration to loader dispatch.

**Fields:**

| Field | Type |
|-------|------|
| `environment_name` | `string` |
| `origin` | `string` |
| `dotenv_path` | `string \| null` |
| `gcp_project_id` | `string \| null` |

### ConfigManager.__init__

**Constructor params:** `config_path`, `secret_origin=None`, `gcp_project_id=None`, `strict=None`, `auto_load=True`, `dotenv_path=None`, `debug=False`

**Init sequence (VERIFIED, order matters):**

| Step | Action | Notes |
|------|--------|-------|
| 1 | Resolve config path | `Path(config_path).expanduser().resolve()` -> absolute |
| 2 | Discover project root | Walk up from config parent looking for `pyproject.toml` (Python) / `package.json` (JS); fallback to config parent |
| 3 | Load YAML | `load_yaml(str(self._config_path))` |
| 4 | Extract variables dict | Validates it's a mapping: `"'variables' must be a mapping"` |
| 5 | Extract validation dict | Validates structure |
| 6 | Parse environments | `parse_environments(raw_config)` -- may raise ValueError |
| 7 | Select active environment | Reads `APP_ENV` from `os.environ` |
| 8 | Resolve dotenv path | Priority: param > active env config > find_dotenv > project_root/.env |
| 9 | Read dotenv values | `dotenv_values()` -- silently returns `{}` if path missing |
| 10 | Set `_debug` | `debug` param |
| 11 | Resolve secret origin | Priority chain (see `_resolve_secret_origin`) |
| 12 | Resolve GCP project ID | Priority chain (see `_resolve_gcp_project_id`) |
| 13 | Resolve strict mode | `strict` param > YAML `validation.strict` > `false` |
| 14 | Initialize `_loader`, `_loaders`, `_values`, `_loaded` | Empty dicts, `_loaded = false` |
| 15 | If `auto_load=True` | Call `self.load()` |

### _select_environment

Determines which environment config to use based on APP_ENV.

**VERIFIED from source (lines 190-216):**

| Condition | Result |
|-----------|--------|
| No environments defined | Return `None` |
| `APP_ENV` set and in environments dict | Return that environment config |
| `APP_ENV` set but NOT in environments dict | `ValueError("APP_ENV='{env_name}' is not defined in the config. Available environments: {sorted_list}")` |
| `APP_ENV` not set, env with `is_default=True` exists | Return default-marked environment |
| `APP_ENV` not set, env named `"default"` exists | Return environment named "default" |
| `APP_ENV` not set, no default found | Return `None` |

### _resolve_dotenv_path

Resolves the dotenv file path with explicit contract tracking.

**Priority chain:**

| Priority | Source | Sets `_has_explicit_dotenv_contract` |
|----------|--------|--------------------------------------|
| 1 | `dotenv_path` constructor param | `true` |
| 2 | Active environment's `dotenv_path` | `true` |
| 3 | `find_dotenv(usecwd=True)` (Python) | `false` |
| 4 | `_project_root / ".env"` if exists | `false` |
| 5 | `None` | `false` |

**All non-None paths are resolved to absolute.**

### _resolve_secret_origin

Resolves the secret origin (local or gcp) from multiple sources.

**Priority chain (VERIFIED):**

| Priority | Source | Normalization |
|----------|--------|---------------|
| 1 | `secret_origin` constructor param | `.strip().lower()` |
| 2 | `os.environ.get("SECRET_ORIGIN")` | `.strip().lower()` |
| 3 | `self._dotenv_values.get("SECRET_ORIGIN")` | `.strip().lower()` |
| 4 | `self._active_environment.origin` | already lowercase |
| 5 | Default: `"local"` | |

### _resolve_gcp_project_id

Resolves the GCP project ID from multiple sources.

**Priority chain (VERIFIED):**

| Priority | Source |
|----------|--------|
| 1 | `gcp_project_id` constructor param |
| 2 | `os.environ.get("GCP_PROJECT_ID")` |
| 3 | `self._dotenv_values.get("GCP_PROJECT_ID")` |
| 4 | `self._active_environment.gcp_project_id` |
| 5 | `None` (with warning: `"GCP_PROJECT_ID not set. Some features may not work."`) |

**Side effect:** Calls `os.environ.setdefault("GCP_PROJECT_ID", candidate)` when a non-None value is resolved. JS port: `process.env.GCP_PROJECT_ID ??= candidate`.

### _validate_variable_definition

Validates a single variable's YAML definition and returns the source key.

**Timing:** Called inside `load()`, NOT in constructor. All schema errors are deferred until `load()`.

**9-step validation sequence (VERIFIED from source):**

| Step | Check | Error Message |
|------|-------|---------------|
| 1 | `definition` must be a dict | `"Invalid configuration for '{name}'. Expected a mapping."` |
| 2 | Extract `source = definition.get("source")` and `has_default = "default" in definition` | |
| 3 | Neither source nor default present | `"Variable '{name}' must define either 'source' or 'default' (or both)."` |
| 4 | `source` present but not a string | `"Variable '{name}': 'source' must be a string if provided."` |
| 5a | `environment` key present but empty string | `"Variable '{name}': 'environment' must be a non-empty string."` |
| 5b | `environment` key present but not in environments dict | `"Variable '{name}' references undefined environment '{env_name}'. Available environments: {sorted_list}"` |
| 6a | `origin` key present but empty/non-string | `"Variable '{name}': 'origin' must be a non-empty string."` |
| 6b | `origin` key value not in `{"local", "gcp"}` | `"Variable '{name}' has invalid origin '{origin_override}'; expected one of ['gcp', 'local']"` |
| 7 | `dotenv_path` key present but empty | `"Variable '{name}': 'dotenv_path' must be a non-empty string."` |
| 8 | `type` not in `{"str", "int", "float", "bool"}` | `"Variable '{name}' uses unsupported type '{v_type}'."` |
| 9 | Return `source` (may be `None` for default-only vars) | |

### _effective_source_context

Builds per-variable source context by applying overrides in order.

**Override application sequence (VERIFIED):**

| Step | Override Key | Effect |
|------|-------------|--------|
| 1 | Start with `_default_source_context()` | Base context from constructor resolution |
| 2 | `environment:` key in variable def | Replace entire context with that environment's settings |
| 3 | `origin:` key in variable def | Replace origin; if `"gcp"` -> clear dotenv_path to null; if `"local"` and dotenv_path was null -> restore `_dotenv_path` |
| 4 | `dotenv_path:` key in variable def | Replace dotenv_path with resolved absolute path |

**Important interaction (VERIFIED):** When `origin: gcp` is set, dotenv_path is set to `null`. But if `dotenv_path:` is ALSO set on the same variable, it IS re-applied after the gcp override clears it (because dotenv_path override runs after origin override at lines 289-300).

### load() pipeline

The main loading pipeline. Called automatically if `auto_load=True`, or manually.

**Guard:** If `_loaded` is `true`, return immediately. Load only runs once.

**Phase 1: Classify variables**
- For each variable: call `_validate_variable_definition(name, definition)` -> returns `source` or `None`
- `source is None` -> add to `default_only_variables` list
- `source is string` -> add to `sourced_variables` list
- Build `contexts` dict for sourced variables via `_effective_source_context()`

**Phase 2: Pre-flight os.environ check**
- For sourced variables: if `name in os.environ` -> use `os.environ[name]` directly, skip loader
- NOTE: Uses the variable's `source` key as the fetched-results dict key

**Phase 3: Group remaining by loader context**
- Group by `(origin, gcp_project_id, dotenv_path, environment_name)` tuple
- Batch-fetch via `loader.get_many([sources[name] for name in grouped_names])`
- On `FileNotFoundError`: raise `RuntimeError("Variable(s) {names} in {env_label} require local .env file '{path}' for sourced lookups.")`

**Phase 4: Resolve validation sets**
- `required = set(validation.get("required", []))` -- `or []` handles explicit `None`
- `optional = set(validation.get("optional", []))`

**Phase 5: Store default-only variables**
- For each default-only var: `_store_loaded_value(var_name, definition["default"], target_type)`
- These IGNORE os.environ (VERIFIED by `test_default_only_variable_ignores_same_named_os_environ`)

**Phase 6: Resolve sourced variables**
For each sourced variable:

| Condition | Action |
|-----------|--------|
| `raw_value` found (not None) | Call `_store_loaded_value(name, raw_value, type)` |
| `raw_value is None` AND `strict` | `RuntimeError("Strict mode: variable '{name}' is missing from source '{source}' in {context}.")` |
| `raw_value is None` AND has default AND in required | Log warning + use default: `"Required variable '{name}' missing from source; using YAML default for source '{source}' in {context}."` |
| `raw_value is None` AND has default AND not in required | Use default silently |
| `raw_value is None` AND no default AND in required | `RuntimeError("Required variable '{name}' not found in source '{source}' for {context}.")` |
| `raw_value is None` AND no default AND in optional | Log warning: `"Optional variable '{name}' resolved to None because source '{source}' was unavailable in {context}."` ; set `_values[name] = None` and continue |
| `raw_value is None` AND no default AND not required AND not optional | Set `_values[name] = None` and continue |

**Phase 7:** Set `_loaded = true`

### _store_loaded_value

Coerces a value, stores it internally, writes to os.environ, and logs.

| Step | Action |
|------|--------|
| 1 | `coerce_type(raw_value, target_type, var_name)` -- may raise ValueError |
| 2 | `self._values[var_name] = coerced_value` |
| 3 | `os.environ[var_name] = str(coerced_value)` -- ALWAYS writes as string |
| 4 | Log: `"Loaded {var_name}: {display_value}"` -- masked unless `_debug=True` |

**Critical guard (in load(), not _store_loaded_value):** When `raw_value is None`, the code sets `self._values[var_name] = None` and `continue` -- bypassing `_store_loaded_value`. This means `None`/`null` is NEVER written to `os.environ`/`process.env`.

### get / require

**get(key, default=None):**
- Triggers `load()` if not loaded (auto-load on first access)
- Returns `self._values.get(key, default)`

**require(key):**
- Triggers `load()` if not loaded
- If key missing or value is `None`: `RuntimeError("Required configuration '{key}' is missing. Call init_config or set a default.")`
- Otherwise returns value

### Singleton API

**Module-level variable:** `_SINGLETON: ConfigManager | null = null`

**init_config(config_path, **kwargs) -> ConfigManager:**

| Condition | Behavior |
|-----------|----------|
| `_SINGLETON is not None` | Log warning: `"Configuration manager already initialised. Replacing existing instance."` |
| Always | Create new ConfigManager, assign to `_SINGLETON`, return it |

**Key behavior:** Re-init REPLACES the singleton (not a no-op). Warning is logged but creation proceeds.

**get_config(key, default=None):**
- If `_SINGLETON is None`: `RuntimeError("Configuration manager not initialised. Call init_config().")`
- Return `_SINGLETON.get(key, default)`

**require_config(key):**
- If `_SINGLETON is None`: `RuntimeError("Configuration manager not initialised. Call init_config().")`
- Return `_SINGLETON.require(key)`

**_resetSingleton() -- JS only:**
- No equivalent in Python source. Python tests directly set `manager_module._SINGLETON = None`.
- JS port exports `_resetSingleton()` as a test-only function that sets `_SINGLETON = null`.
- Called in `tests/setup.ts` `beforeEach`/`afterEach`.

**Python test coverage:** `test_manager.py`:
- `test_singleton_lifecycle` -- init, get_config, require_config
- `test_reinit_warning` -- re-init logs warning, replaces instance
- `test_debug_parameter_disables_masking` -- debug=True shows raw values

---

## Exact Error Messages Reference

All error messages that are asserted in Python tests, grouped by source module. Interpolation variables marked with `{braces}`.

### utils.py errors

| Error | Type | Interpolation |
|-------|------|---------------|
| `"Unsupported type '{target_type}' for variable '{variable_name}'"` | ValueError | target_type, variable_name |
| `"Cannot convert '{variable_name}' value '{value_str}' to int"` | ValueError | variable_name, value_str |
| `"Cannot convert '{variable_name}' value '{value_str}' to float"` | ValueError | variable_name, value_str |
| `"Invalid boolean value for '{variable_name}': '{value_str}'. Must be one of: 'true', 'True', '1', 'false', 'False', '0'"` | ValueError | variable_name, value_str |
| `"Configuration file '{config_path}' does not exist."` | FileNotFoundError | config_path |
| `"Configuration file '{config_path}' must define a mapping at the root."` | ValueError | config_path |

### environment.py errors

| Error | Type | Interpolation |
|-------|------|---------------|
| `"The 'environments' section must be a mapping, got {type_name}"` | ValueError | type_name |
| `"Environment '{env_name}' must be a mapping, got {type_name}"` | ValueError | env_name, type_name |
| `"Environment '{env_name}' is missing the required 'origin' field"` | ValueError | env_name |
| `"Environment '{env_name}' has invalid origin '{origin}'; expected one of ['gcp', 'local']"` | ValueError | env_name, origin |
| `"Environment '{env_name}' with origin 'gcp' requires 'gcp_project_id'"` | ValueError | env_name |
| `"Only one environment may set 'default: true', but found multiple: {list}"` | ValueError | list |

### factory.py errors

| Error | Type | Interpolation |
|-------|------|---------------|
| `"GCP project ID must be provided when SECRET_ORIGIN is 'gcp'."` | ValueError | (none) |
| `"Unsupported SECRET_ORIGIN '{secret_origin}'. Expected 'local' or 'gcp'."` | ValueError | secret_origin |

### loaders/gcp.py errors

| Error | Type | Interpolation |
|-------|------|---------------|
| `"GCP project ID is required when using the GCP secret loader."` | ValueError | (none) |
| `"Failed to access secret '{key}' in GCP project '{project_id}': {exc}"` | RuntimeError | key, project_id, exc |
| `"Retry exhausted when accessing secret '{key}' in GCP project '{project_id}': {exc}"` | RuntimeError | key, project_id, exc |

### loaders/gcp.py warnings (stdout)

| Warning | Interpolation |
|---------|---------------|
| `"Secret '{key}' not found in GCP project '{project_id}'."` | key, project_id |

### manager.py errors

| Error | Type | Interpolation |
|-------|------|---------------|
| `"APP_ENV='{env_name}' is not defined in the config. Available environments: {sorted_list}"` | ValueError | env_name, sorted_list |
| `"'variables' must be a mapping"` | ValueError | (none) |
| `"Invalid configuration for '{name}'. Expected a mapping."` | ValueError | name |
| `"Variable '{name}' must define either 'source' or 'default' (or both)."` | ValueError | name |
| `"Variable '{name}': 'source' must be a string if provided."` | ValueError | name |
| `"Variable '{name}': 'environment' must be a non-empty string."` | ValueError | name |
| `"Variable '{name}' references undefined environment '{env_name}'. Available environments: {sorted_list}"` | ValueError | name, env_name, sorted_list |
| `"Variable '{name}': 'origin' must be a non-empty string."` | ValueError | name |
| `"Variable '{name}' has invalid origin '{origin_override}'; expected one of ['gcp', 'local']"` | ValueError | name, origin_override |
| `"Variable '{name}': 'dotenv_path' must be a non-empty string."` | ValueError | name |
| `"Variable '{name}' uses unsupported type '{v_type}'."` | ValueError | name, v_type |
| `"Required variable '{name}' not found in source '{source}' for {context}."` | RuntimeError | name, source, context |
| `"Strict mode: variable '{name}' is missing from source '{source}' in {context}."` | RuntimeError | name, source, context |
| `"Variable(s) {names} in {env_label} require local .env file '{path}' for sourced lookups."` | RuntimeError | names, env_label, path |
| `"Required configuration '{key}' is missing. Call init_config or set a default."` | RuntimeError | key |
| `"Configuration manager not initialised. Call init_config()."` | RuntimeError | (none) |
| `"GCP_PROJECT_ID not set. Some features may not work."` | Warning | (none) |

### manager.py warnings/log messages (stdout)

| Message | Interpolation |
|---------|---------------|
| `"Configuration manager already initialised. Replacing existing instance."` | (none) |
| `"Required variable '{name}' missing from source; using YAML default for source '{source}' in {context}."` | name, source, context |
| `"Optional variable '{name}' resolved to None because source '{source}' was unavailable in {context}."` | name, source, context |
| `"Loaded {var_name}: {display_value}"` | var_name, display_value (masked or raw) |

### Context format in runtime messages

`{context}` in the messages above expands to:
- GCP: `"environment '{env_name}' using GCP project '{project_id}'"`
- Local: `"environment '{env_name}' using local .env '{dotenv_path}'"`
- No dotenv: `"environment '{env_name}' using local .env '<no dotenv file>'"`

---

## Subtle Behavioral Details

### 1. APP_ENV vs ENVIRONMENT -- THE CRITICAL DISCREPANCY

The Python manager reads `APP_ENV`. All Python tests set `ENVIRONMENT`. The tests are setting a no-op variable. JS tests MUST use `APP_ENV`. JS `setup.ts` must clean `APP_ENV`.

### 2. Bool-to-string produces lowercase only

`coerce_type(True, "str", "x")` -> `"true"` (not `"True"`). In JS: must check `typeof rawValue === "boolean"` before calling `String()`, because `String(true)` -> `"true"` (matches). The key concern is that YAML auto-parses `true`/`false` to boolean type.

### 3. null is NEVER written to process.env

`_store_loaded_value` calls `os.environ[var_name] = str(coerced_value)`. If `coerced_value` were `None`, this would write `"None"`. But the `load()` method's null guard (`self._values[var_name] = None; continue`) ensures `_store_loaded_value` is never called with None. JS port: NEVER write `"null"` or `"undefined"` to `process.env`.

### 4. Default-only variables ignore os.environ

A variable with only `default:` (no `source:`) goes through a separate code path (`default_only_variables` list) that never checks `os.environ`. Even if `process.env.PORT = "9999"`, a default-only `PORT` variable with `default: 8080` will resolve to `8080`.

### 5. Loader cache key is tuple (origin, gcp_project_id, dotenv_path)

In Python: `cache_key = (context.origin, context.gcp_project_id, context.dotenv_path)`. JS port: use a composite string key like `"${origin}|${gcpProjectId}|${dotenvPath}"` since object/tuple equality doesn't work for plain JS objects.

### 6. DotEnvLoader calls load_dotenv() which mutates os.environ (Python only)

Python's `DotEnvLoader` calls `load_dotenv(self._dotenv_path, override=False)` which writes values into `os.environ`. JS port MUST NOT replicate this -- use `dotenv.parse()` only, never `dotenv.config()`.

### 7. source key vs variable name distinction

The `source` field in a variable definition is the lookup key used with the loader. It CAN differ from the variable name. Example: `source: "DB_PASSWORD"` on a variable named `MY_DB_PASS`. The fetched results dict is keyed by source values, not variable names.

### 8. init_config returns the ConfigManager instance

Python's `init_config(config_path, **kwargs)` returns the created `ConfigManager`. JS port: same pattern -- `initConfig()` returns the instance.

### 9. Re-init replaces singleton (not no-op)

Calling `init_config` when `_SINGLETON` is already set logs a warning AND replaces the singleton with the new instance. It does NOT skip creation or return the existing one.

### 10. Deferred FileNotFoundError on missing .env

When `_explicit_path=True` and the `.env` file is missing: `DotEnvLoader` only raises `FileNotFoundError` when `get()` or `get_many()` is called for keys NOT in `os.environ`. If all needed keys are already in `os.environ`, no error is raised even though the file is missing.

### 11. GCP resource name format

The resource name for GCP is: `"projects/{project_id}/secrets/{key}/versions/latest"`. The `key` here is the `source` field from the variable definition, which is typically just the secret name (e.g., `"DB_PASSWORD"`), not a full resource path.

### 12. _extract_validation silently allows None for required/optional

If `required` or `optional` is explicitly `null` in YAML, the `or []` fallback handles it: `self._validation.get("required", []) or []`. JS port: use `validation.required ?? []` with nullish coalescing.

---

## Requirement Cross-Reference

| Requirement | Catalog Section | Python Test File | Python Test(s) |
|-------------|----------------|-----------------|----------------|
| UTIL-01 | coerce_type str branch | test_type_coercion.py | test_coerce_str_returns_string |
| UTIL-02 | coerce_type null passthrough | (none -- implicit) | (untested directly) |
| UTIL-03 | coerce_type bool->str lowercase | test_bool_to_string_coercion.py | test_bool_yaml_value_coerced_to_string |
| UTIL-04 | coerce_type int->str | test_bool_to_string_coercion.py | test_number_yaml_value_coerced_to_string |
| UTIL-05 | coerce_type invalid bool | test_type_coercion.py | test_coerce_bool_invalid_value |
| UTIL-06 | coerce_type unsupported type | test_type_coercion.py | test_coerce_invalid_type |
| UTIL-07 | mask_secret short values | (none) | (ZERO Python tests -- JS writes from catalog) |
| UTIL-08 | mask_secret long values | (none) | (ZERO Python tests -- JS writes from catalog) |
| UTIL-09 | load_yaml valid file | (indirect via ConfigManager) | test_manager.py integration |
| UTIL-10 | load_yaml missing file | (indirect via ConfigManager) | test_manager.py integration |
| ENV-01 | parse_environments no key | test_environment.py | test_no_environments_key |
| ENV-02 | parse_environments local | test_environment.py | test_single_local_environment |
| ENV-03 | parse_environments gcp | test_environment.py | test_single_gcp_environment |
| ENV-04 | parse_environments multiple | test_environment.py | test_multiple_environments |
| ENV-05 | parse_environments missing origin | test_environment.py | test_missing_origin_raises |
| ENV-06 | parse_environments invalid origin | test_environment.py | test_invalid_origin_raises |
| ENV-07 | parse_environments gcp requires project | test_environment.py | test_gcp_requires_project_id |
| ENV-08 | parse_environments not mapping | test_environment.py | test_environments_not_a_mapping |
| ENV-09 | origin normalization | test_environment.py | test_origin_normalization |
| ENV-10 | default flag | test_environment.py | test_default_flag |
| ENV-11 | multiple defaults raises | test_environment.py | test_multiple_defaults_raises |
| ENV-12 | EnvironmentConfig fields | test_environment.py | test_environment_config_fields, test_environment_config_defaults |
| LOAD-01 | DotEnvLoader reads values | test_loaders.py | test_dotenv_loader_reads_and_returns_values |
| LOAD-02 | DotEnvLoader env override | test_loaders.py | test_dotenv_loader_reads_and_returns_values |
| LOAD-03 | DotEnvLoader missing key -> null | test_loaders.py | test_dotenv_loader_reads_and_returns_values |
| LOAD-04 | DotEnvLoader deferred error | test_manager.py | test_deferred_dotenv_file_not_found |
| LOAD-05 | GCPSecretLoader fetch | test_loaders.py | test_gcp_loader_fetches_and_caches_secret |
| LOAD-06 | GCPSecretLoader cache | test_loaders.py | test_gcp_loader_fetches_and_caches_secret |
| LOAD-07 | GCPSecretLoader NotFound | test_loaders.py | test_gcp_loader_handles_missing_secret |
| LOAD-08 | create_loader local | (indirect) | test_manager.py integration |
| LOAD-09 | create_loader gcp | (indirect) | test_environment_integration.py |
| RES-01 | os.environ precedence | test_resolution_pipeline.py | test_os_environ_overrides_dotenv |
| RES-02 | dotenv precedence | test_resolution_pipeline.py | test_dotenv_provides_value |
| RES-03 | default fallback | test_resolution_pipeline.py | test_default_value_used_when_no_source |
| RES-04 | required missing raises | test_manager.py | test_missing_required_variable |
| RES-05 | optional missing -> null | test_resolution_validation.py | test_optional_variable_quiet |
| RES-06 | strict mode raises | test_manager.py | test_strict_mode_raises_on_missing |
| RES-07 | default-only ignores env | test_optional_source.py | test_default_only_variable_ignores_same_named_os_environ |
| RES-08 | source + default combo | test_optional_source.py | test_variable_with_source_and_default |
| RES-09 | pinned environment | test_resolution_pipeline.py | test_pinned_environment_overrides_default |
| RES-10 | origin override per-variable | test_resolution_pipeline.py | test_origin_override_on_variable |
| RES-11 | dotenv_path override | test_resolution_pipeline.py | test_dotenv_path_override_on_variable |
| RES-12 | absolute dotenv_path | test_resolution_pipeline.py | test_absolute_dotenv_path |
| RES-13 | SECRET_ORIGIN from .env | test_secret_origin_detection.py | test_secret_origin_from_env_file |
| RES-14 | env var selects environment | test_environment_integration.py | test_environment_var_selects_staging (BROKEN -- uses ENVIRONMENT not APP_ENV) |
| RES-15 | backwards compat (old format) | test_environment_integration.py | test_backwards_compatibility_no_environments |
| RES-16 | param overrides env var | test_environment_integration.py | test_param_overrides_env_var |
| VAL-01 | variables must be mapping | test_resolution_validation.py | test_variables_must_be_mapping |
| VAL-02 | validation must be mapping | test_resolution_validation.py | test_validation_must_be_mapping |
| VAL-03 | source must be string | test_resolution_validation.py | test_source_must_be_string |
| VAL-04 | environment must be non-empty | test_resolution_validation.py | test_empty_environment_override |
| VAL-05 | undefined environment raises | test_environment_integration.py | test_unknown_environment_in_variable_definition |
| VAL-06 | origin must be valid | test_environment_integration.py | test_invalid_origin_in_variable_definition |
| VAL-07 | dotenv_path must be string | test_resolution_validation.py | test_empty_dotenv_path_override |
| VAL-08 | type must be supported | (indirect) | test_type_coercion.py |
| VAL-09 | neither source nor default | test_optional_source.py | test_no_source_no_default_raises |
| VAL-10 | strict constructor override | test_validation.py | test_strict_false_overrides_yaml_strict_true |
| VAL-11 | error context includes environment | test_resolution_validation.py | test_error_context_includes_gcp_project |
| VAL-12 | error context includes path | test_resolution_validation.py | test_required_variable_error_includes_context |
| VAL-13 | default fallback warning | test_resolution_validation.py | test_required_variable_with_default_logs_warning |
| MGR-01 | local load cycle | test_manager.py | test_local_loading_with_all_types |
| MGR-02 | required missing error | test_manager.py | test_missing_required_variable |
| MGR-03 | optional default quiet | test_manager.py | test_optional_variable_with_default_no_warning |
| MGR-04 | strict mode | test_manager.py | test_strict_mode_raises_on_missing |
| MGR-05 | singleton lifecycle | test_manager.py | test_singleton_lifecycle |
| MGR-06 | APP_ENV selects environment | test_environment_integration.py | (BROKEN in Python -- uses ENVIRONMENT) |
| MGR-07 | re-init warning + replace | test_manager.py | test_reinit_warning |
| MGR-08 | debug mode shows raw values | test_manager.py | test_debug_parameter_disables_masking |
| MGR-09 | deferred dotenv error | test_manager.py | test_deferred_dotenv_file_not_found |
| MGR-10 | write-back to os.environ | test_manager.py | test_local_loading_with_all_types (implicit) |
| MGR-11 | auto_load on construction | test_manager.py | test_local_loading_with_all_types (implicit) |
| MGR-12 | get_config raises if not init | (implicit in singleton test) | test_singleton_lifecycle |
| MGR-13 | require_config raises if not init | (implicit in singleton test) | test_singleton_lifecycle |
| MGR-14 | require raises for missing key | test_manager.py | test_missing_required_variable |
| MGR-15 | get returns default for missing | test_manager.py | test_local_loading_with_all_types (implicit) |
| MGR-16 | multiple source types | test_end_to_end.py | test_mixed_sources_load |

---

## Test Coverage Gaps

### 1. mask_secret: 0 Python tests
The JS port must write maskSecret tests from this catalog's behavioral specification. Recommended test cases:
- Short value (< 10 chars) -> 10 asterisks
- Long value (>= 10 chars) -> first 2 + "****" + last 4
- Empty string -> 10 asterisks
- Exactly 10 chars (boundary) -> first 2 + "****" + last 4

### 2. APP_ENV selection: Python tests use ENVIRONMENT (no-op)
All Python tests that claim to test environment selection via env var actually set `ENVIRONMENT` which the manager ignores. JS tests fix this by using `APP_ENV`.

### 3. ROADMAP test count discrepancy
ROADMAP Plan 3.1 claims "17 coerceType + 3 maskSecret tests" -- actual Python counts are 7 coerceType + 0 maskSecret. The JS port adjusts test counts accordingly (7 ported coerceType tests + new maskSecret tests from catalog).

### 4. load_yaml: No direct tests
`load_yaml` is only tested indirectly through ConfigManager. JS port may add direct unit tests for `loadYaml` based on this catalog.

### 5. coerce_type null passthrough: Not directly tested
The null passthrough behavior (`raw_value is None -> return None`) is implicit in the source but not directly tested.

### 6. DotEnvLoader deferred error: Only via integration
The deferred `FileNotFoundError` mechanics are only tested through ConfigManager integration in `test_manager.py::test_deferred_dotenv_file_not_found`, not as a direct DotEnvLoader unit test.

---

*Catalog complete: 2026-03-30*
*Source: All 9 Python source files + 13 test files + 3 fixture files*
*Research: .planning/phases/02-python-analysis-behavioral-catalog/02-RESEARCH.md*
