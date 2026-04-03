# AGENTS.md (tasksync)

> Detailed operating instructions for AI coding assistants working in this repo.
> For the quick-start map, see the root `AGENTS.md`.

## Guiding principles
1. **Speed first** — never regress latency budgets (`docs/RELIABILITY.md`).
2. **Local-first** — all features must work offline; the server is a sync rendezvous.
3. **Simplicity** — prefer small utilities over large frameworks; avoid heavy deps without proof of value.
4. **Security** — enforce roles server-side; contributors are create-only.
5. **Determinism** — sync and conflict rules must be fully testable and idempotent.

## Tech stack
- **Client:** SvelteKit + TypeScript; IndexedDB/OPFS; WebAudio; MiniSearch.
- **Server:** Rust (Axum + SQLx) + SQLite (WAL); JWT auth.
- **Testing:** Vitest + Playwright (web), cargo test (server).

## Coding standards

Follow `docs/CONTRIBUTING.md` — especially the software design principles section.

Key rules:
- TypeScript `strict`; no `any` unless justified.
- Keep component render cost low; use derived stores and memoization.
- Use SharedWorker for sync/indexing; never block the UI thread.
- All network calls robust to offline (retry with backoff).
- Server endpoints validate role + list grants for every change.
- Database migrations must be reversible.
- Respect `.editorconfig`, ESLint/Prettier, rustfmt; no unchecked formatting diffs.
- Lint/test discipline: run `npm run lint && npm run check && npm run test` after changes; `cargo fmt -- --check && cargo clippy -D warnings && cargo test` for server.

## Communication style
- Default to plain language and practical outcomes over deep technical detail.
- Keep responses concise unless the user asks for deep dives.
- Avoid over-engineering proposals; favor the smallest reliable next step.
- When the user is under pressure, prioritize calm, direct recovery guidance first.

## Git & CI/CD
- Never work directly on `main`. Create topic branches (`feat/`, `fix/`, `chore/`, `docs/`).
- `core.hooksPath=hooks` is set. Hooks must pass before committing/pushing.
- Prefer conventional commits (`feat:`, `fix:`, `chore:`).
- Never use `--no-verify`. Fix the root cause.
- CI/CD: GitHub Actions (`.github/workflows/ci.yml`) is the source of truth.
  - Docker publishing: `main` → `latest` tags; non-main → `beta` tags.
  - Required secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`.
  - Runtime config (web): environment variables (`VITE_API_URL`, `VITE_ALLOWED_HOSTS`).

## File naming & structure
- `shared/types/<domain>.ts` — shared DTOs/schemas
- `web/src/lib/stores/*` — one store per domain
- `web/src/lib/components/*` — UI components
- `web/src/lib/data/*` — IndexedDB repo + persistence
- `web/src/lib/sync/*` — sync coordinator + worker
- `web/src/lib/sound/*` — audio runtime
- `web/src/lib/markdown/*` — import parsing
- `server/src/routes/*` — Axum route modules
- `server/src/db/*` — migrations, models, queries

## Performance budgets (see `docs/RELIABILITY.md` for full details)
- Primary UI actions: **<16 ms**
- Audio onset after check: **<20 ms**
- Search on 10k tasks: **<100 ms**

## Required tests (see `docs/RELIABILITY.md` for gate details)
- **Client**: unit tests for stores; Playwright flow for add → complete; offline add/complete; sound plays once; no jank.
- **Server**: role enforcement (contributors cannot edit/delete/complete); sync idempotency.
- **New code**: every new component/store/module must include at least one unit test, plus E2E when behavior is user-visible or cross-module.

## Definition of done
- Feature works offline, survives reload.
- Syncs correctly, respects roles, passes all tests.
- No new spinners; optimistic UI is immediate.
- All budgets green in CI.
- Docs updated if behavior changed.

## Logs
- Progress and roadmap are tracked in per-plan progress logs (see `docs/PLANS.md`).
- Legacy logs archived in `docs/exec-plans/completed/legacy-progress-and-roadmap.md`.

## Security
- Follow `SECURITY.md` for disclosures; avoid logging secrets.
- Keep deps lean; prefer upgrades over pinning vulnerable packages.
