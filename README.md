# tasksync

Local‑first task manager with SvelteKit client and Rust (Axum + SQLite) server.

## Getting Started
- `npm install` inside `web/` then `npm run dev` to start the client.
- (Rust) Install toolchain and run the server (default port 3000):
  - `cd server; set DATABASE_URL=sqlite://../data/tasksync.db; set RUST_LOG=info; "%USERPROFILE%\.cargo\bin\cargo.exe" run`
- Copy `.env.example` to `.env` in repo root and adjust client identity:
  - `VITE_SPACE_ID` (default `s1`), `VITE_USER_ID` (`admin` or `contrib`), `VITE_ROLE` (`admin|contributor`), `VITE_API_URL` pointing to the server.
- See `docs/ARCHITECTURE.md` and `docs/AGENTS.md` for constraints and workflow.
- Seed server data (space, users, lists) once: `cd server; set DATABASE_URL=sqlite://../data/tasksync.db; "%USERPROFILE%\\.cargo\\bin\\cargo.exe" run --bin seed` (client now starts empty; no legacy seed tasks are created locally)
- Full test/pre-push suite from PowerShell: `scripts/4-prepush.ps1` (use `-SkipPlaywright` to omit browser run)

## Project Layout
- `web/` — SvelteKit PWA, IndexedDB/OPFS first; tests via Vitest + Playwright.
- `server/` — Axum server with SQLite via SQLx (WAL), role-enforced routes.
- `shared/` — cross‑cutting types for client/server.
- `docs/` — architecture and agent instructions.

## Tooling
- TypeScript strict, ESLint + Prettier; `npm run lint` / `npm run format`.
- Vitest (`npm run test`), Playwright e2e scaffold, `svelte-check`.
- Rust: fmt + clippy + tests (once toolchain installed).

## Git Hooks
Hooks live in `hooks/` and are auto-enabled (`core.hooksPath` set):
- `pre-commit`: web lint/check/test, server fmt + clippy.
- `pre-push`: web unit tests + Playwright smoke (set `SKIP_PLAYWRIGHT=1` to skip), server tests.
Ensure deps are installed (`npm install` in `web/`, Rust toolchain) before committing.
