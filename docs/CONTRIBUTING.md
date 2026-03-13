# Contributing to tasksync

## Basics
- Dual-licensed MIT OR Apache-2.0 (see LICENSE).
- Default branch: `main`. Use topic branches (`feat/*`, `chore/*`, `fix/*`).
- Read `docs/index.md` for the knowledge map; `docs/RELIABILITY.md` for budgets and invariants.

## Setup
- Web: `cd web && npm install`.
- Server: install Rust stable (1.93+), `cargo check`.
- Enable automatic pruning of stale remote-tracking refs on every fetch/pull (one-time per clone):
  ```
  git config remote.origin.prune true
  ```
- Git hooks are enabled via `core.hooksPath=hooks`:
  - `pre-commit`: `npm run lint && npm run check && npm run test` (web) + `cargo fmt -- --check && cargo clippy -D warnings` (server).
  - `pre-push`: web unit + Playwright smoke (set `SKIP_PLAYWRIGHT=1` to skip) + `cargo test`.

## Software design principles

These apply to all code — client and server. Follow them literally and in spirit.

### Single responsibility
Every function, module, and file should do one thing well. If a function needs an "and" to describe it, split it. A module, function, or component should have one reason to change — if it mixes state mutation with side effects (sound, network, UI), split it.

### Small, clean functions
Functions should be short, focused, and readable top-to-bottom. Extract when a block has a distinct purpose — not preemptively. A function earns its existence by being called or by clarifying intent.

### Modularity and cohesion
Build composable pieces. Stores, utilities, and components should be self-contained with clear inputs and outputs. Related code lives together — a 2,000-line file mixing six features is a maintenance hazard; split by domain.

### Explicit over implicit
Prefer named parameters, clear return types, and obvious control flow. Avoid magic strings, implicit ordering dependencies, and action-at-a-distance.

### Minimal coupling
Depend on interfaces, not implementations. UI components should not know about persistence. Stores should not know about UI structure. Thin wrappers and pass-throughs that add no logic obscure intent — prefer direct calls. Follow the layered dependency model in `docs/FRONTEND.md`.

### DRY — but not prematurely
Extract repeated patterns when the repetition is structural (e.g., persist-after-mutate). Three similar lines are fine; fifteen identical call sites are not. Two similar blocks are not yet a pattern. Premature abstraction is worse than duplication.

### Fail fast and visibly
Validate at boundaries (user input, API responses, external data). Internal code can trust the contracts established at those boundaries. When something is wrong, surface it early — don't silently swallow errors.

### Naming is documentation
Names should describe what something *is* or *does*, not how it's implemented. `getOverdueTasks` > `filterByDate`. `isOffline` > `checkFlag`. If you need a comment to explain *what* code does, rename it instead. Reserve comments for *why*.

### Type safety
Use TypeScript `strict` mode; no `any` without justification. Avoid `@ts-nocheck` and loose `string` where a union type exists. Validate at system boundaries (API responses, wire formats).

### Defensive async
Guard against stale state in async operations. Don't fire-and-forget without error handling. Capture time-sensitive values once per operation.

### Test coverage
Every public method and exported function should have explicit test coverage. Untested surface area is unverified behavior.

### Keep state minimal and local
Prefer derived/computed values over stored duplicates. Keep state as close to its consumer as possible. Global stores are for genuinely cross-cutting concerns.

### Delete freely
Dead code, unused imports, commented-out blocks, and speculative abstractions are liabilities. Remove them. Version control remembers.

## Coding standards
- Keep UI within latency budgets defined in `docs/RELIABILITY.md`; offline-first and deterministic sync rules.
- Rust: `fmt`, `clippy -D warnings`; reversible migrations.
- Keep component render cost low; use derived stores and memoization.
- All network calls robust to offline (retry with backoff).

## Tests required per PR
- Web: lint, check, vitest; E2E smoke for flows that cross modules or are regression-prone.
- Server: fmt, clippy -D warnings, cargo test.
- Every new component/store/module must include at least one unit test, plus E2E when behavior is user-visible or cross-module.

## Reporting security issues
See `SECURITY.md` for disclosure process.
