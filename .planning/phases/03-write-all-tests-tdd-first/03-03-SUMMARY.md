---
phase: 03-write-all-tests-tdd-first
plan: 03
subsystem: testing
tags: [vitest, tdd, dotenv, gcp, secret-manager]
requires:
  - phase: 02-python-analysis-behavioral-catalog
    provides: loader behavior notes, GCP NotFound mapping, and dotenv parsing guidance
provides:
  - DotEnvLoader unit tests covering file reads, nulls, process.env precedence, and getMany behavior
  - GCPSecretLoader unit tests covering UTF-8 secret fetch caching and NotFound warning behavior
affects: [phase-04-type-stubs, phase-06-loaders-factory]
tech-stack:
  added: []
  patterns: [vi.hoisted Secret Manager client mock, real tmpDir .env fixtures, ESM .js future-entrypoint imports]
key-files:
  created:
    - tests/loaders.test.ts
    - .planning/phases/03-write-all-tests-tdd-first/03-03-SUMMARY.md
  modified: []
key-decisions:
  - "Used vi.hoisted() to keep the Secret Manager mock client compatible with Vitest's hoisted vi.mock factory."
  - "Kept loader imports pointed at future .js ESM entrypoints so Phase 4 and Phase 6 must satisfy the public contract directly."
patterns-established:
  - "DotEnvLoader tests create a real .env file in a fresh tmpDir for each assertion."
  - "GCP NotFound behavior is modeled with Error objects carrying code: 5 and console.warn spying."
requirements-completed: [PKG-02]
duration: 4m 06s
completed: 2026-03-30
---

# Phase 3 Plan 3: Loader Tests Summary

**Loader test contracts for DotEnvLoader file parsing and GCPSecretLoader cache and missing-secret behavior**

## Performance

- **Duration:** 4m 06s
- **Started:** 2026-03-30T18:24:20Z
- **Completed:** 2026-03-30T18:28:26Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Added 4 DotEnvLoader cases covering `.env` reads, missing-key nulls, `process.env` precedence, and `getMany()` mapping behavior.
- Added 2 GCPSecretLoader cases covering UTF-8 secret fetch caching and NotFound warning behavior.
- Locked the required `vi.hoisted()` + `vi.mock('@google-cloud/secret-manager', ...)` pattern for future loader implementation work.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write tests/loaders.test.ts** - `4797256` (test)

## Files Created/Modified
- `tests/loaders.test.ts` - loader test contracts for DotEnvLoader and GCPSecretLoader.
- `.planning/phases/03-write-all-tests-tdd-first/03-03-SUMMARY.md` - execution record for Plan 03-03.

## Decisions Made

- Used a hoisted Secret Manager mock client so the test file satisfies Vitest's module-mocking rules while still letting each test reset and reprogram `accessSecretVersion`.
- Preserved `.js` imports to future loader modules so the tests define the public ESM contract before Phase 4 stubs and Phase 6 implementation exist.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `npx vitest run tests/loaders.test.ts` fails immediately on missing `src/loaders/dotenv.js`, which is expected until Phase 4 creates stubs for the loader modules referenced by this test file.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 4 can now add loader stubs against a fixed contract that already encodes the required `.js` public entrypoints.
- Phase 6 can implement loader behavior directly against the locked tmpDir dotenv fixture pattern and the hoisted GCP Secret Manager mock shape.

## Self-Check: PASSED

- Found `.planning/phases/03-write-all-tests-tdd-first/03-03-SUMMARY.md`
- Found commit `4797256`

---
*Phase: 03-write-all-tests-tdd-first*
*Completed: 2026-03-30*
