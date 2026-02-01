# Contributing to tasksync

## Basics
- Follow `docs/AGENTS.md` and `docs/ARCHITECTURE.md` for constraints, budgets, and testing matrix.
- Dual-licensed MIT OR Apache-2.0 (see LICENSE).
- Default branch: `main`. Use topic branches (`feat/*`, `chore/*`, `fix/*`).

## Setup
- Web: `cd web && npm install`.
- Server: install Rust stable (1.93+), `cargo check`.
- Git hooks are enabled via `core.hooksPath=hooks`:
  - `pre-commit`: `npm run lint && npm run check && npm run test` (web) + `cargo fmt -- --check && cargo clippy -D warnings` (server).
  - `pre-push`: web unit + Playwright smoke (set `SKIP_PLAYWRIGHT=1` to skip) + `cargo test`.

## Tests required per PR
- Web: lint, check, vitest, Playwright smoke; AGENTS budgets/tests for new features.
- Server: fmt, clippy -D warnings, cargo test.

## Coding standards
- TypeScript strict; no `any` without justification.
- Keep UI within latency budgets; offline-first and deterministic sync rules.
- Rust: `fmt`, `clippy -D warnings`; reversible migrations.

## Reporting security issues
See `SECURITY.md` for disclosure process.
