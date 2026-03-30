# env-manager-js

## What This Is

A TypeScript port of the Python `env-manager` library — a configuration manager that loads environment variables from multiple sources (dotenv files, GCP Secret Manager) with type coercion, validation, multi-environment support, and per-variable source overrides. The port must be behavior-identical to the Python version, targeting npm publication.

## Core Value

Every behavior from the Python `env-manager` must be preserved exactly — same resolution pipeline, same error messages, same edge case handling. If the TypeScript version diverges from Python on any input, that's a bug.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Complete TDD port of all Python modules to TypeScript
- [ ] Type coercion (str, int, float, bool) with exact Python-matching behavior
- [ ] DotEnvLoader with process.env override semantics
- [ ] GCPSecretLoader with caching and error handling
- [ ] Environment parsing (local/gcp origins, defaults, validation)
- [ ] ConfigManager with full resolution pipeline
- [ ] Per-variable source overrides (origin, environment pin, dotenv_path)
- [ ] Singleton API (initConfig/getConfig/requireConfig)
- [ ] Strict mode validation
- [ ] Default-only variables (no source, ignore process.env)
- [ ] YAML boolean/int auto-conversion handling
- [ ] Project root discovery via package.json (ecosystem adaptation from pyproject.toml)
- [ ] Deferred dotenv file errors
- [ ] Secret masking in logs
- [ ] Debug mode (unmasked logging)
- [ ] Publish-ready npm package configuration

### Out of Scope

- New features not in the Python version — this is a behavior-preserving port
- Performance optimizations beyond what Python does — match behavior first
- CLI tooling — library only
- Browser support — Node.js target

## Context

- Python source repo available at `../env-manager/` for reference
- PORT_PROMPT.md contains the complete behavioral specification including test cases, implementation notes, and 15 documented gotchas
- TDD methodology: all tests written first (ported from Python test suite), then implementation
- Tests are immutable once written — fix implementation, not tests
- The only allowed behavioral change: project root discovery uses `package.json` instead of `pyproject.toml`
- Python uses `APP_ENV` environment variable for environment selection

## Constraints

- **Methodology**: Strict TDD — all tests before implementation
- **Behavior parity**: Error messages must match Python format exactly (tests assert message content)
- **Null semantics**: Use `null` (not `undefined`) for missing values throughout
- **Type system**: `process.env` values always written as strings
- **Dependencies**: yaml, dotenv, @google-cloud/secret-manager (runtime); typescript, vitest (dev)
- **Target**: ES2022, ESM modules

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use `package.json` for root discovery instead of `pyproject.toml` | Necessary ecosystem adaptation for Node.js | — Pending |
| Use Vitest for testing | Matches PORT_PROMPT.md spec, modern TS test runner | — Pending |
| Use `null` not `undefined` for missing values | Match Python's `None` semantics consistently | — Pending |
| Follow TDD with immutable tests | PORT_PROMPT.md methodology — tests are the spec | — Pending |

---
*Last updated: 2026-03-30 after initialization*
