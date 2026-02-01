# AGENTS.md (tasksync)

> Operating instructions for AI coding assistants (Cursor/Codex) working in this repo.

## Guiding Principles
1. **Speed first**: never regress latency budgets. Avoid heavy deps without proof of value.
2. **Local‑first**: all features must work offline; server is a sync rendezvous.
3. **Simplicity**: prefer small utilities over large frameworks.
4. **Security**: enforce roles server‑side; contributors are **create‑only**.
5. **Determinism**: sync and conflict rules must be fully testable and idempotent.

## Tech Stack
- **Client:** SvelteKit + TypeScript; IndexedDB/OPFS; WebAudio; MiniSearch.
- **Server:** Rust (Axum + SQLx) + SQLite (WAL); JWT auth; file store on disk.
- **Testing:** Vitest + Playwright (web), cargo test (server).

## Coding Standards
- TypeScript `strict` mode; no `any` unless justified.
- Keep component render cost low; use derived stores and memoization.
- Use **SharedWorker** for sync/indexing; never block the UI thread.
- All network calls robust to offline (retry with backoff).
- Server endpoints validate **role + list grants** for every change.
- Database migrations must be reversible.
- You will be operating with both Codex and Cursor. Plan to create a linter, install relevant ones, and lint after each code change. Should use linters for security and for styling.
- Lint/test discipline: run `npm run lint && npm run check && npm run test` after each commit; run `cargo fmt -- --check && cargo clippy -D warnings && cargo test` on server changes. Do not skip.
- Respect `.editorconfig`, ESLint/Prettier, rustfmt; no unchecked formatting diffs.

## Git & Hooks
- `core.hooksPath=hooks` is set. Hooks must pass before committing/pushing:
  - `pre-commit`: web lint/check/test; server fmt + clippy.
  - `pre-push`: web unit + Playwright smoke (skip only with `SKIP_PLAYWRIGHT=1` and note why); server tests.
- Prefer conventional-ish commits (`feat:`, `fix:`, `chore:`) to keep history tidy.
- Keep `PROGRESS.md` updated when you finish a meaningful chunk.

## Security & Compliance
- Follow `SECURITY.md` for disclosures; avoid logging secrets.
- Use linters for security signals (ESLint rules, future dependency scans). Keep deps lean; prefer upgrades over pinning vulnerable packages where feasible.

## Performance Budgets (must pass CI)
- Handler time for primary UI actions: **<16 ms**.
- Audio onset after check: **<20 ms**.
- Search results for 10k tasks: **<100 ms**.

## Required Tests (per PR)
- **Client**: unit tests for stores; Playwright flow for add → complete; offline add/complete; sound plays once; no jank.
- **Server**: role enforcement (contributors cannot edit/delete/complete); sync idempotency; attachment size limit.
- **Property tests**: version‑vector merge associativity/commutativity.
- **New code rule**: every new component/store/module (client or server) must include at least one unit test, plus a functional/e2e test when behavior is user-visible or cross-module. Use Vitest for unit, Playwright for UI flows, Rust `cargo test`/Axum integration tests for server endpoints. Do not add untested features unless explicitly waived.

## How to Work (Cursor prompts)
### Implement a feature
1. Read `ARCHITECTURE.md` and relevant code.
2. Add types in `shared/types` if needed.
3. Implement client logic (stores/repo), then UI.
4. Add server endpoints/migrations only if required.
5. Write tests and ensure perf budgets.
6. When asking the user to test locally, provide one-line commands with env vars set explicitly for each terminal (see “Run Commands”).
7. After each interaction with the user, briefly state overall percent completion for the project/feature.

**Prompt**
```
You are implementing <feature>. Follow ARCHITECTURE.md and AGENTS.md.
Constraints: maintain latency budgets; offline-first; no new heavy deps.
Deliver: code changes + tests; note any migrations.
```

### Fix a bug
**Prompt**
```
Investigate <bug>. Provide minimal repro, root cause, and a small patch.
Add a test preventing regression. Stay within latency budgets.
```

### Add/modify API
**Prompt**
```
Design <endpoint>. Validate admin/contributor rules. Include SQL migration and handler.
Return JSON with explicit errors per change on sync push. Update shared types.
```

## File Naming & Structure
- `shared/types/<domain>.ts` – shared DTOs/schemas
- `web/src/lib/stores/*` – one store per domain
- `web/src/lib/sound/sound.ts` – audio helper
- `server/src/routes/*` – Axum route modules
- `server/src/db/*` – migrations, models, queries

## Definition of Done
- Feature works offline, survives reload.
- Syncs correctly, respects roles, passes tests.
- No new spinners; optimistic UI is immediate.
- All budgets green in CI.

## Run Commands (one-liners for manual testing)
- **Server (Terminal 1)**: `cd server && set DATABASE_URL=sqlite://../data/tasksync.db && set RUST_LOG=info && "%USERPROFILE%\\.cargo\\bin\\cargo.exe" run`
- **Web dev (Terminal 2)**: `cd web && npm run dev -- --host`
- **Playwright e2e**: `cd web && npx playwright test`
- **Web lint/check/unit**: `cd web && npm run lint && npm run check && npm run test`

## Backlog Starters
- Sound settings panel
- My Day scoring refinements
- Natural‑language quick add
- CSV/JSON importers
- E2EE key management (V1 option)

