---
phase: 02-python-analysis-behavioral-catalog
plan: "02"
subsystem: analysis
tags: [python, tests, behavioral-catalog, tdd]

requires:
  - phase: 02-01
    provides: Python source file knowledge (manager.py, utils.py, environment.py, loaders)
provides:
  - Complete test-level behavioral analysis of all 98 Python tests
  - Exact error message strings for JS port assertion parity
  - ENVIRONMENT vs APP_ENV discrepancy documented with root cause
  - conftest.py helper patterns and env var cleanup list
  - Test gap identification (maskSecret has zero tests)
affects: [02-04-behavioral-catalog, 03-write-all-tests]

tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified: []

key-decisions:
  - "JS port tests MUST use APP_ENV (not ENVIRONMENT) -- Python source uses APP_ENV at manager.py:199; Python tests use ENVIRONMENT which is stale after commit 52cd065"
  - "maskSecret has ZERO explicit test cases in Python -- JS port must write these from behavioral catalog"
  - "Python conftest.py uses pyproject.toml for root discovery -- JS port uses package.json (already confirmed in Plan 1.3)"
  - "Python conftest autouse fixture clears 20 specific env vars + resets _SINGLETON -- JS setup.ts already mirrors this"

patterns-established: []

requirements-completed: []

duration: 1min
completed: 2026-03-30
---

# Phase 2 Plan 2: Read All Python Test Files Summary

**Complete analysis of 98 Python tests across 12 test files + conftest.py, capturing exact assertion strings, env var patterns, and confirming the ENVIRONMENT/APP_ENV discrepancy as a stale-test bug**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-30T16:43:33Z
- **Completed:** 2026-03-30T16:44:29Z
- **Tasks:** 1 (analysis-only)
- **Files modified:** 0 (knowledge task)

## Accomplishments

- Read and analyzed all 13 Python test files (12 test + conftest.py)
- Verified exact test counts per file matching 02-RESEARCH.md: 98 total tests
- Confirmed ENVIRONMENT vs APP_ENV discrepancy with live test execution proving the bug
- Captured all error message strings used in pytest.raises and assertion patterns
- Identified maskSecret as having zero test coverage in Python suite

## Test Count Verification

| File | Count | Key Behaviors |
|------|-------|---------------|
| test_type_coercion.py | 7 | coerce_type: str, int, float, bool true/false, invalid bool, unsupported type |
| test_bool_to_string_coercion.py | 2 | YAML bool->str via ConfigManager (true/false), YAML int->str (8080) |
| test_environment.py | 17 | parse_environments: empty, local, gcp, missing origin, invalid origin, defaults, normalization, dataclass |
| test_environment_integration.py | 26 | Environment selection, backwards compat, param overrides, singleton, pinned env, origin override |
| test_loaders.py | 3 | DotEnvLoader read+override, GCPSecretLoader fetch+cache, GCP missing secret handling |
| test_manager.py | 9 | Local loading, missing required, optional defaults, strict mode, singleton, reinit warning, debug, deferred dotenv |
| test_optional_source.py | 6 | Default-only vars, source+default combos, mixed config, no source/no default raises |
| test_resolution_pipeline.py | 10 | Precedence: os.environ > dotenv > default; pinned env; origin override; dotenv_path override; absolute path |
| test_resolution_validation.py | 14 | Error messages with context, schema validation, GCP context, deferred dotenv errors |
| test_secret_origin_detection.py | 1 | SECRET_ORIGIN from .env file |
| test_validation.py | 1 | strict param override disables strict |
| test_end_to_end.py | 2 | Production GCP flow (skipped), mixed sources load |
| **Total** | **98** | |

## Critical Findings

### 1. ENVIRONMENT vs APP_ENV (VERIFIED with live test)

- Python source (manager.py:199): `os.environ.get("APP_ENV")`
- Python tests: all use `monkeypatch.setenv("ENVIRONMENT", ...)`
- Commit 52cd065 renamed ENVIRONMENT->APP_ENV in source but NOT in tests
- Live test run confirmed: `test_environment_var_selects_staging` FAILS (asserts staging, gets default)
- **JS port decision:** Use `APP_ENV` in all tests (matching current Python source behavior)

### 2. maskSecret Has ZERO Python Tests

- No test file exercises maskSecret/mask_secret directly
- test_manager.py::test_debug_parameter_disables_masking tests debug=True (raw output) but not the masking itself
- **JS port must write maskSecret tests from behavioral catalog analysis** (Plan 2.4 -> Plan 3.1)

### 3. conftest.py Analysis

**Env var cleanup list (20 vars):**
DB_PASSWORD, PORT, DEBUG_MODE, TIMEOUT, GCP_PROJECT_ID, SECRET_ORIGIN, API_KEY, OPTIONAL, WORKERS, ENVIRONMENT, DEFAULT_TOKEN, OVERRIDE_TOKEN, PINNED_SECRET, GCP_SECRET, SHARED_TOKEN, OVERRIDDEN_TOKEN, LOCAL_ONLY_TOKEN, OPTIONAL_TOKEN, API_TOKEN, PROD_LOCAL_TOKEN

**Helper signatures:**
- `write_config(tmp_path: Path, yaml_text: str) -> Path` -- writes dedented YAML to tmp_path/config.yaml
- `write_env(tmp_path: Path, content: str = "DB_PASSWORD=secret123\n") -> Path` -- writes to tmp_path/.env
- `write_repo_config(repo_root: Path, yaml_text: str) -> Path` -- creates pyproject.toml + config/ dir + config.yaml

**Autouse fixture pattern:**
- `clear_env` is autouse, runs before+after each test
- Before: sets `_SINGLETON = None`, deletes 20 env vars via monkeypatch
- After (yield): sets `_SINGLETON = None` again

**Root discovery:** `write_repo_config` creates `pyproject.toml` for Python root discovery; JS port equivalent creates `package.json`

### 4. Exact Error Message Strings (for JS assertion parity)

**pytest.raises match strings:**
- `test_environment.py`: `match="staging"`, `match="dev"`, `match="production"`, `match="environments"`, `match="broken"`
- `test_environment_integration.py`: `match="unknown"`, `match="DB_PASSWORD"`, `match="API_TOKEN"`
- `test_optional_source.py`: `match="must define either 'source' or 'default'"`
- `test_resolution_validation.py`: `match="DB_PASSWORD"`

**assert "..." in str(exc) patterns:**
- `"Invalid boolean value"` (test_type_coercion.py)
- `"Unsupported type"` (test_type_coercion.py)
- `"Required variable 'DB_PASSWORD' not found"` (test_manager.py)
- `"Strict mode:"` + `"DB_PASSWORD"` (test_manager.py)
- `"Configuration manager already initialised"` (test_manager.py -- stdout, not exception)
- `"Loaded DB_PASSWORD: password123"` (test_manager.py -- stdout, debug mode)
- `"Required variable 'API_KEY' not found"` + `"environment 'default'"` + absolute path (test_resolution_validation.py)
- `"Required variable 'API_KEY' missing from source; using YAML default"` (test_resolution_validation.py)
- `"Optional variable 'OPTIONAL_TOKEN' resolved to None"` + `"environment 'default'"` (test_resolution_validation.py)
- `"Optional variable 'OPTIONAL_TOKEN'"` NOT in output (test_resolution_validation.py -- quiet case)
- `"Strict mode"` + `"OPTIONAL_TOKEN"` (test_resolution_validation.py)
- `"environment 'default'"` + `"GCP project 'app-prod'"` (test_resolution_validation.py -- GCP context)
- `"environment 'default'"` + absolute path (test_manager.py -- deferred dotenv)
- `"Variable 'API_TOKEN'"` + `"typo"` + available envs (test_environment_integration.py)
- `"Variable 'API_TOKEN'"` + `"origin"` + `"vault"` (test_environment_integration.py)
- `"variables"` + `"mapping"` (test_resolution_validation.py)
- `"validation"` + `"mapping"` (test_resolution_validation.py)
- `"dotenv_path"` (test_resolution_validation.py -- empty dotenv_path)
- `"source"` (test_resolution_validation.py -- non-string source)
- `"environment"` (test_resolution_validation.py -- empty environment override)
- `"Secret 'MISSING' not found in GCP project 'project-123'."` (test_loaders.py -- stdout)

### 5. GCP Loader Test Pattern

- Uses `mocker.Mock()` (pytest-mock) not monkeypatch
- Patches `env_manager.loaders.gcp.secretmanager.SecretManagerServiceClient`
- NotFound: uses `google.api_core.exceptions.NotFound("missing")` -- this is NOT a gRPC code-5 error, it's a google-cloud library exception
- Loader returns `None` for missing secrets, prints warning to stdout
- Cache test: `assert_called_once()` after two `.get()` calls

### 6. Test Patterns Not Exercised (Gaps for JS Port)

1. **maskSecret** -- zero direct tests
2. **loadYaml** -- no direct tests (only tested indirectly via ConfigManager)
3. **coerceType with null input** -- not tested (null passthrough behavior)
4. **coerceType with boolean input** -- only tested via ConfigManager (test_bool_to_string_coercion.py), not directly
5. **DotEnvLoader with missing file** -- deferred error only tested via ConfigManager integration
6. **Factory cache hit** -- not directly tested (only via integration)

## Decisions Made

- **JS port uses APP_ENV:** Python source uses APP_ENV (manager.py:199); Python tests use stale ENVIRONMENT variable. JS tests must use APP_ENV to match actual behavior.
- **maskSecret needs tests from scratch:** Zero Python test coverage means JS port must derive test cases from the `mask_secret` function code in utils.py.
- **Error message strings captured verbatim:** All assertion strings documented above for exact parity in JS test assertions.
- **conftest cleanup list confirmed:** 20 env vars, already mirrored in tests/setup.ts from Plan 1.3.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ENVIRONMENT vs APP_ENV verified with live test execution**
- **Found during:** Task 2.2.1 (reading test files)
- **Issue:** Plan asked to "confirm Python tests set ENVIRONMENT (not APP_ENV)" but the significance was unclear. Live test execution proved the tests are genuinely broken.
- **Fix:** Ran `uv run pytest test_environment_var_selects_staging` to confirm failure (asserts staging, gets default). This proves the env var mismatch is a real bug, not just naming confusion.
- **Verification:** Test output shows `AssertionError: assert 'default' == 'staging'`
- **Impact:** JS port MUST use APP_ENV; any test ported from Python that sets ENVIRONMENT must be changed to APP_ENV.

---

**Total deviations:** 1 auto-fixed (1 bug verification)
**Impact on plan:** Confirms a critical finding. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 2.2 complete (test files read)
- Ready for Plan 2.3 (read Python test fixtures)
- All error message strings and test patterns captured for behavioral catalog (Plan 2.4)

---
*Phase: 02-python-analysis-behavioral-catalog*
*Completed: 2026-03-30*
