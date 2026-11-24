---
plan: fix-doubled-tag-heading
harness: v2 · lean
branch: fix/cold-start-tag-order
anchor: outcome
status: Building
next: add the failing unit test for the off-palette heading, then implement one shared heading helper used by all four sites
gate: pending
---

# Fix: cold-launch tag heading shows the emoji twice

## Request

Dean: on a cold launch, a tag group whose emoji is **not** in the active tag
palette renders its section heading with the emoji doubled — e.g. `🦄 🦄`. An
in-palette tag must keep showing `emoji label` (e.g. `⭐ Starred`). Out of scope
for this plan: the list re-sorting on launch — that stays open and is left
untouched here.

## Symptom

On first paint (before/at palette hydration), any task carrying a tag emoji that
the current palette does not know gets a heading like `🦄 🦄` instead of `🦄`.

## Cause

`web/src/lib/tags/grouping.ts` (`groupTasksByTag`, around line 43) sets each
group's `label = labelInPalette(palette, key) ?? key`. For an off-palette emoji
`labelInPalette` returns `undefined`, so `label` falls back to the raw emoji
(`key === label`). All four section-heading templates then print
`${group.key} ${group.label}`, which repeats the emoji — once as the key and
once as the fallback label.

Sites: `web/src/routes/+page.svelte` (around lines 341 and 378) and
`web/src/routes/list/[id]/+page.svelte` (around lines 230 and 257).

## Acceptance

- A tag group whose emoji is not in the active palette renders its heading with
  that emoji exactly once (no `🦄 🦄`).
- A tag group whose emoji *is* in the palette still renders `emoji label`
  (e.g. `⭐ Starred`), unchanged.
- Untagged groups still render `Untagged`, and there is exactly one shared way
  to build the heading text, used by all four heading sites.

## Design

Add one pure helper to `web/src/lib/tags/grouping.ts` that takes a tag group and
returns its display title:
- the untagged group → `'Untagged'`;
- an off-palette / no-label group where the label equals the key (the key IS the
  emoji) → the label alone, so the emoji appears once;
- otherwise → the key, a space, then the label.

All four template sites call that single helper in place of the inline
"untagged ? label : key space label" expression, so there is one source of truth
for heading text.

## Rulings (owner)

| # | Question | Ruling |
|---|----------|--------|
|   |          | none yet |
