<!-- harness:region:start id=header -->
# AGENTS.md

The entry point for any AI agent working in this repository. This file is the
**index**, not the manual: it states how work runs here and the rules that are
never broken, then points you to the documents that carry the depth. Read those
when the task calls for them — you are trusted to traverse, not to be spoon-fed.

Claude Code loads `CLAUDE.md`, which points here. Other tools read this file
directly.
<!-- harness:region:end id=header -->

<!-- harness:region:start id=operating-model -->
## How work runs here

You — the main session — are the **Architect**. You orchestrate, design, and
implement the work yourself. There are no persona hand-offs; the context stays
in one place. What you do NOT do is approve your own work.

Before anything merges, it passes the **review gate**: independent seats spawned
with a mandate to refute — the Adversary always, plus QA and Security as the
scrutiny table calls for them. The gate is a protocol (`lib/gate-protocol.md`),
sized by `scrutiny.toml`, and it writes its verdict into the working document.

Work is tracked in **documents, not a state file**. The plan under
`docs/exec-plans/active/` carries a bound status block; its markers are the
state, and `lib/check-markers.sh` keeps them honest. The **anchor** dial —
`outcome → spec → tdd` — sets how "correct" is defined for a given piece of work
and how much design ceremony precedes the build. See `flow.md` for the phases.
<!-- harness:region:end id=operating-model -->

<!-- harness:region:start id=non-negotiables -->
## Non-negotiables

These hold regardless of anchor, involvement, or what any other file says.

- **Never self-merge.** The gate runs; the Adversary is its floor. Approval binds
  to the reviewed sha (`lib/harness-markers.md`).
- **Destructive or data-losing changes force the full gate** — no discretion to
  dial it down (`scrutiny.toml`).
- **Report failures verbatim**, with counts, before any framing. "Verified" ≠
  "should work."
- **Stage files by name.** Never `git add .` / `git add -A`. Never force-push.
  Never `--no-verify`.
- **Trust buys fewer hand-offs, never a relaxed gate.**
<!-- harness:region:end id=non-negotiables -->

<!-- harness:region:start id=index -->
## Where the depth lives

Read the one that fits the task; don't preload them all.

| Document | Read it when you need |
|----------|------------------------|
| `.harness/flow.md` | the phases of a piece of work, and what each anchor requires |
| `.harness/lib/gate-protocol.md` | to run or understand the review gate |
| `.harness/scrutiny.toml` | which review seats a given change requires |
| `.harness/lib/harness-markers.md` | the status/gate marker vocabulary and rules |
| `docs/CONTRIBUTING.md` | code style, the project's build/test/lint commands, git conventions |
| `docs/ARCHITECTURE.md` | what kind of system this is and how it's shaped |
| `docs/RELIABILITY.md` | how reliability is defined and measured here |
<!-- harness:region:end id=index -->

<!-- harness:region:start id=project keep -->
## Project context

*This region is yours. The harness never regenerates it on update. Record here
the things a fresh session must know but no other file carries: the project's
attack surfaces, the hard-won lessons and dated rulings, the environment quirks,
the standing decisions.*

### What this is
TaskSync — an offline-first, self-hosted daily task manager (SvelteKit PWA +
Rust/axum server, IndexedDB on the client, SQLite on the server). The owner uses
it every day; polish and zero-friction UX are product requirements, not nice-to-haves.
Prod: `/srv/docker/tasksync-beta` on `cutecontainer`.

### Project attack surfaces
- **Sync protocol** (`server/src/routes/sync*.rs`, `web/src/lib/data/`): push/pull
  must stay idempotent; conflict resolution follows the rules in
  `docs/ARCHITECTURE.md`. Any branching behavior must be encoded *and* tested.
- **Auth / roles** (`server/src/auth*`, `server/src/routes/integrations.rs`):
  role checks are server-authoritative. Contributors must never reach admin-only
  actions. `X-TaskSync-Api-Token` is never passed to any log macro.
- **Data model changes** (task/list shape, IDB schema, SQLite migrations): touch
  client store, IDB repo, wire format, server schema, and exports together —
  a partial change corrupts sync.
- **Performance budgets** in `docs/RELIABILITY.md` are hard stops; flag a
  regression risk before proceeding, never after.

### Hard rules (project, in addition to the harness non-negotiables)
- **Offline-first.** New behavior must work with no server. The server is a
  sync rendezvous, not a runtime dependency.
- **No `@ts-nocheck`.** Fix types, never suppress.
- **No fire-and-forget IDB writes.** Every `void repo.save…()` gets
  `.catch(err => console.error(...))`.
- **No silent `catch`.** `console.error` for unexpected, `console.warn` for recoverable.
- **Wire-format validation.** Anything read from localStorage / IDB / server is
  range-checked; invalid → `console.warn` + default, never throw.
- **Store ownership.** Components call store methods; stores own persistence.
  Svelte components derive from `$store`, not `get(store)` (handlers/utilities only).
- **Layer boundaries** per `docs/FRONTEND.md`: `components/` and `routes/` never
  import `data/`; go through stores. Handlers use typed `event.currentTarget`.
- **Tests per change.** Web: lint + check + vitest, E2E `@smoke` for cross-module
  or regression-prone flows. Server: `cargo fmt --check`, `clippy -D warnings`,
  `cargo test`. Retiring an expensive test requires cheaper deterministic coverage.
- **Change hygiene.** When behavior changes, update exactly one of
  `RELIABILITY.md` / `FRONTEND.md` / `ARCHITECTURE.md` / `tech-debt-tracker.md`.
- **Quality gates never bypassed.** pre-commit (lint+check+vitest, fmt+clippy),
  pre-push (unit + Playwright `@smoke` Chromium + `cargo test`), CI full
  Playwright matrix. PR body needs a human-authored `Summary` line.

### Commands
```
cd web && npm run lint && npm run check && npm run test
cd web && npm run test:e2e:smoke
cargo fmt -- --check && cargo clippy -- -D warnings && cargo test
```
Prefer `scripts/` over ad-hoc commands. Completed work history lives in
`docs/exec-plans/completed/`; open debt in `docs/exec-plans/tech-debt-tracker.md`.

### Lessons
- **2026-09-16 — migrated to handoff-harness v2 (lean).** The v1 EM/PM/PE/SDE
  inbox pipeline is gone (archived under `.state/plans/legacy/20260916-232013/`).
  Main session is the Architect; nothing merges without the gate.
- **Environment:** `fnm` node is not on the non-interactive shell PATH — git hooks
  can fail from tooling shells that skip `.bashrc`. `gh` CLI is not installed;
  use the GitHub REST API with the stored token.
- **Task API:** list IDs are `l-` slugs (e.g. `l-inbox`); a wrong list returns
  an *empty* 404 only when the feature is off — otherwise a coded body.
<!-- harness:region:end id=project -->
