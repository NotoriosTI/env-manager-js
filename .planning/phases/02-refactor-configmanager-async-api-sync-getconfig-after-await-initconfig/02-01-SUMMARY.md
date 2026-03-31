---
phase: 02-refactor-configmanager-async-api-sync-getconfig-after-await-initconfig
plan: "01"
subsystem: testing
tags: [vitest, validation, configmanager, exports]
requires:
  - phase: 01-async-api-refactor
    provides: explicit async load lifecycle and retry-sensitive manager state
provides:
  - red regressions for old-format aggregate validation failures
  - red regressions for environment-format aggregate validation failures
  - public barrel/export coverage for ConfigValidationError instanceof behavior
affects: [phase-02-runtime-refactor, validation-diagnostics, public-api]
tech-stack:
  added: []
  patterns:
    - targeted red regressions aligned to plan verification filters
    - public barrel contract tests for exported error surfaces
key-files:
  created:
    - .planning/phases/02-refactor-configmanager-async-api-sync-getconfig-after-await-initconfig/02-01-SUMMARY.md
  modified:
    - tests/manager.test.ts
    - tests/resolution-validation.test.ts
    - tests/integration.test.ts
key-decisions:
  - "Locked aggregate validation expectations through test-only changes before runtime refactor work."
  - "Aligned new regression titles with the plan's Vitest filter so targeted red-test verification remains reliable."
patterns-established:
  - "Aggregate validation regressions assert structured issues, deterministic ordering, and preserved per-issue wording."
  - "Public API regressions exercise the barrel export directly rather than only manager-module imports."
requirements-completed: [VAL-01, VAL-02, VAL-03]
duration: 2 min
completed: 2026-03-31
---

# Phase 02 Plan 01: Aggregate validation red tests for old-format, environment-format, and public export surfaces

**Red Vitest coverage now locks aggregate validation failures, failed-load retry behavior, and the public ConfigValidationError export contract before the runtime refactor lands.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-31T15:36:50Z
- **Completed:** 2026-03-31T15:38:33Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added old-format regressions for aggregate strict/required missing failures, mixed missing-plus-invalid failures, and failed-load retry behavior on the same manager instance.
- Added environment-format regressions that require load-time aggregation with preserved per-issue environment/source context while excluding optional-null and default-backed paths from the aggregate.
- Added an integration regression proving consumers must be able to import `ConfigValidationError` from the public barrel and use it with `instanceof`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add old-format aggregate validation and retry-state regressions** - `794ad18` (test)
2. **Task 2: Add environment-format aggregate diagnostics and public export regressions** - `978f29f` (test)

## Files Created/Modified
- `tests/manager.test.ts` - Red regressions for old-format aggregate failures, invalid-value non-leakage, and retry after rejected load.
- `tests/resolution-validation.test.ts` - Red regressions for new-format aggregate missing/invalid diagnostics with context assertions and exclusion of non-fatal paths.
- `tests/integration.test.ts` - Public barrel/import regression for `ConfigValidationError` export and `instanceof` behavior.
- `.planning/phases/02-refactor-configmanager-async-api-sync-getconfig-after-await-initconfig/02-01-SUMMARY.md` - Execution summary for this plan.

## Decisions Made
- Locked the phase on red tests only; no runtime code was changed in this plan.
- Renamed new regression titles to include the plan's filter terms so the documented targeted Vitest commands select the intended cases.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- The first targeted Task 1 Vitest run returned a false green because the new test titles did not match the plan regex. Renaming the titles fixed the verification path and the targeted command then failed on the new aggregate expectations.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 02 runtime work now has explicit failing coverage for VAL-01, VAL-02, and VAL-03 across old-format, environment-format, and public export paths.
- The next plan can implement `ConfigValidationError`, aggregate load-time issue collection, and rejected-load retry cleanup against committed red tests.

## Self-Check: PASSED

- Found summary file: `.planning/phases/02-refactor-configmanager-async-api-sync-getconfig-after-await-initconfig/02-01-SUMMARY.md`
- Found commit: `794ad18`
- Found commit: `978f29f`

---
*Phase: 02-refactor-configmanager-async-api-sync-getconfig-after-await-initconfig*
*Completed: 2026-03-31*
