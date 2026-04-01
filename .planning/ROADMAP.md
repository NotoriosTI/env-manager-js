# Roadmap: env-manager-js
Created: 2026-03-30
Last updated: 2026-03-31

## Overview

Behavior-preserving TypeScript port of the Python `env-manager` library, now planning milestone `v0.2.0 / Milestone 2` around the remaining backlog items that improve validation diagnostics, encrypted dotenv handling, typed access patterns, and runtime ergonomics without changing default behavior.

## Milestones

- ✅ **v1.0 Initial Release** — Phases 01-11 ([archive](./milestones/v1.0-ROADMAP.md)) — shipped 2026-03-31
- ✅ **v0.1.1 Post-Launch Housekeeping** — README, package rename, deprecation fixes — shipped 2026-03-31
- ✅ **v0.1.2 Async API Refactor** — Phase 01 (2 plans) — shipped 2026-03-31
- 🚧 **v0.2.0 / Milestone 2** — Phases 02-06 — in progress

## Current State

- Active milestone: **v0.2.0 / Milestone 2**
- Milestone goal: Ship the six prioritized backlog items while preserving Python parity, `null` semantics, and opt-in defaults
- Sequence: validation diagnostics first, then encrypted dotenv support, then validator-agnostic typed retrieval, then schema-safe accessors, then logger and interpolation ergonomics

## Phases

- [x] **Phase 02: Validation Diagnostics** - Aggregate `load()` validation failures into one exported error without changing existing strictness behavior. (completed 2026-03-31)
- [x] **Phase 03: Encrypted Dotenv Support** - Add opt-in dotenvx-compatible encrypted value decryption with explicit key resolution and error typing. (completed 2026-03-31)
- [x] **Phase 03.1: CLI Encryption Script** - Add CLI script to encrypt dotenv files with automatic key management. (completed 2026-03-31)
- [ ] **Phase 04: Generic Typed Retrieval** - Add typed `getConfig` and `requireConfig` overloads with optional validator-backed parsing while preserving existing callers.
- [ ] **Phase 05: Schema-Safe Config Access** - Add `createTypedConfig(schema)` for compile-time key safety on top of a validator-agnostic typed retrieval foundation.
- [ ] **Phase 06: Runtime Ergonomics** - Add injectable logger support and opt-in dotenv expansion without changing defaults for existing consumers.

## Phase Details

### Phase 02: Validation Diagnostics
**Goal**: Users see every missing or invalid required configuration issue from a load attempt in one exported validation error.
**Depends on**: Phase 01 (shipped async API baseline)
**Requirements**: VAL-01, VAL-02, VAL-03
**Success Criteria** (what must be TRUE):
  1. User receives one `ConfigValidationError` from `load()` listing all missing required variables found in the current load attempt.
  2. User receives one `ConfigValidationError` from `load()` listing all invalid configured values found in the current load attempt instead of failing on the first invalid entry.
  3. Consumer can `instanceof`-check the exported `ConfigValidationError` class while existing `strict` and `required` semantics remain unchanged.
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md — Add failing regression coverage for aggregate validation diagnostics and failed-load retry behavior
- [x] 02-02-PLAN.md — Export ConfigValidationError and refactor load() to aggregate fatal issues without breaking retry semantics

### Phase 03: Encrypted Dotenv Support
**Goal**: Users can opt into encrypted dotenv values with dotenvx-compatible decryption, configurable private-key lookup, and explicit failure behavior.
**Depends on**: Phase 02
**Requirements**: ENC-01, ENC-02, ENC-03, ENC-04, ENC-05, ENC-06
**Success Criteria** (what must be TRUE):
  1. User can enable encrypted dotenv handling per environment and plaintext environments keep their current behavior by default.
  2. User can load dotenvx-compatible `encrypted:` values from `.env` files when a matching private key is available.
  3. User receives an exported `DecryptionError` when encrypted values cannot be decrypted because the private key is missing or invalid.
  4. User can provide decryption keys through `DOTENV_PRIVATE_KEY_<ENV>`, then `DOTENV_PRIVATE_KEY`, then a colocated `.env.keys` file in that resolution order.
  5. User can configure the private-key secret name instead of being limited to `DOTENV_PRIVATE_KEY`.
  6. User can load the private decryption key from local dotenv-backed sources or GCP Secret Manager in addition to direct process environment injection.
**Plans**: 3 plans

Plans:
- [x] 03-01-PLAN.md — Add failing regressions for encrypted dotenv loader behavior, manager opt-in activation, dedicated key sources, and the public decryption contract
- [ ] 03-02-PLAN.md — Add exported DecryptionError/types and implement dotenvx-compatible loader decryption with lazy private-key lookup
- [ ] 03-03-PLAN.md — Wire encrypted dotenv config through environment/manager resolution and close the phase with the regression gate

### Phase 03.1: Add CLI script to encrypt dotenv files with key management (INSERTED)

**Goal:** Users can encrypt plaintext .env files into dotenvx-compatible encrypted format with automatic key pair generation and .env.keys file output.
**Requirements**: CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06, CLI-07, CLI-08, CLI-09
**Depends on:** Phase 03
**Plans:** 2/2 plans executed (COMPLETED 2026-03-31)

Plans:
- [x] 03.1-01-PLAN.md — Implement core encryption module with TDD tests for key generation, value encryption, round-trip verification, and edge cases
- [x] 03.1-02-PLAN.md — Wire CLI entry point with arg parsing, tsup multi-entry build, and package.json bin registration

### Phase 04: Generic Typed Retrieval
**Goal**: Consumers can opt into typed config reads and validator-backed retrieval without breaking existing untyped access patterns.
**Depends on**: Phase 03
**Requirements**: TYPE-01, TYPE-02
**Success Criteria** (what must be TRUE):
  1. Consumer can call `getConfig<T>(name)` and `requireConfig<T>(name)` with generic type parameters and existing untyped call sites continue to behave the same way.
  2. Consumer can pass a validator object or parser callback to `getConfig` or `requireConfig` and receive a validated typed result without the public API requiring Zod or another single validator library.
  3. Typed retrieval continues to preserve the existing missing-value and required-value runtime contract for callers that opt in.
  4. Documentation can demonstrate Zod as the primary example without making Zod part of the required runtime contract.
**Plans**: TBD

Plans:
- [ ] 04-01: TBD

### Phase 05: Schema-Safe Config Access
**Goal**: Consumers can create a schema-defined config accessor that enforces key safety at compile time without coupling the API to one validator vendor.
**Depends on**: Phase 04
**Requirements**: TYPE-03
**Success Criteria** (what must be TRUE):
  1. Consumer can create a typed accessor with `createTypedConfig(schema)` and retrieve only keys declared in that schema.
  2. Consumer gets compile-time errors for keys outside the declared schema when using the typed accessor.
  3. Values returned from the typed accessor are typed from the declared schema instead of requiring manual casts.
  4. The accessor API remains validator-agnostic so Zod can be the first documented adapter rather than the only supported contract.
**Plans**: TBD

Plans:
- [ ] 05-01: TBD

### Phase 06: Runtime Ergonomics
**Goal**: Consumers can integrate library logging and dotenv interpolation into their own runtime conventions without changing default behavior.
**Depends on**: Phase 05
**Requirements**: OBS-01, OBS-02, EXP-01
**Success Criteria** (what must be TRUE):
  1. Consumer can inject a logger through `ConfigManagerOptions` so runtime warnings and logs no longer require direct `console` usage.
  2. Consumer can rely on exported logger typing that requires `warn` and `log` and supports optional `debug` and `error` methods.
  3. User can opt into dotenv interpolation and the default disabled behavior remains unchanged when expansion is not enabled.
**Plans**: TBD

Plans:
- [ ] 06-01: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 01. Async API Refactor | 2/2 | Complete | 2026-03-31 |
| 02. Validation Diagnostics | 2/2 | Complete   | 2026-03-31 |
| 03. Encrypted Dotenv Support | 1/3 | Complete    | 2026-03-31 |
| 03.1. CLI Encrypt | 1/2 | In Progress|  |
| 04. Generic Typed Retrieval | 0/TBD | Not started | - |
| 05. Schema-Safe Config Access | 0/TBD | Not started | - |
| 06. Runtime Ergonomics | 0/TBD | Not started | - |

## Historical Context

### Phase 01: Async API Refactor
**Goal**: Remove `autoLoad` footguns, make async loading explicit, and ship the post-launch async cleanup as `v0.1.2`.
**Depends on**: Phase 11 / shipped v1.0 baseline
**Requirements**: Historical
**Plans**: 2/2 plans executed

Plans:
- [x] 01-01: Remove `MaybePromise` and `autoLoad`; make dotenv loading async
- [x] 01-02: Refactor manager loading flow, migrate tests, and ship `v0.1.2`


## Backlog

### Phase 999.1: Implementation of encrypted variable loading from non-local origin (BACKLOG)

**Goal:** Implement encrypted dotenv decryption support for non-local origins (e.g. GCP Secret Manager), removing the NotImplementedError guard added in quick task 260331-k8v.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.2: GCP secret version fallback when latest key is destroyed (BACKLOG)

**Goal:** When the latest version of a GCP secret is destroyed, fall back to the most recent accessible version instead of failing. Verify whether the same fallback gap exists for regular (non-encrypted) variable loading from GCP.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.3: Security hardening for encrypted dotenv attack surfaces (BACKLOG)

**Goal:** Address the attack surfaces identified during encrypted dotenv security analysis: prevent accidental `.env.keys` commit, harden the private key lifecycle, and close env-injection and path-traversal gaps.
**Requirements:** TBD
**Plans:** 0 plans

Captured concerns (from security analysis 2026-03-31):
- `.env.keys` silent disk fallback — add pre-commit hook or CI check to block accidental key commit
- `privateKeyHex` returned in `EncryptResult` — consider zeroing or omitting from return value
- `process.env` unconditional win — document risk of env-injection bypassing encrypted file in container/serverless environments
- `explicitPrivateKey` as plain string — evaluate secure memory handling or zeroization after use
- `normalizeEnvName` collision — `"prod.us"` and `"prod_us"` both normalize to `"PROD_US"`, silent wrong-key resolution
- `--force` silently discards previous keypair with no confirmation or backup prompt
- `findDotenv` walks to filesystem root — may pick up unintended parent `.env` in monorepo setups

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)
