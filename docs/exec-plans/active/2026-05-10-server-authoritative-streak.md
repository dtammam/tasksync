# Server-Authoritative Streak (Deterministic Cross-Device)

**Branch:** `feat/server-authoritative-streak`

---

## Goal

Make the streak combo meter fully consistent and deterministic across all devices and
browsers by moving increment, break, and day-complete operations from client-computed
blob pushes to server-mediated, idempotent mutations that the server broadcasts back
to all connected clients.

## Why now

The user reports that the streak count is "semi-meaningless" because it is "not always
consistent between devices" and causes "multiple triggers." The root cause is that the
increment is still client-computed: two devices each compute `count = current + 1` and
push a full state blob, the second write wins, and the other device's increment is lost.
The 2026-03-12 plan established server-wins-on-hydrate and added a cross-tab refresh
poll, but did nothing to resolve concurrent writes from two devices. The server is
currently a passive blob store; the user is asking it to become an active authority.

---

## Non-goals

- No change to streak settings (theme, mode, enabled flag) — those already sync via prefs.
- No change to theme manifests, asset preloading, or display and animation logic.
- No change to the completion sound subsystem.
- No change to the WebSocket sync protocol structure beyond riding existing channels or
  adding a minimal new message type for streak events.
- No animated/ticker reconciliation when the server-canonical count differs from the
  local optimistic count. When the server pushes a corrected count, the displayed number
  updates in place with no animation, no celebration sound, and no "+N from other device"
  indicator. This is a stated requirement. A ticker or count-up/count-down animation may
  be considered as a follow-up if the silent swap feels glitchy in practice.
- No change to streak settings UI.
- No change to backup/restore scope.

---

## Constraints

- **Offline-first must hold.** Completing a task offline must trigger the local animation
  immediately and increment a local provisional count. The server reconciles the queued
  operations on reconnect. The app must function without a server.
- **Completion-sound onset budget (<20 ms) must hold.** The visual and audio reaction
  cannot wait for a server round-trip. Local optimistic update fires immediately; the
  server response may silently correct the displayed count afterward.
- **Sync determinism must hold.** Increment, break, and day-complete operations must be
  idempotent — re-applying the same operation must not double-count. Operations require
  stable deduplication keys. The task ID is a natural candidate for increment operations.
- **Server-authoritative role enforcement.** Only the authenticated user can mutate their
  own streak. Standard auth applies; no server-side role changes are needed beyond this.
- **No regressions against existing quality gates.** Pre-commit, pre-push, and CI must
  continue to pass clean.

---

## Current state

| What | Where | How counted | Cross-device safe? |
|------|-------|-------------|-------------------|
| `count` | `stateStore` + prefs blob + `streak_state_json` | Client increments locally, pushes full blob (250 ms debounce, last-write-wins) | No — concurrent devices lose increments |
| `countedTaskIds` | Same as above | Client appends locally, same push path | No — second push overwrites first |
| `lastResetDate` | Same as above | Same push path | No |
| `dayCompleteDate` | Same as above | Client sets guard locally, same push path | No — two devices racing final task both set and both celebrate |
| Break (punt/delete/skip) | Same push path | Client zeros locally | No — second device overwrites break |
| Manual reset | Same push path | Client zeros locally | No |

The server stores `streak_state_json` as an opaque blob in `UserPreferences`. There is
no server-side logic for streak operations — no validation, no idempotency, no conflict
resolution. Every mutation is a full-blob replace.

---

## Proposed approach

See [Design](#design) below. In short: introduce a dedicated `user_streak` table on the
server, add a single new authenticated REST endpoint (`POST /auth/streak/op`) that
applies one streak operation atomically with per-operation idempotency keys, and add
piggyback fields (`streakRevision`, canonical `streakStateJson`) to the existing
`GET /auth/preferences` response so any device's next preferences poll picks up the
canonical count. The web client adds an IDB-backed outbound operation queue, fires the
optimistic local animation/sound synchronously on completion (no network on the hot
path), and silently swaps the displayed count when the server's canonical value
arrives.

---

## Alternatives considered

See [Design - Alternatives considered](#alternatives-considered-1) below.

---

## Risks and mitigations

| Risk | Likelihood | Notes |
|------|-----------|-------|
| Server round-trip on every task completion adds latency to a hot path | Medium | Offline queue + optimistic local update keeps perceived latency under 20 ms. Network path is asynchronous and does not block the UI or audio. |
| Current opaque blob has no concurrency control; moving to authoritative model requires a real schema | High | A dedicated column or structured sub-schema with a version/counter will be needed. This is a server migration. |
| Offline queue may deliver duplicate operations if the client retries after a network error before the server's ack arrives | Medium | Idempotency keys (task ID for increments, event type + date for day-complete) must prevent double-counting on the server. |
| Migration: existing `streak_state_json` blob counts must be preserved on deploy | Medium | Server must read existing blob as the seed count when no authoritative record exists yet. |
| Day-complete race: two devices completing the final task simultaneously both believe they should celebrate | Medium | Server-authoritative day-complete guard (by calendar date and user ID) ensures at most one device gets an affirmative response. The first request to reach the server claims the day-complete; the second receives a "already fired today" response and suppresses the celebration locally. |
| Increased server load — streak operations are now network events, not just debounced blob pushes | Low-Medium | Streak operations are sparse relative to task operations. Impact is expected to be low. PE should confirm. |

---

## Acceptance criteria

- [ ] Two devices both online simultaneously, each completes a different task: the
  server-canonical count equals 2 (not 1). Both devices display 2 after reconciliation.
- [ ] Device A is offline and completes 3 tasks, then comes back online: the server count
  converges to the pre-offline count plus 3, with no duplicates and no losses.
- [ ] Device A and Device B both complete the same task (e.g. a recurring instance synced
  mid-flight): the increment is counted exactly once on the server.
- [ ] Day-complete celebration fires on at most one device per calendar day even if both
  devices finish My Day simultaneously.
- [ ] Punting a task on Device A breaks the streak; Device B reflects the break within the
  existing sync latency budget without double-firing the break animation.
- [ ] Manual reset from settings is reflected on all connected devices.
- [ ] Cold boot while offline displays the last-known count from local cache; reconnecting
  triggers reconciliation and displays the server-canonical count.
- [ ] The streak animation and completion sound feel instant (sub-20 ms perceived response)
  on the device that initiated the action.
- [ ] When the server-canonical count differs from the local optimistic count after
  reconciliation, the displayed number updates silently in place — no animation, no sound,
  no indicator.
- [ ] Existing user streak counts are preserved (not reset to zero) after deploy.
- [ ] All new and existing unit tests pass. Pre-commit and pre-push hooks pass clean.
- [ ] New E2E smoke test covers at minimum: complete task online → count increments;
  complete task offline → reconnect → count reconciles.

---

## Tasks

Tasks are ordered so each is independently implementable, independently testable,
and so earlier tasks unblock later ones. Each task is sized for one focused SDE
session. Status is tracked in `.state/feature-state.json`.

### T1 — Shared wire types for streak ops — DONE 2026-05-10

- **Files:** `shared/types/streak.ts` (new), `shared/types/settings.ts`
  (path corrected from `web/src/shared/types/` — actual project location is
  the top-level `shared/` directory aliased as `$shared`)
- **Description:** Add `StreakOpKind` (`'increment' | 'break' | 'day_complete' | 'reset'`),
  `StreakOpRequest`, `StreakOpResponse`, and `StreakBreakCause` types in the new
  `streak.ts`. Extend `UiPreferencesWire` with optional `streakRevision?: number`
  (the canonical `streakStateJson` field already exists). Export everything via the
  shared barrel if one exists. No business logic — types only.
- **Done when:** Types compile clean (`cd web && npm run check`); no production code
  yet imports them.
- **Status:** Done. Wire types shipped in `shared/types/streak.ts`;
  `streakRevision?: number` added to `UiPreferencesWire`. No production
  consumers yet (per spec).

### T2 — Server schema migration `0017_user_streak.sql` — DONE 2026-05-10

- **Files:** `server/migrations/0017_user_streak.sql` (new)
- **Description:** Author the migration exactly as specified in the design Data
  model section: create `user_streak` and `user_streak_op` tables with the index,
  then `insert or ignore` to seed `user_streak` from `user.streak_state_json` so
  existing counts are preserved. Idempotent on rerun.
- **Done when:** Migration applies cleanly against a fresh DB AND against a DB
  already at 0016; rerunning produces no duplicate rows. Verified via the existing
  `setup_pool` migration loop in `server/src/routes/mod.rs` (which runs each
  migration twice).
- **Status:** Done. Migration shipped with `user_streak` + `user_streak_op` tables,
  `idx_user_streak_op_user_date` index, and idempotent seed from legacy
  `user.streak_state_json` via `insert or ignore`. SDE additionally restored a
  TS-parser helper in `server/src/routes/mod.rs` that T1's prettier reformatting
  had silently broken. All server quality gates green.

### T3 — Server `POST /auth/streak/op` endpoint + idempotency logic — DONE

- **Files:** new `server/src/routes/streak.rs` (handler, request/response types,
  helpers); `server/src/routes/mod.rs` (`mod streak;`); `server/src/routes/auth.rs`
  (`.route("/streak/op", post(super::streak::auth_apply_streak_op))` mounted on
  existing `auth_routes` Router so public path is `POST /auth/streak/op` and JWT
  pipeline is reused)
- **Description:** Implemented the handler per design API spec. Request validation
  (kind enum, opKey length cap 128, optional break-cause enum). Inside one
  transaction: insert-or-ignore user_streak seed, dedup short-circuit on
  `(user_id, op_key)`, per-op-kind rule application
  (increment / break / day_complete / reset), monotonic `revision` bump, dedup
  row insert, 7-day TTL prune of `user_streak_op`. Reset additionally prunes
  today's ops BEFORE inserting its own dedup row so subsequent same-day
  increments re-count cleanly. Always returns canonical state including
  `appliedThisCall` and `dayCompleteFiredThisCall`.
- **Status:** Done. Handler is `pub(super) async fn auth_apply_streak_op` so T4
  tests can import via `super::streak`. All server quality gates
  (`cargo fmt -- --check`, `cargo clippy -D warnings`, `cargo test`) pass clean.

### T4 — Server unit tests for streak op semantics — DONE

- **Files:** `server/src/routes/streak_tests.rs` (new) or co-located in the routes
  mod test block
- **Description:** One test per row of the design's Test contracts table (10
  scenarios covering increment dedup, break-vs-increment ordering both ways, reset,
  reset-retry idempotency, day-complete first-to-server-wins, revision
  monotonicity, and same-task-next-day re-counting). Use the existing
  `setup_pool`/test-helper conventions.
- **Done when:** `cargo test` green; all 10 scenarios assert exact final
  `{count, lastResetDate, dayCompleteDate, appliedThisCall, dayCompleteFiredThisCall}`.

### T5 — Extend `GET /auth/preferences` with `streakRevision` + canonical `streakStateJson` — DONE 2026-05-10

- **Files:** `server/src/routes/auth.rs` (preferences GET handler),
  `server/src/routes/types.rs` (`UiPreferencesResponse`)
- **Description:** Left-join `user_streak` in the preferences GET query and emit
  `streakRevision` plus a freshly-built canonical `streakStateJson`
  (`{count, lastResetDate, dayCompleteDate}`) derived from `user_streak`, NOT from
  `user.streak_state_json`. Keep the existing legacy field name for wire
  compatibility. Also: in the `PATCH /auth/preferences` handler, silently skip any
  inbound `streakStateJson` field (log via `tracing::debug!`) so older clients
  cannot clobber canonical state.
- **Status:** Done. Read path now serves canonical state from `user_streak`; PATCH
  silently drops inbound `streakStateJson` with `tracing::debug!`. 52/52 cargo
  tests green. Server side of this feature is now functionally complete — the
  remaining tasks (T6-T14) are all web client + docs.

### T6 — Web IDB schema bump (DB version 2 → 3) + `streakOps` object store

- **Files:** `web/src/lib/data/idb.ts`
- **Description:** Bump DB version to 3. In the upgrade callback, create the
  `streakOps` object store keyed by `opKey` with a `by-enqueued` index on
  `enqueuedAt`. Existing stores are untouched. Verify the upgrade runs only once
  per client.
- **Done when:** Existing IDB tests pass; manual smoke confirms the new store
  appears for fresh installs and after upgrade from v2.
- **Status:** Done. `TaskSyncDB` extended with a `streakOps` store keyed by
  `opKey` plus a `by-enqueued` index on `enqueuedAt`; `openDB` version bumped
  2 → 3 with a contains-then-create idempotent upgrade callback that leaves
  existing v2 data intact. New `StreakOp` value type co-located in `idb.ts`
  sources `StreakOpKind` + `StreakBreakCause` from `$shared/types/streak`.
  4 new schema tests added in `idb.test.ts` (fresh-install all-four-stores,
  fresh-install round-trip via `by-enqueued`, v2 → v3 upgrade preserves
  seeded rows + adds empty `streakOps`, re-open at v3 is no-op); 370 web
  vitest cases pass; pre-commit hook (lint + check + vitest + fmt + clippy)
  all green.

### T7 — Repo: `streakQueue.ts` (IDB CRUD)

- **Files:** `web/src/lib/data/streakQueue.ts` (new), `web/src/lib/data/streakQueue.test.ts` (new)
- **Description:** Pure repo layer: `enqueue(op)`, `peekAll()` (FIFO via the
  `by-enqueued` index), `remove(opKey)`, `count()`. No business logic, no network.
  Unit tests cover insertion order preservation across enqueue/remove cycles, and
  remove-of-missing-key being a no-op (not an error). Per project standard, all
  IDB calls return promises — repo callers will attach `.catch` handlers.
- **Done when:** Vitest green; coverage includes round-trip persistence across a
  simulated reload (using `fake-indexeddb` if already in tooling).
- **Status:** DONE. `streakQueue` shipped with the four CRUD functions; `peekAll`
  uses the `by-enqueued` index from T6 for FIFO ordering; `remove` of a missing
  key is a silent no-op via IDB's native `delete` semantics. `StreakOp` is
  re-declared and re-exported from `streakQueue.ts` (the interface in `idb.ts`
  remains module-private; `idb.ts` is canonical schema owner). 7 new vitest
  cases in `streakQueue.test.ts`; 377 total web tests pass.

### T8 — Service: `streakOps.ts` (pure op-builders) — DONE 2026-05-10

- **Files:** `web/src/lib/service/streakOps.ts` (new), `web/src/lib/service/streakOps.test.ts` (new)
- **Description:** Pure functions: `buildIncrementOp(taskId, dateIso, occurredAtMs)`,
  `buildBreakOp(cause, occurredAtMs)`, `buildDayCompleteOp(dateIso, occurredAtMs)`,
  `buildResetOp(occurredAtMs)`. Each returns the `StreakOp` shape exported by
  `streakQueue.ts` (opKey/kind/occurredAt/cause?/enqueuedAt/taskId?) with the
  idempotency-key formulas in the design's "Idempotency keys per operation"
  table. No I/O, no store access, no clock reads inside the builders.
- **Status:** Done. Four pure op-builders shipped; `opKey` formulas exactly match
  the design contract table (`inc:<taskId>:<dateIso>`,
  `brk:<cause>:<occurredAtMs>`, `dc:<dateIso>`, `rst:<occurredAtMs>`); 15 new
  vitest cases assert exact opKey strings per representative inputs; 392 total
  web tests pass.
- **Done when:** Unit tests assert exact opKey strings for representative inputs
  (covers the table in the design's "Idempotency keys per operation" section).

### T9 — API client: `applyStreakOp(body)`

- **Files:** `web/src/lib/api/client.ts`, `web/src/lib/api/client.test.ts`
- **Description:** Add `applyStreakOp(body: StreakOpRequest): Promise<StreakOpResponse>`
  using the existing fetch helper / auth header pipeline. Wire up the new endpoint
  URL. No retry logic here — the drainer owns retry.
- **Status:** Done. `applyStreakOp(body: StreakOpRequest): Promise<StreakOpResponse>`
  shipped on the `api` object in `web/src/lib/api/client.ts` (POST `/auth/streak/op`
  via the existing `fetchJson` helper — auth headers, base URL, `ApiError`
  normalization all inherited; no retry logic, the drainer owns retry per design).
  New `client.test.ts` cases follow the existing mock-fetch pattern. 395 web
  tests pass.
- **Done when:** Type-checks; unit-test coverage at the level used by other
  client methods (mock fetch).

### T10 — Sync: `streakDrain.ts` (single-flight drainer + reconciler)

- **Files:** `web/src/lib/sync/streakDrain.ts` (new), `web/src/lib/sync/streakDrain.test.ts` (new)
- **Description:** Implement `drain()` per the design's offline-replay algorithm:
  module-level `draining` guard, FIFO walk of `streakQueue.peekAll()`, post via
  `applyStreakOp`, apply canonical response via a new `applyServerCanonical(canonical)`
  helper that revision-gates updates to `streak.stateStore`, removes the op on
  `200`, drops on `4xx` (not 401) with `console.warn`, aborts on `401`/`5xx`/network
  error. End every successful drain with `streak.hydrateFromServer()`. Schedule a
  single 30s retry if queue non-empty after abort. Unit tests cover: single-flight
  guard prevents concurrent drains; revision-gated reconciler ignores stale (lower)
  revisions; 4xx drops the op; 5xx leaves the op in queue.
- **Done when:** Vitest green for all four scenarios above plus the "drain twice
  in a row, no double-count" scenario from design test contract row 3.

### T11 — Wire `streak.ts` store to enqueue + drain (delete legacy debounced blob push)

- **Files:** `web/src/lib/stores/streak.ts`, `web/src/lib/stores/streak.test.ts`
- **Description:** In each of `streak.increment`, `streak.break`,
  `streak.triggerDayComplete`, `streak.reset`: keep the existing synchronous
  optimistic local mutation (count, countedTaskIds, lastResetDate,
  localStorage mirror) UNCHANGED so sound onset stays sub-20ms; after the
  synchronous body, call `streakOps.buildXxxOp(...)`, `void streakQueue.enqueue(op).catch(console.error)`,
  then kick `void streakDrain.drain()` (no await). Delete the legacy debounced
  `pushStateRemote` blob-push path entirely (server now ignores `streakStateJson`
  on PATCH per T5). Update `hydrateFromServer` to accept the new
  `streakRevision` field and call `applyServerCanonical` so existing hydrate
  callers (5-min poll, visibility hook) automatically pick up canonical state.
  Persist `lastSeenRevision` alongside the existing streak state in localStorage.
- **Done when:** Existing streak unit tests still pass (with adjustments for the
  removed debounced-push behavior); new tests cover (a) increment enqueues exactly
  one op with the expected key, (b) hydrateFromServer with a higher revision
  silently swaps count, (c) hydrateFromServer with a lower-or-equal revision
  is a no-op.

### T12 — `+layout.svelte`: drain on online + visibility-restore

- **Files:** `web/src/routes/+layout.svelte`
- **Description:** Add `window.addEventListener('online', () => streakDrain.drain())`
  registration in the existing onMount block; add a `streakDrain.drain()` call
  alongside the existing `streak.hydrateFromServer()` invocations in the
  visibility-change handler and the 5-minute poll. Ensure the listener is removed
  on destroy. No UI changes.
- **Done when:** Manual smoke: go offline in DevTools, complete a task, come
  online, observe the queue drains and the network panel shows the POST.

### T13 — E2E smoke: `streak-sync.spec.ts`

- **Files:** `web/tests/e2e/streak-sync.spec.ts` (new), tagged `@smoke`
- **Description:** ONE Chromium-only `@smoke` scenario exercising the
  end-to-end server-roundtrip path: complete a task in a list → assert
  local streak count increments to 1 (optimistic, sub-20 ms onset) →
  hard-reload the page → assert count is reflected after reload (proving
  the `/auth/streak/op` POST landed and the post-reload hydrate via
  `/auth/preferences` GET returned the canonical `streakStateJson` +
  `streakRevision`). Mocks: `/auth/streak/op` POST returns canonical
  state with bumped revision and `appliedThisCall: true`;
  `/auth/preferences` GET returns the post-roundtrip canonical
  `streakStateJson` so the post-reload hydrate sees the new count.
  Streak settings must be enabled before navigation
  (`defaultStreakSettings.enabled` is `false`) — easiest via a localStorage
  seed of the prefs-blob entry with `streakSettings.enabled: true` and
  `streakSettings.theme: 'ddr'`. Authenticated token-mode pattern
  borrowed from `auth.spec.ts` / `offline.spec.ts`. Assertion target:
  `aria-label="Streak: 1"` on `.streak-root` (existing markup; no new
  test-id required).
- **Out of scope for T13** (already covered elsewhere): two-device
  concurrent increments (10 server contract tests in T4); offline
  multi-op accrual + drain (9 streakDrain unit tests in T10);
  silent-swap reconciliation when server count differs from local
  optimistic count (T11 store unit tests).
- **Done when:** Test passes locally via `npm run test:e2e:smoke` and is
  wired into pre-push (the existing pre-push hook already runs
  `npm run test:e2e:smoke`, so any new `@smoke`-tagged test is picked up
  automatically).

### T14 — Update `docs/ARCHITECTURE.md` rollout note — DONE 2026-05-11

- **Files:** `docs/ARCHITECTURE.md`
- **Description:** PE already updated the high-level component description during
  the design stage. This task adds a short rollout-compat subsection noting:
  legacy `user.streak_state_json` is read-only after this deploy, older clients'
  PATCH writes to it are silently dropped, and a follow-up migration will drop
  the column (cross-reference the new tech-debt entry). Single-doc edit per
  change-hygiene rule.
- **Done when:** Doc updated; cross-references resolve.
- **Status:** Done. Rollout-compat subsection added to `docs/ARCHITECTURE.md`
  capturing the three deploy-window facts: (1) legacy `user.streak_state_json`
  column is read-only after this deploy — server reads canonical state from
  `user_streak`, the column is still seeded by migration `0017_user_streak.sql`
  for back-compat with older clients still hitting `GET /auth/preferences`;
  (2) older clients' `PATCH /auth/preferences` writes that include
  `streakStateJson` are silently dropped server-side (T5); (3) the column itself
  will be dropped via follow-up migration `0018_drop_user_streak_state_json.sql`
  roughly one stable release week post-ship per tech-debt entry #045 in
  `docs/exec-plans/tech-debt-tracker.md`. All 14 tasks complete; feature ready
  for verification.

### Out of scope for this plan (deliberately deferred)

- Dropping the legacy `user.streak_state_json` column. Tracked separately in
  `docs/exec-plans/tech-debt-tracker.md` (added during the Tasks stage). Per
  user decision: drop in a follow-up migration ~1 stable release week after this
  ships and is verified in production.
- Animated/ticker reconciliation (silent-swap is the locked product decision).
- WebSocket broadcast of streak events (out of scope until WS transport exists).

---

## Test plan

(To be filled by principal-engineer and engineering-manager in the design and task-breakdown stages.)

Minimum expected coverage:
- Unit tests for server-side streak operation logic (idempotency for increment, break, day-complete, reset).
- Unit tests for client offline queue: enqueue operations offline, drain on reconnect, no duplicates.
- Unit tests for silent-swap reconciliation: server count differs from optimistic count → display updates, no animation.
- E2E smoke: complete task online → streak increments; complete task offline → come online → streak reconciles.
- E2E smoke: two-device concurrent completion should not be feasible in Playwright without a real second session, but a single-device test that sends two concurrent increment requests for different task IDs and verifies count = 2 approximates the scenario.

---

## Rollout / migration plan

- Server migration required: the current `streak_state_json` opaque blob must be either
  retained as a seed value or superseded by a structured column/table. PE will design the
  exact migration strategy.
- No feature flag required (feature is additive and backward-compatible at the wire level
  once the server is updated).
- Existing counts must be preserved: the migration must read the existing blob count as the
  seed value for any new authoritative record.
- Clients older than this deploy will continue to push full blob updates; they will be
  overwritten on the next server-authoritative push from a newer client. No forced-upgrade
  wall is needed for MVP.

---

## Progress log

- **2026-05-10** — Discovery complete. Exec plan drafted by product-manager. Open questions
  surfaced to user; design stage blocked until answered.
- **2026-05-10** — All three open product questions answered by user. Decision log updated.
  No remaining open product questions. Plan is ready for design stage.
- **2026-05-10** — Design section authored by principal-engineer. Approach: dedicated
  `user_streak` table with `revision` cursor, new `POST /auth/streak/op` endpoint,
  IDB-backed client op queue with idempotency keys, silent reconciliation via existing
  prefs hydrate path (no new transport — WS does not exist yet). Rolling-deploy safe;
  legacy `streak_state_json` column retained as a fallback. No blocking product
  questions. Architecture doc updated to describe the new component and protocol delta.
- **2026-05-10** — T1 complete. Shared wire types (`StreakOpKind`,
  `StreakBreakCause`, `StreakOpRequest`, `StreakOpResponse`) shipped in
  `shared/types/streak.ts`. `UiPreferencesWire` extended with optional
  `streakRevision?: number`. No production consumers yet (per spec).
- **2026-05-10** — T2 started. Migration `0017_user_streak.sql` to create
  `user_streak` and `user_streak_op` tables (with `idx_user_streak_op_user_date`
  index) and seed `user_streak` from existing `user.streak_state_json` via
  `insert or ignore`. Idempotent at the SQL level. SDE inbox written.
- **2026-05-10** — T2 complete. Migration shipped at
  `server/migrations/0017_user_streak.sql`. Side-fix: SDE restored a missing
  TS-parser test helper in `server/src/routes/mod.rs` that prettier
  reformatting from T1 had broken. All server quality gates pass clean
  (`cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`).
- **2026-05-10** — T3 started. POST /auth/streak/op handler + idempotency
  logic. Wires the canonical streak mutation endpoint that T6–T13 (web client
  queue + drainer + store wiring) will eventually post to. SDE inbox written.
- **2026-05-10** — T3, T4, T5 complete. Server side of the feature is now
  functionally finished: handler shipped at `server/src/routes/streak.rs`, all
  10 design test contracts asserted in cargo tests, GET/auth/preferences now
  serves canonical streak state from `user_streak` (legacy `streak_state_json`
  is no longer authoritative on the read path) and PATCH silently drops
  inbound `streakStateJson`. 52/52 cargo tests green; full server quality
  gates pass. Remaining work is all web client (T6 schema bump → T13 E2E
  smoke) plus the T14 ARCHITECTURE rollout note.
- **2026-05-10** — T6 started. Web IDB schema bump v2 → v3 + new `streakOps`
  object store keyed by `opKey` with `by-enqueued` index on `enqueuedAt`.
  Schema-only — no producers, no CRUD. SDE inbox written.
- **2026-05-10** — T6, T7 complete. IDB v3 schema + `streakQueue` repo CRUD
  (enqueue/peekAll/remove/count) shipped. `peekAll` uses the new `by-enqueued`
  index for FIFO drain order; `remove` of a missing key is a silent no-op via
  IDB's native `delete`. `StreakOp` value type co-located in `idb.ts` (private,
  canonical) and re-exported from `streakQueue.ts` (the public import surface
  for callers above the repo layer). 377 web vitest cases pass.
- **2026-05-10** — T8 started. Service layer: pure op-builders for the four
  streak op kinds (increment/break/day_complete/reset). All idempotency-key
  formulas come from the design's table; the builders themselves never read
  the clock or touch IDB. SDE inbox written.
- **2026-05-10** — T8, T9 complete. Four pure op-builders
  (`buildIncrementOp`/`buildBreakOp`/`buildDayCompleteOp`/`buildResetOp`)
  shipped at `web/src/lib/service/streakOps.ts` with idempotency-key formulas
  exactly matching the design contract table. `applyStreakOp(body)` shipped on
  the api object in `web/src/lib/api/client.ts` (POST `/auth/streak/op` via the
  existing `fetchJson` helper — auth headers, base URL, `ApiError` normalization
  all inherited). No retry logic in the client per design — the drainer (T10)
  owns retry. 395 web vitest cases pass.
- **2026-05-10** — T10 complete. `streakDrain.ts` shipped at
  `web/src/lib/sync/streakDrain.ts` with module-level single-flight guard
  (concurrent `drain()` calls return immediately while one pass is in flight),
  FIFO walk via `streakQueue.peekAll()`, per-op error policy matching the
  design (`200` → reconciler then remove; `4xx` not-`401` → `console.warn` +
  remove; `401`/`5xx`/network → `scheduleRetry` + abort), 30-second
  belt-and-braces retry timer, and end-of-clean-drain `hydrator()` pull so
  concurrent peer-device state propagates back. Reconciler + hydrator are
  injected via `setReconciler`/`setHydrator` setters with no-op defaults,
  breaking the `streak.ts` ↔ `streakDrain.ts` circular dependency at the seam
  where T11 will wire it. 9 contract tests pass (single-flight guard,
  revision-gating ignored stale revisions, 4xx drops + continues, 5xx leaves
  op + schedules retry, 401 pauses + schedules retry, network error
  schedules retry, drain-twice-no-double-count, end-of-clean-drain hydrator
  call). 404 total web tests pass.
- **2026-05-11** — T11 started. Wire `streak.ts` store to enqueue + drain;
  delete the legacy debounced blob push. The five mutation methods
  (`increment`/`break`/`triggerDayComplete`/`reset`/`undoCompletion`) keep
  their existing synchronous optimistic local mutation UNCHANGED to preserve
  the sub-20 ms sound onset, then enqueue an op via `streakOps.buildXxxOp`
  and kick `streakDrain.drain()`. `streak.ts` wires
  `setReconciler(applyServerCanonical)` + `setHydrator(refetchPrefs)` at
  module init to close the circular-dep seam left open in T10. Legacy
  `pushStateRemote`/`queueStateSync`/`syncTimer`/`pendingSyncPayload` block
  deleted entirely (server now drops inbound `streakStateJson` per T5).
  `hydrateFromServer` signature extended to accept the new `streakRevision`
  cursor; all three call sites in `+layout.svelte` updated to pass
  `wire?.streakRevision`. `lastSeenRevision` persisted in the prefs-blob
  alongside `streakState`. SDE inbox written.
- **2026-05-11** — T11 complete. `streak.ts` wired to enqueue + drain via
  `streakQueue`/`streakDrain`; legacy debounced `pushStateRemote` /
  `queueStateSync` / `syncTimer` machinery deleted entirely.
  `hydrateFromServer(streakStateJson, streakRevision?)` signature shipped;
  `+layout.svelte` callers updated at all three sites (initial best-effort
  hydrate, 5-min poll, visibility-change). Synchronous optimistic local
  mutation preserved for the sub-20 ms sound-onset hot path. 406 web vitest
  cases pass.
- **2026-05-11** — T12 started. `+layout.svelte` drain triggers: a single
  `window.addEventListener('online', () => streakDrain.drain())` registered
  in `onMount` (mirroring the existing `visibilityListener` lifecycle —
  module-level `let`, removed in `onDestroy`); `streakDrain.drain()` calls
  added alongside the existing `streak.hydrateFromServer()` invocations in
  the visibility-change handler and the 5-minute prefs poll so reconnect /
  visibility-restore / poll all kick a queue drain. No new listeners
  duplicated for prefs sync — hooks into the existing lifecycle. SDE inbox
  written.
- **2026-05-11** — T12 complete. Four drain trigger sites wired in
  `+layout.svelte`: initial best-effort mount hydrate, 5-minute prefs poll,
  visibility-restore, and a new `window` `'online'` listener with `onDestroy`
  cleanup mirroring the existing `visibilityListener` pattern. No UI
  changes; manual smoke confirmed queue drains and POST visible in network
  panel after offline → complete → online sequence. 406 web vitest cases
  pass. The web client side of the feature is now functionally complete;
  remaining work is T13 E2E smoke + T14 ARCHITECTURE rollout note.
- **2026-05-11** — T13 started. E2E smoke `streak-sync.spec.ts` —
  deliberately tightened scope to ONE `@smoke` Chromium scenario covering
  the full server-roundtrip path: complete a task → local count increments
  optimistically → hard-reload → post-reload hydrate reflects canonical
  count returned by mocked `/auth/preferences` GET (proving the
  `/auth/streak/op` POST + canonical-prefs-derive seam end-to-end). The
  two-device race scenarios from the original task description are
  intentionally OUT of scope for E2E: they are already covered by the 10
  server contract tests (T4) and the 9 `streakDrain` unit tests (T10), and
  Playwright cannot run two concurrent browser sessions against shared
  server state cheaply enough for the smoke suite. SDE inbox written.
- **2026-05-11** — T13 complete. E2E smoke `streak-sync.spec.ts` passes
  locally via `npm run test:e2e:smoke` (19/19 smoke tests green) and is
  automatically picked up by the pre-push hook (which runs the same
  command). Web client + server side of the feature is now functionally
  and end-to-end verified. Only T14 (ARCHITECTURE.md rollout-compat note)
  remains.
- **2026-05-11** — T14 started. ARCHITECTURE.md rollout-compat note —
  PE already updated the high-level Streak (combo meter) bullet during
  the design stage (server-authoritative protocol, `user_streak` table,
  `opKey` dedup, silent-swap reconciliation). T14 is the small follow-up:
  add a short rollout-compat subsection — single-doc edit per
  change-hygiene rule — that captures the three deploy-window facts:
  (1) legacy `user.streak_state_json` column is read-only after this
  deploy (server reads canonical state from `user_streak`; column is
  still seeded by migration `0017_user_streak.sql` for back-compat with
  older clients still on `GET /auth/preferences`), (2) older clients'
  PATCH `/auth/preferences` writes that include `streakStateJson` are
  silently dropped server-side (T5), (3) the column itself will be
  dropped via follow-up migration `0018_drop_user_streak_state_json.sql`
  roughly one stable release week post-ship, tracked in tech-debt entry
  #045. SDE inbox written.
- **2026-05-11** — T14 complete. ARCHITECTURE.md rollout-compat
  subsection shipped; cross-references to migration `0017_user_streak.sql`,
  PATCH-drop behaviour from T5, and tech-debt entry #045 all resolve.
  All 14 tasks (T1-T14) now complete. Implementation stage closed; feature
  ready for verification.
- **2026-05-11** — Stage advanced to verification. Build-specialist inbox
  written at `.state/inbox/build-specialist.md` covering the full quality
  gate matrix for this feature, which spans both web (lint, type-check,
  vitest, Playwright @smoke) and server (cargo fmt, clippy, cargo test) —
  T2-T5 added a server migration, new endpoint, and 12 new server tests,
  so the server gates are mandatory for this feature, not optional.

---

## Decision log

- **2026-05-10** — Reconciliation UX: silent swap. When the server pushes a canonical count
  that differs from the local optimistic count, the displayed number updates in place with
  no animation, no celebration sound, and no "+N from other device" indicator. Stated
  requirement from user; not a PE design choice. Animated/ticker reconciliation is a
  deferred follow-up.

- **2026-05-10** — Day-complete race resolution: first-to-server wins. The server records
  the day-complete event the first time it receives the request for a given user and
  calendar date and returns an affirmative response. Any subsequent request for the same
  user and date returns an "already fired today" signal. The client that receives the
  "already fired today" response suppresses its local celebration immediately — no sound,
  no animation. The client that received the affirmative response has already played its
  celebration. There is no shared celebration, no retry, and no secondary notification to
  the losing device beyond silent suppression. This resolves the medium-likelihood race
  risk identified in the risks table above.

- **2026-05-10** — Pending-state indicator: none. While a streak operation is in-flight to
  the server, the optimistic local count is displayed as if it were already confirmed. No
  spinner, badge, dimming, or any other pending state is shown. When the server reconciles
  silently, the displayed value updates in place per the silent-swap decision. This is
  intentionally consistent with the silent-swap reconciliation decision and keeps the UI
  clean. The user accepted the tradeoff that brief discrepancies between optimistic and
  canonical counts will be invisible.

- **2026-05-10** — Streak count scope: per-user, unchanged. The streak count continues to
  be scoped to each individual user. No cross-user, shared, or space-level aggregates are
  introduced by this feature. This is a narrow clarification of existing behavior, not a
  new design choice.

---

## Design

### Approach

Introduce a server-authoritative streak operation model. Server gains a new
`user_streak` table with a canonical `count`, `last_reset_date`, `day_complete_date`,
a `revision` column for optimistic concurrency, and a bounded `counted_op_keys` table
holding the recent set of accepted idempotency keys (per user, with a daily TTL window
so the dedup set cannot grow forever). A single new endpoint
`POST /auth/streak/op` applies one streak operation atomically inside a SQLite
transaction: it (a) checks the idempotency key, (b) applies the rule for that
operation type, (c) bumps `revision`, and (d) returns the canonical
`{count, lastResetDate, dayCompleteDate, revision, dayCompleteFiredThisCall}`.

Because the current sync transport is HTTP-only (there is no WebSocket today —
`docs/ARCHITECTURE.md` aspires to one but it is not implemented and `server/src/main.rs`
mounts only HTTP routes), broadcast is achieved by piggybacking the canonical streak
record on the existing `GET /auth/preferences` payload, which is already polled every
5 minutes and on every visibility change/PWA resume by `+layout.svelte` (the polling
loop and visibility hook installed by the previous streak plan, see
`docs/exec-plans/completed/2026-03-12-streak-server-side-state.md`). On the device that
issued an operation, the response of `POST /auth/streak/op` is the canonical update —
no extra fetch needed. On other devices, the next existing preferences hydrate
delivers the canonical count. This avoids inventing a new transport while still
satisfying the cross-device determinism requirement.

The web client adds an IDB-backed outbound operation queue
(`web/src/lib/data/streakQueue.ts`) and a thin runtime drainer
(`web/src/lib/sync/streakDrain.ts`). `streak.increment()`, `streak.break()`,
`streak.triggerDayComplete()`, and `streak.reset()` mutate the local optimistic state
synchronously (preserving today's sub-20 ms sound onset), enqueue an op record in IDB
with a stable idempotency key, and the drainer pushes them in order, applying the
server's canonical response back into `stateStore` via a silent-swap reconciler.

Layer assignment per `docs/FRONTEND.md`:

- `data/streakQueue.ts` — repo (IDB CRUD only)
- `service/streakOps.ts` — pure functions to build op records (idempotency keys,
  operation payloads). No I/O.
- `sync/streakDrain.ts` — runtime (reads queue, posts to API, applies result to
  store)
- `stores/streak.ts` — store (owns state; calls service to enqueue, calls drain on
  reconnect/visibility, exposes `streakDisplay`)
- Components/routes already consume `streakDisplay` reactively — no UI changes
  required by this design.

### Data model (server)

#### New tables

```sql
-- 0017_user_streak.sql
create table if not exists user_streak (
  user_id            text primary key references user(id) on delete cascade,
  count              integer not null default 0 check (count >= 0),
  last_reset_date    text,                 -- ISO YYYY-MM-DD, nullable
  day_complete_date  text,                 -- ISO YYYY-MM-DD, nullable
  revision           integer not null default 0,  -- optimistic concurrency / change cursor
  updated_ts         integer not null
);

create table if not exists user_streak_op (
  user_id      text    not null references user(id) on delete cascade,
  op_key       text    not null,           -- idempotency key (see below)
  op_kind      text    not null check (op_kind in ('increment','break','day_complete','reset')),
  applied_ts   integer not null,
  applied_date text    not null,           -- ISO YYYY-MM-DD on which it was applied (for TTL pruning)
  primary key (user_id, op_key)
);
create index if not exists idx_user_streak_op_user_date
  on user_streak_op (user_id, applied_date);
```

`user_streak.revision` is the optimistic-concurrency token and the broadcast
change-cursor in one. Every successful mutation runs:

```text
update user_streak set ... , revision = revision + 1, updated_ts = ?  where user_id = ?
```

Wrapped in a SQLite transaction with `journal_mode=WAL` (already configured per
`docs/ARCHITECTURE.md`), this gives us the serializable per-user write semantics we
need. We deliberately do NOT use a CAS-style `revision = ?` predicate from the
client; clients never send the revision they expect. Server is the sole authority
on count derivation given the operation type, current state, and the dedup table.
This is what makes operations idempotent: the same op_key applied twice produces
the same final count regardless of client knowledge.

#### Idempotency / dedup state and bounding

`user_streak_op` is the dedup set. Each row records a single accepted operation by
its `op_key`. To bound size, `applied_date` is the partition column and we prune
rows older than 7 days on every write (cheap delete with the index). Rationale:
- The increment dedup window only needs to cover the longest plausible offline
  outage plus a safety margin. 7 days fits the iOS Safari 7-day eviction horizon
  noted in `docs/ARCHITECTURE.md`.
- Day-complete uniqueness is enforced by a separate `(user_id, kind='day_complete',
  applied_date=today)` predicate, which is naturally bounded (one row per day).
- Reset/break rows expire on the same 7-day window.

Worst-case row count per user: ~ tasks-completed-per-day × 7 + a handful of break
or reset ops + 7 day_complete rows. For a heavy user (~100 ops/day) that is ~700
rows, comfortably small for SQLite.

The previous design's `countedTaskIds` array (carried in `streak_state_json`) is
retired on the server side: dedup now lives in `user_streak_op` keyed by
`op_key='inc:<task_id>:<applied_date>'` (see "Idempotency keys per operation"
below). This keeps `user_streak` row size small and constant.

#### Migration plan (`server/migrations/0017_user_streak.sql`)

Single SQL file. Idempotent on rerun (`create table if not exists`, `insert or
ignore`):

```sql
-- create the new tables (above)

-- seed user_streak from the existing streak_state_json blob in user table.
-- json_extract returns NULL for missing/invalid; coalesce defaults preserve safety.
insert or ignore into user_streak (user_id, count, last_reset_date, day_complete_date, revision, updated_ts)
select
  u.id,
  cast(coalesce(json_extract(u.streak_state_json, '$.count'), 0) as integer),
  json_extract(u.streak_state_json, '$.lastResetDate'),
  json_extract(u.streak_state_json, '$.dayCompleteDate'),
  0,
  unixepoch() * 1000
from user u;
```

Existing user counts ARE preserved by this seed. `insert or ignore` makes the
migration safe to rerun (no double-seed). The legacy `streak_state_json` column on
`user` is intentionally NOT dropped in this migration — leaving it in place is
required for the rolling-deploy compatibility story (see "Backwards compatibility"
below). A follow-up cleanup migration can drop the legacy column after the next
release window.

#### Concurrency control: justification

Optimistic locking via incrementing `revision` was considered and rejected in
favor of pessimistic per-row serialization inside a transaction. Rationale:

- SQLite WAL gives us per-database write serialization at very low cost. Streak
  ops are sparse (a few per minute per user at most), so contention is negligible.
- A pure CAS loop would force the server to RETRY on conflict, which is harder
  to reason about than a single-shot `BEGIN IMMEDIATE; ...; COMMIT` and just as
  fast at our load.
- The `revision` column is still useful as a monotonic change-cursor for clients
  to detect "I am up to date" without comparing counts.

### API / sync protocol

#### New endpoint

```text
POST /auth/streak/op
Authorization: Bearer <jwt>
Content-Type: application/json

Request body (single op):
{
  "opKey": "inc:<taskId>:2026-05-10",     // string; required; <= 128 chars
  "kind":  "increment"                       // 'increment' | 'break' | 'day_complete' | 'reset'
                                             //   (cause hints permitted but not required)
  "occurredAt": 1715300000000,               // ms epoch on the client; advisory only,
                                             //   server uses its own clock for applied_ts
  "cause": "punt" | "skip" | "delete" | "manual" | null  // optional, kind=='break' only
}

Response (always returns full canonical state):
{
  "revision": 17,
  "count": 5,
  "lastResetDate": "2026-05-10",
  "dayCompleteDate": "2026-05-10" | null,
  "appliedThisCall": true,        // false if op_key was a duplicate (idempotent replay)
  "dayCompleteFiredThisCall": false  // true ONLY if this exact request set day_complete
}
```

Status codes:
- `200 OK` — applied or duplicate (both return canonical state)
- `400 Bad Request` — malformed body, unknown kind, opKey too long, bad date
- `401 Unauthorized` — missing/invalid token
- `5xx` — server error; client retries

The endpoint always returns canonical state, even on duplicate replay. That is
how the calling device reconciles: it doesn't matter whether the server
considered this op novel or a replay — the response is the source of truth.

#### Idempotency keys per operation

| Operation | `kind` | `opKey` formula | Notes |
|---|---|---|---|
| Increment | `increment` | `inc:<taskId>:<applied_date>` | `applied_date` = the local ISO date the user completed it. Recurring tasks reuse the task ID across days, so date in the key permits next-day re-counting (matches today's `streak.undoCompletion` reset logic). |
| Break | `break` | `brk:<causeHint>:<occurredAtMs>` | Per-event uniqueness. We do NOT collapse multiple breaks on the same day to a single op — each one is real. The retry path uses the same `occurredAtMs` so a network blip retry is idempotent. `<causeHint>` may be `punt`, `skip`, `delete`, `manual`. |
| Day-complete | `day_complete` | `dc:<applied_date>` | Naturally one per user per calendar date. First-to-server wins; second arrival is a duplicate replay. |
| Reset | `reset` | `rst:<occurredAtMs>` | Manual user reset. Keyed by client-side timestamp so retry is idempotent. |

The `applied_date` in increment keys is the client's local ISO date at the moment
the user completed the task. This is the only place the design depends on a
client-supplied date. It is acceptable because:

- The dedup property only needs to identify "is this the same completion event the
  user just did", not "what day does the server consider it". Mild cross-device
  clock skew (a few hours) does not change which task is being counted.
- The server uses its own clock for `applied_ts` and `last_reset_date`. Client
  date appears only inside the dedup key.

#### Auth

Standard JWT auth via the existing `ctx_from_headers()` pipeline (see
`server/src/routes/types.rs`). The endpoint resolves `user_id` from the JWT and
operates only on that user's `user_streak` row — there is no path through which
user A can mutate user B's streak. No new authorization surface.

#### Broadcast model

There is no live push channel today. Cross-device propagation rides the existing
`GET /auth/preferences` poll:

1. Extend `UiPreferencesResponse` with two fields:
   - `streakRevision: i64` — copied from `user_streak.revision`
   - `streakStateJson: String` — canonicalized JSON
     `{count, lastResetDate, dayCompleteDate}` (legacy field name preserved for
     migration; see "Backwards compatibility" below)
2. `auth_get_preferences` left-joins `user_streak` and includes both fields in the
   response.
3. Client `streak.hydrateFromServer()` (already called by both `+layout.svelte`'s
   visibility hook AND the 5-minute poll, both installed in the previous streak
   plan) compares server `streakRevision` to the locally stored
   `lastSeenRevision` — if higher, the server count silently swaps in.

This preserves the constraint "extend WebSocket sync protocol structure beyond
riding existing channels minimally" from the exec plan's non-goals — except no WS
exists yet, so we ride the existing HTTP preferences channel. If/when a WS
channel is added later, broadcasting `streakRevision` over it is a trivial
follow-up because the server already has the cursor column.

### Web client architecture

#### Module layout

| New file | Layer | Responsibility |
|---|---|---|
| `web/src/lib/data/streakQueue.ts` | repo | IDB object store CRUD: `enqueue(op)`, `peekAll()`, `remove(opKey)`, `count()` |
| `web/src/lib/service/streakOps.ts` | service | Pure helpers: `buildIncrementOp(taskId, dateIso)`, `buildBreakOp(cause)`, `buildDayCompleteOp(dateIso)`, `buildResetOp()`. Each returns a `StreakOp` with a stable `opKey`. |
| `web/src/lib/sync/streakDrain.ts` | runtime | `drain()` walks `streakQueue.peekAll()` in insertion order, posts each via `api.applyStreakOp()`, applies the canonical response to `stateStore`, removes the op on success. Handles offline/5xx by aborting the drain (queue stays). |

| Modified file | Change |
|---|---|
| `web/src/lib/stores/streak.ts` | Each mutation method enqueues an op in addition to its current optimistic store update. The legacy debounced `pushStateRemote` blob push is deleted. `hydrateFromServer` accepts the new `streakRevision` and silently reconciles. |
| `web/src/lib/data/idb.ts` | Add `streakOps` object store to the schema (DB version bump from 2 to 3). |
| `web/src/lib/api/client.ts` | Add `applyStreakOp(body)` returning the canonical response shape. |
| `shared/types/settings.ts` | Add `streakRevision?: number` to `UiPreferencesWire`. Add `StreakOp` and `StreakOpResponse` types in a new `shared/types/streak.ts` (or co-located). |
| `web/src/routes/+layout.svelte` | After existing `streak.hydrateFromServer` call in the 5-min poll and visibility handler, also call `streakDrain.drain()` on online/visibility-restore. Online detection: `window.addEventListener('online', ...)`. |

#### Optimistic local update — sub-20 ms hot path

`streak.increment(taskId)` continues to do everything it does today **synchronously**:

1. Update `stateStore` (count, countedTaskIds, lastResetDate). This drives the
   reactive `streakDisplay` for the overlay and the announcer-suppression boolean
   the caller in `tasks.ts` already uses.
2. Mirror to `localStorage` via `writeStreakStateToPrefsBlob()` (synchronous, same
   as today).
3. Decide whether the announcer fires (already synchronous).
4. NEW: build an op via `streakOps.buildIncrementOp(taskId, todayIso())` and call
   `streakQueue.enqueue(op)`. This is one IDB `put` — fire-and-forget by design,
   but with a `.catch(err => console.error(...))` per the project's no-silent-IDB
   rule.
5. NEW: trigger `streakDrain.drain()` (no `await`). Drain runs on a microtask;
   even if the network call takes 200 ms, the synchronous return path of
   `streak.increment` is unchanged.

The completion sound is dispatched by `tasks.toggle` after `streak.increment`
returns, exactly as today. The hot path adds zero `await`s. Sound onset budget
stays under the existing measurement (the same WebAudio path, gated by the same
synchronous boolean).

`streak.break()`, `streak.triggerDayComplete()`, and `streak.reset()` follow the
same pattern: synchronous local mutation, enqueue op, kick drain.

#### Outbound queue — IDB schema

```ts
// streakOps store (idb.ts)
//   key: opKey (string)
//   value: { opKey, kind, taskId?, cause?, occurredAt, enqueuedAt }
//   index: 'by-enqueued' on enqueuedAt for FIFO drain order
```

Storage layer: IndexedDB via the same `idb` package the rest of `data/` uses.
Bounded by retention: the drain removes ops on successful server ack. If a user
were to remain offline for an extended period and accumulate hundreds of
increments, the queue grows linearly but each row is tiny (~50 bytes). At the
extreme, a runaway queue is bounded by IDB quotas, which would surface as a write
failure that we log (see Failure modes). No periodic prune is needed.

Drain semantics:

- Drain is single-flight: a module-level `let draining = false` guard prevents
  concurrent drains across `online` events, visibility changes, and post-enqueue
  kicks.
- Drain processes ops in `enqueuedAt` order. Each op posts to
  `POST /auth/streak/op`; on `200 OK` it is removed from the queue and the
  canonical response is applied to `stateStore` via `applyServerCanonical()`.
- On `4xx` (other than `401`) the op is removed from the queue and logged via
  `console.warn` — it is malformed and re-trying won't help. Wire-format
  validation per the project standard.
- On `401` the drain stops (auth lost; will resume after re-login).
- On network error or `5xx` the drain aborts, leaving remaining ops in place. A
  subsequent `online` event or visibility-restore re-runs it.

#### Reconciliation — silent swap

`applyServerCanonical(canonical, source)` is the single entry point. It:

1. Compares `canonical.revision` to `lastSeenRevision` (in-memory + persisted in
   the prefs blob alongside `streakState`). If lower or equal, no-op.
2. Updates `stateStore` to `{count, lastResetDate, dayCompleteDate}` from
   canonical, preserving the local in-flight queue (counts of un-acked ops are
   already reflected in the server response from this device's perspective; for
   the OTHER device's perspective, the in-flight ops are not yet acked but they
   will be applied on top of the new canonical state when their turn comes — see
   conflict resolution).
3. Bumps `lastSeenRevision`.
4. Does NOT touch the `displayStore` `pulse`/`visible`/`judgmentSrc` fields. The
   on-screen overlay, if visible from a recent local increment, fades on its own
   timer. The displayed count number is bound reactively to `streakDisplay`,
   which derives from `stateStore.count`. This is the silent swap.

Reactive path: the `StreakDisplay.svelte` component already binds to
`$streakDisplay` (verified by reading `web/src/lib/components/StreakDisplay.svelte`
is unnecessary because the existing component is unchanged — it already reacts to
`stateStore` via `streakDisplay`). The number simply updates.

Project standard compliance: components derive from `$streakDisplay` (reactive),
not `get(stateStore)`. No change required.

#### Offline replay

Algorithm on reconnect (driven by `online` event or visibility-restore):

```text
1. drainStreakOps():
   if draining: return
   draining = true
   try:
     loop:
       op = streakQueue.peekFirst()
       if op is null: break
       try:
         response = await api.applyStreakOp(op)
         applyServerCanonical(response, source='drain')
         streakQueue.remove(op.opKey)
       catch transient:                  // network, 5xx
         break                            // leave the queue intact, retry later
       catch permanent (4xx, not 401):
         streakQueue.remove(op.opKey)
         console.warn('[streakDrain] dropped malformed op', op.opKey)
       catch 401:
         break                            // auth lost; resume after re-login
   finally:
     draining = false
2. If queue is non-empty, also schedule a single retry in 30s.
3. Always call streak.hydrateFromServer() at the END of a successful drain
   to ensure the device picks up any concurrent ops from other devices.
```

End-to-end idempotency: every op carries a stable `opKey`, the server
deduplicates on `(user_id, op_key)`, and the response is the canonical state
regardless of replay status. A retry after a network blip cannot double-count.

#### Day-complete suppression and the timing trade-off

When the user completes the final My Day task on the local device,
`tasks.toggle` calls `streak.triggerDayComplete()` synchronously — exactly as
today. `triggerDayComplete()`:

1. Checks the local `dayCompleteDate === todayIso()` guard. If already fired
   locally (this session), returns false. Same as today.
2. Plays the celebration sound and shows the image OPTIMISTICALLY. This satisfies
   the perceived-instant requirement.
3. Enqueues a `day_complete` op.
4. The drain posts it. If the response says `dayCompleteFiredThisCall === false`
   AND `dayCompleteDate === todayIso()`, it means another device already won.
   The local guard is set to today (no-op since we already set it locally), and
   no further action is taken.

There is no race-free way to suppress the optimistic celebration before it
plays without taking the latency hit on every completion. This is the trade-off
the user accepted by locking the silent-swap and no-pending-indicator decisions:

- **In the rare race window**: both devices play the celebration. The losing
  device hears it once (locally) and silently swallows the server's
  "already fired" signal afterwards. There is no second celebration on either
  device.
- **In the common case**: only one device fires the celebration because the
  other device has already received an updated `dayCompleteDate` via the 5-minute
  preferences poll or visibility-restore hydrate. The local guard short-circuits
  the optimistic celebration before it plays.
- **Documented trade-off**: in the worst case (two devices both online,
  completing the final task within ~1 second of each other), both will play the
  celebration once. This is consistent with the locked
  first-to-server-wins decision and the locked silent-swap decision (no
  mid-flight indicator). No design change can avoid the optimistic celebration
  on both devices without adding latency to the completion sound, which would
  violate the <20 ms onset budget.

### Conflict resolution

All rules are deterministic, idempotent, and testable. Each test contract below
specifies inputs, the order in which operations reach the server, and the
expected final canonical state.

#### Rules

1. **Increment dedup by op_key.** An op with `opKey='inc:<taskId>:<date>'` is
   counted at most once per user per task per date. Server checks
   `(user_id, opKey)` in `user_streak_op` before incrementing.
2. **Break is monotonic-zero.** A `break` op sets `count := 0` unconditionally
   (subject to dedup). Subsequent `increment` ops after the break time produce
   `count := 1, 2, ...` from zero. Concurrent break and increment racing: the
   server applies them in arrival order. If `break` arrives first, increments
   are applied after the break and the count starts from 1. If an increment
   arrives first, it is counted, then the break zeros it.
3. **Day-complete is set-once-per-date.** `dc:<date>` is unique. The first
   request returns `appliedThisCall=true, dayCompleteFiredThisCall=true`; any
   subsequent request for the same date returns `appliedThisCall=false,
   dayCompleteFiredThisCall=false` and the existing canonical state.
4. **Reset is set-zero-and-clear.** `count := 0`, `countedTaskIds` (now
   `user_streak_op` entries) within the past day are pruned for clean re-counting,
   `dayCompleteDate := null`. Subsequent increments are counted from 1.
5. **Last-write-wins on `lastResetDate`.** Server sets it to today's date on
   every successful `increment` and `break`/`reset`. Reads from this field are
   informational only; conflict resolution does not depend on date comparison
   (it uses the dedup table and `revision`).
6. **Revision is monotonic.** Every successful mutation increments `revision`.
   Clients only accept canonical updates whose `revision` is greater than their
   `lastSeenRevision`. This makes the silent swap deterministic and prevents
   stale preferences responses from clobbering newer canonical state.

#### Test contracts

| # | Scenario | Inputs (server-arrival order) | Expected final canonical state |
|---|---|---|---|
| 1 | Two devices, two different tasks | `inc:T1:D` from A, `inc:T2:D` from B | `count=2`, two op rows in dedup table |
| 2 | Two devices, same task ID (recurring synced mid-flight) | `inc:T1:D` from A, `inc:T1:D` from B | `count=1`, one op row; B receives `appliedThisCall=false` and same canonical state |
| 3 | Offline accrual then online | Local queue: `[inc:T1:D, inc:T2:D, inc:T3:D]`. Network restored. Drain posts all three. | `count=3`, three op rows. Drain a second time after the same online event — no double count (single-flight guard + opKey dedup). |
| 4 | Break and increment racing — break first | `brk:punt:t0` then `inc:T1:D` | `count=1` (break zeros, then increment counts from 1) |
| 5 | Break and increment racing — increment first | `inc:T1:D` then `brk:punt:t1` | `count=0` (increment counts to 1, then break zeros) |
| 6 | Manual reset racing with increment | `rst:t0` then `inc:T1:D` | `count=1` (reset clears, then increment counts from 1) |
| 7 | Manual reset twice (network retry) | `rst:t0` twice with same opKey | `count=0`, single dedup row, second response `appliedThisCall=false` |
| 8 | Day-complete first-to-server wins | `dc:2026-05-10` from A, then `dc:2026-05-10` from B | A response: `dayCompleteFiredThisCall=true`. B response: `dayCompleteFiredThisCall=false`, `dayCompleteDate=2026-05-10` unchanged |
| 9 | Hydrate respects revision | Server at revision=5. Client receives stale prefs response with revision=3. | No state change. Lower revision is ignored. |
| 10 | Increment idempotent across days | Recurring task T1 completed today and tomorrow. Two ops: `inc:T1:2026-05-10`, `inc:T1:2026-05-11`. Both succeed. | `count` increments twice. Date-bucketed dedup permits same-task next-day re-counting (matches today's behavior where `streak.undoCompletion` removes from `countedTaskIds`). |

Each row above maps to one server-side unit test (in `server/src/routes/mod.rs` or
a new `streak_tests.rs` module per the routes split convention) and, where the
client's drain/reconcile logic is involved (rows 3, 9), one client-side vitest
case in `web/src/lib/sync/streakDrain.test.ts`.

### Backwards compatibility and data migration

#### Older client talking to newer server

Older client (current code) pushes the full blob via `PATCH /auth/preferences`
with a `streakStateJson` body. Newer server behavior:

- The server SHOULD ignore the `streakStateJson` field on `PATCH
  /auth/preferences` going forward — the canonical streak record is in
  `user_streak`, not in `user.streak_state_json`. To preserve the rolling-deploy
  story, the patch handler will silently drop incoming `streakStateJson` writes
  AFTER the migration is applied. (Today the field is written through to the
  legacy column; the change is a one-line edit to skip that bind.)
- The legacy `user.streak_state_json` column remains in the schema but is
  effectively read-only. The server WRITES to it at most once more (the seed
  during migration); after that it is never updated. Reads from
  `GET /auth/preferences` will continue to return whatever the seed wrote so
  pre-deploy clients see a sensible value, but newer clients will use the
  authoritative `streakStateJson` rebuilt from `user_streak` (which we
  recompute on every preferences GET).
- Effect: an older client sees its own writes "succeed" (HTTP 200) but they have
  no effect on the canonical state. The next preferences hydrate will return the
  authoritative count and the older client's local cache will silently swap in.
  This matches the exec plan's stated behavior: "Clients older than this deploy
  will continue to push full blob updates; they will be overwritten on the next
  server-authoritative push from a newer client" — refined here to "overwritten
  on the next preferences hydrate from any client (including the older one
  itself)".

This is safer than the original plan note suggested: even an older client's own
hydrate will pull canonical state from `user_streak` once the server is upgraded,
so the older client converges without requiring a newer client to push.

#### Mixed devices for a single user during rollout

Newer device A increments; canonical count goes to N+1. Older device B's local
`stateStore.count` stays at N (it has no concept of the new endpoint). On B's
next 5-minute prefs poll, the server returns `streakStateJson` derived from
`user_streak` (i.e. N+1). Older B's `streak.hydrateFromServer()` accepts it
because the existing logic is "server wins on hydrate". B converges within one
poll interval. No data loss.

If older B then completes a task locally, it pushes a stale full blob with
`count: N+1`. The server drops the field. B's local count stays at N+2 (its
optimistic increment) until the next hydrate, which corrects it to whatever the
new server-authoritative count is (N+2 if no other device incremented in the
interim, N+3 if A also incremented). Older B's behavior is degraded but
non-destructive.

#### Migration script idempotency

The migration uses `create table if not exists` and `insert or ignore`. Running
it twice produces no duplicate rows and no count changes. Verified in the
migration test (each migration is run twice in the integration test loop, see
`setup_pool` in `server/src/routes/mod.rs`).

#### Rollback plan

If the new endpoint or migration misbehaves in production:

1. **Code rollback**: revert the server binary to the prior release. The
   `user_streak` table remains but is unused (older code reads
   `user.streak_state_json` exclusively). Clients older than the rollback target
   will keep writing the legacy blob; newer clients fall back to the legacy
   path because their `applyStreakOp` calls will start returning 404 on the
   reverted server, and the drain will treat 404 as a transient error and stop
   draining. State is safe — local optimistic count keeps working; cross-device
   drift returns to the pre-deploy baseline. Drained ops in the queue are
   harmless once code is reverted (they sit until cleared on next deploy).
2. **Schema rollback**: not required. The `user_streak` table can be dropped
   later via a follow-up migration if desired. There is no data we need to
   preserve from `user_streak` that is not also seedable from
   `user.streak_state_json`.
3. **Hot fix**: if only the endpoint is broken but the data is fine, route 503 on
   `/auth/streak/op` and revert the client config to disable the drain. Local
   optimistic state continues to work.

### Performance budget compliance

#### <20 ms sound onset

The hot path is `tasks.toggle` -> `streak.increment` -> sound dispatch. The
synchronous body of `streak.increment` adds two operations vs. today: an
`indexedDB.put` (the enqueue) and a microtask kick of `drain()`. `idb.put` calls
return a promise — we do not await it on the hot path. The microtask kick of
`drain()` is a single function call; the actual network is async.

Measurement strategy: extend the existing E2E perf test
(`web/tests/e2e/perf.spec.ts` `@smoke @perf`) to also exercise streak-on-toggle.
The existing toggle measurement (E2E ceiling 200 ms; product budget < 16 ms)
already includes the streak path; we verify no regression by re-running the
benchmark before and after.

The sub-20 ms budget is for sound onset, which is dispatched in the same
synchronous tick as the toggle. The audio buffer is pre-decoded
(`web/src/lib/sound/sound.ts` per `docs/RELIABILITY.md` and ARCHITECTURE.md);
adding an IDB enqueue does not block the audio path.

#### Server round-trip cost

`POST /auth/streak/op` is async from the client's perspective and never blocks
the UI. The server side runs a single `BEGIN IMMEDIATE; SELECT; INSERT/UPDATE;
COMMIT` against SQLite in WAL mode. Empirically these are sub-millisecond on
local SQLite. Even at 100 ms WAN latency this is invisible because nothing on
the client awaits it.

#### Server load delta

PM rated this low-medium. Refining: streak ops are sparse — at most a few per
minute per active user (one per task completion, plus rare break/reset events).
Each op is a tiny SQLite write. Compared to the existing task sync push traffic,
the additional load is negligible. **Confirm: low.**

#### IDB writes on the hot path

One new write per increment: `streakQueue.enqueue(op)`. Per project standard
(no fire-and-forget IDB writes), the call is wrapped:

```ts
void streakQueue.enqueue(op).catch((err) => console.error('[streak] enqueue failed', err));
```

The same applies to `streakQueue.remove(opKey)` on successful drain.

### Failure modes

| Failure | Detection | User-visible behavior | Recovery |
|---|---|---|---|
| Server unreachable (offline / server down / 5xx) | `fetch` rejects or returns 5xx | None on local device — optimistic state shown. | Op stays in queue. Drain re-runs on next `online` event, visibility-restore, or 5-min poll. |
| Server reachable but rejects op (`400`) | Response body has `4xx` status | None visible. `console.warn` logged. | Op is dropped from queue. Local optimistic state remains — would be corrected on next hydrate if it were divergent. |
| Auth lost (`401`) | Response is `401` | None visible (auth flow handles re-login). | Drain stops. After re-login, drain re-runs from queue. |
| IDB enqueue failure | `streakQueue.enqueue().catch(...)` fires | None visible. `console.error` logged. | Op is lost. Local optimistic state survives in `stateStore` until next hydrate — at that point the local count silently swaps to canonical (which is missing this increment). One increment is lost. Acceptable, rare, and logged. |
| Malformed inbound canonical state | `applyServerCanonical` validates: `count` is non-negative integer; `revision` is integer; dates are ISO YYYY-MM-DD or null. Wire-format validation per project standard. | None visible. `console.warn` logged. Old state retained. | Next hydrate retries. |
| Queue corruption (unparseable op) | `streakDrain.drain()` validates each op record before posting | None visible. `console.warn` logged. Bad op dropped. | Drain continues with the next op. |
| Clock skew between devices | Inspected in design: client clock appears only inside `opKey` strings (as `applied_date` for increments and `occurredAtMs` for break/reset). It is never used for ordering or rule evaluation on the server. | None. | N/A — no behavior depends on cross-device clock agreement. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep the opaque blob; add CRDT-style merge on the server | The blob has no operation semantics — only end-state. Merge would require synthesising operations from before/after diffs, which is exactly what we're trying to avoid. Also: increments are not commutative with breaks; a CRDT merge cannot decide ordering without per-op metadata, at which point we have an op log. Rejected. |
| Vector clocks for per-device ordering | Adds significant complexity (per-user-per-device VV, garbage collection of dead devices) for no user-visible benefit. The user does not care which device's increment happened first — only that the count is correct. Server-authoritative ordering by SQLite arrival is simpler, deterministic, and sufficient. |
| New dedicated `/streak` REST endpoint vs. WebSocket sync channel | Chosen: REST endpoint. WebSocket transport does not exist today (`server/src/main.rs` has no WS routes). Adding WS infrastructure is a large project on its own and out of scope for this feature. The existing 5-minute prefs poll + visibility-restore hydrate gives us all the cross-device propagation latency we need (already accepted by users for task sync). |
| Schema: dedicated `user_streak` table vs. dedicated columns on `user` vs. structured sub-blob with version | Chosen: dedicated `user_streak` table. Dedicated columns on `user` work but conflate concerns (streak is its own domain — easier to test, easier to drop in rollback). Sub-blob with version requires the client to do the merge, which defeats the purpose of moving to server-authoritative. |
| Embed dedup set in `streak_state_json` (today's behavior, server-side now) | Forces the column to grow unboundedly with task completions over time. Dedicated `user_streak_op` table with TTL pruning bounds the growth and uses a real index for lookups. |
| Strong CAS on `revision` from the client (client must send expected revision) | Not needed — server always derives the next state from current state + op type. The client never has to "re-base" because the operation is meaningful regardless of what revision the server is at when it arrives. Avoids CAS retry loops. |
| Drop `streak_state_json` column in this migration | Leaving it in place preserves rolling-deploy compatibility (older clients reading `GET /auth/preferences` see a sensible value). A follow-up migration can drop it after one full release window. |

### Risks and open technical questions

#### New / refined risks

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Migration on a large user table (`insert or ignore` from `streak_state_json`) is a single transaction; could lock the DB briefly | Low | Low | One row per user. Even at 10k users this completes in milliseconds. SQLite WAL avoids reader blocking. |
| Older clients keep pushing `streakStateJson` after deploy and we drop the field silently, potentially confusing devs investigating | Low | Low | Drop behavior is logged via `tracing::debug!` server-side. Documented in this plan and in the rollout note in `docs/ARCHITECTURE.md`. |
| Drain races with hydrate: hydrate applies canonical state from server, then drain replays an op the server has already counted | Already-mitigated | N/A | The server returns canonical state on every op response, and `applyServerCanonical` is idempotent + revision-gated. Replaying a duplicate op returns `appliedThisCall=false` and the same canonical state, which is a no-op against the local store. |
| Day-complete double-celebration in the rare two-devices-finishing-simultaneously case | Medium-Low | Low | Documented trade-off (see "Day-complete suppression and the timing trade-off"). Locked product decisions accepted this trade-off. No mitigation needed; would require either pre-flight latency or a pending indicator, both rejected by user. |
| 5-minute poll interval means cross-device propagation lag in the worst case is ~5 minutes | Low | Low | This already matches the cross-device latency for everything else in tasksync. Visibility-restore hydrate covers active tab-switching cases. Future WS broadcast (out of scope) would tighten this. |

#### Questions for product/EM

None blocking. The locked decisions in the exec plan's decision log are
sufficient and consistent with the design above. One soft question to surface:

- **Do we want to drop the legacy `user.streak_state_json` column in a follow-up
  migration once the rollout is stable**, or leave it in place permanently as a
  migration-safety lifeline? This is a follow-up cleanup decision, not a
  blocker for this feature. Default recommendation: drop it in the next minor
  release after this one ships and is verified in production for a full week.
