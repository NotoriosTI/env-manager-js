---
phase: 03-refactor-configmanager-async-api-sync-getconfig-after-await-initconfig
plan: 03.2
subsystem: encryption
tags: [eciesjs, dotenvx, encrypted-dotenv, decryption, error-handling]

requires:
  - phase: 03-refactor-configmanager-async-api-sync-getconfig-after-await-initconfig
    provides: loader-level red regressions for encrypted dotenv and DecryptionError contract

provides:
  - DotEnvLoader encrypted mode with eciesjs ECIES decryption for dotenvx-compatible payloads
  - Lazy private key chain: DOTENV_PRIVATE_KEY_<ENV> → DOTENV_PRIVATE_KEY → .env.keys
  - Aggregate decryption failures behind one exported DecryptionError class
  - DecryptionError exported from public barrel with instanceof and issues inspection

affects: [03-03, encrypted-dotenv, public-api, manager-load]

tech-stack:
  added: [eciesjs]
  patterns: [encrypted-prefix detection, lazy key resolution, aggregate failure collection]

key-files:
  created:
    - src/errors.ts
    - tests/fixtures/.env.test
    - tests/fixtures/.env.prod
  modified:
    - src/loaders/dotenv.ts
    - src/types.ts
    - src/index.ts
    - src/manager.ts
    - src/environment.ts
    - tests/helpers.ts
    - tests/loaders.test.ts

key-decisions:
  - "Used eciesjs as runtime dependency (same library dotenvx uses) rather than hand-rolling secp256k1 ECIES to guarantee identical decryption behavior."
  - "DecryptionError is defined in src/errors.ts separate from manager.ts to avoid circular imports between the loader and manager layers."
  - "DotEnvLoader._tryDecrypt never throws — callers decide whether to aggregate or short-circuit, keeping the single-key and batch paths consistent."
  - "Per-environment encrypted_dotenv.enabled parsed in environment.ts and stored in EnvironmentConfig so _loadNewFormat can activate encrypted mode per-group."
  - "Old-format top-level encrypted_dotenv.enabled stored in ConfigManager._encryptedDotenvEnabled — no environment name so only generic key chain is used."

patterns-established:
  - "Encrypted prefix detection: isEncryptedValue() checks startsWith('encrypted:') before any decryption attempt."
  - "Key resolution is pure function (resolvePrivateKey) with no side effects, testable in isolation."
  - "getMany() collects all DecryptionIssue objects before throwing, matching the ConfigValidationError aggregation pattern."

requirements-completed: [ENC-02, ENC-03, ENC-04]

duration: 35min
completed: 2026-03-31
---

# Phase 03 Plan 02: Encrypted Dotenv Loader Support and Public Error Surface Summary

**eciesjs-backed ECIES decryption for dotenvx-compatible encrypted: values with lazy key chain, aggregate DecryptionError, and public barrel export**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-03-31T13:50:00Z
- **Completed:** 2026-03-31T14:07:00Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Implemented DotEnvLoader encrypted mode: detects `encrypted:` prefix, resolves private key lazily via DOTENV_PRIVATE_KEY_<ENV> → DOTENV_PRIVATE_KEY → .env.keys chain, decrypts using eciesjs.
- Defined DecryptionError in src/errors.ts with structured issues array; exported from public barrel parallel to ConfigValidationError.
- Wired encrypted DotEnvLoader into _loadOldFormat (top-level encrypted_dotenv config) and _loadNewFormat (per-environment encrypted_dotenv.enabled), with DecryptionError propagating directly without wrapping.
- Created missing test fixture files (.env.test, .env.prod) and updated .gitignore to allow them.

## Task Commits

1. **Task 1: Encrypted loader, DecryptionError, key lookup, fixture fixes** - `c90ea63` (feat)
2. **Task 2: Export DecryptionError barrel + wire manager** - `7c9a09b` (feat)

## Files Created/Modified
- `src/loaders/dotenv.ts` - DotEnvLoader with encrypted option, _tryDecrypt/_decryptSingleOrThrow, getMany aggregate failures
- `src/errors.ts` - DecryptionError class with issues array (new file)
- `src/types.ts` - Added DecryptionIssue interface and EncryptedDotenvConfig interface + EnvironmentConfig.encryptedDotenv field
- `src/index.ts` - Export DecryptionError and DecryptionIssue from public barrel
- `src/manager.ts` - Parse encrypted_dotenv in constructor, use encrypted DotEnvLoader in _loadOldFormat and _loadNewFormat
- `src/environment.ts` - Parse encrypted_dotenv.enabled into EncryptedDotenvConfig on EnvironmentConfig
- `tests/helpers.ts` - Fix ciphertext constant (was encrypting "World" not "Hello")
- `tests/loaders.test.ts` - Sync local ciphertext constant with helpers.ts fix
- `tests/fixtures/.env.test` - Missing fixture (gitignored, needed for integration tests)
- `tests/fixtures/.env.prod` - Missing fixture (gitignored, needed for integration tests)
- `.gitignore` - Added !tests/fixtures/.env* exception to allow fixture commit

## Decisions Made
- Used eciesjs (the same library dotenvx ships with) to avoid re-implementing secp256k1 ECIES and guarantee format compatibility.
- Kept DecryptionError in a separate errors.ts to prevent circular import between loader layer and manager.
- Per-environment encrypted_dotenv stored in EnvironmentConfig so manager grouping logic has natural access during file resolution.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test fixture ciphertext encrypted "World" not "Hello"**
- **Found during:** Task 1 (verifying test vector round-trip)
- **Issue:** DOTENVX_ENCRYPTED_HELLO constant in both helpers.ts and loaders.test.ts decrypted to "World" while tests asserted "Hello", meaning the regressions could never pass.
- **Fix:** Regenerated ciphertext by encrypting "Hello" with the test keypair using eciesjs; updated both constants.
- **Files modified:** tests/helpers.ts, tests/loaders.test.ts
- **Verification:** decrypt(DOTENVX_PRIVATE_KEY, new_ciphertext) === "Hello" confirmed before update.
- **Committed in:** c90ea63

**2. [Rule 2 - Missing Critical] Missing test fixture files for integration tests**
- **Found during:** Task 2 (running full suite)
- **Issue:** tests/fixtures/.env.test and .env.prod were never committed (gitignored) but integration tests unconditionally call copyFileSync from that directory, causing ENOENT failures for 13 pre-existing tests.
- **Fix:** Created fixture files with values matching test assertions; added !tests/fixtures/.env* exception to .gitignore.
- **Files modified:** tests/fixtures/.env.test, tests/fixtures/.env.prod, .gitignore
- **Verification:** Full suite runs with 0 additional fixture-related failures.
- **Committed in:** c90ea63

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical)
**Impact on plan:** Both fixes necessary for test correctness. No scope creep — encryption implementation was unchanged.

## Known Stubs

None — all plan goals wired to real implementations.

## Issues Encountered

- The 2 environment-integration tests for dedicated key sources (local dotenv + GCP) remain red — these are 03-03 scope tests that were red before this plan and are still red (now failing because the loader correctly attempts decryption but the dedicated key source routing is not yet implemented).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- 03-03 can now implement per-environment dedicated private-key source routing (local .env and GCP) against the committed regression tests.
- The public DecryptionError contract is stable for downstream manager integration.

## Self-Check: PASSED

---
*Phase: 03-refactor-configmanager-async-api-sync-getconfig-after-await-initconfig*
*Completed: 2026-03-31*
