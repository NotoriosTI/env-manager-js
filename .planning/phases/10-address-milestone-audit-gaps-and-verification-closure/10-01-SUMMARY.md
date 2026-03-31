---
phase: 10-address-milestone-audit-gaps-and-verification-closure
plan: 10.1
subsystem: testing
tags: [vitest, regression, gcp, singleton, dotenv]
requires:
  - phase: 07-configmanager-singleton
    provides: ConfigManager resolution and singleton lifecycle behavior under test
  - phase: 09-fix-singleton-re-init-state-leakage
    provides: Existing singleton lifecycle regression surface extended by this plan
provides:
  - manager-driven GCP async contract regressions
  - reset/recreate loader-cache regression coverage
  - failing-before-fix evidence for Phase 10 runtime work
affects: [phase-10-runtime-fixes, verification, src/manager.ts, src/factory.ts]
tech-stack:
  added: []
  patterns: [tests-first audit closure, failing regression capture before runtime changes]
key-files:
  created: []
  modified:
    - tests/environment-integration.test.ts
    - tests/resolution-pipeline.test.ts
    - tests/manager.test.ts
key-decisions:
  - "Record Phase 10 audit gaps as executable regressions even when the task-level vitest runs fail before implementation."
  - "Use the real factory cache boundary through repeated init/reset/recreate flow instead of asserting private cache internals."
patterns-established:
  - "Audit-first regressions: add the smallest failing coverage that proves the live defect before touching runtime code."
  - "Reset lifecycle tests should verify stale data through observed values, not internal cache inspection."
requirements-completed: [RES-04]
duration: 4 min
completed: 2026-03-31
---

# Phase 10 Plan 10.1: Lock Audit Regressions For GCP And Reset Boundaries Summary

**Executable regressions now pin the manager-driven GCP async contract and the singleton reset loader-cache boundary before Phase 10 runtime fixes begin**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-31T05:08:00Z
- **Completed:** 2026-03-31T05:11:48Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added manager-driven GCP regression coverage that expects async loader results to resolve into real secret values instead of being treated as missing.
- Added per-variable `origin: gcp` regression coverage that fails on the current batch async mismatch in `ConfigManager`.
- Added reset/recreate lifecycle coverage that proves `_resetSingleton()` does not currently clear the loader cache boundary in `src/factory.ts`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add a manager-driven GCP regression that fails on async misuse** - `83ca03b` (test)
2. **Task 2: Add reset/recreate coverage for loader cache clearance** - `5048102` (test)

## Files Created/Modified
- `tests/environment-integration.test.ts` - Adds a manager-backed GCP regression that expects awaited async loader values for a required variable pinned to a GCP environment.
- `tests/resolution-pipeline.test.ts` - Adds per-variable GCP override regression coverage against async `getMany()` loader results.
- `tests/manager.test.ts` - Adds reset/recreate coverage that reuses the same dotenv path and proves stale loader snapshots survive `_resetSingleton()`.

## Decisions Made
- Record the audited failures as intentional red tests instead of widening this plan into runtime implementation.
- Exercise the reset bug through observable secret values read after `_resetSingleton()` rather than coupling the test to private factory cache storage.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `npx vitest run tests/environment-integration.test.ts tests/resolution-pipeline.test.ts` fails in the new regressions because `ConfigManager` treats async GCP loader results as missing and throws required-variable errors from `src/manager.ts:711`.
- `npx vitest run tests/manager.test.ts` fails in the new reset regression because the recreated manager still reads `first-secret`, showing the factory loader cache survives `_resetSingleton()`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 10 runtime work now has executable failing coverage for both audited gaps.
- The next implementation plan should fix `src/manager.ts` async handling and ensure `_resetSingleton()` clears the factory cache without relaxing these new tests.

## Self-Check
PASSED

- Verified summary file exists at `.planning/phases/10-address-milestone-audit-gaps-and-verification-closure/10-01-SUMMARY.md`.
- Verified task commits `83ca03b` and `5048102` exist in git history.

---
*Phase: 10-address-milestone-audit-gaps-and-verification-closure*
*Completed: 2026-03-31*
