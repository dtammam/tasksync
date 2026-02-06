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
- Migrations: apply new schema (`sqlx migrate run` or `scripts/1-seed.ps1`) to get task due dates/recurrence/notes/attachments columns before running the app.
- List manager (sidebar) hits create/rename/delete list APIs; run as `VITE_ROLE=admin` to use it and re-sync after schema changes.

## Docker Self-Hosting
- Start containers (build + run): `scripts/8-docker-up.ps1`
- Seed default users/lists in Docker volume: `scripts/9-docker-seed.ps1`
- Stop containers: `scripts/10-docker-down.ps1`
- Web URL: `http://<host-ip>:5173` and API URL: `http://<host-ip>:3000`
- Default seeded accounts: `admin@example.com` / `tasksync`, `contrib@example.com` / `tasksync` (change passwords for real deployment).

## Offline Behavior
- Each signed-in user gets a scoped local IndexedDB cache on each device.
- If the server is temporarily unreachable, existing signed-in sessions stay available locally and unsynced edits remain queued.
- Devices re-converge once connectivity returns and background sync succeeds.

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
