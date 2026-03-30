---
phase: 04-type-stubs
plan: 02
subsystem: api
tags: [typescript, esm, type-stubs, public-api, vitest]
requires:
  - phase: 04-type-stubs
    provides: null-aware shared contracts in `src/types.ts`
provides:
  - Stubbed utility, environment, loader, factory, manager, and package-barrel modules under `src/`
  - Full Phase 4 public export surface with `.js`-suffixed internal imports
  - Verification that Vitest now fails on stub runtime paths instead of missing module/export errors
affects: [05-core-implementation, 06-loaders-factory, 07-configmanager-singleton, 08-integration-verification-publish]
tech-stack:
  added: []
  patterns: [stub-first module surface, named export spy seam for createLoader, safe singleton reset helper]
key-files:
  created: [src/utils.ts, src/environment.ts, src/loaders/dotenv.ts, src/loaders/gcp.ts, src/loaders/index.ts, src/factory.ts]
  modified: [src/manager.ts, src/index.ts, tests/environment-integration.test.ts]
key-decisions:
  - "Every new runtime stub throws `Not implemented`, except `_resetSingleton()` which remains a safe reset hook for test setup."
  - "The package barrel re-exports the full public surface now so later implementation phases can fill behavior without changing import contracts."
patterns-established:
  - "Internal source imports keep explicit `.js` suffixes to stay aligned with NodeNext ESM resolution."
  - "Factory remains a named export seam so tests can spy on `createLoader`."
requirements-completed: [compiler-contract]
duration: 5min
completed: 2026-03-30
---

# Phase 4 Plan 2: Module stubs Summary

**Full Phase 4 `src/` stub surface for utils, environment parsing, loaders, factory, manager singleton, and the package API barrel**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-30T19:44:00Z
- **Completed:** 2026-03-30T19:48:43Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Added the missing non-manager source modules so every Phase 3 direct import resolves under `src/`.
- Expanded `src/manager.ts` and `src/index.ts` into the full stubbed public API surface while keeping `_resetSingleton()` safe for test setup.
- Verified both targeted and full Vitest runs now fail on `Not implemented` runtime paths rather than missing modules or missing exports.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create utility, environment, loader, and factory stubs** - `03f5a9e` (feat)
2. **Task 2: Expand manager.ts and index.ts into the full public stub surface** - `c7c6dca` (feat)

## Files Created/Modified
- `src/utils.ts` - Stub exports for `coerceType`, `maskSecret`, and `loadYaml`.
- `src/environment.ts` - Stub export for `parseEnvironments`.
- `src/loaders/dotenv.ts` - `DotEnvLoader` class stub with null-aware sync signatures.
- `src/loaders/gcp.ts` - `GCPSecretLoader` class stub with null-aware async signatures.
- `src/loaders/index.ts` - Loader barrel exports.
- `src/factory.ts` - Named `createLoader` stub and context shape used by tests.
- `src/manager.ts` - Stubbed `ConfigManager`, singleton helpers, and safe `_resetSingleton()`.
- `src/index.ts` - Public package barrel re-exporting manager, helpers, loaders, factory, and shared types.
- `tests/environment-integration.test.ts` - Added the missing `ConfigManager` import so verification reaches stub failures instead of a `ReferenceError`.

## Decisions Made
- Kept runtime stubs intentionally shallow: preserve signatures and export names now, defer all real behavior to later implementation phases.
- Left `_resetSingleton()` as the only non-throwing manager entry point because `tests/setup.ts` calls it before and after every test.
- Re-exported shared types from `src/index.ts` now so the public API contract is fixed before implementation work begins.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed missing `ConfigManager` import in environment integration test**
- **Found during:** Task 2 (Expand manager.ts and index.ts into the full public stub surface)
- **Issue:** `tests/environment-integration.test.ts` referenced `ConfigManager` without importing it, producing `ReferenceError: ConfigManager is not defined` during verification.
- **Fix:** Added the missing named import from `../src/manager.js`.
- **Files modified:** `tests/environment-integration.test.ts`
- **Verification:** Targeted and full Vitest verification no longer report the reference error; failures land on `Not implemented` stub paths.
- **Committed in:** `c7c6dca` (part of task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix was required to validate the stubbed source surface as intended. No scope creep.

## Issues Encountered

None beyond the blocking verification issue documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 5 can now replace stub logic in `src/utils.ts` and `src/environment.ts` without changing the public/import contract.
- Phase 6 and Phase 7 can implement loaders, factory, and manager behavior against a stable stubbed source graph.

## Self-Check: PASSED

- Verified `.planning/phases/04-type-stubs/04-02-SUMMARY.md` exists.
- Verified task commits `03f5a9e` and `c7c6dca` exist in git history.
- Verified all Phase 4 stub source files exist under `src/`.

---
*Phase: 04-type-stubs*
*Completed: 2026-03-30*
