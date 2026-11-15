---
plan: fix-regroup-on-load
harness: v2 · lean
branch: fix/regroup-on-load
anchor: outcome
status: In progress
next: builder — W3 (docs)
gate: pending
builder: smart
---

# Fix: task order jumps a moment after the page loads

## Request

Dean (2026-11-15): when reopening the app, a list (or My Day) first renders in
one order, then "a moment later the tag groups/tasks rearrange themselves —
it almost feels like a refresh." Ruled symptom: **order jumps after load**
(the sort *setting* is not lost).

## Rulings (owner, 2026-11-15)

| # | Question | Ruling |
|---|----------|--------|
| R1 | Symptom | Order jumps after load. Not a lost preference. |
| R2 | Done means | The first render after launch shows the final order; no visible rearrangement on a warm reopen (online or offline), absent real data changes from another device. |

## Leading hypothesis (Root, 2026-11-15 — confirm by measurement in W1)

`web/src/lib/stores/tagPalette.ts` has **no local cache**. It boots as
`DEFAULT_TAG_PALETTE` and is only replaced by `hydrateFromServer()`, which
`web/src/routes/+layout.svelte:283` runs *after* auth, sound settings, UI
preferences and members have all hydrated from the server. Groups are ordered
by palette rank (`groupTasksByTag(..., $tagPalette)` in
`web/src/routes/list/[id]/+page.svelte:39-40`, and My Day's group-by), and
labels come from the palette too — so any space with a customized palette
(Dean's is) renders default-palette order first, then regroups when the server
answer lands. Offline, it never regroups: the wrong (default) order sticks.

Other candidates the builder must rule in or out with the same measurement:
- `uiPreferences.listSort` — `hydrateFromLocal()` then `hydrateFromServer()`
  (`+layout.svelte:205,272`); jumps only if local and server disagree.
- My Day sort/group from localStorage (`web/src/routes/+page.svelte:164-188`)
  — `$:` blocks run before first render, so expected clean; verify.
- Tasks: `tasks.hydrateFromDb()` then sync-pull `mergeRemote` — a legitimate
  change from another device may reorder; out of scope (R2), but the
  measurement should show whether a no-op pull reorders anything.

## Fix shape (if the hypothesis holds)

- `tagPalette.hydrateFromLocal()`: read a per-space localStorage key
  (`tasksync:tag-palette:<space_id>`, same scoping idea as
  `preferences.ts:197` `storageKey()`), wire-format validated (array of
  `{section: string, entries: {emoji: string, label: string}[]}`; invalid →
  `console.warn` + keep default, never throw). Called inside
  `hydrateScopedStores()` (`+layout.svelte:198`) alongside
  `uiPreferences.hydrateFromLocal()`, so it lands before the first data render.
- Persist on every successful `hydrateFromServer()` and `save()`. A server
  `null` ("never customized") persists as "default" (store the default or
  remove the key — pick one, test it). A server `[]` is a real state and is
  cached as `[]`.
- `clear()` (logout / space switch) resets the store; the next space must
  not see the previous space's cached palette (the key is per space, but
  verify the space-switch path at `+layout.svelte:256,364`).
- No server, wire, or schema change.

## Acceptance (outcome — each measurable)

1. **Measured before the fix.** A Playwright spec
   (`web/tests/e2e/regroup-on-load.spec.ts`, `@smoke`) with a mocked
   customized palette whose rank order differs from the default, plus tagged
   tasks: reload, and record the `tag-group-title` order at first render and
   after sync settles. **On main it shows a change** (proves the bug); with
   the fix the two orders are identical. Same for a list view and My Day with
   group-by on. The builder records the before/after numbers in Evidence.
2. **Offline.** With the network blocked after one online load, reload →
   groups render in the customized order (bound by the offline describe,
   chromium).
3. **Unit.** `tagPalette.test.ts`: local hydrate round-trip; invalid JSON /
   wrong shape → default + `console.warn`; `null` vs `[]` handling; `save()`
   persists; per-space isolation.
4. **No regressions.** Full web suite + `@smoke` green; existing
   `tag-palette-settings.spec.ts` green unchanged.

## Out of scope

- Reordering caused by real remote changes (another device edits a tag).
- Moving the palette into IDB, or any server change.
- The iOS portrait lock (separate plan, `2026-11-15-ios-portrait-lock.md`).

## Step 0 — builder setup

- **Read order:** `AGENTS.md` → this plan → `tagPalette.ts`,
  `tagPalette.test.ts`, `preferences.ts` (`storageKey`, `hydrateFromLocal` as
  the pattern), `+layout.svelte` (`hydrateScopedStores` and the server
  hydration chain), `lib/tags/grouping.ts`, both `+page.svelte` files.
- **Environment:** worktree on `fix/regroup-on-load` (plan committed there).
  Web commands from `web/`. **Tech debt 056:** the parallel builder could
  share Playwright's port 4173 — run e2e with a distinct preview port, or
  confirm the bundle under test is yours before trusting a result.
- **Git rules:** stage by name, no force-push, no `--no-verify`, never
  self-merge. PR body leads with `## Summary`.
- **Stop rules — ask Dean (AskUserQuestion):**
  1. W1's measurement does **not** show the palette as the cause (or shows a
     second cause outside this plan's candidates) — report the numbers and
     ask before fixing anything else.
  2. The fix appears to need a server / wire / IDB schema change.

## Waves

- **W1 — Measure.** Write the spec from Acceptance 1, run it on the
  unchanged branch, record which candidate(s) move the order. Commit the spec
  (marked `test.fail` or skipped-with-reason only if it must, so the commit
  passes hooks — note which in Evidence).
- **W2 — Fix.** Local palette cache per "Fix shape"; unit tests (Acc. 3);
  spec now passes (Acc. 1–2). Commit.
- **W3 — Docs.** One line in `docs/FRONTEND.md` (or `ARCHITECTURE.md`,
  whichever documents boot hydration order). Commit.
- **Gate → PR.** `/gate` (adversary + qa). Brief names: cold first launch
  with no cache, space switch / logout leaking a palette, invalid cached
  JSON, `null` vs `[]`, and the offline path. Open the PR; Dean merges.

## Evidence (builder fills)

- W1 (before numbers): `regroup-on-load.spec.ts` on unchanged code (chromium,
  private preview port 4391): an init-script MutationObserver records every
  distinct `tag-group-title` order from the first byte of the reload.
  - List view: 2 orders — `["⭐ Starred","🥛 Dairy","Untagged"]` →
    `["🥛 Dairy run","⭐ Top","Untagged"]` (FAIL, bug proven).
  - My Day, group-by on: same 2-order timeline (FAIL).
  - Offline reload (My Day): default order sticks — `toHaveText(CUSTOM_ORDER)`
    fails after the offline reload (FAIL).
  - Control (server palette `null`, same no-op `/sync/pull` returning identical
    lists+tasks, server prefs = defaults, My Day sort from localStorage): 1
    order, never rearranges (PASS) → the no-op pull, `listSort` and My Day
    sort are ruled out; the palette is the only mover. Stop rule 1 not hit.
  - Committed un-skipped, no `test.fail`: pre-commit runs no e2e and W1 is
    not pushed before W2.
  - Finding: `context.setOffline()` does not stop `page.route()` mocks, so the
    offline arm also aborts its mocks (it passed vacuously on main otherwise).
  - Out of scope, logged to tech-debt: an offline reload of a deep
    `/list/<id>` URL renders an empty body (app never boots) on unchanged
    code; the offline arm uses `/` (PWA start URL).
- W2 (after numbers): `tagPalette.hydrateFromLocal()` (sync, per-space key
  `tasksync:tag-palette:<space_id>`, wire-validated) runs first in
  `hydrateScopedStores()`; `hydrateFromServer()`/`save()` persist; server
  `null` → key removed, `[]` → `"[]"`. A fetch is discarded if the space
  changed or `save()`/`clear()` ran meanwhile.
  - `regroup-on-load.spec.ts`, chromium, `--repeat-each=5`: 20/20 pass, 0 flaky.
    List and My Day timelines: 1 order each run,
    `["🥛 Dairy run","⭐ Top","Untagged"]` from first render (was 2). Control:
    1 order. Offline (My Day): customized order (was default).
  - Stress `--workers=4 --repeat-each=20`: 80/80 pass.
  - Mutation (comment out the `hydrateFromLocal()` call in `+layout.svelte`):
    list, My Day and offline FAIL with the W1 2-order timeline; control
    passes. Restored.
  - Spec setup fix: 2/60 first-load setups (before the reload under test)
    showed no tasks after a 200 pull — suspected pre-existing startup race,
    logged as tech-debt 058; setup now drives one focus-path pull
    (`settleFirstLoad`).
  - Unit: `tagPalette.test.ts` 8 → 28 (round-trip, 7 invalid-cache shapes,
    null vs `[]`, save persists, failed save/fetch keep cache, per-space
    isolation, signed-out, fetch-after-switch, fetch-after-logout,
    stale fetch vs save, throwing localStorage).
- W3:
- Gate:
- PR:
