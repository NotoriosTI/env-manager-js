# Requirements: env-manager-js

**Defined:** 2026-03-31
**Core Value:** Behavior parity with the Python implementation remains the primary value. Packaging and ecosystem adaptations are acceptable only when they preserve observable behavior for consumers.

## Milestone 2 Requirements

Requirements for milestone `v0.2.0 / Milestone 2`.

### Validation

- [x] **VAL-01**: User receives a single `ConfigValidationError` from `load()` listing every missing required variable discovered in the current load attempt
- [x] **VAL-02**: User receives a single `ConfigValidationError` from `load()` listing every invalid configured value discovered in the current load attempt
- [x] **VAL-03**: Consumer can `instanceof`-check the exported `ConfigValidationError` class without changing existing `strict` or `required` semantics

### Encryption

- [x] **ENC-01**: User can opt into encrypted `.env` handling per environment configuration without changing behavior for plaintext environments
- [x] **ENC-02**: User can load dotenvx-compatible `encrypted:` values from `.env` files when a matching private key is available
- [x] **ENC-03**: User receives an exported `DecryptionError` when encrypted values cannot be decrypted because the private key is missing or invalid
- [x] **ENC-04**: User can supply decryption keys through `DOTENV_PRIVATE_KEY_<ENV>`, `DOTENV_PRIVATE_KEY`, or a colocated `.env.keys` file in that resolution order
- [x] **ENC-05**: User can configure which secret name should be read for the private decryption key instead of being limited to `DOTENV_PRIVATE_KEY`
- [x] **ENC-06**: User can load the private decryption key from local dotenv-backed sources or GCP Secret Manager, not only from process environment variables or `.env.keys`

### Typed Access

- [ ] **TYPE-01**: Consumer can call `getConfig<T>(name)` and `requireConfig<T>(name)` with generic type parameters without breaking existing untyped call sites
- [ ] **TYPE-02**: Consumer can pass a validator object or parser callback to `getConfig` or `requireConfig` and receive a validated typed result without requiring a specific validation library
- [ ] **TYPE-03**: Consumer can create a typed accessor via `createTypedConfig(schema)` and get compile-time errors for keys outside the declared schema while keeping the public contract validator-agnostic

### Observability

- [ ] **OBS-01**: Consumer can inject a logger through `ConfigManagerOptions` so runtime warnings and logs do not require direct `console` usage
- [ ] **OBS-02**: Consumer can rely on exported logger typing that supports `warn`, `log`, and optional `debug` / `error` methods

### Dotenv Expansion

- [ ] **EXP-01**: User can opt into `.env` variable interpolation through `dotenv-expand` without changing the default disabled behavior

## Future Requirements

Deferred until the current backlog milestone lands.

### Encryption

- **ENC-07**: User can generate or rotate encrypted `.env` payloads directly through library APIs

### Typed Access

- **TYPE-04**: Consumer can use first-class helpers for popular validator libraries beyond the initial validator-agnostic schema path without extra wrappers

### Providers

- **PROV-01**: User can load secrets from additional cloud providers beyond the current dotenv and GCP support

## Out of Scope

Explicitly excluded from milestone `v0.2.0 / Milestone 2`.

| Feature | Reason |
|---------|--------|
| Plaintext/env resolution behavior changes | Would break established Python parity guarantees |
| Built-in encryption authoring CLI or secret rotation workflow | Backlog item is read-path decryption only; write-path tooling expands scope materially |
| Browser runtime support | Current package architecture and roadmap remain Node-focused |
| Mandatory validator dependency for all consumers | Typed schema support must remain opt-in to preserve current install surface |
| Public API coupled to Zod-specific runtime types | Validator support should stay library-agnostic so ecosystem choice does not become a compatibility constraint |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| VAL-01 | Phase 02 | Complete |
| VAL-02 | Phase 02 | Complete |
| VAL-03 | Phase 02 | Complete |
| ENC-01 | Phase 03 | Complete |
| ENC-02 | Phase 03 | Complete |
| ENC-03 | Phase 03 | Complete |
| ENC-04 | Phase 03 | Complete |
| ENC-05 | Phase 03 | Complete |
| ENC-06 | Phase 03 | Complete |
| TYPE-01 | Phase 04 | Pending |
| TYPE-02 | Phase 04 | Pending |
| TYPE-03 | Phase 05 | Pending |
| OBS-01 | Phase 06 | Pending |
| OBS-02 | Phase 06 | Pending |
| EXP-01 | Phase 06 | Pending |

**Coverage:**
- Milestone 2 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-31*
*Last updated: 2026-03-31 after renaming the active milestone to v0.2.0 / Milestone 2*
