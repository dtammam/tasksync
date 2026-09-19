---
plan: fix-tag-group-header-hydration-staleness
harness: v2 · lean
anchor: outcome
status: Shipped PR#145
gate: APPROVED r1 @6b7610ac8cedacd1b52c5d609bcf2735189944df — adversary, qa
---

# Fix: tag group headers frozen at stale palette after hydration

## Request

Owner-reported via device screenshots on 2026-09-18: after renaming a tag
("Starred" -> "Directive") and adding new custom sections/tags ("Night" 🌙,
"Maintenance" 🔧) in the new Tags settings panel, the My Day / list group
headers sometimes show the OLD default label ("Starred" instead of
"Directive") and sometimes render a broken doubled-emoji header ("🌙 🌙"
instead of "🌙 Night") — inconsistent between screenshots taken moments
apart, and reported as persisting "regardless" of re-tagging individual
tasks afterward.

## Root cause (traced directly in code, not inferred)

`web/src/routes/+page.svelte` and `web/src/routes/list/[id]/+page.svelte`
compute `pendingGroups`/`completedGroups` in Svelte `$:` reactive blocks that
call `groupTasksByTag()`. That function (in `web/src/lib/tags/grouping.ts`)
resolved tag labels/order by calling `tagRank`/`tagLabel` from
`$lib/stores/tagPalette` -- a plain function call that internally reads
`get(tagPaletteStore)`. Svelte's compiler can only detect a `$:` block's
dependencies from what it can see *textually* in that block; it has no
visibility into what an imported function reads internally. Neither page
referenced `$tagPalette` anywhere, so Svelte had no way to know these groups
depended on it.

The live palette hydrates from the server asynchronously, deliberately
*after* first paint (`+layout.svelte`, non-blocking by design). So on cold
boot: `pendingGroups`/`completedGroups` compute once, against whatever the
store holds at that instant -- the seeded `DEFAULT_TAG_PALETTE`, since real
hydration hasn't resolved yet. When hydration completes moments later,
nothing invalidates the memoized `$:` block, so the group headers stay frozen
at the pre-hydration snapshot:
- `⭐`'s custom label "Directive" never appears; the built-in default's
  "Starred" does, because `tagLabel('⭐')` against the still-in-use default
  palette returns the built-in label.
- `🌙`, which doesn't exist in the default palette at all, resolves to
  `undefined`; the fallback `tagLabel(key) ?? key` renders the key itself as
  the label, and the template renders `${group.key} ${group.label}` --
  producing the doubled "🌙 🌙" glyph exactly as reported.

Any *unrelated* trigger that happens to reassign `sortedPending`/
`pendingTasks` (a task edit, a toggle flip) forces a fresh recompute against
whatever the palette holds *at that instant* -- explaining why the two
screenshots looked different despite being the same bug, and why re-tagging
individual tasks did not reliably fix it: the outcome depends on whether
hydration has already resolved by the time some *unrelated* reactive trigger
happens to fire, not on the re-tag action itself.

## Fix

`groupTasksByTag()` becomes a pure function of an explicit `palette`
argument (using the already-existing pure `rankInPalette`/`labelInPalette`
helpers in `palette.ts`) instead of reading a store internally. Both pages
now call `groupTasksByTag(tasks, $tagPalette)` -- a plain, visible argument
Svelte's compiler correctly tracks as a dependency, so the groups recompute
the moment the palette store updates, with no reload and no unrelated
trigger required.

(A `($tagPalette, groupTasksByTag(...))` comma-operator trick was tried
first as a smaller diff, but both eslint and svelte-check correctly reject
an unused comma-operand as dead code -- the palette-as-argument refactor is
the actual clean fix, not a workaround.)

## Acceptance

- [x] A new custom tag/section, once its palette save has round-tripped to
  the client, is reflected in list/My Day group headers without requiring a
  page reload or an unrelated task edit.
- [x] Regression test added (`task-tags.spec.ts`) that holds the `/tags` GET
  response open past first paint, confirms the header shows the broken
  pre-hydration state, then releases the response and confirms the header
  updates in place -- verified to fail against the pre-fix code (temporarily
  reverted and re-run) and pass against the fix.
- [x] `groupTasksByTag` unit-tested as a pure function of its `palette`
  argument: the same tagged item resolves a different label under a
  different palette, in the same process, with no store involved.
- [x] Full existing test suites (unit + E2E for tags/grouping) still pass.

## Gate

### Adversary — r1 @6b7610ac8cedacd1b52c5d609bcf2735189944df

Verified by measurement, not by trusting the plan narrative:

- **`grouping.ts` purity**: confirmed no hidden store read remains. The
  file's only import is `rankInPalette`/`labelInPalette`/`TagPaletteSection`
  from `$lib/tags/palette`, and `palette.ts` itself has zero imports from
  `$lib/stores/*` — genuinely a pure, palette-argument function with no
  transitive store dependency.
- **`$tagPalette` wiring**: both `+page.svelte` and `list/[id]/+page.svelte`
  import `{ tagPalette }` from `$lib/stores/tagPalette` and pass `$tagPalette`
  into `groupTasksByTag`. Traced `tagPalette` itself: `export const tagPalette
  = { subscribe: tagPaletteStore.subscribe, ... }` where `tagPaletteStore =
  writable(...)` — a real, live Svelte store subscription, not a dead
  reference.
- **Enumeration**: repo-wide grep for `groupTasksByTag` finds exactly the two
  page call sites (both updated) plus `grouping.test.ts` (updated) and
  `palette.ts`'s comment — no missed caller.
- **E2E regression test stability**: ran
  `task-tags.spec.ts -g "group headers update once a custom palette"` on
  chromium 4 times total (1 + 3 repeats) — passed every time, no flake
  observed.
- **Faithfulness of the regression test (independently reproduced, not
  trusted from the plan)**: reverted `grouping.ts`, `+page.svelte`, and
  `list/[id]/+page.svelte` to base sha (`git checkout 5363b62 -- <3 files>`),
  left the new test untouched, and reran it. It failed exactly at the final
  assertion (`tag-group-title` filtered on `'Night'` never becoming visible
  after the gated `/tags` response was released) — i.e., it correctly
  captured the pre-hydration broken state as a *pass* on the earlier
  assertion and only broke where the fix is supposed to land. Restored all
  three files to the fix commit afterward (`git checkout HEAD -- <3 files>`)
  and removed the `web/test-results` artifact directory the failing run
  produced.
- **Instruments**: `npx vitest run` — 28 files / 409 tests passed, 0
  failures (one benign expected `console.error` from an existing
  network-failure test, not a new failure). `npm run lint` — clean, no
  output/errors. `npm run check` (svelte-check) — "0 errors and 0 warnings".
  Confirmed via `git diff <base>..HEAD --name-only` that this diff touches
  only files under `web/` plus the plan doc itself — `server/` has a
  zero-line diff, so `cargo test`/`clippy`/`fmt` are provably unaffected by
  this change (not run, correctly not needed).
- **Second-bug angle (persistence layer)**: read `TagPaletteSettings.svelte`'s
  `save()` (sets the store directly from the PUT response, no reliance on a
  follow-up GET) and the server's `PUT /tags` handler
  (`server/src/routes/tags.rs`) — validates, writes `tag_palette_json` to the
  `space` row, and echoes the saved body back, which the client store adopts
  immediately. Grepped all `tagPalette.*` call sites in `web/src` and found
  only two `hydrateFromServer()` calls (cold boot, space switch) and one
  `clear()` (logout) — no periodic re-fetch or focus-triggered rehydration
  that could race with and clobber a save. Found no live second bug in the
  save/persistence path on this pass; this fix's mechanism (explicit
  `$tagPalette` argument) also directly explains the owner's "regardless of
  re-tagging" symptom per the plan's own causal chain, which holds up under
  inspection. This is not an exhaustive persistence-layer audit — flagging
  as a suspicion-not-a-finding only: worth a fresh look if the owner
  reports recurrence after this fix ships.
- Tree left byte-identical apart from this verdict addendum; the
  pre-existing unrelated modification to `.claude/agents/security-brief.md`
  present in git status at session start was left untouched (not part of
  this branch's diff against base).

No CRITICAL or WARNING findings.

Gate: APPROVED r1 @6b7610ac8cedacd1b52c5d609bcf2735189944df — adversary

### QA — r1 @6b7610ac8cedacd1b52c5d609bcf2735189944df

**Scope confirmation**: `git diff 5363b62..6b7610a --stat` touches only the
plan doc, `web/src/lib/tags/{grouping.ts,grouping.test.ts}`,
`web/src/routes/+page.svelte`, `web/src/routes/list/[id]/+page.svelte`, and
`web/tests/e2e/task-tags.spec.ts` — no `server/` file, no migration, no
auth/secrets/dependency file. Web-only refactor as claimed; no dedicated
security-brief seat needed, and I found no security surface in this diff
myself either (no new user input path, no new network boundary — the
`palette` argument is an already-server-validated, already-client-stored
value, just threaded differently into a pure function; Svelte auto-escapes
the rendered label/key text as before).

**Instruments run, verbatim**:
- `npm run lint` (web/): clean, no output.
- `npm run check` (web/): `svelte-check found 0 errors and 0 warnings`.
- `npx vitest run` (web/): `Test Files 28 passed (28)`, `Tests 409 passed
  (409)` — includes `grouping.test.ts` (8/8) and `tagPalette.test.ts` (8/8).
  Two expected `stderr` lines from a pre-existing, unrelated
  network-failure test in `sync.test.ts`, not a new failure.
- `server/`: confirmed zero-line diff via the stat above; `cargo
  test`/`clippy` correctly not run, not needed.
- `npx playwright test task-tags tag-palette-settings --project=chromium
  --workers=1 --retries=0`, run 7 times total: 6/7 clean (`6 passed`), one
  failure on my very first invocation of the session, specifically at the
  new test's final assertion (`tag-group-title` filtered on `'Night'` never
  became visible within the 10s expect-timeout after the gated `/tags`
  response was released). This was the first `npm run dev`/Playwright
  webServer boot of my session (no dev server was running beforehand per
  `ps aux`); the failure's `error-context.md` shows nothing semantically
  wrong (task, tag, and pre-hydration doubled-emoji state all rendered
  exactly as expected up to that point) — consistent with a slow first
  Vite/webServer boot rather than a logic defect. All 6 subsequent runs
  (including 4 back-to-back after that one) passed cleanly with no retries.
  This isn't literally tech-debt #050's documented pattern (that tracker
  entry is scoped to `offline.spec.ts`/`pull-to-refresh.spec.ts` on CI
  runners specifically, and states those "pass 100% locally"), so I'm not
  folding it into #050 as-is, but I'm also not treating a 1-in-7,
  first-boot-only miss with no reproducing signal on 6 immediate reruns as
  a real regression in this diff's logic — flagging as a disclosed,
  non-blocking observation. Recommend the owner note it if it recurs.

**Correctness — `grouping.ts` refactor is computation-preserving**: read
`palette.ts`'s `rankInPalette`/`labelInPalette` and `stores/tagPalette.ts`'s
old wrappers side by side. `tagRank(emoji) = rankInPalette(currentTagPalette(),
emoji)` and `tagLabel(emoji) = labelInPalette(currentTagPalette(), emoji)` —
identical pure logic, just called with an explicit `palette` argument
instead of an internal `get(store)` call. `grouping.ts`'s new signature
threads `$tagPalette` through unchanged call sites in both pages, so for any
given palette value the output is byte-identical to before; only *when* it
recomputes changed. Confirmed `tagRank`/`tagLabel` still exist in
`stores/tagPalette.ts` (kept for other callers, e.g. `EmojiPicker.svelte`
per the prior piece's plan) and are still directly tested in
`tagPalette.test.ts:91-100` even though `grouping.ts` no longer uses them.

**Store singleton wiring**: `+page.svelte` and `list/[id]/+page.svelte` both
`import { tagPalette } from '$lib/stores/tagPalette'` — the exact same
import path and export used by `TagPaletteSettings.svelte`'s save path
(`import { tagPalette, currentTagPalette } from '$lib/stores/tagPalette'`,
`await tagPalette.save(draft)` at line 152). No alternate alias or relative
path resolves to a second module instance anywhere in the tree
(`grep -rn "stores/tagPalette"` finds only this one file). An owner save
therefore reaches both pages' `$tagPalette` subscription in the same
running app, guaranteed by construction, not by convention.

**Comment accuracy**: `grouping.ts`'s new block (lines 16-22) accurately
describes Svelte's `$:` dependency tracking as purely syntactic/textual,
which matches the actual Svelte compiler behavior and is the real
mechanism of the original bug — not vague or wrong. One pre-existing
in-function comment (line 50, `"tagRank alone can't distinguish..."`) is
now a stale name reference: the code no longer calls `tagRank` anywhere in
this file (it calls `rankInPalette`). SUGGESTION, not blocking — the
function it refers to (the palette-rank lookup) is unambiguous from
context in the same 6-line block, and no reader would be misled about
behavior, only about the exact historical identifier. Neither page file
carries new commentary (only an import line and an added argument), so
there was nothing to check for staleness there.

**New unit test genuinely proves the fix**: `grouping.test.ts:61-74` ("takes
the palette as an argument...") groups the *same* item (`🌙`) under
`DEFAULT_TAG_PALETTE` (asserts fallback-to-key, `'🌙'`) and under a
`customPalette` containing only `🌙 -> 'Night'` (asserts `'Night'`) — a
function that ignored its second argument, or read a store instead, could
not pass both assertions in the same synchronous test with no store
mutation between them. Not a tautology.

**Piece 3 regression check**: reran `grouping.test.ts` specifically — all
8 tests pass, including the 7 pre-existing cases now passing
`DEFAULT_TAG_PALETTE` explicitly instead of relying on an implicit store
default. Diffed each assertion's expected values against the pre-fix
version in `git show 5363b62:web/src/lib/tags/grouping.test.ts` — identical
expectations, only the call signature changed. No behavior drift.

**E2E regression test faithfulness**: read `task-tags.spec.ts:57-112`. It
gates the real `GET /tags` response, asserts the broken pre-hydration state
first (doubled `🌙 🌙`-style header, `not.toContainText('Night')`), then
releases the gate and asserts the corrected header appears — this proves
the *update-in-place* behavior the plan claims, not just an eventual
correct render on next load. The Adversary's r1 note above independently
reverted the three fix files and confirmed this test fails exactly at that
final assertion pre-fix; I did not re-do that revert (no need to duplicate
identical verification), but I did independently re-confirm the test
passes reliably against the actual fix commit across 6 of 7 runs as
detailed above.

**Tree state**: `git status --porcelain` shows only this plan doc (this
appended section, below the Adversary's untouched) and the pre-existing,
unrelated `.claude/agents/security-brief.md` modification present in git
status at session start (per the conversation's initial `gitStatus`
context) — not part of this branch's diff against base, left untouched.
`web/test-results/` artifacts from my Playwright runs are gitignored and do
not appear in `git status`.

No CRITICAL findings. One non-blocking SUGGESTION (stale `tagRank` name in
a `grouping.ts` comment) and one disclosed, non-blocking flaky-run
observation (Playwright cold-boot miss, 1/7, non-reproducing) — neither
blocks close.

Gate: APPROVED r1 @6b7610ac8cedacd1b52c5d609bcf2735189944df — qa
