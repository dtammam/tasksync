# tasksync

Local‑first task manager with SvelteKit client and Rust (Axum + SQLite) server.

## Getting Started
- `npm install` inside `web/` then `npm run dev` to start the client.
- (Rust) Install toolchain and run `cargo run -p tasksync-server` for the API (default port 3000).
- See `docs/ARCHITECTURE.md` and `docs/AGENTS.md` for constraints and workflow.

## Project Layout
- `web/` — SvelteKit PWA, IndexedDB/OPFS first; tests via Vitest + Playwright.
- `server/` — Axum server scaffold with SQLite via SQLx (WAL).
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
