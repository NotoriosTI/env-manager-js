---
phase: 02-refactor-configmanager-async-api-sync-getconfig-after-await-initconfig
plan: "02"
subsystem: config
tags: [typescript, vitest, validation, dotenv, configmanager]
requires:
  - phase: 02-01
    provides: red regression coverage for aggregate validation diagnostics
provides:
  - exported ConfigValidationError and ConfigValidationIssue contract
  - aggregate load-time validation for old and environment-based configs
  - retry-safe load attempts without partial _values or process.env writes
affects: [validation-diagnostics, public-api, tests]
tech-stack:
  added: []
  patterns: [staged load commits, aggregate validation issues, retry-safe loader resets]
key-files:
  created: []
  modified:
    - src/types.ts
    - src/index.ts
    - src/manager.ts
    - tests/manager.test.ts
    - tests/resolution-validation.test.ts
    - tests/integration.test.ts
    - tests/environment-integration.test.ts
key-decisions:
  - "Stage _values and process.env writes until load() completes so failed attempts do not poison retries."
  - "Keep per-variable missing dotenv overrides deferred to get() while aggregating true load-time missing and invalid failures."
patterns-established:
  - "Aggregate validation uses stable issue objects with coarse missing|invalid classification."
  - "Load retries reset loader cache and loading state before each new attempt."
requirements-completed: [VAL-01, VAL-02, VAL-03]
duration: 5min
completed: 2026-03-31
---

# Phase 02 Plan 02: Aggregate Validation Runtime Summary

**Exported ConfigValidationError diagnostics with aggregate load-time missing and invalid issue reporting across both config formats**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-31T15:42:00Z
- **Completed:** 2026-03-31T15:47:21Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- Added a public `ConfigValidationIssue` type and `ConfigValidationError` class that consumers can inspect and `instanceof`-check.
- Refactored `load()` to collect fatal missing and invalid issues deterministically for old-format and environment-based configs.
- Preserved deferred per-variable dotenv lookup failures while making rejected load attempts retry-safe and free of partial state writes.

## Task Commits

Each task was committed atomically:

1. **Task 1: Define the exported aggregate validation contract** - `f5acb16` (feat)
2. **Task 2: Refactor load() to collect fatal issues and clear retry state on failure** - `532cbf6` (fix)
3. **Task 3: Refresh assertions and run the full regression gate** - `9ad8884` (test)

**Plan metadata:** pending

## Files Created/Modified
- `src/types.ts` - public aggregate validation issue typing
- `src/index.ts` - public barrel export for `ConfigValidationError`
- `src/manager.ts` - staged load attempts, aggregate issue collection, and retry-safe state reset
- `tests/manager.test.ts` - old-format load-time aggregate validation assertions
- `tests/resolution-validation.test.ts` - environment-context aggregate validation assertions
- `tests/integration.test.ts` - public export and load-time rejection coverage
- `tests/environment-integration.test.ts` - backwards-compat assertion aligned with the aggregate error contract

## Decisions Made
- Staged `_values` and `process.env` writes inside a load attempt so rejected loads do not leave partial state behind.
- Kept missing per-variable dotenv override errors deferred to `get()` to preserve the existing explicit-file behavior outside true load failures.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reset loader cache between load retries**
- **Found during:** Task 2 (Refactor load() to collect fatal issues and clear retry state on failure)
- **Issue:** Retrying `load()` after fixing a dotenv file still reused the stale cached loader snapshot from the failed attempt.
- **Fix:** Cleared the loader cache at the start of each load attempt.
- **Files modified:** `src/manager.ts`
- **Verification:** `npx vitest run tests/manager.test.ts tests/resolution-validation.test.ts tests/integration.test.ts -t "ConfigValidationError aggregates|retry load\\(\\) on the same manager after a rejected old-format attempt|missing per-variable dotenv raises only when lookup needs file|ConfigValidationError is exported from the public barrel for instanceof checks"`
- **Committed in:** `532cbf6`

**2. [Rule 1 - Bug] Updated one extra compatibility test outside the plan file list**
- **Found during:** Task 3 (Refresh assertions and run the full regression gate)
- **Issue:** `tests/environment-integration.test.ts` still asserted the old single-error load message, causing the full `npm test` gate to fail.
- **Fix:** Aligned the assertion with the aggregate `ConfigValidationError` contract.
- **Files modified:** `tests/environment-integration.test.ts`
- **Verification:** `npm test`
- **Committed in:** `9ad8884`

---

**Total deviations:** 2 auto-fixed (2 bug fixes)
**Impact on plan:** Both fixes were required for correctness and full-suite parity. No architectural scope change.

## Issues Encountered
- The first runtime pass incorrectly treated all environment-based missing values as load failures; narrowing the logic to true fatal misses and explicit deferred dotenv overrides restored parity.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Aggregate validation diagnostics are implemented and covered by the full regression suite.
- The public error contract is stable for follow-on validation or accessor work in later phases.

## Self-Check
PASSED

- FOUND: `.planning/phases/02-refactor-configmanager-async-api-sync-getconfig-after-await-initconfig/02-02-SUMMARY.md`
- FOUND: `f5acb16`
- FOUND: `532cbf6`
- FOUND: `9ad8884`

---
*Phase: 02-refactor-configmanager-async-api-sync-getconfig-after-await-initconfig*
*Completed: 2026-03-31*
