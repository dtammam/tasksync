---
plan: sync-default-emoji-dropped
harness: v2 · lean
branch: fix/sync-default-emoji-dropped
anchor: outcome
status: Building
next: Run /gate on the branch diff (fix + regression test); all local web gates green
gate: pending
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
