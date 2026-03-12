# Execution Plan: UI Polish Batch 1

**Date:** 2026-03-12
**Branch:** `feat/ui-polish-batch-1`
**Items:** #036, #037, #038, #039, #040

---

## Goal

Five focused fixes spanning UI polish, a small feature addition, a tooling gap, and a persistent bug:

- **#036** — Redesign list sort indicator in sidebar (confusing drag line)
- **#037** — Restyle / replace the list color picker (visually jarring)
- **#038** — Show scheduled date chip for non-recurring tasks in task rows
- **#039** — Create `/review` skill with a consistent standards entrypoint
- **#040** — Fix streak text rendering too far right on first task check after container rebuild

## Non-goals

- Rearchitecting sidebar state or list persistence
- Adding new color themes or custom color palettes
- Changing recurrence logic or due-date storage
- Replacing the review workflow beyond the skill file
- Touching sync, server, or offline behavior

## Constraints

- Performance budgets, offline-first, sync determinism, and server-side role enforcement remain non-negotiable
- `--no-verify` must never be used
- All quality gates must pass after each item
- Each item is committed independently

---

## Item assessment

### #036 — List sort indicator redesign
**Severity:** Med | **Risk:** Low | **Complexity:** Low

**Current state:**
- In `Sidebar.svelte`, lists are reordered with ↑/↓ buttons exposed in an edit/sort mode.
- The visual indicator between list items (the sort line) currently falls between the list name and the rest of the row properties (icon, color, order controls), making it hard to tell which list is being moved.

**Proposed approach:**
1. Audit the sort mode markup in `Sidebar.svelte` (the section rendering list rows with move controls).
2. Redesign: the drag/move indicator should visually wrap the entire list row (name + properties) as a single unit, not split inside it. Consider a full-row highlight or border on the selected item rather than an inter-field line.
3. Ensure the active/moving list row is clearly distinguished (e.g., elevated shadow or accent border around the whole row).
4. Run `npm run lint` and `npm run check`.

**Cross-domain dependencies:** `Sidebar.svelte` only.

---

### #037 — List color picker restyle
**Severity:** Low | **Risk:** Low | **Complexity:** Low

**Current state:**
- `Sidebar.svelte` uses `<input type="color">` (native HTML color picker) for both create-list and edit-list flows.
- Styled at 44 × 36 px with 3 px padding and 8 px border-radius, but the native picker chrome looks visually inconsistent with the rest of the UI.

**Proposed approach:**
1. Assess whether a small set of preset swatches (e.g., 8–12 named colors) would better fit the UX than a free-form picker.
2. If swatches: replace `<input type="color">` with a swatch grid component inline in the sidebar. Match existing list icon/color options already used by the app.
3. If restyling the native input is sufficient: apply `appearance: none` + custom overlay to make it consistent; test across Chromium/Firefox/WebKit.
4. Chosen approach must not break existing list color persistence (color is stored as a hex string).

**Decision needed before coding:**
- Swatch grid (finite palette) vs. restyled native picker (free color). Recommendation: **swatch grid** — bounded palette is easier to style and matches the app's aesthetic; free color is overkill for list labels.

**Cross-domain dependencies:** `Sidebar.svelte`; potentially a new small `ColorSwatch.svelte` component.

---

### #038 — Show scheduled date for non-recurring tasks
**Severity:** Low | **Risk:** Low | **Complexity:** Low

**Current state:**
- `TaskRow.svelte` shows a "Next: {date}" chip only when `inMyDayView && nextRecurrenceDate` — i.e., only for recurring tasks in the My Day view.
- Non-recurring tasks that have a scheduled due date show nothing in the chip area, even in My Day view where date context is most relevant.

**Proposed approach:**
1. In `TaskRow.svelte`, extend the chip logic: if a task has a `due_date` (or equivalent scheduled date field) and is not recurring, show a `"Date: {formattedDate}"` chip using the same `chip subtle` style.
2. Scope the display: show it whenever a due date exists (not just My Day), or limit to My Day view to match the existing recurrence chip scope — confirm with user before coding.
3. Ensure the date formatting matches the existing recurrence date format (same locale/relative display).
4. Add/update a unit test in `tasks.test.ts` or a new `taskRow.test.ts` if relevant logic moves to a helper.

**Decision needed before coding:**
- Show in all views or only My Day view? Recommendation: **all list views** — a scheduled date is always relevant context and aligns with how recurrence chips behave in My Day. If the user prefers My Day only, limit the `{#if}` condition accordingly.

**Cross-domain dependencies:** `TaskRow.svelte` only.

---

### #039 — Create `/review` skill
**Severity:** Med | **Risk:** Low | **Complexity:** Low

**Current state:**
- No `/review` skill exists in `~/.claude/commands/`.
- Code reviews currently have no consistent entrypoint or checklist, making it easy to miss standards checks (layer boundaries, no `@ts-nocheck`, IDB error handling, reactive bindings, etc.).

**Proposed approach:**
1. Create `~/.claude/commands/review.md` as a Claude Code skill.
2. The skill should:
   - Start from a consistent entrypoint: read `CLAUDE.md` → `docs/RELIABILITY.md` → `docs/FRONTEND.md` for standards context before reviewing any file.
   - Run through a structured checklist covering all non-negotiables from `CLAUDE.md` coding standards:
     - No `@ts-nocheck`
     - No fire-and-forget IDB writes
     - Reactive store bindings (`$store` not `get(store)` in templates)
     - `event.currentTarget` not `event.target`
     - No silent catch blocks
     - Wire format validation at boundaries
     - Store ownership (components don't write stores directly)
     - Layer boundaries (`components/` and `routes/` don't import from `data/`)
   - Summarize findings as: ✅ pass / ⚠️ advisory / ❌ must fix
3. Scope: works on the current selection, a named file, or a git diff (`git diff HEAD` or a PR diff).

**Cross-domain dependencies:** `~/.claude/commands/review.md` only — no repo files change.

---

### #040 — Fix streak text position after container rebuild
**Severity:** Med | **Risk:** Low | **Complexity:** Med

**Current state:**
- `StreakDisplay.svelte` positions the streak overlay using `frozenLeft` / `frozenMaxWidth` captured from the `<main>` element's bounding rect at display time.
- `captureContentCenter()` is called on mount and whenever `visible` transitions false → true.
- **Symptom:** After a container rebuild (e.g., hard reload, dev-server restart), the very first task check renders the streak text too far to the right. Subsequent checks are fine.
- This has been addressed multiple times without a durable fix — the root cause is that `captureContentCenter()` fires before the layout has fully settled on first render (the `<main>` bounding rect is measured before fonts/styles are applied, giving a stale width).

**Proposed approach:**
1. Audit the timing of `captureContentCenter()` in `StreakDisplay.svelte`: confirm it is called before the browser has painted the final layout on the first render (likely a race between `onMount` and CSS/font load).
2. Fix options:
   - (a) Defer `captureContentCenter()` with `requestAnimationFrame` (one frame after mount) to ensure layout is stable before measuring.
   - (b) Use a `ResizeObserver` on `<main>` to re-capture whenever the container dimensions change — this handles fonts loading late and window resizes.
   - **Recommendation: option (b)** — `ResizeObserver` eliminates the timing race entirely and also handles sidebar-toggle width changes.
3. On `onDestroy`, disconnect the observer.
4. Verify: hard-reload the app, complete the first task, confirm streak text is centered. Repeat after sidebar toggle.

**Cross-domain dependencies:** `StreakDisplay.svelte` only.

---

## Sequencing (lowest risk first)

| Order | Item | Rationale |
|-------|------|-----------|
| 1 | **#039** Review skill | Zero repo risk; pure tooling; no test gate needed |
| 2 | **#038** Date chip | Single component; additive change; easy to test |
| 3 | **#037** Color picker | Single component; visual-only; no data model change |
| 4 | **#036** Sort indicator | Visual-only; slightly more markup surgery |
| 5 | **#040** Streak position | Requires timing/layout reasoning; most care needed |

## Alternatives considered

- **#037: keep native `<input type="color">`** — easier, but browser chrome varies too much across platforms; swatch grid is more predictable.
- **#038: drawer-only display** — task detail drawer is a natural place for date context, but the chip in `TaskRow` is already the established pattern for at-a-glance scheduling info.
- **#040: `setTimeout(fn, 100)`** — brittle; `ResizeObserver` is more principled and handles layout shifts from any cause.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Swatch grid breaks existing hex color storage | Ensure swatches map to valid hex strings; same storage path |
| Date chip is noisy in dense list views | Gate display on whether date is set; keep chip style `subtle` |
| `ResizeObserver` callback fires too often on scroll | Observe only the `<main>` element (stable); debounce if needed |
| Review skill becomes stale as standards evolve | Link to `CLAUDE.md` as the live source; skill reads it each run |

## Acceptance criteria

- **#036:** Sort mode in sidebar renders a clear, full-row visual indicator around the list being moved; no split-line artifact between name and properties.
- **#037:** Color selection for lists uses a swatch grid (or comparably polished control); no raw `<input type="color">` visible; existing list colors preserved.
- **#038:** A "Date: {date}" chip appears on task rows for non-recurring tasks that have a scheduled date; chip uses the same `chip subtle` style as the recurrence chip.
- **#039:** `/review` command is available; running it reads standards docs first and produces a structured pass/warn/fail report.
- **#040:** After container rebuild (hard reload), the first task check renders the streak text centered correctly; no rightward drift on any subsequent check or sidebar toggle.

## Test plan

- #036: Visual inspection in browser; `npm run lint` + `npm run check`.
- #037: Visual inspection; confirm color saved and loaded correctly in list row.
- #038: Unit test asserting chip renders when `due_date` set and task is non-recurring; `npm run test`.
- #039: Run `/review` on a known-good file; verify checklist output; no test gate.
- #040: Hard-reload smoke check; `npm run test` (streak store tests); optionally add a Playwright `@smoke` assertion for centering.

## Rollout / migration plan

No data migration needed. All changes are UI-only or tooling-only.

## Progress log

- 2026-03-12: Plan written. Awaiting implementation.
- 2026-03-12: All 5 items implemented in sequence (#039 → #038 → #037 → #036 → #040). Each committed independently. All lint/check/test gates pass. Also fixed stray unused `auth_members` import in server routes and added CONTRIBUTING.md with git prune config.

## Decision log

- 2026-03-12: Sequencing chosen: #039 → #038 → #037 → #036 → #040 (risk ascending). Open decisions: (a) #037 swatch vs. native picker — recommendation is swatch; (b) #038 scope — recommendation is all views. Awaiting confirmation before code.
- 2026-03-12: Decisions confirmed: #037 uses swatch grid (12-color palette); #038 shows date chip in all list views.
