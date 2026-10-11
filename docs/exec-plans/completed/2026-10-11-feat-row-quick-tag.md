---
plan: feat-row-quick-tag
harness: v2 · lean
branch: feat/row-quick-tag
anchor: outcome
status: Shipped (PR #169)
next: none (shipped; owner merges PR #169)
gate: APPROVED r1 @de850c8
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

## Step 0 — builder setup (read before any code)

- **Read order:** `AGENTS.md` → this plan → `web/src/lib/components/TaskRow.svelte`,
  `EmojiPicker.svelte`, `SelectableTask.svelte`, `BulkSelectToolbar.svelte`
  (the Clear-tag pattern), `TaskRow.test.ts`, `web/tests/e2e/bulk-tag.spec.ts`.
- **Environment:** work in the main checkout on `feat/row-quick-tag` (already
  exists, plan committed). Web commands from `web/`: `npm run lint`,
  `npm run check`, `npm run test`, `npm run test:e2e:smoke`, and
  `npx playwright test tests/e2e/<file>` for a single spec.
- **Git rules:** stage files by name (no `git add .`/`-A`), no force-push, no
  `--no-verify`, never self-merge. PR body must lead with `## Summary`
  (12+ char sentence) or the `pr-body` CI check fails.
- **Stop rules — stop and ask the owner (AskUserQuestion):**
  1. The change appears to need anything in "Out of scope" (a store method,
     field, wire change, or drawer/toolbar change).
  2. An existing test in Acceptance #3 needs editing to pass (they must stay
     green *unchanged*).
  3. The chip can't fit the `.sub` strip at 360px width without wrapping the ⋯
     chip onto a lone line in the common case (My Day chip + ⋯) — show a
     screenshot and ask.

## Seams (verified 2026-10-11)

- `TaskRow.svelte` — `showActions` (⋯ shelf state), `closeActions()`,
  `canEditTask`, the `.emoji-indicator` span (`data-testid="task-emoji-indicator"`)
  in `.title`, the `.sub` strip ending in `button.chip.ghost.actions-chip`,
  the `.quick` shelf. Add a row-local `showTagPicker` boolean; opening it sets
  `showActions = false` and vice versa.
- `EmojiPicker.svelte` — `value` prop + `change` event (`string | undefined`;
  re-picking the active tag dispatches `undefined`). Reuse as-is.
- `tasks.setEmoji(id, emoji?)` — `web/src/lib/stores/tasks.ts:731`. The only
  store call this change makes.
- `BulkSelectToolbar.svelte` `bulk-tag-clear` — model for the row's
  `task-tag-clear` button (`Clear tag`), shown only when `task.emoji` is set.
- `SelectableTask.svelte` `onRowClick` — ignores targets inside `button`; no
  change needed, only a test.
- `TaskRow.test.ts` — the `$lib/stores/tasks` mock lacks `setEmoji`; add it.
  The `$lib/stores/auth` mock is a fixed owner; the contributor case needs a
  mutable store (e.g. `vi.hoisted` + `writable`) or a separate test file —
  don't break the existing cases.
- New testids: `task-tag-chip`, `task-tag-picker` (wrapper around the row's
  `EmojiPicker`), `task-tag-clear`, `task-tag-menu` (the ⋯ shelf entry).

## Waves

1. **W1 — row picker + chip + emoji button.** `TaskRow.svelte`: faint chip
   (ghost chip, ~0.55 opacity, `aria-label="Add tag"`), emoji indicator as a
   `<button>` when `canEditTask` (span otherwise; keep the testid), inline
   picker panel spanning the full row (`grid-column: 1 / -1`, like `.quick`)
   with `Clear tag` when tagged; close-before-`setEmoji`. Unit tests in
   `TaskRow.test.ts` for Acceptance #1 (chip / emoji / pick / clear) and #2
   (contributor). Run `npm run test -- TaskRow`, `npm run check`, `npm run lint`.
2. **W2 — ⋯ shelf Tag entry + mutual exclusion.** `Tag` button
   (`task-tag-menu`) in `.quick` under `canEditTask`; opening the picker closes
   the shelf and opening the shelf closes the picker. Unit tests for both.
3. **W3 — E2E.** `web/tests/e2e/row-quick-tag.spec.ts`: the `@smoke` flow in
   Acceptance #1 (use the `bulk-tag.spec.ts` helpers' shape and
   `/list/goal-management`), plus Acceptance #3's selection-mode case (enter
   `list-select-mode`, click the chip, pick, assert
   `bulk-selected-count` still `0 selected`). Then the full web suite and
   `npm run test:e2e:smoke`; run the four existing specs named in #3.

## Gate

`/gate` — `core-logic` row → **adversary + qa** (fresh seats, brief = branch,
base `d7f51b7`, this plan, attack surfaces: permission gating of the new
controls, selection-mode tap routing, picker state across a group-by regroup,
the testid contract with `bulk-tag.spec.ts`). Fix CRITICAL/WARNING findings,
re-confirm with the same instances. Verdicts recorded here, bound to the sha.

## Release

1. Push the branch (owner beta-tests on device: CI republishes `:beta` from any
   non-main branch). Open the PR (feature → `main`), body led by `## Summary`.
2. Owner validates on a real device in beta.
3. `/release`: verify against Acceptance, set `status: Shipped (PR #<n>)`,
   move this plan to `docs/exec-plans/completed/`, `grep -q '^status: Shipped'`
   the moved file, commit (staged by name), run `.harness/lib/check-markers.sh`,
   push — one PR carries code + close-out.
4. **Merge is the owner's call** — ask; never self-merge.

## Evidence (builder fills)

- W1 tests: TaskRow.test.ts 10/10 after W1 (7 existing unchanged + chip/pick, tagged/clear, contributor); lint + check clean
- W2 tests: TaskRow.test.ts 12/12 (+ shelf Tag entry closes shelf, shelf closes picker)
- W3 E2E (+ the four existing specs): row-quick-tag, bulk-tag, task-delete-undo, offline, add-task-details-resilience on chromium: 12 passed (28.5s)
- Full suites (vitest count, smoke count, CI run link): vitest 29 files / 455 passed; `npm run test:e2e:smoke` 35 passed (1.1m); CI link: https://github.com/dtammam/tasksync/pull/169/checks
- Gate verdicts: adversary + qa APPROVED r1 @de850c8, no CRITICAL/WARNING. Notes: untested chip-closes-shelf direction, untested close-before-setEmoji ordering (sync store, no live bug), no regroup test, ⋯ chip lacks aria-expanded (pre-existing)
- Device checks owed by the owner:
  1. Untagged row: faint 🏷 sits just before ⋯; two taps (chip, swatch) tag it.
  2. Tagged row: tap the emoji, picker opens with the tag highlighted; Clear tag works, also for a tag not in the palette.
  3. ⋯ then Tag opens the picker and closes the shelf; opening either closes the other.
  4. 360px width with My Day chip + 🏷 + ⋯: no lone ⋯ line (plan stop rule 3), no horizontal overflow.
  5. Selection mode: chip/emoji taps edit the tag without toggling selection.
  6. Emoji group-by view: tagging moves the row cleanly, no stuck picker.
  7. Contributor (non-owner) sees no chip/Tag and a plain emoji.

## Progress log
- 2026-10-11 — intake: owner chose the faint row chip (over menu-only /
  emoji-only variants). Plan drafted.
- 2026-10-11 — owner approved acceptance as written; builder launched (Standard).

## Gate verdicts

Gate: APPROVED r1 @de850c8 — qa
Gate: APPROVED r1 @de850c8 — adversary
- 2026-10-11 — owner validated on device (beta): "It's perfect." Closed out in PR #169; merge is the owner's call.
