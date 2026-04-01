---
phase: 03-refactor-configmanager-async-api-sync-getconfig-after-await-initconfig
plan: 03.3
subsystem: encryption
tags: [encrypted-dotenv, eciesjs, private-key, dedicated-source, gcp, dotenv, decryption]

requires:
  - phase: 03-refactor-configmanager-async-api-sync-getconfig-after-await-initconfig
    provides: DotEnvLoader encrypted mode with eciesjs ECIES decryption, DecryptionError, lazy key chain

provides:
  - PrivateKeyConfig type for dedicated private-key source configuration
  - environment-level encrypted_dotenv.private_key YAML parsing
  - explicitPrivateKey option on DotEnvLoaderOptions to bypass default key chain
  - Manager resolution that fetches private key from dedicated local or GCP source before encrypted load

affects: [public-api, encrypted-dotenv, manager-load, environment-integration]

tech-stack:
  added: []
  patterns:
    - "Dedicated key source fetched via createLoader before constructing encrypted DotEnvLoader — keeps key resolution inside existing loader abstractions"
    - "explicitPrivateKey on DotEnvLoaderOptions short-circuits internal resolvePrivateKey() when a pre-resolved key is passed in"

key-files:
  created: []
  modified:
    - src/types.ts
    - src/environment.ts
    - src/loaders/dotenv.ts
    - src/manager.ts

key-decisions:
  - "PrivateKeyConfig uses secretOrigin/dotenvPath/gcpProjectId to map onto createLoader directly — no second source-resolution system needed"
  - "explicitPrivateKey on DotEnvLoaderOptions rather than a constructor override keeps the interface minimal and the internal resolvePrivateKey function unchanged"
  - "Manager fetches the dedicated key synchronously before the encrypted DotEnvLoader is constructed — simpler than passing a resolver callback into the loader"

patterns-established:
  - "Dedicated key source resolution: createLoader(privateKeyConfig) → loader.get(source) → pass as explicitPrivateKey to DotEnvLoader"

requirements-completed: [ENC-01, ENC-03, ENC-05, ENC-06]

duration: 12min
completed: 2026-03-31
---

# Phase 03 Plan 03.3: Integrate Dedicated Private-Key Sources Into Environment And Manager Resolution Summary

**Dedicated private-key source resolution (local dotenv or GCP) wired into encrypted DotEnvLoader construction, completing Phase 03 encrypted dotenv support**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-31T17:08:00Z
- **Completed:** 2026-03-31T17:20:02Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Extended `EncryptedDotenvConfig` with `PrivateKeyConfig` for declaring a dedicated key source in environment YAML
- Parser in `environment.ts` extracts `private_key.source`, `secret_origin`, `dotenv_path`, and `gcp_project_id` from the `encrypted_dotenv` block
- `DotEnvLoaderOptions.explicitPrivateKey` added so a pre-resolved key bypasses `resolvePrivateKey()` entirely
- Manager `_loadNewFormat` fetches the private key via `createLoader` before constructing the encrypted `DotEnvLoader`, ensuring the dedicated source takes priority over the fallback chain
- Full suite (141 tests) and build pass with no regressions

## Task Commits

1. **Task 1: Extend config parsing and manager resolution for encrypted dotenv activation and dedicated key-source config** - `f51f088` (feat)
2. **Task 2: Run end-to-end regression and close the phase with the final public contract** - no source changes required; f51f088 cover all outcomes

## Files Created/Modified
- `src/types.ts` - Added `PrivateKeyConfig` interface and `privateKey` field on `EncryptedDotenvConfig`
- `src/environment.ts` - Parses `encrypted_dotenv.private_key` block into `PrivateKeyConfig` during environment config parsing
- `src/loaders/dotenv.ts` - Added `explicitPrivateKey` option to `DotEnvLoaderOptions`; `_tryDecrypt` uses it when non-null
- `src/manager.ts` - `_loadNewFormat` resolves dedicated private key via `createLoader` before constructing encrypted `DotEnvLoader`

## Decisions Made
- Reused `createLoader` for dedicated key-source resolution instead of a new abstraction — consistent with the existing factory pattern
- `explicitPrivateKey` as a loader option rather than a runtime callback — simpler interface, no closure complexity
- Private key fetched once before `DotEnvLoader` construction, not inside it — keeps the loader stateless with respect to key resolution

## Deviations from Plan

None - plan executed exactly as written.

The worktree branch lacked Phase 02 and Phase 03 work; a `git merge milestone-2` and `npm install` (eciesjs) were required before implementation could begin. These are infrastructure setup steps, not deviations.

## Issues Encountered
- Worktree was based on `main` branch which was behind `milestone-2`. Resolved by merging `milestone-2` into the worktree and running `npm install` to install `eciesjs`.

## Next Phase Readiness
- Phase 03 is complete. Encrypted dotenv support is fully wired across loader, manager, environment parser, and public API.
- `DecryptionError` and `PrivateKeyConfig` are exported from `src/index.ts` barrel (done in 03-02).
- Ready for Phase 04.

---
*Phase: 03-refactor-configmanager-async-api-sync-getconfig-after-await-initconfig*
*Completed: 2026-03-31*
