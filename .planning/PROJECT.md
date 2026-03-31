# env-manager-js

## What This Is

A shipped TypeScript port of the Python `env-manager` library for Node.js. The package preserves the Python library's configuration resolution behavior across dotenv files, GCP Secret Manager, validation, type coercion, multi-environment selection, and singleton access patterns.

## Core Value

Behavior parity with the Python implementation remains the primary value. Packaging and ecosystem adaptations are acceptable only when they preserve observable behavior for consumers.

## Current State

- Current npm version: **0.1.2**
- Last shipped milestone: **v0.1.2 Async API Refactor** on 2026-03-31
- Prior milestone: **v1.0 Initial Release** on 2026-03-31
- Runtime status: Typecheck, test suite, build, publint, `attw --pack`, and real-GCP verification all passed at milestone closeout
- Codebase snapshot: 11 completed v1.0 phases + 1 post-launch phase, 42 completed plans, roughly 4.7k lines across `src/` and `tests/`

## Requirements

### Validated

- ✓ Full TypeScript port of the Python modules required for v1 parity — v1.0
- ✓ Type coercion, environment parsing, loader behavior, resolution pipeline, validation, and singleton APIs match the documented Python behavior — v1.0
- ✓ Dotenv and GCP Secret Manager loading paths, including cache and deferred-error behavior, are verified — v1.0
- ✓ Publish-ready npm package outputs and public API surface are verified — v1.0
- ✓ Project-root discovery via `package.json` is the accepted Node.js adaptation from the Python source layout — v1.0

### Active

- [ ] Define the next milestone scope with `$gsd-new-milestone`
- [ ] Decide whether v2 starts with additional cloud providers, developer-experience tooling, or another parity-preserving enhancement set

### Out of Scope

- New features that break Python behavior parity
- Browser support for the current package architecture
- Performance-first rewrites that change the observable resolution contract

## Context

- Python source remains available at `../env-manager/` for future parity checks
- The planning archive for the shipped milestone lives in `.planning/milestones/`
- Remaining known debt is documentation debt in older planning artifacts, not a runtime blocker

## Constraints

- Preserve the `null` contract for missing values
- Preserve exact Python-facing error and warning semantics where tests assert them
- Keep test execution deterministic for environment-mutating suites

## Next Milestone Goals

- Create fresh milestone requirements before adding new roadmap phases
- Decide whether the next release is v1.1 hardening or a v2 expansion milestone
- Keep historical v1.0 artifacts archived instead of growing the live planning files again

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use `package.json` for root discovery instead of `pyproject.toml` | Required Node.js adaptation while preserving behavior | ✓ Good |
| Use Vitest with serial file execution for env-mutating suites | Preserves deterministic parity tests in the JS runtime | ✓ Good |
| Use `null` instead of `undefined` for missing values | Matches Python `None` semantics across the API | ✓ Good |
| Keep tests immutable once ported | Enforces parity by fixing implementation instead of drifting the spec | ✓ Good |
| Expose a first-class GCP client seam instead of test-only runtime hacks | Keeps production code clean while preserving loader testability | ✓ Good |

<details>
<summary>Archived pre-v1.0 framing</summary>

Initial project framing focused on port completion, TDD sequencing, and publish readiness before any feature expansion. That framing is preserved in the v1.0 milestone archive and superseded by the shipped state above.

</details>

---
*Last updated: 2026-03-31 after v0.1.2 async API refactor*
