---
phase: 04-type-stubs
plan: 01
subsystem: api
tags: [typescript, esm, compiler-contract, type-stubs]
requires:
  - phase: 03-write-all-tests-tdd-first
    provides: immutable Vitest coverage that fixes the public contract this plan must satisfy
provides:
  - Null-aware shared type surface in `src/types.ts`
  - Exact option/context keys for `secretOrigin`, `gcpProjectId`, and `dotenvPath`
  - Compiler-enforced `string | null` loader/result contract for downstream stubs
affects: [04-02, 05-core-implementation, 06-loaders-factory, 07-configmanager-singleton]
tech-stack:
  added: []
  patterns: [centralized shared interfaces, null-over-undefined public contract, ESM .js import-ready type exports]
key-files:
  created: [src/types.ts]
  modified: []
key-decisions:
  - "Public missing-value paths stay null-aware in shared types so later implementations cannot leak undefined."
  - "Factory and manager-facing context keys remain camelCase as secretOrigin, gcpProjectId, and dotenvPath to match tests."
patterns-established:
  - "Shared contracts live in src/types.ts and contain no runtime logic."
  - "Loader interfaces support sync or async implementations while preserving string-or-null results."
requirements-completed: [compiler-contract]
duration: 4min
completed: 2026-03-30
---

# Phase 4 Plan 1: Core types Summary

**Null-aware shared TypeScript contracts for loaders, environments, variable definitions, and manager options in `src/types.ts`**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-30T19:42:39Z
- **Completed:** 2026-03-30T19:46:39Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added `src/types.ts` as the shared compiler contract for Phase 4.
- Defined the required exports: `SecretLoader`, `EnvironmentConfig`, `VariableDefinition`, `ValidationConfig`, `SourceContext`, and `ConfigManagerOptions`.
- Locked the public null contract around loader values and environment metadata before module stubs and implementations.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/types.ts with the null-aware shared contract** - `eaf5539` (feat)

## Files Created/Modified
- `src/types.ts` - Shared Phase 4 type surface for loaders, environments, variable metadata, validation, source context, and manager options.

## Decisions Made
- Used `string | null` for public missing-value paths in loader and environment-facing contracts.
- Kept the test-visible override keys as `secretOrigin`, `gcpProjectId`, and `dotenvPath` in shared option/context types.
- Allowed `SecretLoader` methods to support synchronous or asynchronous implementations so both dotenv and GCP loaders fit the same contract.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `src/types.ts` is ready for Plan 4.2 stub modules to import via `.js`-suffixed paths.
- Downstream plans can now implement stubs and runtime logic against a fixed null-aware compiler contract.

## Self-Check: PASSED

- Verified `.planning/phases/04-type-stubs/04-01-SUMMARY.md` exists.
- Verified `src/types.ts` exists.
- Verified task commit `eaf5539` exists in git history.

---
*Phase: 04-type-stubs*
*Completed: 2026-03-30*
