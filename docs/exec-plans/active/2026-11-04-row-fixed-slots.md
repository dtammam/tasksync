---
plan: row-fixed-slots
harness: v2 · lean
branch: feat/row-fixed-slots
anchor: outcome
status: In progress
next: builder — W3 (position spec + screenshots)
gate: pending
builder: smart
---

# Task row: fixed slots under the title

## Request

The line under a task's title (list name, date, My Day / Catch Up, 🏷, ⋯) is a
wrapping flex row of conditional chips, so every missing chip slides the rest
left, and the variable-length list name shifts everything further. Owner:
"I don't want the date or the catch-up button positions or three dots to ever
deviate between tasks" — so the eye and thumb can process rows efficiently.

## Rulings (owner, 2026-11-04)

| # | Question | Ruling |
|---|----------|--------|
| R1 | Layout | **Actions pinned right, fixed slots.** List name on the left takes the leftover width and truncates with `…`. Right side, in order: **date slot · action slot · tag slot · ⋯**, each a fixed width, anchored to the row's right edge. An empty slot keeps its width (renders nothing / invisible placeholder). |
| R2 | Date format | **Keep ISO** (`2026-11-06`). |
| R3 | Recurring "Next:" | **Replace the word "Next:" with a ↻ glyph**: `↻ 2026-11-11`. Same slot as the due date. (Ruled after the width estimate: ISO + "Next:" left the list name ~25px on a 390px phone.) |
| R4 | Punted chip | **Drop the "Punted" / "Punted today" chips.** The ▶ indicator before the title is the only punt marker. |
| R5 | My Day vs Catch Up | **One shared action slot.** Catch Up wins if both apply; My Day stays reachable another way (see findings). |
| R6 | Phone fit (asked under stop rule 1, 2026-11-04) | Measured: at 360px the My Day `.sub` is 232px; date + Catch Up + 🏷 + ⋯ need 246px (Sora) / 261px (widest font) — list name 0px, ⋯ overflowed. **Slim + icon actions** at `max-width: 900px`: plain-text date (no pill), zero side padding on action/tag/⋯, 4px gaps, Catch Up → `⤼` and My Day → `☀︎` (word kept as `aria-label`/`title`). Desktop keeps word labels. |

## Outcome Dean will see

On every row, in every view, the date's right edge, the Catch Up / My Day
button, 🏷 and ⋯ sit at exactly the same x-position. Long list names end in
`…` instead of pushing anything. Nothing under the title ever wraps to a
second line.

## Blind-spot findings

- **Current markup:** `web/src/lib/components/TaskRow.svelte:253-300`, the
  `.sub` flex strip (`flex-wrap: wrap`, CSS at `.sub {…}`). Rebuild it as a
  grid: `grid-template-columns: minmax(0,1fr) var(--slot-date) var(--slot-action) var(--slot-tag) var(--slot-more)`,
  no wrap. Widths as CSS custom properties on `.task` so compact mode
  (`.task.compact`, `@media (max-width: 900px)`) can tune them in one place.
  Size each slot to its widest possible content at that breakpoint (date:
  `↻ 2026-12-31`; action: `Catch Up`), measured, not guessed.
- **Slot contents:**
  - *left / list name* — `taskList?.name` only when `inMyDayView` (as today);
    in list views the cell is empty but still occupies `1fr`, so the right
    slots are identical across views. `overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0`.
    Put the full name in `title=` for hover.
  - *date* — recurring + `nextRecurrenceDate` → `↻ <iso>`; else non-recurring
    with `due_date` → `<iso>`; else empty. Note today `Next:` only renders
    `inMyDayView`; keep that condition (only the text changes). Right-align
    the text inside the slot so the date's right edge is fixed.
  - *action* — `showCatchUp` → Catch Up; else the My Day condition
    (`!inMyDayView && !task.my_day && task.due_date !== todayKey`) → My Day;
    else empty. If both are true, the hidden My Day stays reachable via the
    drawer's existing "Add to My Day" (`TaskDetailDrawer.svelte` ~line 210) —
    **no new ⋯ entry** (out of scope).
  - *tag* — 🏷 chip when `canEditTask && !task.emoji`; else empty (tagged
    tasks show their emoji by the title, per PR #169).
  - *⋯* — always.
- **Keep every testid** (`task-myday-btn`, `task-catchup`, `task-tag-chip`,
  `task-punt-indicator`) and their present/absent semantics: `myday.spec.ts`
  asserts `toHaveCount(0)` for both buttons in several cases (lines ~682-878).
  Empty slots must render **no** element with those testids.
- **Punted chips removal (R4):** delete the two `punted-chip` spans and their
  CSS. `showPuntedArrivalTag`/`showPuntedCompletedTag` still feed
  `showPuntIndicator` (▶) — keep those derivations. `myday.spec.ts:287`
  matches `/Punted/` on a *drawer* toggle, not the chip — verify, don't assume.
- **Touch targets.** Don't shrink chips below today's `min-height: 24px`
  (22px compact). Fixed widths must not clip "Catch Up" at 12px.
- **Expanded panels.** `.tag-panel` and `.quick` are `grid-column: 1 / -1` on
  the outer `.task` grid — unaffected, but verify they still span full width.
- **Narrowest width.** At 360px the list name may shrink to a few characters;
  that's accepted (R1/R3). It must never push or wrap the right slots — the
  `1fr` column takes `minmax(0, 1fr)`.
- **Parallel plan:** `feat/retire-starred` also edits `TaskRow.svelte` (the ★
  indicator in `.title` and the Star shelf button — different hunks). It
  merges **first**; see Step 0.
- **Gate size.** `web/src/**` → `core-logic` full gate (adversary + qa). No
  data, wire or store change.

## Acceptance (outcome — each measurable)

1. **Fixed positions.** A Playwright spec `web/tests/e2e/row-fixed-slots.spec.ts`
   (tag `@smoke`) seeds rows that vary on every axis — short vs very long list
   name, dated / recurring / undated, Catch Up / My Day / neither,
   tagged / untagged — at viewports **360×740 and 1280×800**, in My Day and in
   a list view, and asserts for every row: the bounding-box `right` of ⋯, of
   the action slot, of the tag slot and of the date slot is identical across
   rows (±1px), and `.sub` height equals one line (no wrap).
2. **Content rules.** `TaskRow.test.ts` cases: recurring in My Day → date slot
   text `↻ <iso>` and no "Next:" anywhere; non-recurring dated → `<iso>`;
   Catch Up + My Day both applicable → only `task-catchup` renders; punted task
   → `task-punt-indicator` present and no text "Punted" in the row; long list
   name → element has `text-overflow: ellipsis` and `title` = full name.
3. **No regressions.** Existing `myday.spec.ts`, `row-quick-tag.spec.ts`,
   `bulk-tag.spec.ts` green **unchanged**; full web suite + `@smoke` green.
4. **Screenshots.** Builder attaches 360px and 1280px screenshots of My Day
   and a list view to the PR (and sends them to Dean).

## Out of scope

- Changing date format beyond R3 (no "Nov 6").
- New ⋯ shelf entries, swipe gestures, or moving actions to the title line.
- Star removal (separate plan `2026-11-04-retire-starred.md`).
- Any store / data change.

## Step 0 — builder setup (read before any code)

- **Read order:** `AGENTS.md` → this plan → `TaskRow.svelte` (whole file) →
  `TaskRow.test.ts` → `web/tests/e2e/myday.spec.ts` (the My Day / Catch Up
  cases) → `row-quick-tag.spec.ts` → `docs/FRONTEND.md`.
- **Environment:** worktree `.claude/worktrees/feat/row-fixed-slots` on
  branch `feat/row-fixed-slots` (plan committed there). Web commands from
  `web/`: `npm run lint`, `npm run check`, `npm run test`,
  `npm run test:e2e:smoke`, `npx playwright test tests/e2e/<file>`.
- **Merge order:** `feat/retire-starred` lands first. Before opening the PR
  (and before the gate's final sha), merge the updated `origin/main` into this
  branch and re-run the full suites. If `retire-starred` hasn't merged yet
  when you're ready, open the PR anyway and note the dependency; re-merge
  main when it lands. If the merge conflicts outside the ★ indicator / Star
  shelf button hunks, stop and ask.
- **Git rules:** stage files by name (no `git add .`/`-A`), no force-push, no
  `--no-verify`, never self-merge. PR body must lead with `## Summary`
  (12+ char sentence).
- **Stop rules — stop and ask the owner (AskUserQuestion):**
  1. At 360px, the fixed slots leave the list-name column under ~40px —
     send a screenshot and ask before shrinking anything.
  2. An existing test in Acceptance 3 needs editing to pass.
  3. The work appears to need anything listed in Out of scope.

## Waves

- **W1 — Grid + slots.** Rebuild `.sub` per R1, R3, R5; CSS custom-property
  widths, measured. Acceptance 2 unit tests. Commit.
- **W2 — Punted chips out (R4).** Remove chips + CSS; tests. Commit.
- **W3 — Position spec.** `row-fixed-slots.spec.ts` (Acceptance 1) at both
  viewports, both views. Screenshots. Commit.
- **W4 — Docs.** Update `docs/FRONTEND.md` with the row's slot contract (one
  short section). Commit.
- **Gate → PR.** Merge `origin/main` (see Step 0), `/gate`. Adversary brief
  names: positions under every slot combination at 360px, the empty-slot
  testid absence, compact mode, and the `title` tooltip. Open the PR with
  screenshots; Dean merges.

## Evidence (builder fills)

- W1: `.sub` is a 5-track grid; every cell has an explicit `grid-column`, so an absent chip leaves its fixed track empty (no placeholder elements, testids stay absent). Widths measured as max-content across all 23 UI fonts in Chromium: desktop date 100 (Sono `↻ 2026-12-31`), action 78 (Comfortaa `Catch Up`), tag/⋯ 30; phones (R6) date 88 (plain text, 86 measured), action 28 (icon), tag/⋯ 24, gap 4 → list name 52px in My Day at 360px (Missed-card rows ~28px, nested container). Unit: `TaskRow.test.ts` 21/21 (9 new); full vitest 489/489 (31 files); lint + check clean. Ellipsis is asserted as computed style in W3 (vitest doesn't process component CSS). Punted chips parked on grid row 2 until W2.
- W2: both `punted-chip` spans + CSS removed; `showPuntedArrivalTag`/`showPuntedCompletedTag` kept (feed ▶). 2 new unit cases (arrival + completed-context punt: ▶ present, no /Punted/ text). `TaskRow.test.ts` 23/23. `myday.spec.ts:287` `/Punted/` is the drawer's `detail-punt-toggle`, not the chip — verified by reading.
- W3:
- W4:
- Gate:
- PR:
