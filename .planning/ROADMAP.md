# Roadmap: env-manager-js
Created: 2026-03-30
Last updated: 2026-03-31

## Overview

Behavior-preserving TypeScript port of the Python `env-manager` library, published to npm after full parity, packaging, and verification work across 11 completed phases.

## Milestones

- ✅ **v1.0 Initial Release** — Phases 1-11 ([archive](./milestones/v1.0-ROADMAP.md)) — shipped 2026-03-31
- ✅ **v0.1.1 Post-Launch Housekeeping** — README, package rename, deprecation fixes — shipped 2026-03-31
- ✅ **v0.1.2 Async API Refactor** — Phase 1 (2 plans) — shipped 2026-03-31

## Current State

- No active milestone is planned yet.
- Backlog for the next milestone: [BACKLOG.md](./BACKLOG.md)
- Start the next milestone with `$gsd-new-milestone`, which will create a fresh `.planning/REQUIREMENTS.md` and extend the roadmap from this shipped baseline.

## Progress

| Milestone | Phases | Plans | Status | Shipped |
|-----------|--------|-------|--------|---------|
| v1.0 Initial Release | 1-11 | 40/40 | Complete | 2026-03-31 |
| v0.1.1 Post-Launch Housekeeping | — | — | Complete | 2026-03-31 |
| v0.1.2 Async API Refactor | 1 | 2/2 | Complete | 2026-03-31 |

### Phase 1: Refactor ConfigManager async API: Option A (async init, sync get) + Option B (parallel GCP fetches). Move all async work into initConfig/load() so getConfig() is always synchronous. Parallelize GCPSecretLoader.getMany with Promise.all instead of sequential await.

**Goal:** Remove `autoLoad` footgun, make `load()` always return `Promise<void>`, and clean up `MaybePromise<T>`/`isPromiseLike` dead code. Ship as v0.1.2.
**Requirements**: TBD
**Depends on:** Phase 0
**Plans:** 2/2 plans executed

Plans:
- [x] 01-01-PLAN.md — Remove MaybePromise/autoLoad from types.ts; make DotEnvLoader async
- [x] 01-02-PLAN.md — Refactor manager.ts load() to always-async; migrate tests; bump to v0.1.2
