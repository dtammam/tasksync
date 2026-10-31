---
plan: integration-api-read-complete
harness: v2 · lean
branch: feat/integration-api-read-complete
anchor: spec
status: Approved
next: Write ## Design (D1-D11 interfaces, file-by-file), then launch the Smart-tier builder
gate: pending
---

# Scoped integration API: read, complete, uncomplete

## Request

Let an automated caller (first consumer: the home-server voice assistant)
**find** a task and **complete / uncomplete** it with the same semantics as
tapping it in the web app, authenticated by a scoped static token, never a
login. Built as a general integration surface (Home Assistant, Shortcuts,
etc.), not a consumer-specific endpoint. Source: an agent-authored brief,
taken as intent, not as spec; deviations from it are recorded below.

## Blind-spot findings (2026-10-31)

1. **The server has no notion of "today".** Web My Day uses device-local
   date (`web/src/lib/stores/tasks.ts:89`, `toLocalIsoDate(new Date())`).
   No timezone is stored anywhere server-side. The brief's "use the space or
   user timezone the web app uses" has no referent.
2. **Existing inconsistency:** `web/src/lib/stores/streak.ts:16` uses a **UTC**
   date (`toISOString().slice(0,10)`), so streak "today" and My Day "today"
   diverge every evening west of UTC.
3. **Month-end overflow bug:** `addMonths` (`web/src/lib/tasks/recurrence.ts`)
   uses `Date.setMonth`, so monthly from Jan 31 → **Mar 3** (verified with
   node). A parity test as written in the brief would enshrine it in Rust.
4. **Web completion is client-computed.** `tasks.toggle()` computes next due
   (`nextRecurringDueAfterCurrent`, tasks.ts:195) and pushes absolute values
   through `UpdateTaskMeta`. Offline-first forbids routing the app through the
   server, so "one shared function" is realized as **one shared case table**
   both implementations must pass, not shared code.
5. **Web undo is lossy.** `undoRecurringCompletion` (tasks.ts:832) only works
   same-day and computes `prevDueForRecurrence(due)`, which does not restore a
   punted anchor, and (after the clamp fix) is not an inverse at month end
   (Jan 31 → Feb 28 → Jan 28).
6. **Owner resolution is nondeterministic.** `ctx_from_api_token`
   (`server/src/routes/types.rs:289`) selects the admin membership with
   `limit 1` and no `order by`.
7. **The brief's `undo: {...}` echo-back blob is an arbitrary-write channel**
   (caller supplies field values the server restores). Rejected; see D5.
8. **Field naming:** client `recurrence_id` ↔ server/wire `recur_rule`.
9. **Streak:** the combo is driven only by in-session `tasks.toggle()`;
   `mergeRemote` never touches streak state, so remote completions are
   invisible to it today.
10. Concurrency: `mergeRemote` skips `dirty` local tasks, so an offline phone
    edit racing an API completion resolves last-writer-wins on push. Absolute
    values (not deltas) keep this bounded to "one side's view wins"; noted,
    not addressed here.

## Rulings already made (Dean, 2026-10-31)

- Server "today" comes from an env var (revised in D3: the standard `TZ`, not
  `TASKSYNC_TZ`). Fix `streak.ts` UTC date to local in its own commit.
- **No new crate dependencies** (Dean, 2026-10-31, at approval). Use what is in
  `server/Cargo.toml` (`chrono` 0.4 `clock`): `chrono::Local` for "today",
  `NaiveDate` for recurrence math.
- Month-end: **clamp in both** TS and Rust (Jan 31 → Feb 28/29), driven by one
  shared case table, its own commit (deliberate, small web behavior change).
- Streaks: remote completions fire **day-complete only** (no combo bump, no
  announcer); own commit, droppable.

## Decision register (ordered by blast radius)

| ID | Decision | Recommendation | Rationale |
|----|----------|----------------|-----------|
| D1 | Token model | Keep `TASK_API_TOKEN` (scope `create`). Add `TASK_AGENT_TOKEN` (≥24 chars, boot-validated like the existing one) with scopes `read`, `complete`, `create`. Scopes are a set (`AuthScope` → scope flags), so a future token is a config line, not a refactor. No DB token table yet. | Generic enough without a token-management UI nobody asked for. |
| D2 | Acting identity | `TASK_API_USER_EMAIL` (applies to both tokens). Unset → deterministic fallback: oldest admin (`order by` created/rowid). Unknown email → boot failure. | Fixes finding 6; "My Day" is per-user. |
| D3 | Server "today" | Standard **`TZ`** env read by `chrono::Local` (no `chrono-tz`). Runtime image adds the `tzdata` apt package so IANA names (`America/New_York`) resolve; a POSIX string (`EST5EDT,M3.2.0,M11.1.0`) also works with no files. chrono silently falls back to UTC on an unresolvable name, so boot checks it: `TZ` set to a name with no `/usr/share/zoneinfo/<name>` and not POSIX-shaped → boot failure; unset → UTC with a boot `warn`. Every read response includes `"today": "YYYY-MM-DD"`. | Finding 1; no new crate (ruling); the caller never has to guess. |
| D4 | Complete semantics + idempotency | `POST /api/tasks/:id/complete`, body `{"expected_due_date"?: "YYYY-MM-DD"}`. Recurring: next due from anchor `punted_from_due_date ?? due_date` (advance past current due), `occurrences_completed+1`, `completed_ts=now`, punt cleared, status stays `pending`. One-off: `status=done`, `completed_ts=now`. **Already done** (one-off done, or recurring with `completed_ts` today and `expected_due_date` ≠ current due) → 200 `already_done:true`, no write. `expected_due_date` ≠ current due and not completed today → 409 `conflict`. | Precondition gives retry-safety with no op-id table; also stops a stale caller from completing the wrong occurrence. |
| D5 | Uncomplete | `POST /api/tasks/:id/uncomplete`, body `{"previous_due_date"?: ..., "expected_due_date"?: ...}`. One-off done → `pending`, `completed_ts=null`. Recurring completed today → `due_date = previous_due_date` **only if** the server's own next-due from it equals the current due (validated, so not arbitrary write); else `prevDue(due)`. `occurrences_completed-1` (floor 0), `completed_ts=null`. Not completed today → 409 `conflict`. Precondition mismatch → 409. | Replaces the echo-back blob (finding 7) and fixes month-end/punt lossiness (finding 5) for API callers. |
| D6 | Read routes | `GET /api/lists` → `[{id,name,icon,default_emoji}]`. `GET /api/tasks?view=today\|all&q=&list_id=&status=&include_done_today=` → `{today, tasks:[TaskRow + is_recurring, done_today, next_due_date]}`. `view=today` = web My Day pending (`my_day \|\| due==today`, pending, not missed, assigned to acting user) plus, if `include_done_today`, done-today items. `q` = case-insensitive substring; no fuzzy matching server-side. | Matching intelligence belongs to the caller. Wrapped object (not bare array) leaves room for `today`. |
| D7 | Errors / feature-off | Reuse `ApiTaskError`. Feature off (no token configured for any scope a route needs) → concealed empty 404. New codes: `forbidden_scope` (create-only token on read/complete), `not_found` (task id), `conflict`. | Consistent with the existing contract. |
| D8 | Sync visibility | All writes bump `updated_ts` via the existing update path so `/sync/pull` carries them. Punt-field clearing must actually null the columns (verify against the COALESCE behavior noted at tasks.ts:186). | Open clients must see check-offs. |
| D9 | Recurrence parity | Rust `recurrence.rs` with `next_due`, `prev_due`, `next_due_after_current`. Cases live in **one JSON fixture** (`shared/recurrence-cases.json` or under `web/src/shared/`) consumed by a vitest test and a `cargo test`. Covers all 9 rules, punted anchors, 29/30/31 month ends, Feb 29 (leap & non-leap), DST-boundary dates. | Single source of truth both sides must pass. |
| D10 | Day-complete on sync | After `mergeRemote`, if My Day transitions to `pending==0 && completed>0` and remote data caused it, call `streak.triggerDayComplete()` (already once-per-day guarded). No `increment`. | Ruling; separate commit. |
| D11 | Docs | `docs/API.md` (new): every route, exact JSON, curl. Env vars added to `.env.example` and `docs/SECURITY.md` token section. | Brief's handoff note lives in repo. |

## Acceptance (measurable)

- A1 `cargo test`: create-only token → 403 `forbidden_scope` on `GET /api/tasks`, `GET /api/lists`, `POST …/complete`, `POST …/uncomplete`; agent token → 2xx on all four and on `POST /api/tasks`; no/wrong token → 401 `unauthorized`; no tokens configured → empty-body 404.
- A2 `cargo test`: completing a daily, weekly, punted daily, and one-off task yields the field values in D4; a second identical call returns `already_done:true` and leaves `updated_ts` unchanged.
- A3 `cargo test`: uncomplete after complete restores `due_date`, `occurrences_completed`, `completed_ts`, `status` byte-identical, including a Jan 31 monthly and a punted task when `previous_due_date` is supplied.
- A4 `cargo test`: a completion's row appears in `/sync/pull` with `since_ts` = pre-completion cursor.
- A5 vitest + `cargo test` both consume the same case-table file and pass; the table has ≥1 case per rule, plus month-end, leap-day, punt and DST cases; Jan 31 monthly → Feb 28 (2026) / Feb 29 (2028).
- A6 `cargo test`: `view=today` on a seeded fixture returns exactly the ids the web `myDayPending` predicate selects for the same fixture and date (fixture shared, or ids asserted on both sides).
- A7 vitest: `streak.ts` "today" equals `toLocalIsoDate(new Date())` under a TZ where local ≠ UTC date.
- A8 vitest: a `mergeRemote` that empties My Day pending triggers day-complete once and does not change `count`.
- A9 Existing suites green: web lint/check/vitest/@smoke, `cargo fmt --check`, `clippy -D warnings`, `cargo test`.
- A10 `docs/API.md` exists with a curl example per new route; `.env.example` lists `TASK_AGENT_TOKEN`, `TASK_API_USER_EMAIL`, `TZ`.
- A11 `server/Cargo.toml` `[dependencies]` and `[dev-dependencies]` are unchanged vs. base (`git diff` on those sections is empty); `server/Dockerfile` runtime stage installs `tzdata`.
- A12 `cargo test`: boot validation rejects `TZ=Not/AZone`, accepts `TZ=America/New_York` (when zoneinfo present) and a POSIX string; server "today" for a fixed instant differs between `TZ=UTC` and `TZ=America/New_York` across local midnight.

## Commit plan (each independently droppable after #1)

1. Recurrence case table + month-end clamp (TS) + Rust port.
2. Scoped tokens, acting identity, `TZ` + `tzdata`, read routes.
3. Complete / uncomplete routes.
4. `streak.ts` local-date fix.
5. Day-complete on remote merge.
6. Docs (`API.md`, `.env.example`, `SECURITY.md`).

## Scrutiny

Touches auth (new token, scopes) and task write semantics → Adversary + QA +
Security seats. Not destructive, but uncomplete writes historical fields, so
the Adversary should attack D5's validation specifically.

## Consumer coordination

- First consumer: the voice assistant behind SANDYJAR Host Root (Remote Control session).
  It accepted the shape above on 2026-10-31.
- Test list on beta for the consumer's automated writes: **Agent Test**,
  `e4f7b340-91cc-4141-a02e-6b4315e4c092` (created by Dean in the app).
- On ship: send that session the `docs/API.md` path and the commit/tag.

## Design

Dean approved going straight from the approved register into build and gate
(2026-10-31: "go straight through... to me asking to merge"), so this section
records the design rather than holding for a separate approval.

### Components

- **`shared/fixtures/recurrence-cases.json`**: the single case table. Sections
  `next` (`date, rule → expected`), `prev`, `after_current`
  (`due, punted_from, rule → expected`). Read by
  `web/src/lib/tasks/recurrence.parity.test.ts` (run under several `TZ`s, including
  `America/New_York`, `America/Santiago` and `Pacific/Auckland`, for DST) and by
  the `#[cfg(test)]` module of `server/src/routes/recurrence.rs` via
  `include_str!`. That module is test-only, so the release Docker build, which
  copies only `server/`, is unaffected.
- **`web/src/lib/tasks/recurrence.ts`**: `addMonths` clamps the day to the end of
  the target month. `nextRecurringDueAfterCurrent` moves into this module
  (exported) so the parity test exercises the real function. `tasks.ts` imports it.
- **`server/src/routes/recurrence.rs`**: `is_recurrence_rule`, `next_due`,
  `prev_due`, `next_due_after_current`, all on `chrono::NaiveDate`
  (`checked_add_months` clamps natively).
- **`server/src/routes/clock.rs`**: `validate_tz(value, zoneinfo_dir)` (pure),
  `local_date_of_ms(ms)`, and a `Clock { fixed_now_ms: Option<i64> }` held in
  `AppState` (production is `None`, tests pin it). `today()` / `now_ms()` go
  through it.
- **`server/src/routes/types.rs`**:
  - `AppState` gains `agent_token: Option<String>`, `api_user_email: Option<String>`
    and `clock`.
  - `AuthScope` becomes `Session | Api(ApiScopes)`, where `ApiScopes { read,
    complete, create }`. `ctx_from_api_token` compares against both configured
    tokens in constant time, and its role comes from the acting user's membership.
  - `validate_boot_secrets` adds the `TASK_AGENT_TOKEN` length check and `TZ`.
  - `validate_api_identity(pool)` runs after migrations and fails boot when
    `TASK_API_USER_EMAIL` is set but matches no membership.
- **`server/src/routes/task_actions.rs`**: `complete_task_for_ctx` and
  `uncomplete_task_for_ctx`. These are generic (any `RequestCtx`), with the same
  contributor rule as `update_task_status_for_ctx` (creator only). Writes are a
  single `UPDATE … WHERE updated_ts = <read value>` (optimistic concurrency); if
  zero rows change, the request returns 409.
- **`server/src/routes/integrations.rs`**: the error type gains `not_found`,
  `due_date_mismatch`, `not_completed` and `invalid_request`, and the new
  handlers live here. Route table:
  `/tasks` GET+POST, `/lists` GET, `/tasks/:id/complete`, `/tasks/:id/uncomplete`.

### Interfaces (wire)

- `GET /api/lists` → the same `ListRow[]` as session `GET /lists` (a superset of
  the brief's fields).
- `GET /api/tasks` → `{ today, view, tasks: [TaskRow & {is_recurring, done_today,
  next_due_date}] }`. `include_done_today` applies to `view=today` only; there,
  done-today items are the web `myDayCompleted` set minus punted-today.
- `POST /api/tasks/:id/complete` `{expected_due_date?}` →
  `200 {task, completed:true, already_done, previous_due_date, next_due_date}`.
  When `already_done` is true: `previous_due_date: null`, and `next_due_date` is
  the current `due_date`.
- `POST /api/tasks/:id/uncomplete` `{previous_due_date?, expected_due_date?}` →
  `200 {task, uncompleted:true}`. `previous_due_date` is honored only if
  `prev_due(current) <= previous < current`; otherwise `prev_due(current)` is
  used. One-off: any `done` task. Recurring: only when completed today.
- Errors:
  - 401 `unauthorized`
  - 403 `forbidden_scope` / `forbidden`
  - 404 `not_found`
  - 400 `invalid_request` (malformed date)
  - 409 `due_date_mismatch` (expected ≠ current and not completed today)
  - 409 `not_completed` (uncomplete with nothing to undo)
  - 409 `conflict` (concurrent write lost the race)

### Steps

1. Shared table, TS clamp, Rust port. *Demo:* both test suites pass on the same
   JSON; Jan 31 monthly → Feb 28.
2. Clock/TZ, scopes, identity, read routes. *Demo:* `curl -H token /api/tasks?view=today`
   returns My Day.
3. Complete/uncomplete. *Demo:* complete twice → `already_done`; uncomplete
   restores.
4. `streak.ts` local date. *Demo:* vitest under `TZ=America/New_York` at 23:00 local.
5. Day-complete on remote merge. *Demo:* vitest merge that empties My Day fires once.
6. Docs.

## Deviations

- Read `GET /api/lists` returns full `ListRow` (superset), not the brief's 4 fields.
- 409 is split into three codes (`due_date_mismatch`, `not_completed`,
  `conflict`) instead of one `conflict`. The status is still 409, and the
  consumer will be told at ship.
- Clamping causes drift: monthly from the 31st becomes the 28th after February
  and stays there (the overflow it replaces drifted too). `lastDayOfMonth` is the
  rule for true month-end tasks. Documented in `docs/API.md`.
