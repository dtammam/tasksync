---
plan: sync-default-emoji-dropped
harness: v2 · lean
branch: fix/sync-default-emoji-dropped
anchor: outcome
status: Shipped PR#167
next: Merged via PR #167 — nothing outstanding
gate: APPROVED @5e93e23 — adversary + qa (r1)
---

# Fix: list default tag dropped on sync-pull

## Request (restated)

A list's default tag (`default_emoji`) is applied to the **first** task created
after the list is made, then silently stops applying to every subsequent task.
Root cause: `syncFromServer`'s inline list mapping omits `default_emoji`, so the
first background sync overwrites the lists store and strips the tag.

## Blind-spot pass

- **Root cause (confirmed by measurement).** `web/src/lib/sync/sync.ts:194-200`
  maps `pull.lists` into `List[]` with a hand-written object literal that lists
  `id, name, icon, color, order` but **not** `default_emoji`. Line 215 then calls
  `lists.setAll(toLists)`, replacing the whole store. Any sync after the first
  task-create (the 15s dirty-retry timer, post-push sync, 5-min poll,
  focus/visibility) wipes the default tag. `tasks.ts:281`/`:306` then read a list
  with no `default_emoji`, so later tasks get no tag.
- **Server is not at fault.** `server/src/routes/lists.rs` create/update/get all
  persist and return `default_emoji` correctly; `shared/types/sync.ts` `SyncList`
  carries the field; the API client returns it. The value is present on the wire
  and only discarded in this one client mapping.
- **Divergence, not absence.** `lists.ts:17-24` `normalizeListFromApi` already
  maps `default_emoji` correctly. The sync layer has a *parallel* literal that
  drifted from it — that drift is the bug, and is the reason to prefer a fix that
  can't drift again.
- **Separate, pre-existing gap (out of scope here).** Even with this fixed, a
  task created before the lists store first hydrates gets no default (seed lists
  in `lists.ts:6-13` carry no `default_emoji`), and the server applies no
  fallback in `tasks.rs`. A server-side default fallback would kill the whole
  class — deliberately deferred; noted in tech-debt candidates below.
- **Assumptions.** Web-only change; no schema, no server, no wire-type change.
  `SyncList.default_emoji` and `List.default_emoji` already exist. No migration.

## Acceptance (outcome — measurable)

1. **The mapping preserves the field.** `syncFromServer`'s `toLists` map includes
   `default_emoji` (via the field, or by reusing the store's normalizer), so a
   sync-pull round-trip leaves each list's `default_emoji` intact in the store.
   *Measured:* read the diff at `sync.ts:194-200`; the field is present.
2. **A regression test binds it.** A web unit test asserts that after a
   `syncFromServer` pull carrying a list with `default_emoji`, `get(lists)` still
   reports that `default_emoji`. The test **fails on the pre-fix code and passes
   after**. *Measured:* run the test on both trees.
3. **Gates stay green, nothing else moves.** `npm run lint`, `npm run check`,
   `npm run test` (web) pass; the diff touches only `web/` (sync mapping + test);
   no server/Rust files change. *Measured:* gate command output + `git diff --stat`.

## Build

- **Fix:** `web/src/lib/sync/sync.ts:199` — added `default_emoji: l.default_emoji ?? undefined`
  to the `toLists` map (matching `normalizeListFromApi`). +1 line.
- **Regression test:** `web/src/lib/sync/sync.test.ts` — "preserves a list's
  default_emoji through the pull that overwrites the store". Verified **red then
  green**: with the fix line deleted the test fails (`Received: undefined`); with
  it restored it passes.
- **Local gates:** `npm run lint` clean · `npm run check` 0 errors/0 warnings ·
  `npm run test` 449 passed (29 files).
- **Scope:** `git diff --stat` = `sync.ts` (+1), `sync.test.ts` (+regression);
  no server/Rust files touched.

## Out of scope

- Server-side `default_emoji` fallback in `tasks.rs` (kills the cold-hydration
  class too) — logged as a follow-up, not built here.
- Cold-start hydration race for a task created before first list hydration.

Gate: APPROVED r1 @5e93e23 — adversary
- Fix verified binding: deleting `default_emoji: l.default_emoji ?? undefined` (sync.ts:199) turns the regression test RED (`expected undefined to be '🔥'`); restored → 28/28 sync tests pass.
- Empty-string idiom safe: mapping keeps '' as '' (matching normalizeListFromApi), and both consumers tasks.ts:281/:306 use `|| undefined`, so a cleared default never applies a literal '' tag.
- Enumeration complete: only two SyncList→List mappings exist (sync.ts + lists.ts normalizeListFromApi); both now carry default_emoji. hydrateFromDb round-trips full List objects; no other rebuild drops the field.
- No regression to icon/color/order; svelte-check 0 errors/0 warnings; eslint exit 0; git diff --stat = plan doc + sync.ts(+1) + sync.test.ts, no server/Rust files.
- Tree byte-identical after mutation cycle (git status clean apart from this line).

Gate: APPROVED r1 @5e93e23 — qa
- Fix matches acceptance #1: `sync.ts:199` adds `default_emoji: l.default_emoji ?? undefined` to the `toLists` map, byte-identical to `normalizeListFromApi` (lists.ts:22); `List`/`SyncList` both declare `default_emoji?: string`, so types agree.
- Acceptance #2 independently verified red→green: in a throwaway worktree at base 43d2b0f (pre-fix sync.ts + the new test), the regression test FAILS `Expected "🔥" / Received undefined`; on HEAD the full suite passes — so it truly binds `setAll` overwrite and would catch a re-drop.
- Acceptance #3 gates green, verbatim: `npm run lint` exit 0 (eslint clean); `npm run check` "0 errors and 0 warnings"; `npm run test` "29 passed (29) / 449 passed (449)"; `git diff --stat` = plan doc + sync.ts(+1) + sync.test.ts(+27), no server/Rust files.
- Comment/commit accuracy confirmed: consumers `tasks.ts:281`/`:306` read `get(lists)...default_emoji || undefined`, so the store-strip mechanism the test comment describes is real; empty-string is coerced away by `|| undefined` — no literal '' tag applied.
- Security surface: none. `default_emoji` is a server-originated string echoed through the store and rendered as auto-escaped text in Svelte; no new sink, no injection/traversal/SSRF/auth/PII exposure introduced. Tree left byte-identical (only gate verdict lines added; worktree removed and pruned).
