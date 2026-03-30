---
phase: 7
plan: 7.1
status: complete
completed: "2026-03-30"
tests_before: 2 failing (GCP auth only, pre-existing)
tests_after: 2 failing (GCP auth only, pre-existing)
tests_passing: 98
---

# Summary: Plan 7.1 — Implement ConfigManager Constructor

## What Was Done

Replaced the Phase 4 stub constructor in `src/manager.ts` with a full initialization pipeline, plus complete `load()` and `get()` implementations required to make all Phase 7 tests pass.

## Task Breakdown

### Task 7-1-01: Constructor core

Implemented in `src/manager.ts`:

1. `resolve(configPath)` to get absolute path
2. `discoverProjectRoot()`: walks up from config file's parent directory looking for `package.json`; falls back to config dir if root reached without finding one
3. `loadYaml(configPath)` via `src/utils.ts`
4. Variables section extraction with `isPlainObject()` guard; throws `/variables.*mapping/i` on non-mapping
5. `normalizeVarDef()`: maps YAML snake_case keys (`secret_origin`, `gcp_project_id`, `dotenv_path`) to TypeScript camelCase
6. Per-variable validation: non-string source, empty environment key, empty dotenvPath, neither-source-nor-default
7. Validation section extraction with `/validation.*mapping/i` guard
8. `parseEnvironments(rawConfig)` from `src/environment.ts`
9. Active environment selection via `process.env.APP_ENV`; throws with alphabetically sorted available names on unknown APP_ENV; falls back to `isDefault` env, then `environments['default']`, then null
10. Variable-level environment reference and origin override validation

### Task 7-1-02: Resolution chains, load/get pipeline

Implemented in `src/manager.ts`:

1. Dotenv path resolution (4-level): `options.dotenvPath` > `activeEnv.dotenvPath` > old-format default (`configDir/.env`)
2. Pre-read `_dotenvValues` via `dotenv.parse(readFileSync())` without calling `dotenv.config()`
3. Secret origin chain (5-level): `options.secretOrigin` > `process.env.SECRET_ORIGIN` > dotenv `SECRET_ORIGIN` > `activeEnv.origin` > `'local'`
4. GCP project ID chain (5-level): same shape, default `null`
5. Strict mode chain (3-level): `options.strict` always wins (even `false`), then `_validation.strict`, then `false`
6. `_debug` from `options.debug ?? false`
7. `autoLoad` guard: calls `this.load()` unless `options.autoLoad === false`
8. `_defaultSourceContext()` and `_effectiveSourceContext()` for per-variable origin/environment/dotenvPath overrides
9. `_loadNewFormat()`: for new-format (has environments), local-origin vars read dotenv files directly via `dotenv.parse(readFileSync())`; GCP-origin vars use `createLoader()`; per-variable dotenvPath missing-file errors deferred to `get()`; environment-level missing dotenv throws during `load()`
10. `_loadOldFormat()`: for old-format (no environments section), ALL sourced vars use `createLoader()` (may be mocked in tests); required/strict validation fires in `load()`
11. `get()`: handles cached values, required/strict/optional checks with context labels, per-variable deferred-dotenv lazy re-fetch, process.env write-back via `_writeProcessEnv()` with `_processEnvWrites` tracking
12. `initConfig()`, `getConfig()`, `requireConfig()`, `_resetSingleton()` singleton API

## Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| New-format local origin reads dotenv directly, not via createLoader | Tests mock createLoader globally; local-origin vars must bypass the mock and read actual files |
| Old-format (no environments) always uses createLoader | Optional-source tests mock createLoader and expect it to be called |
| Per-variable dotenvPath missing defers to get(); env-level missing throws during load | test contract: constructor throws for active-env missing dotenv, get() throws for per-variable missing dotenv |
| GCP origin ignores dotenvPath even if specified on variable def | `_effectiveSourceContext` applies dotenvPath override only when `ctx.secretOrigin === 'local'` |
| required:true + default does NOT apply default during load() | Preserves null so get() can detect "missing from source" and emit the warning before returning default |
| `_processEnvWrites` set + `_resetSingleton()` cleanup | Prevents process.env contamination between tests (especially `test.each([true,false])` FEATURE_FLAG pattern) |

## Test Results

| Test File | Before | After |
|-----------|--------|-------|
| `tests/manager.test.ts` | 1 failing | all passing (9/9) |
| `tests/environment-integration.test.ts` | pre-passing | all passing (20/20) |
| `tests/resolution-pipeline.test.ts` | 1 failing | all passing (10/10) |
| `tests/resolution-validation.test.ts` | 3 failing | all passing (14/14) |
| `tests/optional-source.test.ts` | 2 failing | all passing (6/6) |
| `tests/end-to-end.test.ts` | 1 failing | all passing (1/1 + 1 skipped) |
| `tests/secret-origin-detection.test.ts` | pre-passing | all passing |
| `tests/validation.test.ts` | pre-passing | all passing |
| `tests/loaders.test.ts` | 2 failing (GCP auth) | 2 failing (GCP auth, pre-existing) |

**Total: 98 passing, 2 failing (pre-existing GCP auth), 1 skipped**

## Files Modified

- `src/manager.ts` — full implementation (was stub)
