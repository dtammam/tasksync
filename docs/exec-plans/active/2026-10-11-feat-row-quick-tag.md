---
plan: feat-row-quick-tag
harness: v2 · lean
branch: feat/row-quick-tag
anchor: outcome
status: Draft
next: owner confirms acceptance → builder (Standard / Sonnet) implements on feat/row-quick-tag
gate: pending
builder: standard
---

# Quick tag from the task row

## Request

Tagging a task today takes ⋯ → Details → Tag → pick (four taps). Owner wants it
faster. **Ruling (owner, 2026-10-11):** a faint 🏷 chip on the task row itself,
next to ⋯, opens the tag picker inline in the row: **two taps** (chip → tag).

Scope of the ruling:
- **Untagged task:** a faint 🏷 ghost chip in the row's `.sub` chip strip,
  immediately before the ⋯ chip. Tap → inline `EmojiPicker` expands in the row
  (same placement pattern as the ⋯ quick shelf).
- **Tagged task:** the existing emoji indicator before the title becomes the
  tap target (a `<button>`), opening the same picker with the current tag
  highlighted. The 🏷 chip is not shown when a tag is set (the emoji is the
  affordance).
- **Pick** applies via `tasks.setEmoji(id, emoji)` and closes the picker.
  Tapping the highlighted tag clears it (existing `EmojiPicker` behavior).
- **⋯ menu:** gains a **Tag** entry that opens the same inline picker (for
  discoverability; closes the shelf).

## Blind-spot findings

- **No data-model or wire change.** `tasks.setEmoji` (`web/src/lib/stores/tasks.ts:731`)
  already exists and is what the drawer's save path effectively writes; the
  field round-trips through IDB + sync since Piece 3 (PR #141). This is a pure
  UI change in `TaskRow.svelte` (+ tests).
- **Permissions.** `TaskRow` already derives `canEditTask` (contributor && not
  owner → false). The chip, the ⋯ Tag entry, and the emoji-as-button must all
  be gated on it; for non-editors the emoji stays a plain non-interactive span.
  Server remains authoritative (unchanged).
- **Selection mode.** `SelectableTask.onRowClick` ignores clicks whose target is
  inside `button`/`a`/etc. Because the chip and the emoji indicator are
  `<button>`s, tapping them in selection mode edits the tag and does **not**
  toggle selection. Must be tested, not assumed.
- **Testid compatibility.** `data-testid="task-emoji-indicator"` is asserted by
  `web/tests/e2e/bulk-tag.spec.ts` (text + count 0 when untagged). Keep that
  testid on the indicator element (button or span) and keep it absent when
  untagged — so the 🏷 chip gets its **own** testid (`task-tag-chip`).
- **Tag not in the palette.** A task can carry an emoji that is not in the
  current palette (list `default_emoji`, or a palette entry since removed in
  Settings). `EmojiPicker` then highlights nothing, and the only clear gesture
  (tap the highlighted swatch) is unavailable. The row picker therefore shows a
  **"Clear tag"** button whenever the task has a tag — mirrors
  `BulkSelectToolbar`'s `bulk-tag-clear`.
- **Group-by regrouping.** In emoji group-by view, setting a tag moves the row
  to another section, remounting it. Picker state is row-local and closes on
  pick, so nothing dangles — but the builder must close the picker *before*
  (or as) `setEmoji` is called, not after.
- **Mutual exclusion.** Picker and ⋯ shelf should not be open at once on the
  same row: opening one closes the other.
- **Chip clutter on narrow phones.** The `.sub` strip may already hold My Day /
  Catch Up / date chips. The chip must be faint (ghost, reduced opacity) and no
  larger than the ⋯ chip, and the strip already `flex-wrap`s, so it can't
  overflow horizontally.
- **Gate size.** `web/src/**` matches `.harness/scrutiny.toml` row
  `core-logic` → **full gate: adversary + qa**. No force rows match (no
  schema/auth/deps/fetch/client paths). Not `deletes-data`.
- **No overlapping active plan** (only the roadmap umbrella is active; clone
  slice is unrelated).

## Anchor

Default: `outcome` · recommended: `outcome`. Both match — a UI affordance on an
existing, already-synced field; the owner will eyeball it on device via beta.

## Acceptance (outcome — each measurable)

1. **Two-tap tag from the row.** For an editable, untagged task, the row
   renders `[data-testid="task-tag-chip"]` (faint, in `.sub`, directly before
   `button.actions-chip`); clicking it renders the `EmojiPicker` inside that
   row; clicking a swatch calls `tasks.setEmoji(task.id, <emoji>)` and the
   picker is gone. For a tagged task, `task-emoji-indicator` is a `<button>`
   that opens the same picker with that emoji `aria-checked="true"`, the chip
   is absent, and a `Clear tag` control calls `tasks.setEmoji(task.id, undefined)`.
   The ⋯ shelf has a `Tag` button that opens the picker and closes the shelf.
   Bound by `TaskRow.test.ts` cases for each, plus an E2E
   `web/tests/e2e/row-quick-tag.spec.ts` tagged `@smoke`: add task → click
   chip → pick a palette emoji → row's `task-emoji-indicator` shows it → click
   it → Clear tag → indicator count 0 → survives reload.
2. **Non-editors can't reach it.** When `canEditTask` is false (contributor,
   not owner): no `task-tag-chip`, no `Tag` in the ⋯ shelf, and
   `task-emoji-indicator` (when tagged) is not a button / has no click handler
   that opens a picker. Bound by a `TaskRow.test.ts` case with a contributor
   auth user.
3. **Selection mode unaffected.** With selection mode on, clicking the chip or
   the emoji indicator opens the picker and does **not** change
   `selectedIds`. Bound by a test (unit on `SelectableTask` or E2E). Existing
   suites stay green unchanged: `bulk-tag.spec.ts`, `task-delete-undo.spec.ts`,
   `offline.spec.ts`, `add-task-details-resilience.spec.ts`, and
   `TaskRow.test.ts`'s existing "closes after each action" cases.

## Out of scope

- No new store method, field, wire verb, or migration.
- No long-press / swipe gestures.
- No change to the drawer's tag control or the bulk toolbar.
- No "recently used" strip (possible later).

## Progress log
- 2026-10-11 — intake: owner chose the faint row chip (over menu-only /
  emoji-only variants). Plan drafted; awaiting acceptance confirmation.
