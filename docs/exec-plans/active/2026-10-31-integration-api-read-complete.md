---
plan: integration-api-read-complete
harness: v2 · lean
branch: feat/integration-api-read-complete
anchor: spec
status: Approved
next: Run /gate (Adversary + QA + Security) against HEAD
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
- A3 `cargo test`: uncomplete after complete restores `due_date`, `occurrences_completed` and `status` byte-identical, including a Jan 31 monthly when `previous_due_date` is supplied. `completed_ts` returns to null, which is byte-identical only when it was null before; an earlier completion time is not kept, matching the web undo. A punted task steps back onto its cadence. *(Amended at gate r1: Adversary W5, QA S8.)*
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
  `next_due(previous) == current` (an exact inverse, as D5 says); otherwise
  `prev_due(current)` is used. One-off: any `done` task. Recurring: only when completed today.
- Errors:
  - 401 `unauthorized`
  - 403 `forbidden_scope` / `forbidden`
  - 404 `not_found`
  - 400 `invalid_request` (malformed date)
  - 409 `due_date_mismatch` (expected ≠ current and not completed today)
  - 409 `not_completed` (uncomplete with nothing to undo)
  - 409 `concurrent_update` (concurrent write lost the race)

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

## Build log

- Step 1: `9691cdd`, the TS clamp plus the shared case table. The Rust port moved
  into the step 2 commit because pre-commit clippy rejects a module nothing uses yet.
- Steps 2 and 3: `aee5cf3`, scopes, identity, `TZ`, read routes, complete and
  uncomplete. They are one commit because the routes and the auth change land
  together.
- Step 4: `bb950dc`, the local date in `streak.ts`, with a guard for dates written
  under the old UTC rule.
- Step 5: `360ca0a`, day-complete on remote merge.
- Step 6: the docs commit (`docs/API.md`, `ARCHITECTURE.md`, this plan).
- Mutation checks run while building: putting back the `setMonth` overflow fails
  the parity table; putting back the UTC `todayIso` fails the streak TZ test;
  dropping the merge guard's "was pending here" check fails the reassignment test.

## Deviations

- Read `GET /api/lists` returns full `ListRow` (superset), not the brief's 4 fields.
- 409 is split into three codes (`due_date_mismatch`, `not_completed`,
  `concurrent_update`) instead of one `conflict`. The status is still 409, and the
  consumer will be told at ship.
- D11: `docs/SECURITY.md` has no token section, so the security-relevant
  contract lives in the `ARCHITECTURE.md` API bullet and in `docs/API.md`.
- No new crates: the router tests call `tower::Service::call`, since `oneshot`
  would need tower's `util` feature, a `Cargo.toml` change.
- Compose: the repo's `docker-compose.yml` passes `TZ` through only. The token
  variables are not passed through with blank defaults, because a blank token
  fails the boot length check. Operators add them when enabling the API, as the
  existing beta stack already does for `TASK_API_TOKEN`.
- Clamping causes drift: monthly from the 31st becomes the 28th after February
  and stays there (the overflow it replaces drifted too). `lastDayOfMonth` is the
  rule for true month-end tasks. Documented in `docs/API.md`.

- Gate r1, D5: the Design briefly widened D5's exact-inverse check to a
  `[prev_due(current), current)` window, to make punted undo exact. The
  Adversary showed that window can walk a due date forward without limit
  through complete/uncomplete cycles. Reverted to D5 as approved: exact inverse
  only. Punted undo steps back onto the cadence (A3 amended).

## Follow-ups (not in this change)

- The web app's own undo (`undoRecurringCompletion`) still steps back with
  `prevDueForRecurrence`, which is lossy at month ends (Jan 31 → Feb 28 → Jan 28)
  and for punted tasks. The API's validated `previous_due_date` shows the fix.
- On deploy to beta: set `TZ`, `TASK_AGENT_TOKEN`, and optionally
  `TASK_API_USER_EMAIL` in `/srv/docker/tasksync-beta`'s server environment, then
  notify SANDYJAR Host Root with the `docs/API.md` path and the commit or tag.

## Gate

Seats: adversary, qa, security-brief (scrutiny: auth-and-secrets via `.env.example`, `force = true`). Base `af599b1`, reviewed `a1d3d50`.

Gate: APPROVED r1 @a1d3d50 — security-brief
- GAP: the seat has no shell, so it could not run `git diff af599b1..a1d3d50`. It read the HEAD files directly. A11 (`Cargo.toml` deps unchanged vs. base) is NOT verified by this seat. The current `[dependencies]` contain no surprising crate, and `Dockerfile` adds only Debian `tzdata`.
- LOW: uncomplete's `previous_due_date` accepts any date in `[prev_due(current), current)`. That is looser than D5's "next_due(previous) == current". An agent-token holder can complete and then uncomplete to move a recurring task's due date back by up to one step (a year for yearly rules), which flags it as missed. The move is bounded, needs the agent token, and loses no data. Accept, or tighten to `next_due_after_current(previous) == current`.
- INFO: the `ctx_from_api_token` comment says timing "does not reveal which token is configured". That is inaccurate: `is_some_and` skips hashing for an unset token, so 0, 1 or 2 SHA-256 runs happen. The difference can't be measured remotely, and the concealed 404 already reveals whether the agent token is set, by design. Fix the comment.
- INFO: a contributor identity gets 403 `forbidden` rather than 404 for a task that exists but isn't theirs, which confirms the id exists. Completion checks creator only, not `list_grant`. Both mirror `update_task_status_for_ctx`, so this is not new.
- INFO: an absolute-path `TZ` accepts any existing file (chrono then silently falls back to UTC). Only the operator can set it, and no request data reaches `validate_tz`.
- Verified clean: scope gating on all 5 routes; the create-only token gets 403 on read and complete; boot rejects equal or short tokens; no token in any log; error bodies are static; `TASK_COLUMNS` is the only `format!` input to SQL.


Gate: CHANGES r1 @a1d3d50 — qa
- WARNING server/src/routes/integrations.rs:337 (`Query<TaskQuery>`): a duplicated key (`GET /api/tasks?view=a&view=b`) fails serde_urlencoded ("duplicate field `view`", verified) inside axum's extractor, before the handler runs. With TASK_AGENT_TOKEN unset that returns a plain-text 400 instead of the concealed empty 404, which reveals the route exists. With it set, the 400 is uncoded and breaks API.md's "every error has the same shape". The TaskQuery doc comment says this cannot happen. Fix: take `Result<Query<TaskQuery>, QueryRejection>` (or RawQuery), run the feature-off gate and authorize first, then map the rejection to `invalid_query`. Test both modes.
- WARNING web/src/lib/stores/streak.ts:196,231: the `>=` / `<` comparisons place no upper limit on a stored date. If any device once wrote a future dayCompleteDate or lastResetDate (a wrong clock, a bad blob; the state syncs through the prefs blob), day-complete and the daily reset stay off until that date. Before this change, `!==` recovered the next day. Fix: only treat a value as "today" when it equals today or today+1 (the UTC-skew window), and treat anything else as a new day.
- WARNING docs/ARCHITECTURE.md:89 and server/src/routes/integrations.rs:242-249: both still say the feature-off gate is `TASK_API_TOKEN` unset and name `AuthScope::ApiTaskCreate`. That type is gone, and TASK_AGENT_TOKEN alone now enables POST /api/tasks (`agent_token_alone_enables_create`). Fix: update both to match the code.
- SUGGESTION server/src/routes/clock.rs:78-83: validate_tz accepts any regular file, such as `TZ=zone.tab`, `TZ=iso3166.tab` or `TZ=/etc/passwd`. chrono then fails to parse it and silently uses UTC, which is the exact case D3 says boot catches. Fix: check for the `TZif` magic.
- SUGGESTION clock.rs:71 and docker-compose.yml `TZ: ${TZ:-}`: an empty TZ makes chrono use UTC, not /etc/localtime, but the boot warning says "host zone". This makes no difference in the stock image.
- SUGGESTION docs/API.md, idempotency table: "The first two cases return 200" should be three rows (1, 2 and 4). The table also omits that a pending one-off with a wrong expected_due_date returns 409 due_date_mismatch.
- SUGGESTION, this plan: Design and Deviations still name `409 conflict` for a lost race, but the code and API.md use `concurrent_update`. D5's "next_due(prev)==current" check became the range `[prev_due(cur), cur)`, and Deviations does not record that.
- SUGGESTION A3 / task_actions.rs uncomplete: a prior non-null completed_ts (for example yesterday's) becomes null, not "byte-identical". The tests only seed a null completed_ts, so this part of A3 is unbound. Nothing visible changes, since only today-checks read it, and the web undo does the same. Reword A3 or record it.
- SUGGESTION, tests: there are no tests for validate_distinct_api_tokens (the scope-escalation guard), TASK_AGENT_TOKEN length, validate_api_identity boot failure, or next_updated_ts with a stored updated_ts greater than now. The A4 test seeds updated_ts=1000.

Gate: CHANGES r1 @a1d3d50 — adversary
- Instruments @a1d3d50: cargo fmt --check exit 0; clippy --all-targets -D warnings exit 0; cargo test 144 passed / 0 failed (seed bin 0 tests); web lint exit 0; svelte-check 0 errors 0 warnings; vitest 31 files, 475 passed. Recurrence fixture: all 84 expected values match an independent Python model. A11: no diff in Cargo.toml, Cargo.lock or package*.json between af599b1 and a1d3d50.
- WARNING server/src/routes/clock.rs:282-332 (A12/D3): validate_tz returns Ok for values that chrono 0.4.43 cannot parse, so chrono falls back to UTC (offset/local/unix.rs:103 current_zone; tz_info/rule.rs from_tz_string returns "DST start and end rules must be provided"). Verified by running the test binary's clock child at 2026-10-31T23:30Z: `CET-1CEST`, `AEST-10AEDT`, `XYZ-3garbage`, `Europe/Paris ` (trailing space; validate trims and chrono does not) and `zone1970.tab` all give 2026-10-31, the UTC date, where the zone's date is 11-01. `EST5EDT,M3.2.0` is also accepted. The clock test `posix_strings_are_accepted_without_zoneinfo` treats `CET-1CEST` as valid. Fix: mirror chrono's grammar (a DST name requires `,start,end`, no trailing data), reject a value that trim changes, and require the TZif magic for files. Add these values as tests that must be rejected.
- WARNING web/src/lib/stores/tasks.ts:460-466 (D10): a remote punt of the last pending My Day task fires day-complete. myDayCompleted includes wasPuntedToday, and the guard only checks membership in it. Verified with vitest: setAll a pending weekly task due 2026-10-31, then mergeRemote the punted version (my_day false, due 11-01, punted_on 10-31). triggerDayComplete is called once. A local `tasks.punt()` of the same task calls streak.break and does not fire. The comment "only fires when a task that was pending here is now completed" is false. Fix: require `wasCompletedToday || wasRecurringCompletedToday` on the transitioned task, not myDayCompleted membership. Add the punt test.
- WARNING server/src/routes/task_actions.rs:229-233 (D5): the `[prev_due(current), current)` window lets a caller write due dates the task never had, and repeated cycles move a due date forward with no limit. Verified: a weekly task due 10-31 went through 4 complete→uncomplete cycles with previous_due_date 11-06, 11-12, 11-18, 11-24. Every call returned 200, the due date ended at 2026-11-24 (off its cadence), and occurrences stayed at 3. An annual task went to 2027-03-15 in one cycle. This contradicts D5 ("validated, so not arbitrary write") and the comment at :203 ("can only undo, never move a task arbitrarily"). Deviations does not record the change. Fix: accept only exact inverses (`next_due(prev)==current` or `prev==prev_due(current)`) and restate A3 for punted tasks, or return an unforgeable undo token from complete (an HMAC over the pre-completion fields and the post-write updated_ts) and restore from it. The token would also make punt and completed_ts exact. Add a test that a complete/uncomplete loop cannot move the due date past its original value.
- WARNING server/src/routes/task_actions.rs:138,167,239,261,101 + :225,:257/:163: these guards are present but no test exercises them. Each mutant passed all 22 integration tests. Mutants: drop `updated_ts = ?N` from the recurring or one-off UPDATE (the lost-update CAS, named surface 1); drop uncomplete's expected_due_date check; drop the one-off complete expected check; change `next_updated_ts` to `now`. Fix: split the write step out so a test can bump updated_ts between read and write and assert 409 concurrent_update with the row unchanged. Add a stale-expected test for uncomplete and for the one-off, and seed updated_ts > now.
- WARNING A3 (and the tests at integration_api_tests.rs:517-578): completed_ts is not restored "byte-identical". Verified: a daily task with completed_ts from yesterday evening ends with completed_ts null after complete+uncomplete. Every A3 fixture seeds null, so the fixture never reaches this path. Fix: restore it (the undo token above would) or amend A3.
- SUGGESTION task_actions.rs:128: a retry without expected_due_date that crosses local midnight completes twice. Verified: complete at 23:59:59, retry at 00:00:01, and the task ends with occurrences 2 and due 11-02. Fix: state the midnight case in API.md next to "send the due_date you read".
- SUGGESTION task_actions.rs:236: undo of a recurring task that had no due_date sets due_date to today (verified: null before, 2026-10-31 after).
- SUGGESTION tasks.ts:461: `pendingBeforeIds.size > 0` is dead code because `.some(...has)` implies it. The mutant that removes it passes all 87 tasks tests.
- SUGGESTION shared/fixtures/my-day-cases.json: two cases are missing on both sides. Without a done task whose completed_ts is null, the updated_ts-fallback mutant survives in TS and in Rust (tasks.ts:995, task_views.rs:89). Without a recurring task in `done`, dropping `status==='pending'` from wasRecurringCompletedToday (TS) and dropping `status!="done"` from uses_recurring_path (Rust) both survive.
- SUGGESTION streak.ts:196,231: the `<` reset change and the date regex both survive mutation (55/55 green). QA's upper-bound finding is the same issue.
- SUGGESTION boot checks have no tests. validate_distinct_api_tokens survives its mutant (139/139). Removing safe_name from clock.rs:321 also survives.
- SUGGESTION stale text: ARCHITECTURE.md:89 and integrations.rs:241-250 (`ApiTaskCreate`, gate "api_token.is_none()"). This plan's Design and Deviations still say `409 conflict`, but the wire code is `concurrent_update`.
- Clean (mutant killed): retry→already_done (both variants), the window's lower bound, uncomplete's completed-today check, contributor 403, punt clearing, My Day missed/assignee/in-my-day, recurrence `<=`, anchor order, weekdays and lastDayOfMonth prev, the TS setMonth overflow, the merge trigger and `.some` guard, streak `>=` and the UTC todayIso, the agent feature-off gate, role-from-membership, and create-only scope.

Gate: APPROVED r2 @fd3a674 — security-brief
- Correction to my r1: I rated the uncomplete window as "back by up to one step". The Adversary showed that repeated cycles could walk the due date forward without limit. My r1 analysis was wrong; the fix makes that moot.
- r1 LOW (uncomplete window): fixed as D5 prescribes. `uncomplete_loaded` keeps `previous_due_date` only if `next_due(previous, rule) == Some(current)`, otherwise it uses `prev_due(current)`. Checked by reasoning, not by a test run. Every accepted value is an exact preimage of `current`, so it lies within one step before it. Completing from that value gives `next_due_after_current(P) = next_due(P) = current` (no punt is left after a complete), so a cycle comes back to `current` and the date cannot walk. Clamp preimages (Jan 28–31 → Feb 28) and weekday preimages (Fri/Sat/Sun → Mon) are on-cadence dates.
- r1 INFO (timing comment): fixed. The new comment is accurate.
- r1 INFO (TZ any file): fixed and tightened. Every file must start with the `TZif` magic. `:name` is file-only, whitespace is rejected, and the POSIX grammar requires `,start,end` for a DST zone. A path with `..` is still not joined, and `TZ` is read only at boot from the operator's env.
- r1 INFO (contributor 403): unchanged; it mirrors the existing route. Accepted.
- r1 GAP (A11): still not checked by this seat (no shell). The Adversary's r1 instrument run covers it: no diff in Cargo.toml, Cargo.lock or package*.json.
- New in the delta, checked clean: `GET /api/tasks` now takes `Result<Query, QueryRejection>` and maps a parse failure to coded `invalid_query` only after `agent_routes_enabled` and `authorize`, so the route is no longer revealed while the feature is off. The only outside callers of `complete_loaded` and `uncomplete_loaded` are in `integration_api_tests.rs`; the production path still runs `load_task`'s permission check first. No new `tracing` call takes a token or header. `format!` SQL still takes only `TASK_COLUMNS`.
- New INFO: `is_tzif_file` opens and reads 4 bytes from an operator-chosen path at boot. A FIFO or a device path could stall boot. Only the operator controls it, so this is not a security issue; no action needed.

Gate: APPROVED r2 @fd3a674 — qa
- Instruments @fd3a674: cargo fmt --check exit 0; clippy --all-targets -D warnings exit 0; cargo test "153 passed; 0 failed" (seed bin 0); web lint exit 0; svelte-check "0 errors and 0 warnings"; vitest "31 passed (31) / 479 passed (479)". Smoke e2e not re-run (optional; web delta is stores only).
- r1 W1 (query rejection): fixed as prescribed. `Result<Query<TaskQuery>, QueryRejection>` is mapped to `invalid_query` after `agent_routes_enabled` and `authorize`. `an_unparseable_query_is_coded_and_only_after_the_gates` binds all three outcomes (404 empty / 401 / 400 coded).
- r1 W2 (streak future dates): fixed. `isCurrentDay` accepts only today or tomorrow. Tests cover the UTC-ahead case and far-future values for both guards. Residual, accepted: a pre-upgrade UTC-ahead value suppresses one local day's reset or day-complete once. This is inherent to the skew and is not a regression vs. r1.
- r1 W3 (stale text): fixed in ARCHITECTURE.md (both bullets) and the integrations.rs handler docs.
- r1 S4/S5 (TZ): fixed and tightened. TZif magic is required, `:name` is file-only, the POSIX grammar is complete, and an empty TZ warns "UTC". `today_follows_tz_across_local_midnight` now proves a DST string is really applied (CET case).
- r1 S6/S7/S8/S9: fixed (API.md table and one-off row; plan says concurrent_update; D5 reverted to the exact inverse `next_due(prev)==current`, recorded; A3 amended; tests added for distinct tokens, agent token length, check_api_identity, future updated_ts).
- New in the delta, checked: the mergeRemote guard now uses wasCompletedToday/wasRecurringCompletedToday on tasks that were pending before the merge (a punt no longer fires; test added). The uncomplete exact-inverse fallback for punted tasks and for a null due date is documented in API.md. No new findings.

Gate: CHANGES r2 @fd3a674 — adversary
- Instruments @fd3a674: cargo fmt --check exit 0; clippy -D warnings exit 0; cargo test 153 passed / 0 failed (seed 0); web lint exit 0; svelte-check 0 errors 0 warnings; vitest 31 files, 479 passed.
- r1 W1 (TZ) mostly fixed, one fail-open left. A differential fuzz compared validate_tz with chrono's actual Local offsets in a child process over 4000 generated POSIX strings. Result: 0 fail-open, 45 stricter (all trailing whitespace or 4-digit hours, which are safe), 725 both accept, 3230 both reject. All my r1 values are now rejected. The fuzz flagged one more class:
  - WARNING clock.rs:93 (`posix_hhmmss`, `> 24`): validate_tz accepts an offset of 24 hours or more, for example `ABC24`, `ABC24:25`, `ABC-24:30`, or `EST5EDT24,M3.2.0,M11.1.0` (verified Ok(None)). chrono's parser accepts hour 24, but `FixedOffset::east_opt` requires |secs| < 86400, so `Local::offset_from_utc_datetime(..).unwrap()` panics (chrono offset/local/mod.rs:193; verified, the clock child panics for all four). Effect: boot passes, then every `today()` call panics, which means every complete, uncomplete, and GET /api/tasks drops its connection. This is the exact fail-closed case the check exists for. Fix: reject a std or dst offset whose total is >= 86400 s (rule `/time` may stay at <= 24:59:59, since that is not an offset). Add `ABC24` and `ABC-12XYZ-24,M3.2.0,M11.1.0` to `values_chrono_cannot_load_fail_closed`.
- r1 W2 (punt) fixed as prescribed. The new test kills the r1-style membership mutant, and dropping either `wasCompletedToday` or `wasRecurringCompletedToday` also fails tests.
- r1 W3 (window) fixed differently, and the walk is closed. Mutants that restore the loose window or accept any value both fail tests (2 and 3 failures). Residual: exact-inverse is not the same as on-cadence. Verified: a `weekdays` task due Fri 10-30 completed then uncompleted with forged 11-01 (a Sunday) ends due Sunday. A `lastDayOfMonth` task due 10-31 ends due 10-03 or 10-17, which makes it overdue. This is bounded to one step and cannot walk, but API.md:212 ("A previous_due_date the task's cadence couldn't have produced is ignored") is false for these rules. SUGGESTION: also require the previous date to be on cadence (not a weekend for `weekdays`, last day of its month for `lastDayOfMonth`), or reword API.md.
- r1 W4 (untested guards) fixed. Each of these mutants now fails tests: all four CAS guards, `next_updated_ts` changed to plain `now`, uncomplete's expected check, `uses_recurring_path`'s status check, and `validate_distinct_api_tokens`.
- r1 W5 (A3) fixed: A3 is amended, and the API.md wording matches the behavior.
- r1 suggestions: the fixture rows q and r now kill the updated_ts-fallback and status-pending mutants in both TS and Rust. `isCurrentDay` mutants (dropping tomorrow, or `>=`) fail tests. API.md documents the midnight retry and the null-due-date behavior.
- SUGGESTION clock.rs tests: two guards still survive their mutants. A DST name plus an offset with no rules is never tested (add `CET-1CEST-2`). Removing the whitespace check survives because the parser already rejects every tested whitespace case, so the check is redundant as tested.
- SUGGESTION tasks.ts:461-467: day-complete fires when another device removes `my_day` from a recurring task that was completed earlier today and was the last item left in pending (verified with vitest). The task was "completed today" before the merge, so the merge did not complete anything. Fix: record which tasks were already done-today before the merge and require that the flag flipped.
- SUGGESTION ARCHITECTURE.md:89: the tail still says "The feature-off `404` (`TASK_API_TOKEN` unset)". It should say "neither token set".

Gate: APPROVED r3 @60a565e — security-brief
- Correction to my r2: I wrote that weekday preimages (Fri/Sat/Sun → Mon) are "on-cadence dates". That was wrong, as the Adversary showed (Sat and Sun are not on the `weekdays` cadence).
- Offset panic (Adversary r2 blocker), checked by reading the code, not by running it. `posix_offset` rejects a std offset of 86400 s or more in magnitude. The DST offset is checked against the same bound, both when it is given and when it is derived (`std_offset - 3600`), so `-23:xx` plus the derived hour is caught. The rule `/time` keeps `posix_hhmmss` up to 24:59:59, which is not an offset. This closes the boot-passes-then-every-request-panics path. Impact in this deployment context: `TZ` is set only by the operator, so this was a self-inflicted availability fault, not an attacker path.
- `is_exact_previous` adds `next_due(prev_due(P)) == P`. That narrows the accepted set and never widens it: Sat/Sun for `weekdays` and non-last days for `lastDayOfMonth` now fall back to `prev_due(current)`. The r2 argument still holds (one-step preimage, a cycle returns to `current`, no walk).
- tasks.ts mergeRemote guard and docs: only client-side streak behaviour, no security surface.
- No new findings. GAP: this seat still has no shell. Instruments and A11 rely on the QA and Adversary runs.

Gate: APPROVED r3 @60a565e — qa
- Instruments @60a565e: cargo fmt --check exit 0; clippy --all-targets -D warnings exit 0; cargo test "153 passed; 0 failed" (seed bin 0; the new cases extend existing tests); web lint exit 0; svelte-check "0 errors and 0 warnings"; vitest "31 passed (31) / 479→480 passed (480)".
- clock.rs `posix_offset`: correct. Std and explicit-DST offsets need |s| < 86400. An omitted DST offset is derived as std−3600 and checked. Rule times stay ≤ 24:59:59, per chrono. The child-process test proves the largest accepted values (`ABC23:59:59`, `/24:59:59`) load without a panic, and the rejection matrix covers 24h, ±24:xx, and the derived-DST overflow.
- task_actions.rs `is_exact_previous`: correct. Checked by hand: weekdays Sun/Sat preimages rejected, Fri accepted; lastDayOfMonth the 3rd/17th rejected, month-end accepted; monthly Jan 31 → Feb 28 → Jan 31 still exact.
- tasks.ts merge guard: correct. Tasks already done today are excluded from the pending-before set, and the new test binds it. `wasCompletedToday`/`wasRecurringCompletedToday` are module consts declared later but only called at runtime, so there is no TDZ issue.
- SUGGESTION (non-blocking) task_actions.rs:107: the on-cadence clause also rejects a genuine off-cadence ORIGINAL due date. Example: a weekdays task the user dated Sat Oct 31, completed that day (due → Mon Nov 2). Uncomplete with previous_due_date=2026-10-31 now restores Fri Oct 30 (shows as missed), where fd3a674 restored Oct 31. This is rare, bounded, and equal to the web undo (prevDue), and API.md's new wording describes the behavior. Accept, or mention "a user-picked off-cadence date also steps back" in API.md.

Gate: CHANGES r3 @60a565e — adversary
- Instruments @60a565e: cargo fmt --check exit 0; clippy -D warnings exit 0; cargo test 153 passed / 0 failed (seed 0); web lint exit 0; svelte-check 0 errors 0 warnings; vitest 31 files, 480 passed.
- r2 24h-offset WARNING: fixed. The differential fuzz, re-run (4000 strings against chrono in a child process), found 0 fail-open, 0 accepted values that panic chrono, 85 stricter (the 24h offsets chrono panics on, trailing whitespace, 4-digit hours), 685 both accept, and 3230 both reject. Mutants that drop the offset cap, drop the derived-dst cap, or change `<` to `<=` each fail a clock test.
- Merge my_day removal: fixed. Dropping the pre-merge done-today filter fails 1 test, and swapping the post-merge check fails 1 test.
- ARCHITECTURE.md wording: fixed.
- WARNING server/src/routes/task_actions.rs:107-110 (`is_exact_previous`, the new cadence clause): this regresses the month-end exact undo that W3/D5 were meant to provide. `next_due(prev_due(p)) == p` fails for every 31st that follows a shorter month, and for Feb 29. Verified with complete→uncomplete and `previous_due_date` supplied:
  - monthly 2026-03-31 ends due 03-30 (prev_due(03-31) = 02-28, and next_due of that is 03-28);
  - monthly 2026-10-31 ends due 10-30;
  - annual 2024-02-29 ends due 2024-02-28.

  r2 restored all three exactly. The day-of-month change is permanent: the task then recurs on the 30th, or the 28th. Only Jan 31 is tested, and it passes because December has 31 days. docs/API.md still promises "month-end undo exact". Fix: replace the generic clause with a per-rule check: `weekdays` → previous is not a weekend; `lastDayOfMonth` → previous is the last day of its month; every other rule → true. Add round-trip tests for monthly 03-31 and 10-31 and annual 2024-02-29. The cadence mutants (R1/R2) are killed today, and the Sunday and 10-03 rejections still hold under the per-rule check.
- SUGGESTION: whitespace check kept as defense-in-depth. Accepted.
