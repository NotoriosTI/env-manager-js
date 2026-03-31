# Milestones

## v0.1.2 Async API Refactor (Shipped: 2026-03-31)

**GitHub tag:** v0.1.2

**Key accomplishments:**
- Removed `autoLoad` footgun from `ConfigManagerOptions` (unawaited promise risk).
- Removed `MaybePromise<T>` and `isPromiseLike` dead code from `types.ts`.
- Made `SecretLoader` interface fully async (`get`/`getMany` return `Promise`).
- Made `DotEnvLoader.get`/`getMany` async to satisfy the updated interface.
- Refactored `ConfigManager.load()` to explicitly `await` all loader calls; removed lazy sync fetch paths from `get()`.
- Parallelized `GCPSecretLoader.getMany` with `Promise.all` instead of sequential `await`.
- Migrated all affected tests to explicit `await load()` pattern; removed dead lazy-loader call sites.
- Bumped version `0.1.1 → 0.1.2`.

---

## v0.1.1 Post-Launch Housekeeping (Shipped: 2026-03-31)

**GitHub tag:** v0.1.1

**Key accomplishments:**
- Created comprehensive README.md covering installation, configuration schema, singleton API, environment selection, secret origin resolution, and full API reference.
- Renamed package from `env-manager` to `@notoriosti/env-manager` (scoped, public `publishConfig`).
- Added `package.json` metadata: author, repository URL, homepage.
- Added npm `overrides` for `rimraf` and `node-domexception` to eliminate transitive deprecation warnings on install.
- Bumped version `0.1.0 → 0.1.1`.

---

## v1.0 Initial Release (Shipped: 2026-03-31)

**Phases completed:** 11 phases, 40 plans, 10 tracked tasks

**Key accomplishments:**
- Bootstrapped a TypeScript, Vitest, ESM, and tsup-based package foundation suitable for npm publication.
- Produced a full behavioral catalog of the Python source and ported the complete parity-focused test suite before implementation.
- Implemented the runtime surface across utilities, environment parsing, dotenv and GCP loaders, factory caching, ConfigManager, and singleton accessors.
- Verified build, package exports, `publint`, `attw --pack`, and tarball behavior for publish readiness.
- Closed singleton re-init and milestone audit gaps, verified real GCP Secret Manager integration, and migrated Vitest to supported serial-file execution.

**Known debt accepted at ship time:**
- Older planning artifacts still contain some stale wording and requirement-traceability history, but the runtime and verification state for v1.0 is complete.

---
