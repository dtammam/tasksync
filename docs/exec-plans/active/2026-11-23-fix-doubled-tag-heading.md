---
plan: fix-doubled-tag-heading
harness: v2 · lean
branch: fix/cold-start-tag-order
anchor: outcome
status: Building
next: Fixes verified locally; return to the existing Adversary/QA sessions for r2
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

Since #175, a tag whose emoji is genuinely absent from the active palette has
doubled its fallback on **every** render—not only during cold launch—because
the heading template combined the raw key with the same emoji as its fallback
label. For example, an unknown `🦄` rendered as `🦄 🦄`; an in-palette tag still
rendered correctly as `⭐ Starred`.

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

## Verification

### Unit, static analysis and helper coverage

- `cd web && npm run lint`: passed, no ESLint findings.
- `cd web && npm run check`: passed, 0 errors and 0 warnings.
- `cd web && npm run test`: 34 files and 544 tests passed.
- `src/lib/tags/grouping.test.ts`: 11 tests passed, including off-palette,
  in-palette and untagged headings through the shared helper.

### Deterministic rendered-heading tests

Both headings on each affected surface are pinned to their exact visible text:

- `web/tests/e2e/task-tags.spec.ts` → “a list’s pending and completed headings
  show an off-palette tag once” asserts both list headings match `'🦄'`.
- Same file → “My Day’s pending and completed headings show an off-palette tag
  once” enables grouping and asserts both My Day headings match `'🦄'`.
- With the fix in place, both new tests pass and also clear the full smoke suite.
- Temporarily reverting `web/src/routes/+page.svelte` to
  `{isUntaggedGroupKey(group.key) ? group.label : `${group.key} ${group.label}`}`
  made the new My Day test fail with rendered value `'🦄 🦄'`; the template was
  restored and all four targeted tests then passed again. This proves the tests
  detect the old expression rather than merely asserting against its outcome.
- Reverting one template catches only that template directly. Each of the other
  surfaces' new or corrected assertions would expose the same failure if their
  own templates reverted too; otherwise there is no way to prove every site in
  one run without changing them simultaneously.

### Playwright smoke

- First full run of `npm run test:e2e:smoke` remained at the known baseline
  (39 passed / 3 failed): `bulk-move.spec.ts:61`, `offline.spec.ts:448` and
  `row-quick-tag.spec.ts:24`.
- After tagging the two new heading tests `@smoke`, the suite ran 44 cases:
  **41 passed / 3 failed**, with exactly those same unrelated baseline failures.
  No previously passing case regressed.

### Rust

- `cargo fmt -- --check`: passed.
- `cargo clippy -- -D warnings`: exit 0 and compilation finished successfully.
  Pre-existing workspace manifest warnings about unused package fields remain;
  `-D warnings` applies lints emitted by rustc/clippy, not this separate Cargo
  warning category, and no new lint appeared.
- `cargo test`: 154 tests passed, 0 failed.

## Rulings (owner)

| # | Question | Ruling |
|---|----------|--------|
|   |          | none yet |
