# Requirements: env-manager-js

**Defined:** 2026-03-30
**Core Value:** Behavior-identical TypeScript port of the Python env-manager library

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Core Utilities

- [x] **UTIL-01**: `coerceType` converts string values to str/int/float/bool with exact Python semantics
- [x] **UTIL-02**: `coerceType` handles null input by returning null immediately
- [x] **UTIL-03**: `coerceType` handles YAML auto-converted booleans (true/false → "true"/"false" for type: str)
- [x] **UTIL-04**: `coerceType` handles YAML auto-converted numbers (8080 → "8080" for type: str)
- [x] **UTIL-05**: `coerceType` throws on invalid boolean values (e.g., "yes") with exact error message
- [x] **UTIL-06**: `coerceType` throws on unsupported types (e.g., "date") with exact error message
- [x] **UTIL-07**: `maskSecret` masks short values (<10 chars) with 10 asterisks
- [x] **UTIL-08**: `maskSecret` masks long values showing first 2 and last 4 chars
- [x] **UTIL-09**: `loadYaml` loads YAML config file and validates root is a mapping
- [x] **UTIL-10**: `loadYaml` throws on missing file with exact error message

### Environment Parsing

- [x] **ENV-01**: `parseEnvironments` returns empty object when no environments key
- [x] **ENV-02**: `parseEnvironments` parses valid local environment with dotenv_path
- [x] **ENV-03**: `parseEnvironments` parses valid GCP environment with gcp_project_id
- [x] **ENV-04**: `parseEnvironments` throws on missing origin with env name in message
- [x] **ENV-05**: `parseEnvironments` throws on invalid origin with env name in message
- [x] **ENV-06**: Local origin defaults dotenv_path to ".env"
- [x] **ENV-07**: GCP origin requires gcp_project_id (throws if missing)
- [x] **ENV-08**: GCP ignores dotenv_path, local ignores gcp_project_id
- [x] **ENV-09**: Origin is normalized to lowercase
- [x] **ENV-10**: `default: true` marker works, multiple defaults throws
- [x] **ENV-11**: `environments` as array or individual env as string throws
- [x] **ENV-12**: Multiple environments parse independently

### Loaders

- [ ] **LOAD-01**: DotEnvLoader reads KEY=VALUE from .env file
- [ ] **LOAD-02**: DotEnvLoader returns null for missing keys
- [ ] **LOAD-03**: DotEnvLoader getMany returns dict with present and missing keys
- [ ] **LOAD-04**: process.env overrides .env file values in DotEnvLoader
- [ ] **LOAD-05**: GCPSecretLoader fetches and decodes UTF-8 secret payload
- [ ] **LOAD-06**: GCPSecretLoader caches — second get does not call API again
- [ ] **LOAD-07**: GCPSecretLoader returns null and logs warning for NotFound
- [ ] **LOAD-08**: Loader factory creates correct loader by origin string
- [ ] **LOAD-09**: Loader factory caches instances by (origin, gcpProjectId, dotenvPath)

### Resolution Pipeline

- [ ] **RES-01**: process.env beats active environment dotenv
- [ ] **RES-02**: Active environment dotenv used when process.env missing
- [ ] **RES-03**: Falls back to YAML default after env and dotenv
- [x] **RES-04**: Per-variable `origin: gcp` override uses GCP loader while active env is local
- [ ] **RES-05**: process.env beats pinned environment lookup
- [ ] **RES-06**: Variables without overrides keep active environment behavior
- [ ] **RES-07**: Per-variable `dotenv_path` override uses project-root-relative path
- [ ] **RES-08**: Absolute `dotenv_path` loads from that exact file
- [ ] **RES-09**: Pinned environment without other overrides uses environment defaults
- [ ] **RES-10**: `origin: local` + `dotenv_path` override independent of active GCP environment
- [ ] **RES-11**: Default-only variables (no source) resolve from YAML without creating a loader
- [ ] **RES-12**: Default-only variables ignore same-named process.env values
- [ ] **RES-13**: Variable with source + default uses loader value when present
- [ ] **RES-14**: Variable with source + default falls back to default when source missing
- [ ] **RES-15**: Variable with neither source nor default throws
- [ ] **RES-16**: Deferred dotenv error — missing .env file only throws when variable needs it

### Validation & Messages

- [ ] **VAL-01**: Missing required variable throws with exact Python error message format
- [ ] **VAL-02**: Required variable with default warns with "using YAML default" message
- [ ] **VAL-03**: Optional missing without default warns "resolved to None" with env context
- [ ] **VAL-04**: Optional with default is quiet (no warning)
- [ ] **VAL-05**: Strict mode throws on ANY missing with "Strict mode:" prefix
- [ ] **VAL-06**: Strict mode: constructor param overrides YAML strict setting
- [ ] **VAL-07**: GCP context in messages includes "GCP project 'X'"
- [ ] **VAL-08**: Schema validation: empty dotenv_path throws with variable name
- [ ] **VAL-09**: Schema validation: non-string source throws with variable name
- [ ] **VAL-10**: Schema validation: empty environment throws with variable name
- [ ] **VAL-11**: Schema validation: variables as list throws with "mapping"
- [ ] **VAL-12**: Schema validation: validation as string throws with "mapping"
- [ ] **VAL-13**: Variable schema validation runs during load(), not constructor

### Manager & Singleton

- [x] **MGR-01**: ConfigManager loads local .env, coerces types, writes process.env
- [x] **MGR-02**: Singleton API: initConfig/getConfig/requireConfig work correctly
- [x] **MGR-03**: Re-init logs warning "Configuration manager already initialised"
- [ ] **MGR-04**: requireConfig throws when singleton not initialized
- [ ] **MGR-05**: Debug mode disables masking (logs show raw values)
- [ ] **MGR-06**: APP_ENV selects active environment
- [ ] **MGR-07**: APP_ENV unset falls back to default environment
- [ ] **MGR-08**: APP_ENV=unknown throws with available environments listed
- [ ] **MGR-09**: No default environment + no APP_ENV → activeEnvironment is null
- [ ] **MGR-10**: Old format (no environments) works with process.env > dotenv > YAML default
- [ ] **MGR-11**: Constructor param overrides beat environment config
- [ ] **MGR-12**: Project root discovery walks up looking for package.json
- [ ] **MGR-13**: SECRET_ORIGIN and GCP_PROJECT_ID detected from .env file
- [ ] **MGR-14**: Write-back to process.env always as string
- [x] **MGR-15**: Missing active environment dotenv deferred when process.env has value
- [x] **MGR-16**: Missing active environment dotenv raises with absolute path when lookup needed

### Package & Setup

- [ ] **PKG-01**: Project initialized with TypeScript, Vitest, ESM configuration
- [x] **PKG-02**: All tests written before implementation (TDD)
- [x] **PKG-03**: npm publish-ready package.json with exports, types, files
- [x] **PKG-04**: Public API exports match Python's __init__.py

## v2 Requirements

### Cloud Provider Expansion

- **CLOUD-01**: AWS Secrets Manager loader
- **CLOUD-02**: Azure Key Vault loader
- **CLOUD-03**: HashiCorp Vault loader

### Developer Experience

- **DX-01**: CLI for subprocess injection (env-cmd style)
- **DX-02**: Variable interpolation/expansion

## Out of Scope

| Feature | Reason |
|---------|--------|
| Browser/client-side support | process.env is Node.js-only, GCP SDK is server-side, security risk |
| Schema validation via Zod | Python uses YAML + runtime validation, adding Zod diverges from behavior parity |
| Auto-reload on file change | Race conditions, not in Python version |
| Performance optimizations | Match Python behavior first, optimize later |
| New features not in Python | Behavior-preserving port constraint |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| UTIL-01 | Phase 5 | Not started |
| UTIL-02 | Phase 5 | Not started |
| UTIL-03 | Phase 5 | Not started |
| UTIL-04 | Phase 5 | Not started |
| UTIL-05 | Phase 5 | Not started |
| UTIL-06 | Phase 5 | Not started |
| UTIL-07 | Phase 5 | Not started |
| UTIL-08 | Phase 5 | Not started |
| UTIL-09 | Phase 5 | Not started |
| UTIL-10 | Phase 5 | Not started |
| ENV-01 | Phase 5 | Complete |
| ENV-02 | Phase 5 | Complete |
| ENV-03 | Phase 5 | Complete |
| ENV-04 | Phase 5 | Complete |
| ENV-05 | Phase 5 | Complete |
| ENV-06 | Phase 5 | Complete |
| ENV-07 | Phase 5 | Complete |
| ENV-08 | Phase 5 | Complete |
| ENV-09 | Phase 5 | Complete |
| ENV-10 | Phase 5 | Complete |
| ENV-11 | Phase 5 | Complete |
| ENV-12 | Phase 5 | Complete |
| LOAD-01 | Phase 6 | Not started |
| LOAD-02 | Phase 6 | Not started |
| LOAD-03 | Phase 6 | Not started |
| LOAD-04 | Phase 6 | Not started |
| LOAD-05 | Phase 6 | Not started |
| LOAD-06 | Phase 6 | Not started |
| LOAD-07 | Phase 6 | Not started |
| LOAD-08 | Phase 6 | Not started |
| LOAD-09 | Phase 6 | Not started |
| RES-01 | Phase 7 | Not started |
| RES-02 | Phase 7 | Not started |
| RES-03 | Phase 7 | Not started |
| RES-04 | Phase 7 | Complete |
| RES-05 | Phase 7 | Not started |
| RES-06 | Phase 7 | Not started |
| RES-07 | Phase 7 | Not started |
| RES-08 | Phase 7 | Not started |
| RES-09 | Phase 7 | Not started |
| RES-10 | Phase 7 | Not started |
| RES-11 | Phase 7 | Not started |
| RES-12 | Phase 7 | Not started |
| RES-13 | Phase 7 | Not started |
| RES-14 | Phase 7 | Not started |
| RES-15 | Phase 7 | Not started |
| RES-16 | Phase 7 | Not started |
| VAL-01 | Phase 7 | Not started |
| VAL-02 | Phase 7 | Not started |
| VAL-03 | Phase 7 | Not started |
| VAL-04 | Phase 7 | Not started |
| VAL-05 | Phase 7 | Not started |
| VAL-06 | Phase 7 | Not started |
| VAL-07 | Phase 7 | Not started |
| VAL-08 | Phase 7 | Not started |
| VAL-09 | Phase 7 | Not started |
| VAL-10 | Phase 7 | Not started |
| VAL-11 | Phase 7 | Not started |
| VAL-12 | Phase 7 | Not started |
| VAL-13 | Phase 7 | Not started |
| MGR-01 | Phase 7 | Complete |
| MGR-02 | Phase 7 | Complete |
| MGR-03 | Phase 7 | Complete |
| MGR-04 | Phase 7 | Not started |
| MGR-05 | Phase 7 | Not started |
| MGR-06 | Phase 7 | Not started |
| MGR-07 | Phase 7 | Not started |
| MGR-08 | Phase 7 | Not started |
| MGR-09 | Phase 7 | Not started |
| MGR-10 | Phase 7 | Not started |
| MGR-11 | Phase 7 | Not started |
| MGR-12 | Phase 7 | Not started |
| MGR-13 | Phase 7 | Not started |
| MGR-14 | Phase 7 | Not started |
| MGR-15 | Phase 7 | Complete |
| MGR-16 | Phase 7 | Complete |
| PKG-01 | Phase 1 | Not started |
| PKG-02 | Phase 3 | Complete |
| PKG-03 | Phase 8 | Complete |
| PKG-04 | Phase 8 | Complete |

**Coverage:**
- v1 requirements: 68 total
- Mapped to phases: 68
- Unmapped: 0

---
*Requirements defined: 2026-03-30*
*Last updated: 2026-03-31 — traceability refreshed after Plan 10.2 runtime audit closure updates*
