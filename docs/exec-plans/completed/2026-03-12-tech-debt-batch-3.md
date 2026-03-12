# Execution Plan: Tech Debt Batch 3

**Date:** 2026-03-12
**Branch:** `chore/tech-debt-batch-3`
**Items:** #003, #002, #010

---

## Goal

Close the three remaining active tech-debt items:
- **#003** — Enforce frontend layer boundaries with ESLint rules
- **#002** — Make latency budgets mechanically enforced in CI
- **#010** — Split `server/src/routes.rs` into domain modules

## Non-goals

- Changing any runtime behavior (all three items are tooling/structure only)
- Adding new features or routes
- Rewriting sync logic or data model
- Modifying existing tests beyond adding benchmark assertions

## Constraints

- Performance budgets, offline-first, sync determinism, and server-side role enforcement remain non-negotiable
- `--no-verify` must never be used
- All quality gates (pre-commit, pre-push) must pass after each item
- Each item is committed independently so rollback is surgical

---

## Item assessment

### #003 — ESLint layer boundary enforcement
**Severity:** Med | **Risk:** Low | **Complexity:** Low

**Current state:**
- `docs/FRONTEND.md` defines three forbidden import patterns:
  - `components/` must not import from `data/`
  - `routes/` must not import from `data/`
  - `data/` must not import from `components/` or `routes/`
- No ESLint rule enforces this today. `eslint.config.js` has no import-boundary plugin.
- Known violation: `web/src/routes/+layout.svelte` imports `setDbScope` directly from `$lib/data/idb`.
- No `eslint-plugin-import` is installed. The built-in `no-restricted-imports` rule can enforce the boundary without adding a dependency.

**Proposed approach:**
1. Audit all current violations (`grep -rn "from.*['\"].*\/data\/"` in `components/` and `routes/`).
2. Fix the known `+layout.svelte` violation (route `setDbScope` call through a store or utility, or move the call to a `+layout.ts` server-side init if appropriate).
3. Add `no-restricted-imports` rules to `eslint.config.js` scoped to the violating directories.
4. Run `npm run lint` — all violations must be zero.
5. Update `docs/FRONTEND.md` to note the rules are now enforced mechanically.

**Decision needed before coding:**
- How to fix `+layout.svelte → $lib/data/idb`: the import calls `setDbScope(space, user)` which initializes the IDB namespace. Options:
  - (a) Move the call into a Svelte store's `init()` method that takes the scope as args — keeps data layer ownership in the store.
  - (b) Expose a thin wrapper in `stores/` that internally calls `setDbScope` — cleanest: stores own data initialization.
  - **Recommendation: option (b)**, expose `initializeDbScope(space, user)` from `stores/db.ts` (new or existing) so `+layout.svelte` goes through the store layer. This fully respects store ownership.

**Cross-domain dependencies:** touches `eslint.config.js` and `docs/FRONTEND.md`.

---

### #002 — Latency budgets mechanically enforced in CI
**Severity:** High | **Risk:** Low–Med | **Complexity:** Med

**Current state:**
- `docs/RELIABILITY.md` states budgets "must be backed by a repeatable benchmark harness + CI checks that fail when budgets are exceeded."
- No benchmark harness exists today — no Vitest bench files, no performance assertions in Playwright tests.
- CI (`ci.yml`) runs `npm run lint`, `npm run check`, `npm run test`, and the smoke E2E suite. No perf gate.
- Defined budgets:
  - Primary UI actions: < 16 ms
  - Completion sound onset: < 20 ms
  - Search on 10k tasks: < 100 ms
- The search benchmark is the most tractable (pure in-memory MiniSearch, no browser needed). Sound onset requires a real audio context (browser-only; difficult in CI without a headless audio stack). UI interaction timing is best done in Playwright.

**Proposed approach:**

*Phase A — Vitest benchmark for search (pure unit, no browser)*
1. Add `web/src/lib/stores/search.bench.ts` (or alongside `miniSearch` usage) using Vitest's `bench()` API.
2. Seed 10k synthetic tasks, run MiniSearch query, assert median < 100 ms.
3. Add `"bench": "vitest bench"` script to `web/package.json`.
4. The bench run is informational locally. CI gate comes next.

*Phase B — CI gate (informational threshold, not hard-fail for now)*
- Vitest bench runs don't have a native "fail if > N ms" assertion in a deterministic way across runner hardware. The practical approach is: run bench in CI, capture output, fail only if median exceeds a **generous ceiling** (e.g., 500 ms) to catch catastrophic regressions, not minor variance.
- Add a `bench` step to the `web` CI job.
- Document in `docs/RELIABILITY.md` that the CI ceiling is a "catastrophic regression" gate, not the product budget; the product budget is a developer-local target.

*Phase C — Playwright interaction timing (E2E smoke)*
- Add a `@perf` tagged test that measures `task toggle → state update` round trip using `performance.now()` and asserts < 200 ms (generous E2E budget accounting for test runner overhead). This runs in the smoke gate.
- Sound onset cannot be measured in headless Playwright (AudioContext suspended); skip for now, document as "manual verification only" in RELIABILITY.md.

**Decision needed before coding:**
- Confirm the CI benchmark ceiling: 500 ms for search is proposed as a "not totally broken" gate while still providing regression signal. Tighter would cause flaky failures on slow GitHub runners.
- Confirm whether the Playwright perf test belongs in `@smoke` or a new `@perf` tag that runs alongside smoke.

**Cross-domain dependencies:** `web/package.json`, `ci.yml`, `docs/RELIABILITY.md`, new test files.

---

### #010 — Split `server/src/routes.rs` into domain modules
**Severity:** High | **Risk:** Med | **Complexity:** Med–High

**Current state:**
- `server/src/routes.rs` is **3,972 lines** containing every server handler, type, and helper in a single file.
- It already has logical domain groupings via four public router functions: `list_routes`, `task_routes`, `sync_routes`, `auth_routes`.
- 62 functions total. Domain breakdown (approximate):
  - Auth/user management (login, me, password, settings, preferences, backup/restore): ~1,400 lines
  - Tasks (CRUD, recurrence, My Day, tags, checklist): ~1,200 lines
  - Lists (CRUD, membership, grants): ~600 lines
  - Sync (pull, push, WS): ~500 lines
  - Shared types + helpers (AppState, RequestCtx, normalization fns, auth helpers): ~300 lines
- No behavioral changes — this is a pure mechanical extraction.

**Proposed approach:**
1. Create `server/src/routes/` directory with five files:
   - `mod.rs` — re-exports the four public router fns; `use`s the shared types
   - `types.rs` — `AppState`, `AuthClaims`, `Role`, `RequestCtx`, shared `FromRow` structs, normalizer fns, `ctx_from_headers`, `role_from_membership`, utility fns
   - `auth.rs` — `auth_routes()` + all auth/user/settings/preferences/backup handlers
   - `tasks.rs` — `task_routes()` + all task handlers
   - `lists.rs` — `list_routes()` + all list/membership/grant handlers
   - `sync.rs` — `sync_routes()` + push/pull/websocket handlers
2. Update `server/src/main.rs` to `use routes::` (unchanged public API — only the internal module path changes).
3. Keep `server/src/routes.rs` deleted and replaced by `server/src/routes/mod.rs`.
4. Run `cargo fmt`, `cargo clippy -D warnings`, `cargo test` — all must pass.

**Risk:**
- No behavioral change; `cargo clippy` + `cargo test` provide high confidence.
- The main risk is accidentally moving a shared helper into a domain file that another domain depends on — mitigated by keeping all shared types + helpers in `types.rs` and having domain modules import from it.
- `AppState` and `ctx_from_headers` are used across all domains, so they must live in `types.rs` (or `mod.rs`), not in any domain module.

**Requires its own exec plan?** No — this is a pure mechanical refactor. The approach is fully defined above and the change is contained to `server/src/`. Proceeding directly is appropriate once the batch-3 plan is approved.

**Cross-domain dependencies:** `server/src/main.rs`, `server/src/routes.rs` → `routes/`. No web or shared changes.

---

## Sequencing (lowest risk first)

| Order | Item | Rationale |
|-------|------|-----------|
| 1 | **#003** ESLint boundaries | Zero runtime risk; pure tooling; ships in < 1 session; no decisions pending if approach (b) is accepted |
| 2 | **#002** Latency benchmarks | Runtime-free (test infra only); two well-scoped phases; the CI ceiling decision is the only open question |
| 3 | **#010** routes.rs split | Largest mechanical change; medium risk; isolated to server; must pass clippy + cargo test before commit |

## Items requiring their own exec plan before code

None. All three are self-contained enough to proceed from this plan once decisions above are confirmed.

## Alternatives considered

- **#003: `eslint-plugin-import` or `eslint-plugin-boundaries`** — adds a new dev dependency for capability already achievable with `no-restricted-imports`. Deferred until the built-in approach proves insufficient.
- **#002: Playwright-only perf gate** — Playwright measures real-browser interactions but can't test search without rendering the full app. Vitest bench covers the pure-logic budget more cheaply.
- **#010: Keep routes.rs, just add mod-level comments** — not acceptable; the file is already 4k lines and growing. Module splitting is the only durable fix.

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| `no-restricted-imports` false-positives blocking legitimate imports | Scope rules tightly to the three violating directory pairs only |
| Vitest bench flakiness on GitHub runners | Use a generous ceiling (10×); treat it as catastrophic-regression gate, not product budget |
| `routes.rs` split introduces a compiler error | `cargo build` before and after each file extraction; fix before committing |
| Shared helpers accidentally scoped to wrong module | Identify all cross-domain callees up front; put them in `types.rs` |

## Acceptance criteria

- **#003:** `npm run lint` passes with zero errors on all files in `components/`, `routes/`, `data/`; the three boundary rules are present in `eslint.config.js`; `docs/FRONTEND.md` notes mechanical enforcement.
- **#002:** A Vitest bench file exists and passes locally; CI `web` job runs `npm run bench` and fails if search exceeds 500 ms; `docs/RELIABILITY.md` documents the gate and its intent.
- **#010:** `server/src/routes.rs` is deleted; five module files exist under `server/src/routes/`; `cargo fmt -- --check`, `cargo clippy -D warnings`, and `cargo test` all pass.

## Test plan

- #003: `npm run lint` (pre-existing gate); add a comment in `eslint.config.js` pointing to FRONTEND.md.
- #002: `npm run bench` (new command); CI bench step; one Playwright `@smoke @perf` test for interaction timing.
- #010: `cargo fmt -- --check` + `cargo clippy -D warnings` + `cargo test` (all pre-existing gates).

## Rollout / migration plan

No migration needed — all changes are local tooling or server-internal structure. No client behavior changes.

## Progress log

- 2026-03-12: Plan written. Branch `chore/tech-debt-batch-3` created. Awaiting review.
- 2026-03-12: Plan approved ("In sync. GO!"). Implementation started.
- 2026-03-12: **#003 complete.** Fixed `+layout.svelte` import violation (re-exported `setDbScope` through `stores/tasks.ts`). Added two `no-restricted-imports` rule blocks to `eslint.config.js`. Updated `docs/FRONTEND.md` to document mechanical enforcement. `npm run lint` passes (0 errors). Committed.
- 2026-03-12: **#002 complete.** Created `web/src/lib/stores/tasks.bench.ts` (4 bench cases at 10k tasks; search ~3.7ms, well under 100ms budget). Added `npm run bench` script. Added `npm run bench` step to CI `web` job. Created `web/tests/e2e/perf.spec.ts` (`@smoke @perf` task-toggle test, 200ms ceiling). Updated `docs/RELIABILITY.md` to document all gates. Committed.
- 2026-03-12: **#010 complete.** Deleted `server/src/routes.rs` (3,972 lines). Created `server/src/routes/{mod.rs,types.rs,auth.rs,lists.rs,tasks.rs,sync.rs}`. All 40 tests pass. `cargo fmt -- --check` and `cargo clippy -D warnings` clean. Committed.

## Decision log

- 2026-03-12: Sequencing chosen: #003 → #002 → #010 (risk ascending). #003 option (b) proposed for the `+layout.svelte → data/idb` violation. CI bench ceiling proposed at 500 ms. Awaiting confirmation before code.
- 2026-03-12: Plan approved by user. All three items implemented and committed on `chore/tech-debt-batch-3`.
