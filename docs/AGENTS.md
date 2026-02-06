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
6. Prefer sharing runnable `.ps1` scripts from `scripts/` for local testing/setup. If a needed script does not exist and the command is reusable, create the script and share that path.
7. If a one-liner is still needed, provide a strict copy/paste-safe command with no leading spaces and no extra separator spacing (for example `...;$env:FOO='x';& ...`, not `...; $env:FOO='x'; & ...`).
8. When outputting runnable commands, never prefix with bullets/dashes/numbers and never wrap a single command onto multiple lines; place each command on its own plain line or in a fenced code block.
9. After each interaction with the user, briefly state overall percent completion for the project/feature.

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

## Script-First Command Policy
- Prefer sharing `.ps1` scripts in `scripts/` for repeated workflows instead of ad-hoc terminal one-liners.
- When sharing a script, include a short "values to update" note if the user may need different paths/ports/IDs.
- Keep one-liners as fallback only.
- Command formatting rule: commands must be copy/paste-safe (`no list markers`, `no leading spaces`, `no extra separator spaces`, `no accidental line wraps`).

## Run Commands (script-first + copy/paste-safe one-liner fallback)
- **Server start (preferred script):** `scripts/2-serve.ps1`
  - Values to update if needed: `DATABASE_URL`, `RUST_LOG`, `JWT_SECRET`, `DEV_LOGIN_PASSWORD`, server port/env in your terminal.
  - One-liner fallback: `cd C:\Repositories\tasksync\server;$env:DATABASE_URL='sqlite://../data/tasksync.db';$env:RUST_LOG='info';& "$env:USERPROFILE\.cargo\bin\cargo.exe" run --bin tasksync-server`
- **Web dev (preferred script):** `scripts/3-web.ps1`
  - Values to update if needed: `VITE_API_URL`, `VITE_SPACE_ID`, `VITE_USER_ID`, `VITE_ROLE`, port.
  - One-liner fallback: `cd C:\Repositories\tasksync\web;npm run dev -- --host`
- **Seed data (preferred script):** `scripts/1-seed.ps1`
  - Values to update if needed: `DATABASE_URL`.
  - One-liner fallback: `cd C:\Repositories\tasksync\server;$env:DATABASE_URL='sqlite://../data/tasksync.db';& "$env:USERPROFILE\.cargo\bin\cargo.exe" run --bin seed`
- **Pre-push verification (preferred script):** `scripts/4-prepush.ps1`
  - Values to update if needed: optional `-SkipPlaywright`.
  - One-liner fallback: `cd C:\Repositories\tasksync\web;npx playwright test`
- **Auth login test (preferred script):** `scripts/5-login.ps1`
  - Values to update if needed: `-ApiUrl`, `-Email`, `-Password`, `-SpaceId`.
  - One-liner fallback: `Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/auth/login' -ContentType 'application/json' -Body '{"email":"admin@example.com","password":"tasksync","space_id":"s1"}'`
- **Ownership/contributor API test (preferred script):** `scripts/6-ownership-check.ps1`
  - Values to update if needed: `-ApiUrl`, `-Password`, `-SpaceId`, `-ListId`, `-AssigneeEmail`, `-CreatorEmail`.
  - One-liner fallback: `cd C:\Repositories\tasksync;scripts\6-ownership-check.ps1`
- **Admin/profile + grants API test (preferred script):** `scripts/7-admin-check.ps1`
  - Values to update if needed: `-ApiUrl`, `-Password`, `-SpaceId`, `-AdminEmail`, `-ListId`, optional `-NewMemberEmail`, optional `-NewMemberDisplay`.
  - One-liner fallback: `cd C:\Repositories\tasksync;scripts\7-admin-check.ps1`
- **Web lint/check/unit fallback:** `cd C:\Repositories\tasksync\web;npm run lint;npm run check;npm run test`

## Backlog Starters
- Sound settings panel
- My Day scoring refinements
- Natural‑language quick add
- CSV/JSON importers
- E2EE key management (V1 option)

