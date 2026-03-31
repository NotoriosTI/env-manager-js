---
phase: 01-refactor-configmanager-async-api
plan: "02"
subsystem: manager, tests
tags: [typescript, async, refactor, tests]
dependency_graph:
  requires: [01-01]
  provides: [always-async-load, no-autoload-constructor]
  affects: [src/manager.ts, tests/]
tech_stack:
  added: []
  patterns: [explicit-load pattern, async/await, Promise<void> load()]
key_files:
  created: []
  modified:
    - src/manager.ts
    - tests/manager.test.ts
    - tests/end-to-end.test.ts
    - tests/bool-to-string-coercion.test.ts
    - tests/environment-integration.test.ts
    - tests/integration.test.ts
    - tests/loaders.test.ts
    - tests/optional-source.test.ts
    - tests/resolution-pipeline.test.ts
    - tests/resolution-validation.test.ts
    - tests/secret-origin-detection.test.ts
    - tests/validation.test.ts
    - package.json
decisions:
  - "Removed all lazy async loader.get() calls from get() — after explicit-load refactor, loader.get() is async and cannot be called synchronously at get() time"
  - "createFakeLoader helpers updated across all test files to return Promises (mockResolvedValue/Promise.resolve)"
  - "Tests that checked createLoader was called for local-origin variables restructured to verify behavior via GCP-origin paths or direct value assertions"
  - "missing per-variable dotenv deferred error now surfaces at get() time (not load() time) — test updated to match"
metrics:
  duration: "15 minutes"
  completed: "2026-03-31"
  tasks_completed: 2
  files_changed: 13
---

# Phase 01 Plan 02: Refactor manager.ts — always-async load(), no autoLoad, test migration

Always-async `load(): Promise<void>` replacing `MaybePromise<void>` branch, autoLoad constructor guard removed, all 11 test files migrated to explicit `await manager.load()`, dead lazy-loader calls in `get()` removed, version bumped to 0.1.2.

## Objective

Rewrite `manager.ts` runtime behavior so `load()` is always async, the constructor never calls `load()`, and all tests explicitly `await manager.load()` before calling `get()`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Refactor manager.ts | 6216e64 | src/manager.ts |
| 2 | Migrate tests + bump version | 0d08281 | 11 test files, package.json |

## What Was Built

- `load(): Promise<void>` — always returns a Promise, idempotent via `_loadingPromise` guard
- `_loadNewFormat(): Promise<void>` — resolveFileResults() is async, uses `await Promise.all(groupLoads)`
- `_loadOldFormat(): Promise<void>` — `await loader.getMany()` replaces `isPromiseLike` branch
- `initConfig()` no longer passes `autoLoad: false` to constructor
- `get()` lazy async loader calls removed — only `process.env` and `_dotenvValues` sync lookups remain
- All test files migrated: `async` tests, `await manager.load()` or `await initConfig()`
- `createFakeLoader` helpers updated to return Promises across all test files

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Dead async loader.get() calls in get() method caused unhandled rejections**
- **Found during:** Task 2 (test run revealed unhandled rejection)
- **Issue:** `get()` had three lazy-fetch paths that called `loader.get()` synchronously. After Plan 01 made DotEnvLoader async, these calls returned Promises that were discarded, causing unhandled rejections.
- **Fix:** Removed all `loader.get()` calls from `get()`. The method now only checks `process.env` (synchronously) and `_dotenvValues` for cache misses; all loader fetches must happen via `await manager.load()`.
- **Files modified:** src/manager.ts
- **Commit:** 0d08281

**2. [Rule 1 - Bug] Test mocks returned sync values for async loader interface**
- **Found during:** Task 2
- **Issue:** `createFakeLoader()` in multiple test files returned plain objects/values, not Promises. After DotEnvLoader became async, `await loader.getMany()` in `_loadNewFormat`/`_loadOldFormat` would resolve the plain value successfully (Promise.resolve wraps it), but `mockReturnValue` for vi.fn was used where `mockResolvedValue` was needed for semantic clarity and correctness.
- **Fix:** Updated all `createFakeLoader` helpers to use `Promise.resolve(...)` / `mockResolvedValue`.
- **Files modified:** 6 test files
- **Commit:** 0d08281

**3. [Rule 1 - Bug] Test "missing per-variable dotenv raises only when lookup needs file" expected load() to reject**
- **Found during:** Task 2
- **Issue:** Per-variable dotenv errors for variables with `hasPerVarDotenvPath: true` are deferred to `get()` time, not thrown during `load()`. The test expected `manager.load()` to reject.
- **Fix:** Changed test to `await manager.load()` then `expect(() => manager.get()).toThrow(missingPath)`.
- **Files modified:** tests/resolution-validation.test.ts
- **Commit:** 0d08281

**4. [Rule 1 - Bug] Tests for "createLoader called with local secretOrigin" no longer valid**
- **Found during:** Task 2
- **Issue:** Several tests in `environment-integration.test.ts` relied on lazy `get()` calling `createLoader` for local-origin variables. With the new explicit-load model, local-origin load reads dotenv files directly (not via `createLoader`). The tests needed restructuring.
- **Fix:** Restructured affected tests to use GCP origin (where `createLoader` IS called during `load()`) or to verify behavior via actual value assertions rather than spy assertions.
- **Files modified:** tests/environment-integration.test.ts
- **Commit:** 0d08281

## Known Stubs

None — all values are wired from real dotenv/GCP sources or explicit test fixtures.

## Self-Check: PASSED
