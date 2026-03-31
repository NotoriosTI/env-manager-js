---
phase: 09-fix-singleton-re-init-state-leakage
plan: 01
subsystem: testing
tags: [vitest, singleton, regression, process-env]
requires:
  - phase: 07-configmanager-singleton
    provides: singleton API, `_resetSingleton()`, and manager test coverage baseline
  - phase: 08-integration-verification-publish
    provides: published singleton surface and recorded divergence context for follow-up fixes
provides:
  - re-init singleton identity regression coverage
  - re-init process.env leakage regression coverage
  - expected-red evidence for the current singleton replacement bug
affects: [src/manager.ts, tests/manager.test.ts, phase-09-plan-02]
tech-stack:
  added: []
  patterns: [observable singleton regression assertions, warning-plus-state contract coverage]
key-files:
  created: [.planning/phases/09-fix-singleton-re-init-state-leakage/09-01-SUMMARY.md]
  modified: [tests/manager.test.ts]
key-decisions:
  - "Lock the re-init regression through public identity and state assertions instead of constructor spies."
patterns-established:
  - "Singleton regression tests should prove identity retention, retained loaded values, and no second-init process.env writes."
requirements-completed: [MGR-02, MGR-03]
duration: 3 min
completed: 2026-03-31
---

# Phase 9 Plan 1: Add Singleton Re-init Regression Coverage Summary

**Vitest coverage now proves repeated `initConfig()` calls must preserve the original singleton and avoid second-config `process.env` leakage**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-31T04:31:00Z
- **Completed:** 2026-03-31T04:33:08Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added a focused regression test in `tests/manager.test.ts` for repeated `initConfig()` calls with different config and dotenv inputs.
- Locked the expected singleton contract with object identity, retained `DB_PASSWORD` resolution, and absence of `SECOND_ONLY` leakage into `process.env`.
- Captured the expected-red verification output showing the current implementation still replaces the singleton after warning.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add a failing regression test for re-init identity and state stability** - `03655f3` (test)

## Files Created/Modified

- `.planning/phases/09-fix-singleton-re-init-state-leakage/09-01-SUMMARY.md` - plan execution summary, decisions, and verification record
- `tests/manager.test.ts` - singleton re-init regression that asserts identity retention and state stability

## Decisions Made

- Locked the bug through observable behavior assertions instead of constructor/helper spies so the test remains implementation-agnostic and directly reflects the public singleton contract.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `npx vitest run tests/manager.test.ts` failed as intended because `initConfig()` still returns a different `ConfigManager` instance and loads `SECOND_ONLY` from the second config.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 9.2 can now change `src/manager.ts` against a concrete failing regression.
- The failure output clearly shows both identity replacement and second-init state leakage, so the implementation fix has direct acceptance criteria.

## Self-Check

PASSED

- Found `.planning/phases/09-fix-singleton-re-init-state-leakage/09-01-SUMMARY.md`
- Found task commit `03655f3`

---
*Phase: 09-fix-singleton-re-init-state-leakage*
*Completed: 2026-03-31*
