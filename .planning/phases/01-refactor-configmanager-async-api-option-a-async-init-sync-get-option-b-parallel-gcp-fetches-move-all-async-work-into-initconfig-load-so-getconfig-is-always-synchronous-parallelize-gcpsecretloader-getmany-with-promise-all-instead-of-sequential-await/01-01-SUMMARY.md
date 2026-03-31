---
phase: 01-refactor-configmanager-async-api
plan: "01"
subsystem: types, loaders
tags: [typescript, async, types, refactor]
dependency_graph:
  requires: []
  provides: [async-secretloader-interface, dotenvloader-async]
  affects: [src/manager.ts, src/loaders/gcp.ts]
tech_stack:
  added: []
  patterns: [async/await, Promise returns on all SecretLoader implementations]
key_files:
  created: []
  modified:
    - src/types.ts
    - src/loaders/dotenv.ts
decisions:
  - "Removed MaybePromise<T> alias with no backward-compat shim — not exported in public API surface (index.ts)"
  - "autoLoad removed from ConfigManagerOptions per D-04 (footgun: unawaited promise)"
  - "DotEnvLoader.get() and getMany() converted to async without changing internal logic"
metrics:
  duration: "2 minutes"
  completed: "2026-03-31"
  tasks_completed: 2
  files_changed: 2
---

# Phase 01 Plan 01: Remove MaybePromise/autoLoad from types.ts; make DotEnvLoader async

Established fully-async SecretLoader type contract by removing MaybePromise<T> type alias and autoLoad option, then updating DotEnvLoader to satisfy the new interface with async/Promise returns.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Remove MaybePromise and autoLoad from types.ts; tighten SecretLoader to Promise returns | bbd7bac | src/types.ts |
| 2 | Update DotEnvLoader to return Promise values, satisfying the new SecretLoader interface | 0985f45 | src/loaders/dotenv.ts |

## What Was Built

### Task 1 — src/types.ts
- Deleted `MaybePromise<T>` type alias
- Updated `SecretLoader.get()` return type: `MaybePromise<string | null>` → `Promise<string | null>`
- Updated `SecretLoader.getMany()` return type: `MaybePromise<Record<string, string | null>>` → `Promise<Record<string, string | null>>`
- Removed `autoLoad?: boolean` field from `ConfigManagerOptions`

### Task 2 — src/loaders/dotenv.ts
- Converted `get(key: string): string | null` → `async get(key: string): Promise<string | null>`
- Converted `getMany(keys: readonly string[]): Record<string, string | null>` → `async getMany(keys: readonly string[]): Promise<Record<string, string | null>>`
- Updated inner `getMany` loop to use `await this.get(key)`
- All internal logic (process.env precedence, deferred file-missing error, parsedValues lookup) is unchanged

## Decisions Made

1. **No MaybePromise backward-compat alias** — `MaybePromise` is not in `src/index.ts` public exports, so removal is safe with zero consumer impact. No shim needed.
2. **autoLoad removal is clean** — Per D-04, `autoLoad` was a footgun because constructor-fired `load()` is unawaited. Removing it from the type forces consumers to call `await initConfig()` explicitly.
3. **DotEnvLoader: only async wrapper added** — Internal synchronous logic kept as-is. The `throw` inside `get()` for missing files correctly becomes a rejected promise inside the async function.

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

- `grep "MaybePromise" src/types.ts` — no results (✓ VERIFIED)
- `grep "autoLoad" src/types.ts` — no results (✓ VERIFIED)
- `grep "Promise<string | null>" src/types.ts` — line 6: SecretLoader.get (✓ VERIFIED)
- `grep "async get" src/loaders/dotenv.ts` — line 86 (✓ VERIFIED)
- `grep "async getMany" src/loaders/dotenv.ts` — line 110 (✓ VERIFIED)
- `npm run typecheck` — errors only in src/manager.ts (expected; Plan 02 fixes those); no errors in src/loaders/dotenv.ts (✓ VERIFIED)

## Known Stubs

None — no placeholder or stub patterns introduced in this plan.

## Self-Check: PASSED

- src/types.ts modified: `git show bbd7bac` confirms MaybePromise and autoLoad removed
- src/loaders/dotenv.ts modified: `git show 0985f45` confirms async wrappers added
- Commits bbd7bac and 0985f45 exist in main branch
