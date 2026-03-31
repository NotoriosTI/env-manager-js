# Roadmap: env-manager-js
Created: 2026-03-30
Author: architect-agent

## Overview

A behavior-preserving TypeScript port of the Python `env-manager` library, published to npm. The project follows strict TDD methodology: all 13 test files are written first (ported 1:1 from the Python test suite), then implementation follows module by module in dependency order. Behavior parity with the Python version is the acceptance criterion for every requirement.

## Phase Structure

| Phase | Name | Requirements | Parallel? |
|-------|------|-------------|-----------|
| 1 | Project Bootstrap | PKG-01 | No | Complete |
| 2 | Python Analysis & Behavioral Catalog | (prerequisite) | No |
| 3 | Write All Tests (TDD First) | PKG-02, UTIL-01–10, ENV-01–12, LOAD-01–09, RES-01–16, VAL-01–13, MGR-01–16 | No |
| 4 | Type Stubs | (compiler contract) | No |
| 5 | Core Implementation: utils + environment | Complete    | 2026-03-30 |
| 6 | Loaders + Factory | LOAD-01–09 | dotenv ∥ gcp | Complete (2026-03-30) |
| 7 | ConfigManager + Singleton | RES-01–16, VAL-01–13, MGR-01–16 | No |
| 8 | Integration Verification + Publish | PKG-03, PKG-04 | No |

---

## Phase 1: Project Bootstrap

**Goal:** A working TypeScript + Vitest + ESM project that compiles and can run (empty) tests. All toolchain decisions locked in before any code is written.

**Rationale:** ESM import resolution errors (`.js` extensions, `moduleResolution: Node18`) cascade into every subsequent phase. A broken tsconfig discovered during Phase 5 is far more expensive to fix than one caught in Phase 1. `setup.ts` is also written here because singleton and `process.env` contamination pitfalls corrupt test results if deferred.

### Plans

#### Plan 1.1 — Package initialization ✓ COMPLETE (2026-03-30)
- `npm init` with `"type": "module"`
- Install runtime deps: `yaml`, `dotenv`, `@google-cloud/secret-manager`
- Install dev deps: `typescript@5.8`, `vitest@4`, `@types/node`, `tsup@8`
- Add `publint` and `are-the-types-wrong` as dev deps

#### Plan 1.2 — TypeScript and build config ✓ COMPLETE (2026-03-30)
- `tsconfig.json` with `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"target": "ES2022"`, `strict: true`
- `tsup.config.ts` for dual ESM+CJS output with `.d.ts` generation
- `src/index.ts` stub created; `tsc --noEmit` exits 0
- Note: Plan specified `"Node18"` for moduleResolution but TS 5.8.3 requires `"NodeNext"` (semantically equivalent)

#### Plan 1.3 — Vitest and test infrastructure ✓ COMPLETE (2026-03-30)
- `vitest.config.ts` with `setupFiles: ['tests/setup.ts']`, `environment: 'node'`, `globals: true`
- `tests/setup.ts` — singleton reset (`_resetSingleton()`) in `beforeEach`/`afterEach`, `vi.unstubAllEnvs()` in `afterEach`, env var cleanup list from Python's `conftest.py`
- `tests/helpers.ts` — `writeConfig()`, `writeEnv()`, `writeRepoConfig()` helpers (using `package.json` for root discovery, NOT `pyproject.toml`)
- Create directory skeleton: `src/loaders/`, `tests/fixtures/` with `.gitkeep` files

**Success Criteria:**
- [x] `tsc --noEmit` exits 0 on empty `src/index.ts`
- [x] `npx vitest run` finds 0 test files and exits 0
- [x] `tests/setup.ts` imports `_resetSingleton` from `src/manager.ts` stub without error
- [x] Directory structure matches PORT_PROMPT.md Phase 1.5 exactly

**Requirements mapped:** PKG-01

**Estimated effort:** Small

---

## Phase 2: Python Analysis & Behavioral Catalog

**Goal:** A written behavioral catalog of every observable behavior in the Python `env-manager` library, organized by module. This catalog is the implementation specification.

**Rationale:** PORT_PROMPT.md Phase 0 is mandatory and must not be skipped. The catalog catches subtle behavioral details (exact error message wording, gRPC error code shape, `APP_ENV` vs `ENVIRONMENT` variable name, YAML schema selection) before any test is written. A missed behavior discovered in Phase 7 is a test rewrite — but tests are immutable once written (Phase 3).

### Plans

#### Plan 2.1 — Read all Python source files
- `src/env_manager/__init__.py`, `base.py`, `utils.py`, `environment.py`, `factory.py`, `manager.py`
- `src/env_manager/loaders/__init__.py`, `loaders/dotenv.py`, `loaders/gcp.py`

#### Plan 2.2 — Read all Python test files
- All 13 test files from `tests/` in `../env-manager/`
- `tests/conftest.py` for fixture and env var teardown list

#### Plan 2.3 — Read Python test fixtures COMPLETE (2026-03-30)
- `tests/fixtures/test_config.example.yaml`, `prod_config.example.yaml`
- `config_vars.yaml.example`

#### Plan 2.4 — Produce behavioral catalog COMPLETE (2026-03-30)
- Written document at `.planning/research/BEHAVIORAL_CATALOG.md` (836 lines)
- Organized by module: utils, environment, loaders (dotenv, gcp), factory, manager, singleton
- Each entry: trigger -> output/side-effect, edge cases, exact error messages
- Explicitly document: `APP_ENV` vs `ENVIRONMENT` resolution, YAML 1.1 vs 1.2 schema, gRPC error code shape for NotFound

**Success Criteria:**
- [x] `BEHAVIORAL_CATALOG.md` exists with entries for every Python function/method
- [x] Every exact error message string is captured (they are asserted in tests)
- [x] `APP_ENV` vs `ENVIRONMENT` question resolved with line reference from Python source
- [x] YAML schema (1.1 vs 1.2) decision documented
- [x] gRPC NotFound error shape documented with exact field names

**Requirements mapped:** (prerequisite for all — no v1 req directly, but PKG-02 depends on it)

**Estimated effort:** Medium

---

## Phase 3: Write All Tests (TDD First)

**Goal:** All 13 test files written and committed before any `src/` file contains implementation logic. Every test compiles (stubs exist) but all tests fail (stubs throw `Not implemented`).

**Rationale:** This is the core TDD discipline. Tests are the spec. Once committed, tests are immutable — if a test fails during Phase 5–7, the implementation is fixed, not the test. Writing tests first also surfaces any ambiguity in the behavioral catalog while the Python source is still fresh context.

**Dependency:** Phase 2 (behavioral catalog must be complete before tests are written)

### Plans

#### Plan 3.1 — Utility and masking tests COMPLETE (2026-03-30)
- `tests/utils.test.ts` — port `test_type_coercion.py` (17 coerceType cases + 3 maskSecret cases)
- `tests/bool-to-string-coercion.test.ts` — port `test_bool_to_string_coercion.py` (YAML bool/int → str coercion)

#### Plan 3.2 — Environment parsing tests
- `tests/environment.test.ts` — port `test_environment.py` (18 cases)
- `tests/environment-integration.test.ts` — port `test_environment_integration.py` (17 cases including APP_ENV selection, old format, param overrides)

#### Plan 3.3 — Loader tests
- `tests/loaders.test.ts` — port `test_loaders.py` (DotEnvLoader: 4 cases; GCPSecretLoader: 3 cases with vi.mock)

#### Plan 3.4 — Manager and singleton tests COMPLETE (2026-03-30)
- `tests/manager.test.ts` — port `test_manager.py` (local loading, required/optional vars, strict mode, singleton API, debug mode, deferred dotenv error)
- `tests/validation.test.ts` — port `test_validation.py` (strict constructor param override)

#### Plan 3.5 — Resolution pipeline and validation tests COMPLETE (2026-03-30)
- `tests/resolution-pipeline.test.ts` — port `test_resolution_pipeline.py` (10 precedence cases)
- `tests/resolution-validation.test.ts` — port `test_resolution_validation.py` (error messages, schema validation, GCP context)
- `tests/optional-source.test.ts` — port `test_optional_source.py` (default-only vars, source+default combos)
- `tests/secret-origin-detection.test.ts` — port `test_secret_origin_detection.py`

#### Plan 3.6 — End-to-end test + test fixtures COMPLETE (2026-03-30)
- `tests/end-to-end.test.ts` — port `test_end_to_end.py` (multi-source load, skip real GCP test)
- Port YAML fixtures to `tests/fixtures/`: `test_config.example.yaml`, `prod_config.example.yaml`
- Run full test suite — confirm ALL tests fail (not zero failures)

**Success Criteria:**
- [ ] All 13 test files exist under `tests/`
- [ ] `npx vitest run` shows all tests failing (not "no tests found", not "compile error")
- [ ] Zero TypeScript compile errors (stubs satisfy all type references)
- [ ] No test file modified after this phase is committed
- [ ] Test fixtures match Python fixture content

**Requirements mapped:** PKG-02 (all 66 behavioral requirements are covered by tests in this phase; implementation comes later)

**Estimated effort:** Large

---

## Phase 4: Type Stubs

**Goal:** `src/types.ts` fully defined; all other `src/` modules exist as stubs with correct signatures that throw `new Error('Not implemented')`. This encodes the `null` contract at the compiler level before any implementation can violate it.

**Rationale:** Defining return types as `string | null` (never `string | undefined`) in the stubs forces every implementation to respect the null contract. Type errors caught here prevent `undefined` bleed-through in the resolution pipeline (pitfall 2). This phase is short but load-bearing.

### Plans

#### Plan 4.1 — Core types COMPLETE (2026-03-30)
- `src/types.ts` — `SecretLoader`, `EnvironmentConfig`, `VariableDefinition`, `ValidationConfig`, `SourceContext`, `ConfigManagerOptions` as defined in PORT_PROMPT.md Phase 3.1
- All nullable fields use `string | null`, never `string | undefined`

#### Plan 4.2 — Module stubs COMPLETE (2026-03-30)
- `src/utils.ts` — `coerceType()`, `maskSecret()`, `loadYaml()` stubs with correct signatures
- `src/environment.ts` — `parseEnvironments()` stub
- `src/loaders/dotenv.ts` — `DotEnvLoader` class stub implementing `SecretLoader`
- `src/loaders/gcp.ts` — `GCPSecretLoader` class stub implementing `SecretLoader`
- `src/loaders/index.ts` — re-export barrel
- `src/factory.ts` — `createLoader()` stub
- `src/manager.ts` — `ConfigManager` stub + `initConfig`/`getConfig`/`requireConfig`/`_resetSingleton` exports
- `src/index.ts` — public API barrel (no logic)

**Success Criteria:**
- [ ] `tsc --noEmit` exits 0
- [ ] `npx vitest run` still shows all tests failing (not compile errors)
- [ ] No `string | undefined` in any return type (only `string | null`)
- [ ] `_resetSingleton` exported from `src/manager.ts`

**Requirements mapped:** (compiler contract — enables all subsequent phases)

**Estimated effort:** Small

---

## Phase 5: Core Implementation — Utils + Environment

**Goal:** `src/utils.ts` and `src/environment.ts` fully implemented with all tests passing. These are pure functions with no external dependencies and can be implemented in parallel.

**Rationale:** `coerceType` is the most subtle function in the codebase (YAML bool/int auto-conversion pitfall) and must be correct before any higher layer calls it. `parseEnvironments` is a pure function with no I/O — green tests here confirm YAML config parsing before loaders are involved.

**Parallelization:** `utils.ts` and `environment.ts` are independent and can be implemented concurrently.

### Plans

#### Plan 5.1 — `src/utils.ts` COMPLETE (2026-03-30)
- `coerceType()`: null passthrough → str branch (bool check before String()) → int/float (parseInt/parseFloat + NaN check) → bool (exact set match) → unsupported type throw
- `maskSecret()`: length < 10 → 10 asterisks; else → `slice(0,2) + "****" + slice(-4)`
- `loadYaml()`: `yaml.parse()` with schema selection matching Python PyYAML behavior; file-not-found throw; non-mapping throw
- Completed in commits `5de46b3` and `d8fc5e6`

#### Plan 5.2 — `src/environment.ts` COMPLETE (2026-03-30)
- `parseEnvironments()`: no-key → {}; array check → throw; per-env: missing origin → throw; origin lowercase + validate; local defaults; gcp requires project; multiple defaults → throw
- Completed in commits `9566167` and `ab3bda4`
- `npx vitest run tests/environment.test.ts` passes

#### Plan 5.3 — Post-parallel validation COMPLETE (2026-03-30)
- Merged typecheck + quick suite: 29/29 pass (utils + environment)
- Full regression: 71 stub failures match Phase 4 baseline, no regressions

**Success Criteria:**
- [ ] `tests/utils.test.ts` — all pass
- [ ] `tests/bool-to-string-coercion.test.ts` — all pass
- [ ] `tests/environment.test.ts` — all pass
- [ ] `coerceType(true, "str", "x")` returns `"true"` (not `"True"`) — YAML boolean pitfall verified
- [ ] `coerceType(null, "int", "x")` returns `null` — null passthrough verified

**Requirements mapped:** UTIL-01, UTIL-02, UTIL-03, UTIL-04, UTIL-05, UTIL-06, UTIL-07, UTIL-08, UTIL-09, UTIL-10, ENV-01, ENV-02, ENV-03, ENV-04, ENV-05, ENV-06, ENV-07, ENV-08, ENV-09, ENV-10, ENV-11, ENV-12

**Estimated effort:** Medium

---

## Phase 6: Loaders + Factory

**Goal:** `DotEnvLoader`, `GCPSecretLoader`, and `createLoader()` fully implemented with loader tests passing. Both loaders implement `SecretLoader` and can be built in parallel.

**Rationale:** Both loaders are independent of each other and depend only on `types.ts`. They must be stable before `ConfigManager` calls them. Critical pitfalls addressed here: `dotenv.parse()` not `dotenv.config()` (test contamination), gRPC code-5 NotFound returning `null` not throwing, deferred file-not-found error.

**Parallelization:** `loaders/dotenv.ts` and `loaders/gcp.ts` are independent and can be implemented concurrently.

### Plans

#### Plan 6.1 — `src/loaders/dotenv.ts` (parallel with 6.2) ✓ COMPLETE (2026-03-30)
- Constructor: resolve `dotenvPath`; load values via `dotenv.parse(fs.readFileSync())` into `_values`; do NOT call `dotenv.config()`
- `get(key)`: `process.env[key] ?? null` first (override semantics), then `_values[key] ?? null`
- `getMany(keys)`: iterate `get()`
- `_ensureFileBackedLookupAvailable()`: deferred throw if explicit path set, file missing, and key not in `process.env`
- `findDotenv()`: walk up from cwd looking for `.env`
- Run `npx vitest run tests/loaders.test.ts` (dotenv describe block) — all pass

#### Plan 6.2 — `src/loaders/gcp.ts` (parallel with 6.1) ✓ COMPLETE (2026-03-30)
- Constructor: `projectId`, create `SecretManagerServiceClient` via try/catch factory (vitest 4 compat), init `_cache: Map<string, string | null>`
- `get(key)`: cache hit → return; call `accessSecretVersion` with `projects/${projectId}/secrets/${key}/versions/latest`; decode `Uint8Array` payload with `Buffer.from(payload).toString('utf-8')`; catch `error.code === 5` → return null + `console.warn`; other errors → throw
- `getMany(keys)`: iterate `get()`
- Run `npx vitest run tests/loaders.test.ts` (gcp describe block) — all pass (6/6)

#### Plan 6.3 — `src/factory.ts` ✓ COMPLETE (2026-03-30)
- `createLoader(origin, gcpProjectId, dotenvPath)`: switch on origin → `new DotEnvLoader(dotenvPath)` or `new GCPSecretLoader(gcpProjectId)`; throw on unknown origin
- Loader instance caching: `Map<string, SecretLoader>` keyed by `` `${origin}:${gcpProjectId ?? ''}:${dotenvPath ?? ''}` ``
- Run `npx vitest run tests/loaders.test.ts` — LOAD-08 and LOAD-09 pass (6/6)

**Success Criteria:**
- [ ] `tests/loaders.test.ts` — all pass (DotEnvLoader + GCPSecretLoader + factory)
- [ ] `dotenv.config()` never called anywhere in `src/loaders/dotenv.ts`
- [ ] GCP NotFound (code 5) returns `null` and logs warning — not a thrown error
- [ ] DotEnvLoader deferred error: missing .env only throws when variable lookup is attempted
- [ ] Loader factory cache hit confirmed: GCP mock called once for two `get()` calls on same key

**Requirements mapped:** LOAD-01, LOAD-02, LOAD-03, LOAD-04, LOAD-05, LOAD-06, LOAD-07, LOAD-08, LOAD-09

**Estimated effort:** Medium

---

## Phase 7: ConfigManager + Singleton

**Goal:** `src/manager.ts` fully implemented. This is the largest module and depends on every layer below it. All resolution pipeline, validation, manager, and singleton tests pass.

**Rationale:** `ConfigManager` is the orchestrator — it coordinates environment selection, loader dispatch, resolution precedence, type coercion, validation, and process.env write-back. Building it last means all dependencies are tested and correct. This phase is where the most complex behavioral requirements live.

### Plans

#### Plan 7.1 — Constructor ✓ COMPLETE (2026-03-30)
- Config path resolution (absolute); project root discovery (walk up for `package.json`); load YAML; extract + validate variables and validation sections; parse environments; select active environment from `process.env.APP_ENV`; resolve dotenv path; pre-read dotenv values; resolve secret origin chain (param > `process.env.SECRET_ORIGIN` > .env file > active env > `"local"`); resolve GCP project ID chain; resolve strict mode; `autoLoad` guard
- Also implemented: `_effectiveSourceContext()`, `load()` (with `_loadNewFormat()` and `_loadOldFormat()`), `get()`, singleton API — all 98 non-GCP tests pass

#### Plan 7.2 — `_effectiveSourceContext()` — per-variable override ✓ COMPLETE (2026-03-30)
- Default context from active environment; `environment:` pin → use that env's context; `origin:` override → replace origin (clear/restore dotenvPath per origin type); `dotenv_path:` override → replace dotenvPath (resolve relative to project root, or use absolute as-is)
- Also added `_validateVariableDefinition()` helper method for use in load() pipeline
- Note: _effectiveSourceContext() was implemented ahead-of-schedule in Plan 7.1; Plan 7.2 confirmed correctness and added the named validation helper

#### Plan 7.3 — `load()` pipeline ✓ COMPLETE (2026-03-30)
- Guard (already-loaded); split default-only vs sourced vars; sourced already in `process.env` → use; group remaining by source context key; batch-fetch via `createLoader()`; per-variable resolution with validation (strict → throw; has default → use + warn if required; no default + required → throw; no default + optional → warn; no default + neither → silent null); `coerceType()`; store in `_values`; write to `process.env` as string (null guard — never write "null"); log masked/raw
- Note: Implementation was complete from Plan 7.1. Plan 7.3 confirmed 61/61 Phase 7 tests passing (all 7 test files green).

#### Plan 7.4 — Singleton API ✓ COMPLETE (2026-03-30)
- Module-level `let _singleton: ConfigManager | null = null`
- `initConfig(configPath, options)`: if already init'd → `console.warn("Configuration manager already initialised")`; create and store; return
- `getConfig(key, defaultValue?)`: return `_singleton._values[key] ?? defaultValue ?? null`
- `requireConfig(key)`: throw `"Configuration manager not initialised. Call initConfig()."` if no singleton; throw `"Required configuration 'X' is missing..."` if key missing
- `_resetSingleton()`: set to null (test-only export)
- Note: Implementation was complete from Plan 7.1. Plan 7.4 confirmed 61/61 Phase 7 tests passing (all 7 test files green).

**Success Criteria:**
- [x] `tests/manager.test.ts` — all pass
- [x] `tests/resolution-pipeline.test.ts` — all pass (all 10 precedence cases)
- [x] `tests/resolution-validation.test.ts` — all pass (error messages match Python exactly)
- [x] `tests/validation.test.ts` — all pass
- [x] `tests/optional-source.test.ts` — all pass
- [x] `tests/secret-origin-detection.test.ts` — all pass
- [x] `tests/environment-integration.test.ts` — all pass
- [x] `null` never written to `process.env` (no `"null"` string values)
- [x] Loader cache uses composite string key (not object identity)

**Requirements mapped:** RES-01, RES-02, RES-03, RES-04, RES-05, RES-06, RES-07, RES-08, RES-09, RES-10, RES-11, RES-12, RES-13, RES-14, RES-15, RES-16, VAL-01, VAL-02, VAL-03, VAL-04, VAL-05, VAL-06, VAL-07, VAL-08, VAL-09, VAL-10, VAL-11, VAL-12, VAL-13, MGR-01, MGR-02, MGR-03, MGR-04, MGR-05, MGR-06, MGR-07, MGR-08, MGR-09, MGR-10, MGR-11, MGR-12, MGR-13, MGR-14, MGR-15, MGR-16

**Estimated effort:** Large

---

## Phase 8: Integration Verification + Publish Configuration

**Goal:** Full test suite passes (zero failures). Package.json configured for npm publication with correct `exports`, `types`, and `files`. `publint` and `are-the-types-wrong` pass clean.

**Rationale:** End-to-end tests validate the full pipeline across real fixture files. Package misconfiguration (wrong exports field, missing `.d.ts`) is invisible to `tsc --noEmit` locally but breaks consumers — `publint` and `attw` catch this before users do.

### Plans

#### Plan 8.1 — Full test suite run COMPLETE (2026-03-31)
- `npx vitest run` — zero failures
- `tests/end-to-end.test.ts` passes (multi-source mixed load with mocked GCP)
- Fix any remaining failures — implementation only, never tests

#### Plan 8.2 — Package.json publish configuration
- `"name": "env-manager"`, `"version": "0.1.0"`, `"type": "module"`
- `"exports"` field: `"."` → `{ "import": "./dist/index.js", "types": "./dist/index.d.ts" }`
- `"files": ["dist"]`
- `"main"`, `"types"` fields for legacy CJS compatibility
- `"scripts"`: `build`, `test`, `test:watch`, `prepublishOnly`

#### Plan 8.3 — Public API surface (`src/index.ts`)
- Re-export: `ConfigManager`, `initConfig`, `getConfig`, `requireConfig`, `createLoader`, `_resetSingleton` (test-only)
- Re-export types: `SecretLoader`, `EnvironmentConfig`, `ConfigManagerOptions`
- Matches Python `__init__.py` exports

#### Plan 8.4 — Build and publish validation
- `tsup build` → `dist/` with `index.js` + `index.cjs` + `index.d.ts`
- `npx publint` — zero warnings
- `npx are-the-types-wrong` — zero errors
- Verify `dist/index.js` imports work from a `node --input-type=module` one-liner

**Success Criteria:**
- [ ] `npx vitest run` — zero failures across all 13 test files
- [ ] `tests/end-to-end.test.ts` — all pass
- [ ] `npx publint` — clean (zero warnings/errors)
- [ ] `npx are-the-types-wrong dist/index.js` — clean
- [ ] `import { ConfigManager, initConfig, getConfig, requireConfig } from 'env-manager'` resolves correctly in ESM consumer
- [ ] `dist/` contains both `.js` (ESM) and `.cjs` (CJS) outputs

**Requirements mapped:** PKG-03, PKG-04

**Estimated effort:** Small

---

## Requirement Coverage

All 68 v1 requirements mapped:

| Group | Count | Phases |
|-------|-------|--------|
| UTIL (10) | 10 | Phase 5 |
| ENV (12) | 12 | Phase 5 |
| LOAD (9) | 9 | Phase 6 |
| RES (16) | 16 | Phase 7 |
| VAL (13) | 13 | Phase 7 |
| MGR (16) | 16 | Phase 7 |
| PKG (4) | 4 | Phase 1 (PKG-01), Phase 3 (PKG-02), Phase 8 (PKG-03, PKG-04) |
| **Total** | **68** | |

---

## Dependency Graph

```
Phase 1 (Bootstrap)
    └── Phase 2 (Python Analysis)
            └── Phase 3 (Write All Tests)
                    └── Phase 4 (Type Stubs)
                            ├── Phase 5a (utils.ts) ─────────┐
                            └── Phase 5b (environment.ts) ───┤
                                                              ├── Phase 6a (DotEnvLoader) ─┐
                                                              └──────────────────────────┤  ├── Phase 7 (ConfigManager)
                                                                Phase 6b (GCPSecretLoader) ┘       └── Phase 8 (Integration + Publish)
                                                                Phase 6c (Factory)
```

## Parallelization Opportunities

| Phases | Can run in parallel? | Notes |
|--------|---------------------|-------|
| 5.1 (utils) + 5.2 (environment) | Yes | No shared state, independent functions |
| 6.1 (DotEnvLoader) + 6.2 (GCPSecretLoader) | Yes | Both implement SecretLoader independently |
| 7.1 (constructor) + 7.2 (sourceContext) | Partial | Write 7.2 first, needed by 7.1 |

---

## Risks & Mitigations

| Risk | Impact | Phase | Mitigation |
|------|--------|-------|------------|
| YAML auto-converts bool/int before coerceType sees them | High | 5 | Explicitly check `typeof rawValue === "boolean"` in str branch before String() |
| `process.env` returns `undefined`, not `null` | High | 4 | Encode `string \| null` return types in stubs; use `?? null` everywhere |
| `dotenv.config()` mutates global state in tests | High | 1, 6 | Use `dotenv.parse(fs.readFileSync())` in DotEnvLoader; `vi.unstubAllEnvs()` in afterEach |
| Singleton state leaks between test runs | High | 1 | Export `_resetSingleton()` from manager.ts; call in beforeEach AND afterEach in setup.ts |
| ESM `.js` extension errors | High | 1 | Set `"moduleResolution": "NodeNext"` in tsconfig; verify tsc --noEmit before Phase 3 — MITIGATED in Plan 1.2 |
| GCP NotFound error wrapping in v6 client | Medium | 6 | Use `(error as any).code === 5`; note gap — validate against real client or emulator |
| Loader cache using object identity not string key | Medium | 7 | Use composite string key: `` `${origin}:${gcpProjectId ?? ''}:${dotenvPath ?? ''}` `` |
| `null` written as string "null" to process.env | Medium | 7 | Guard: only write to process.env when coerced value is non-null |
| APP_ENV vs ENVIRONMENT variable name mismatch | High | 2 | Confirm in Python manager.py:199 during Phase 2 analysis; use APP_ENV in all TS tests |
| YAML 1.1 vs 1.2 schema divergence from Python PyYAML | Medium | 5 | Verify in Phase 2 which schema Python fixtures use; document in loadYaml() options |

---

## Open Questions

- [ ] Does `@google-cloud/secret-manager` v6 wrap NotFound errors differently than gRPC code-5 direct access? (Validate in Phase 6 against real client source or emulator)
- [x] Which YAML schema does PyYAML use for `yes`/`no` boolean parsing — 1.1 or 1.2? RESOLVED: All fixtures use YAML 1.2 constructs only (true/false, no yes/no). `yaml` npm default schema handles everything.
- [ ] Is `APP_ENV` confirmed as the exact environment variable name in Python `manager.py` (not `ENVIRONMENT`)? (Confirm in Phase 2 before writing any tests in Phase 3)

---

*Last updated: 2026-03-30 (after Plan 1.3 completion — Phase 1 complete)*
*Author: architect-agent*
