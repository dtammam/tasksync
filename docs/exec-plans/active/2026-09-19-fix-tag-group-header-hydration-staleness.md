---
plan: fix-tag-group-header-hydration-staleness
harness: v2 · lean
anchor: outcome
status: Draft
gate: pending
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
