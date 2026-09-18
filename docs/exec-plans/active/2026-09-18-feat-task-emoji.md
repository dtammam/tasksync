---
plan: feat-task-emoji
harness: v2 · lean
anchor: spec
status: Building
gate: APPROVED r2 @c816a220fbd3bd99d7fb50417a3672e7d11e170d — adversary, qa, security-brief
---

# Feat — optional per-task emoji ("tag")

Roadmap: `docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md`
("Piece 3"). This doc is that piece's own plan, per the v2 flow. Order was
reprioritized 2026-09-17 — this piece now goes first.

## Request (restated)

Add a first-class, optional per-task "tag" (internally: a single emoji
character) that can be set from a curated picker, groups a list's view into
sections, and survives sync, IDB, and backup. Motivating use case: grocery
lists (multiple stores, imported via text/markdown) currently rely on
manually typing an emoji into the task title to fake section grouping —
works, but breaks down the moment items arrive from someone else's text and
aren't manually re-tagged, and pollutes the title text itself.

## Why `spec`, not the project default `outcome`

Default: `outcome`. This piece touches the client store, IDB (implicitly,
via a new `Task`/`List` field), the sync wire format, and a server migration
simultaneously — exactly the case `AGENTS.md`'s attack-surface note warns
about ("a partial change corrupts sync"). The decision register below is the
contract, approved before code exists.

## Decision register

Ordered by blast radius — data model and sync semantics first, UI content
last.

**D1 — Field shape.** `Task.emoji?: string`, absent by default.
*Rationale:* every optional string on `Task` today is `field?: string`
(`url?`, `due?`, `notes?`, `assignee_user_id?` — `shared/types/task.ts`),
never `?: string | null`. No reason to break that convention.

**D2 — Validation & length.** Client clips to the first grapheme cluster via
`Intl.Segmenter` (UTF-16-unit fallback for old browsers); server performs no
content validation.
*Rationale:* direct precedent in `List.icon` (`Sidebar.svelte:149-160`,
`normalizeListIcon`) — clips to 2 grapheme clusters client-side, zero
server-side validation (`server/src/routes/lists.rs:26-27`). This field
clips to 1, since it's a single category symbol, not an icon+badge.
Rejecting "not a real emoji" server-side is a false economy — valid emoji
sequences (flags, ZWJ combos, skin-tone modifiers) are hard to regex
correctly, and the codebase's standing convention is "client trims for UX,
server trusts it."

**D3 — Server column & migration.** New migration:
`alter table task add column emoji text;` — nullable, no default, no check
constraint.
*Rationale:* matches `0012_task_priority_and_punt_state.sql`
(`punted_from_due_date text`, `punted_on_date text`) and
`0005_user_avatar.sql` (`avatar_icon text`) exactly. The project does use
`check(...)` for real enums (`status`), but never for icon-like free text —
no reason to start here.

**D4 — Clear semantics.** The `update_task_meta` SQL statement
(`server/src/routes/tasks.rs:442`) assigns `emoji` directly (`emoji = ?N`),
not via `coalesce(?N, emoji)`. The client always includes the task's
*current* `emoji` value (or absent/`null` to clear) on every
`update_task` push, not only when the tag itself changes.
*Rationale:* traced the actual SQL. Fields using `coalesce` (`notes`,
`assignee_user_id`) can be set but never explicitly cleared through this
endpoint — omitting them just preserves the old value. Fields using direct
assignment (`punted_from_due_date`, `punted_on_date`) support clearing, and
only work correctly because the client is already disciplined about
resending their current value on every call (confirmed at
`sync.ts:104-105,128-129`). Since "given, changed, or cleared" is an
explicit acceptance requirement, `coalesce` is the wrong pattern here even
though `notes` looks superficially similar — mirror the punt-fields'
pattern exactly rather than invent a third (e.g. a tri-state wrapper) that
doesn't exist anywhere else in this codebase.

**D5 — IDB / client migration.** None. No IDB version bump.
*Rationale:* `repo.ts:71` does a whole-object `tx.store.put(task)`, no field
allowlist. Git history shows `priority`, `notes`, `assignee_user_id`, and
the punt-date fields were all added to `Task` with zero IDB version bumps —
bumps in this codebase are reserved for new object stores/indexes
(confirmed: the only two version changes in history, v1 create and v1→v2 for
the `settings` store, both added a *store*, never a scalar field).

**D6 — Existing data.** No automatic migration of titles that already start
with a manually-typed emoji.
*Rationale:* confirmed no code anywhere parses a leading emoji from task
titles today (`markdown/import.ts` only strips `@myday`/`#list-id` tokens).
Auto-rewriting existing titles is data-losing if the heuristic is ever
wrong, for a benefit that doesn't justify the risk. Clean slate, nothing to
conflict with.

**D7 — Backups.** Add `emoji?: string` to `SpaceBackupTask`
(`shared/types/backup.ts`) explicitly.
*Rationale:* confirmed there is no CSV/Markdown/ICS export anywhere in this
codebase — the only whole-task serialization boundary is the admin JSON
space-backup, and `SpaceBackupTask` is a hand-maintained mirror of the
`task` table, not derived from `Task`/`TaskRow` — so this field will not
appear in a backup automatically and needs one explicit line.

**D8 — Picker & palette.** A curated, sectioned picker (not a free emoji
picker). Starter palette, defined in one small, trivially-editable config
(not scattered across components) — **section order below is also D9's
fixed group order**, so Time/priority is deliberately listed first (it's
the direct replacement for the owner's `0.`-prefix trick, which needs to
sort to the top):
- Time / priority — ⭐ starred, ⏰ time-sensitive, 🎯 goal-focused
- Grocery aisles — 🥦 produce, 🥛 dairy, 🥩 meat, 🍞 bakery, 🧊 frozen,
  🧺 household/other
- Household & chores — 🧹 cleaning, 🔧 maintenance, 🐾 pets
- Money — 💰 financial
- Health — 💊 health/medical
- Family — 👨‍👩‍👧 family
- Recurring — 🔁

*Rationale:* curated over free-form: fast, consistent, offline, no font
dependency, matches the "easy to populate and discern" purpose stated for
this field (it is a label, not a text field). Sectioned rather than a flat
list, since it needs to stay legible across a wide range of list types
(grocery, chores, money, health, family). Content is a first draft, editable
freely later — a config-file change, not an architecture change.

**D9 — List view & My Day grouping.**
- A list view (`web/src/routes/list/[id]/+page.svelte`) automatically
  groups its tasks into tag-headed sections once any task in it has a tag;
  the existing sort (manual/alphabetical/etc.) is preserved *within* each
  section.
- Section order is **fixed**, matching the palette's own defined order
  (D8) — no user-customizable/draggable group order in this piece (see
  Deferred, below).
- Untagged tasks appear in their own section, at the **bottom** — so a list
  with no tags in use looks identical to today.
- My Day (`web/src/routes/+page.svelte`) gets the same grouping behavior,
  but gated behind an **explicit, off-by-default toggle** — My Day is
  ~85-90% of daily usage and must stay frictionless; grouping there is an
  optional lens, not a default change to the primary flow.

**D10 — Per-list default tag.** `List.default_emoji?: string` (mirrors
`List.icon`/`List.color` exactly — optional, unvalidated, nullable text
column). Applied at task-creation time (manual add-task input **and**
markdown import — both already go through `makeLocalTask`,
`tasks.ts:194,246`) when the target list has a default set and the new task
doesn't already specify its own tag. Per-task tag can still be changed or
cleared afterward via the normal edit flow (D4).
*Rationale:* replaces an earlier, narrower idea (parsing a leading emoji out
of freshly-imported markdown text). Rejected in favor of this: the import
case turned out to be a very small slice of real usage once the existing
duplicate-review/reactivation behavior in import is accounted for (most
re-imported items match and reactivate an already-tagged existing task
rather than creating a fresh untagged one), and a per-list default covers
the actual need more simply, more generally (works for manual add too, not
just import), and reuses the same picker component being built for D8 — no
new UI surface, just a new field on the existing list-settings surface
where `icon`/`color` already live.

**D11 — Naming.** Internal/code identifier: `emoji` (`Task.emoji`,
`List.default_emoji`). User-facing label, everywhere shown in the UI:
**"Tag"**.
*Rationale:* the code name should describe what the data structurally is —
exactly one emoji character, not a general string — so a future reader
isn't misled into assuming multi-value or free-text support that isn't
built. The UI word should describe what a user thinks they're doing —
tagging/categorizing a task — which is a separate, freely-changeable
concern (this codebase already separates the two elsewhere, e.g. `status`
is stored as `'pending' | 'done' | 'cancelled'` without the UI necessarily
printing those literal words). Renaming the *code* identifier would only be
warranted if the underlying shape changes (e.g. a future move to multiple
free-text tags) — that's a deliberate future decision, not a shortcut now.

## Deferred (recorded, not lost)

- **User-reorderable group order.** Would need new stored, synced ordering
  state (per-list or per-space) — a real scope increase and its own
  decision register (where is order stored? synced how? conflict rules?).
  Not this piece.
- **Auto-set a recurring task's tag from `recur_rule`.** Considered and
  explicitly rejected by the owner: recurring tasks vary too much in kind
  for one auto-tag to make sense.
- **Import-time leading-emoji text parsing.** Considered, then rejected in
  favor of D10 (per-list default) — see D10's rationale.

## Acceptance

- A task's tag can be set, changed, or cleared from the curated picker
  (D8); the field is absent by default, round-trips through IDB and sync
  unchanged (D1, D5), and old clients ignore it without error.
- Clearing actually works end-to-end (D4) — bound by a server test
  mirroring the existing punt-date clear behavior, plus a client-side test
  that an update omitting no other fields still clears a previously-set
  tag.
- A list view groups into tag-headed sections once any task carries a tag,
  preserving existing in-section sort, untagged tasks at the bottom, fixed
  section order matching the palette (D9). My Day exposes the same grouping
  behind an explicit toggle, default off.
- A list's default tag (D10) applies to new tasks (manual add and markdown
  import) created in that list when the task doesn't specify its own, and
  can still be overridden or cleared per-task afterward.
- The tag survives an admin space-backup download and restore (D7).
- Tests: server test for the direct-assignment clear semantics (D4); client
  store tests for tag round-trip through `replaceWithRemote`/IDB and for
  the default-tag-on-create behavior (D10); a component/E2E test for list
  grouping (section order, untagged-at-bottom) and for the My Day toggle
  being off by default.

## Build plan

- **Step 1:** `Task.emoji?: string` on the shared type (D1); no IDB changes
  needed (D5).
- **Step 2:** server migration `alter table task add column emoji text;`
  (D3); update the select/insert/update SQL in `tasks.rs` to read/write it,
  using direct assignment (not `coalesce`) per D4; a server test mirroring
  the existing punt-date clear-semantics coverage.
- **Step 3:** sync wire — include `emoji` in `SyncTask`/`TaskRow` and in the
  create/update push bodies; client always resends the task's current
  `emoji` on every `update_task` push (D4), matching the punt-field call
  sites in `sync.ts`.
- **Step 4:** `SpaceBackupTask` gains `emoji?: string` (D7).
- **Step 5:** curated picker component + the palette config (D8), built
  once and reused for both per-task and per-list-default pickers (D10).
- **Step 6:** task detail UI — set/change/clear a tag via the picker,
  wired through the store (D1, D4).
- **Step 7:** list view grouping — tag-headed sections, fixed order
  matching the palette, existing in-section sort preserved, untagged
  section at the bottom (D9).
- **Step 8:** My Day — same grouping, behind an explicit toggle, default
  off (D9).
- **Step 9:** `List.default_emoji?: string` (D10) — server migration,
  list-settings UI (reusing Step 5's picker), and apply-on-create logic at
  both `makeLocalTask` call sites (manual add, markdown import).
- **Step 10:** tests across all of the above, per Acceptance.

## Progress log

- 2026-09-18 — Decision register worked through conversationally with the
  owner across several rounds (not rubber-stamped — several items changed
  shape during discussion: D4's clear-semantics required tracing actual SQL
  before either of us understood the risk; D10 replaced an initial
  import-parsing idea after the owner reasoned through the existing
  dedup/reactivation behavior in import; D11's naming split was worked out
  explicitly). Register above reflects the final, confirmed state.
- 2026-09-18 — Owner approved the written doc as committed at `e93e4c9`.
  Design and build plan Approved, bound to that sha. Proceeding to Build
  (Step 1).
- 2026-09-18 — Steps 1-4 complete: `Task.emoji?: string` (also removed a
  dead, unused `tags: string[]` field found on `Task` during Step 1 — a
  deviation flagged to and approved by the owner, since it wasn't in the
  original register); server migration `0018_task_and_list_emoji.sql`
  (bundles `task.emoji` and `list.default_emoji` for D10); `TaskRow`,
  `CreateTask`, `UpdateTaskMeta`, and every SQL query that returns a task
  row updated across `tasks.rs`, `auth.rs` (space-backup export/import,
  `BackupTaskRow`), and `mod.rs` (test call sites); `update_task_meta`'s
  SQL uses direct assignment for `emoji` (not `coalesce`), matching D4;
  sync wire types and push bodies updated in `sync.ts`/`shared/types/sync.ts`;
  `hasChangesSinceCreate` (`tasks.ts`) gained the missing `emoji` comparison
  needed for the local-edit-vs-stale-ack race D4 depends on.
  Environment note: `cc` (linker) was missing from this sandbox entirely —
  installed `gcc` via `sudo apt-get install gcc` to actually build/test the
  server; this had been masked all session because no prior push touched
  Rust source.
  Tests added: server `admin_can_set_change_and_clear_task_emoji_via_task_meta_update`
  (set/change/clear via the real endpoint); client
  `keeps the emoji tag stable when the server ack echoes back the same value`
  and `preserves a local emoji edit made after push but before the ack
  lands, over a stale remote echo` (the latter specifically exercises the
  `hasChangesSinceCreate` fix). All gates green: `cargo fmt --check`,
  `cargo clippy -D warnings`, `cargo test` (94 passed), `npm run lint`,
  `npm run check`, `npm run test` (382 passed).
- 2026-09-18 — Steps 5-10 complete: curated sectioned picker
  (`EmojiPicker.svelte` + `tags/palette.ts`, mirrors `ColorSwatchPicker`'s
  shape; clicking the active tag again clears it) wired into
  `TaskDetailDrawer` (toggle-reveals-inline-picker, matching the drawer's
  existing custom-picker convention) and `TaskRow` (small indicator next to
  the star). List view and My Day both group into tag-headed sections via a
  shared `tags/grouping.ts` utility (extracted rather than duplicated once
  both pages needed the identical algorithm) — fixed palette order, untagged
  last, existing sort preserved within each section; a list with no tags in
  use renders identically to before. My Day's grouping sits behind an
  explicit toggle, persisted the same way My Day's existing sort already is
  (plain localStorage — matches this page's own established pattern rather
  than expanding the synced `uiPreferences` surface for a one-off toggle).
  `List.default_emoji` added end-to-end (type, migration, server CRUD,
  backup, Sidebar settings UI) mirroring `List.icon`/`color` exactly,
  including their coalesce (can't-clear-via-update) semantics — applied at
  task-creation time (manual add and markdown import) via a lookup in
  `createLocalWithOptions`/`importBatch`.
  Considered and dropped: import-time leading-emoji text parsing (the
  original motivating idea) — the owner walked it back after accounting for
  the import path's existing duplicate-reactivation behavior, which already
  covers most of the real-world case; `List.default_emoji` replaces it with
  a simpler, more general mechanism.
  Tests added: `tags/grouping.test.ts` (5 tests: single-group fallback,
  palette-order over insertion-order, untagged-last, in-group order
  preserved, unknown-emoji fallback ordering); `tasks.test.ts` (2 tests:
  default tag applied on manual create vs. explicit override; default tag
  applied only to freshly-created import rows, never to reactivated ones);
  server `admin_can_set_and_change_list_default_emoji`; a new E2E spec
  `task-tags.spec.ts` (2 tests: real-browser section ordering/content on the
  list page; My Day toggle off-by-default and grouping-on-enable).
  All gates green: `cargo fmt --check`, `cargo clippy -D warnings`,
  `cargo test` (95 passed), `npm run lint`, `npm run check`, `npm run test`
  (389 passed), full chromium Playwright suite incl. the two new specs
  (60 passed, zero regressions).
  All 10 build-plan steps done. Next: Phase 4 gate — this diff includes a
  migration (`0018_task_and_list_emoji.sql`), so `scrutiny.toml`'s
  `data-loss` row forces the full gate (adversary + qa + security-brief)
  regardless of the additive-only nature of the change.
- 2026-09-18 — Fix round after r1 (adversary: CHANGES; qa, security-brief:
  APPROVED with non-blocking notes). Five fixes:
  1. **Adversary CHANGES #1** — `tagRank`'s fallback tied every unrecognized
     emoji to the same rank, so multiple different off-palette tags sorted
     by array-iteration order, not a fixed order (contradicting D9). Fixed:
     unrecognized emoji now get their own single rank bucket (after every
     known tag, before untagged), and `groupTasksByTag` breaks ties between
     multiple unrecognized emoji on the emoji string itself — deterministic
     regardless of input order. New tests in `grouping.test.ts` assert the
     same three-tag set produces the same group order forward and reversed.
  2. **Adversary CHANGES #2** — clearing a list's default tag via the
     existing icon/color "send empty string" idiom persists literal `''`
     server-side (not null), which then leaked onto new tasks as
     `emoji: ''` — violating D1's absent-by-default contract and landing in
     its own broken, unlabeled grouping bucket instead of "Untagged". Fixed
     at both application sites in `tasks.ts` (`|| undefined` instead of
     trusting the stored value directly). New test in `tasks.test.ts`
     covers both the manual-create and import paths.
  3. **Adversary CHANGES #3** — `shared/types/backup.ts`'s
     `SpaceBackupTask`/`SpaceBackupList` never actually got `emoji`/
     `default_emoji` added, despite D7/Step 4 and the prior progress-log
     entry claiming this was done (server-side `BackupTaskRow`/
     `BackupListRow` in `auth.rs` *were* done correctly — only the
     client-side TS type was missed). Fixed: both fields added.
  4. **QA WARNING** — `data-testid="completed-section"` sat inside the
     per-tag-group loop on both the list and My Day pages, so it duplicates
     once completed tasks span multiple tags — a latent trap for future
     test authors using the established single-element idiom. Moved to the
     outer `<section>` wrapper on both pages (one element, always).
  5. **QA SUGGESTION** — D8's prose palette listing didn't match
     `palette.ts`'s actual order (Time/priority was written last in the doc
     but shipped first in code, deliberately, to match the `0.`-prefix
     replacement use case). Fixed the doc to match the code and say why.
  Re-ran the full gate suite after fixes: `cargo fmt --check`,
  `cargo clippy -D warnings`, `cargo test` (95 passed), `npm run lint`,
  `npm run check`, `npm run test` (392 passed), full chromium Playwright
  suite (60 passed). Re-engaging all three r1 seat instances for delta
  re-confirmation at the new sha.

## Gate — security-brief (r1)

Note: this seat's agent instance was not provisioned with Write/Edit tools
(a tooling gap in its definition — the role description says it writes its
own verdict, but its configured toolset in this harness is Read/Grep/Glob
only), so the Architect is appending this section verbatim on its behalf
rather than the seat writing it directly. Content below is the seat's own
review, unedited.

Findings: none CRITICAL/HIGH/MEDIUM/LOW. All named attack surfaces traced
and verified clean:
- **Freeform, unvalidated `emoji`/`default_emoji` content** — bound with no
  server-side length/content check, identical in kind to the existing
  `title`/`notes`/`icon`/`color` fields today. No new route-specific body
  limit exists; axum's default 2 MB body-limit layer is the only cap, and it
  already governs every existing string field. Not a new exposure class.
- **SQL injection** — every new/changed query in `tasks.rs`, `lists.rs`, and
  `auth.rs` (backup export/import) uses sqlx bind placeholders exclusively;
  no string interpolation of user input into SQL anywhere in this diff.
- **Role/auth boundary** — `emoji` in `update_task_meta` is bound after all
  Contributor-role checks and is not specially stripped/blocked for
  contributors, matching `title`/`notes`/`url` treatment (no new privilege).
  `default_emoji` in `lists.rs` is gated by the same `Role::Admin` check as
  `icon`/`color` on both create and update.
- **Backup export/import** — `auth_export_backup`/`auth_restore_backup`
  retain their pre-existing admin-only checks untouched; the diff only adds
  fields to the row structs and bind lists, no new failure mode.
- **Client-side XSS** — zero `{@html}` usage anywhere in `web/src`; every new
  render site (`TaskRow.svelte`, `TaskDetailDrawer.svelte`, the list/My Day
  group titles via `tags/grouping.ts`) interpolates `emoji`/tag text as plain
  Svelte text expressions, which auto-escape.

`emoji`/`default_emoji` correctly extend the existing freeform-text-field
precedent in this codebase rather than introducing a new exposure class.

Gate: APPROVED r1 @b7520cddbab676b67fabc296558392435a73192e — security-brief

### r2 (delta re-confirmation)

Note: same tool-gap as r1 — this instance was spawned before the
Edit-tool fix to its own agent definition, so the Architect is again
appending its verdict on its behalf; content below is the seat's own
review, unedited.

Delta re-review of the fix commit (tagRank/grouping tie-break determinism,
empty-string default_emoji normalization, shared/types/backup.ts type
completion, plus two qa test-id/doc cleanups): all changes confined to
client-side grouping/store logic and a type-only declaration file. No
change to server/src/routes/{tasks,lists,auth}.rs beyond r1; role/auth
gates, SQL bind-parameter usage, and backup export/import access control
re-confirmed unchanged. No `{@html}` introduced; XSS surface unchanged. No
new CRITICAL/HIGH/MEDIUM/LOW findings within scope.

Gate: APPROVED r2 @c816a220fbd3bd99d7fb50417a3672e7d11e170d — security-brief

## Gate — qa (r1)

Scope: full gate (migration touches `scrutiny.toml`'s data-loss row).
Reviewed `git diff main...feat/task-emoji` at `b7520cddbab676b67fabc296558392435a73192e`
against the plan's Decision register (D1-D11) and Acceptance section.

**Verified test runs (real output, not claimed):**
- `npm run lint` — clean, no output/errors.
- `npm run check` — `svelte-check found 0 errors and 0 warnings`.
- `npm run test` — `Test Files 26 passed (26)` / `Tests 389 passed (389)`, matches
  the Progress log's claimed count.
- `cargo fmt --check` — clean (exit 0).
- `cargo clippy --all-targets -- -D warnings` — clean, no warnings.
- `cargo test` (server) — `test result: ok. 95 passed; 0 failed`, matches claim.
- `npx playwright test --project=chromium --workers=2` — `60 passed (1.0m)`,
  including both new `task-tags.spec.ts` cases; zero regressions in
  `myday.spec.ts` (which exercises the same shared pages this diff rewrites).

**Acceptance bullets — verified against code, not just presence:**
- Set/change/clear via curated picker, round-trips IDB/sync unchanged, old
  clients ignore it: confirmed. `D1` field shape matches convention;
  `EmojiPicker.svelte` only ever dispatches a `TAG_PALETTE` member or
  `undefined` (no free-text path) — D8's "curated, not free-form" holds.
- D4 clear semantics: confirmed by direct SQL read
  (`tasks.rs:446` — `emoji = ?11`, not `coalesce`), a real server test
  (`admin_can_set_change_and_clear_task_emoji_via_task_meta_update`) that
  exercises set → change → clear through the actual endpoint, and a client
  test for the stale-echo race that specifically depends on the
  `hasChangesSinceCreate` fix. `saveFromDetails`/`toPushChange` always
  include `task.emoji` on every push, matching the punt-field discipline
  D4 depends on.
- D9 grouping: `groupTasksByTag` verified — untagged-last, fixed order,
  in-group order preserved (stable map iteration + stable `Array.sort`),
  single unlabeled group when no tags in use (list looks unchanged). My Day
  gating behind an explicit, persisted, default-off toggle confirmed in
  `+page.svelte` (`groupByTagEnabled = false` initial, only flips true after
  reading `localStorage`).
- D10 list default tag: confirmed applied at both `createLocalWithOptions`
  and `importBatch` call sites, only when the task doesn't already specify
  a tag, and only to freshly-created rows (not reactivated ones) — bound by
  real tests, not tautological.
- D7 backup: `SpaceBackupTask`/`BackupTaskRow`/`BackupListRow` all gained
  `emoji`/`default_emoji`, and both the export select and the restore
  insert were updated together (checked column-for-column against the bind
  order — no off-by-one).
- D10 vs D4 precedent (focus area 5): confirmed `lists.rs`'s `update_list`
  uses `coalesce` for `default_emoji` exactly like `icon`/`color`
  (can't-clear-via-update by construction), and confirmed the client-side
  escape hatch is present and used: `Sidebar.svelte`'s
  `default_emoji: typeof emojiInput === 'string' ? emojiInput || '' : undefined`
  sends `''` on clear, same trick already used for `icon`/`color`. Not
  missing.
- Security-brief focus area 6: `update_task_meta_for_ctx`'s Contributor-role
  branch only special-cases `my_day`/`assignee_user_id`/`list_id`; `emoji`
  is untouched by any role restriction, correctly (it's a label, not a
  permission-sensitive field) — no weakening of existing role enforcement.
  `update_list` keeps its pre-existing `Role::Admin`-only gate, `default_emoji`
  included. `EmojiPicker.svelte` has no text input, only buttons over the
  closed `TAG_PALETTE` set — no injection surface, confirmed curated-only.

**Findings:**

1. **WARNING (safe to ship disclosed) — duplicate `data-testid="completed-section"` per tag group.**
   `web/src/routes/list/[id]/+page.svelte:232,241` and
   `web/src/routes/+page.svelte:376,385` put `data-testid="completed-section"`
   on the `.stack` div *inside* the per-group `{#each}` loop, not on a
   wrapping container. Once a list's (or, with the toggle on, My Day's)
   completed tasks span more than one tag, the page renders **multiple**
   elements sharing that one testid. Concrete scenario: a list with two
   completed tasks tagged 🥦 and ⭐ — a test written the same way the
   existing `myday.spec.ts` already writes selectors against this testid
   (`page.locator('[data-testid="completed-section"] [data-testid="task-row"]')`,
   lines 102/300/594/616/638) would, if a future author instead reaches for
   `page.getByTestId('completed-section')` directly for a single-element
   action, hit a Playwright strict-mode violation; a `.first()` fallback
   would silently see only one group's completed tasks. Verified this does
   **not** currently invalidate any passing test: grepped every use of
   `completed-section` — only `myday.spec.ts` (gated behind the
   off-by-default toggle, so still single-group today) and the two new
   `task-tags.spec.ts` cases (neither exercises tagged completed tasks).
   Real, but latent — safe to ship disclosed; flag for a fast-follow (move
   the testid to a stable outer wrapper, or drop it from the per-group
   `.stack` and add a container-level one).

2. **SUGGESTION — D8 section order silently reordered from the approved decision register.**
   `web/src/lib/tags/palette.ts:15-59` ships `Time / priority` as the
   *first* section, then `Grocery aisles`, `Household & chores`, `Money`,
   `Health`, `Family`, `Recurring`. The plan's own D8 register (this doc,
   lines 108-115) lists the order as `Grocery aisles → Household & chores →
   Money → Health → Family → Time / priority → Recurring` —
   `Time / priority` last, not first. Since `TAG_ORDER`/`tagRank` derive
   section rank straight from `palette.ts`, the grouping code is internally
   consistent with itself (and the D9 acceptance bullet "fixed order
   matching the palette" is trivially satisfied), so this isn't a
   functional bug. But it's an undisclosed deviation from an explicitly
   "approved before code exists" register — contrast with the two *other*
   deviations in this same diff (dropping the dead `tags: string[]` field,
   replacing the import-parsing idea with D10), both of which were
   explicitly flagged to the owner and recorded in the Progress log. This
   one wasn't. Low impact (palette ordering is aesthetic), but for register
   fidelity either update D8's text to match what shipped, or reorder
   `palette.ts` to match D8 — currently the plan doc and the code disagree
   about a decision both claim to be settled.

No CRITICAL or blocking WARNING findings. Both items above are
disclosed-and-shippable per their own reasoning.

**Clean-tree check:** `git status`/`git diff` show only this doc edit (my
addition below the pre-existing security-brief section) plus that section
itself, which predates this review and was not touched. No other
untracked files present at review time.

Gate: APPROVED r1 @b7520cddbab676b67fabc296558392435a73192e — qa

## Gate — adversary (r1)

Verified by execution, not by reading the plan's own claims:

- `cargo test --manifest-path server/Cargo.toml`: **95 passed, 0 failed**
  (matches claim).
- `cd web && npm run test`: **389 passed, 0 failed** (matches claim).
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`,
  `npm run lint`, `npm run check`: all clean (matches claim).
- `npx playwright test tests/e2e/task-tags.spec.ts --project=chromium`:
  **2 passed** (matches claim; did not re-run the full 60-test suite).
- Migration `0018_task_and_list_emoji.sql`: two plain
  `alter table ... add column ... text` statements, nullable, no default, no
  constraint. Genuinely additive/non-destructive.
- Bind-order audit (surface 8): manually counted placeholders vs. `.bind()`
  calls for `create_task`, `update_task_meta` (tasks.rs), `create_list`,
  `update_list` (lists.rs), and the backup export/import task+list inserts
  (auth.rs). All correct, 1:1, no off-by-one.
- D4 clear-semantics (surface 1): confirmed `emoji = ?11` is a direct
  assignment in `update_task_meta`'s SQL (not `coalesce`), and
  `sync.ts`'s single `toPushChange` call site unconditionally includes
  `emoji: task.emoji` on every `create_task`/`update_task` push body — no
  other code path constructs these pushes. Traced the local-store side too:
  `setPriority`, `saveFromDetails`, etc. all spread `...t` before
  overwriting their own field, so an edit to priority/due-date/etc. does not
  touch `task.emoji` in memory, and it gets correctly resent. Clearing
  (`EmojiPicker` toggling the active swatch dispatches `undefined`, wired
  through `saveFromDetails` -> `emoji: details.emoji` direct assignment)
  round-trips to a real `null` clear via the mirrored server test
  (`admin_can_set_change_and_clear_task_emoji_via_task_meta_update`, calls
  the real handler in-process against a real pool). This claim holds.
- Race condition (surface 2): `hasChangesSinceCreate` is a flat OR across
  all comparable fields including the new `emoji` line; multi-field local
  edits between push and ack still correctly trip the check (any one
  differing field is sufficient), and the "changed" branch keeps the entire
  current local task object (not just `emoji`), so a same-tick edit to
  emoji *and* another field is preserved together, not just emoji alone.
  No gap found here.
- Dead `tags: string[]` removal (surface 3): whole-tree grep confirms zero
  remaining references to a `.tags` field anywhere in `web/`, `server/`, or
  `shared/`. Clean.
- D10 default-tag scoping (surface 4): `createLocalWithOptions` and
  `importBatch` only apply a list's `default_emoji` at the point a *new*
  `Task` object is constructed via `makeLocalTask`; the reactivation branch
  of `importBatch` builds its updated task via `{...existing, status:
  'pending', ...}` and never touches `emoji`, so a default set after
  existing tasks were created does not retroactively tag them. Confirmed by
  reading + the two accompanying tests.
- My Day toggle default (surface 6): fresh session with no localStorage key
  correctly resolves `groupByTagEnabled = (null === '1') = false`. No
  off-by-one.

**Finding 1 (WARNING) — group order is not actually fixed for
unknown/off-palette emoji; `tagRank`'s tie-breaking is undefined-behavior
by input order, not palette order, contrary to D9's stated guarantee.**
`palette.ts`'s `tagRank` maps *any* unrecognized emoji to the exact same
rank as the palette's last section ("Recurring", 🔁 = `TAG_ORDER.length -
1`). `groupTasksByTag`'s sort is a plain `.sort()` (stable) over a `Map`
built by first-appearance order in the input array, so when two or more
groups tie on rank, their relative order is decided by which one appeared
first in the underlying task list — not the palette, not alphabetical, not
anything the user controls. Repro (ran against the actual
`grouping.ts`/`palette.ts` source, not a reimplementation of the claim):
tasks tagged 🛸 (unknown), 🦄 (unknown), and 🔁 (real, defined, last
palette entry) all tie at the same rank. Feeding them in one array order
produces section order `[🛸, 🦄, 🔁]`; reversing the input array order
produces `[🔁, 🦄, 🛸]` — i.e. the "Recurring" section, a real first-class
palette entry, silently jumps from last to first purely because of
incoming task order, whenever an off-palette/legacy emoji is also present.
This is reachable without any hypothetical future palette edit: today's
`TAG_PALETTE` is explicitly documented (D8) as "a first draft, editable
freely later," and this diff's own `EmojiPicker`/`palette.ts` file header
comment for `tagRank` explicitly anticipates the case ("unknown tag: sort
with the last known group"). The single test covering this
(`grouping.test.ts`, "sorts an unrecognized emoji with the last known
palette group") only ever exercises *one* unknown emoji at a time, so the
interleaving-with-`🔁`/interleaving-between-two-unknowns case that D9
promises ("Section order is fixed") is untested and, as shown, false. Not
a data-loss bug and not CRITICAL — no task is lost or mislabeled data-wise,
only its group placement is nondeterministic — but it directly contradicts
an explicit acceptance-criteria guarantee ("fixed section order matching
the palette") the moment the palette is edited (an explicitly anticipated,
near-term event per D8), so I'm not waiving it as pre-existing/unrelated.

**Finding 2 (WARNING) — clearing a list's default tag via the Sidebar
admin UI sets `Task.emoji` to `''` (empty string) on subsequently created
tasks, not `undefined`, breaking D1's "absent by default" convention and
producing a broken, unlabeled group in list/My Day grouping.**
`renameList` in `Sidebar.svelte` reuses the exact same clear-via-empty-
string idiom as `icon`/`color` (`default_emoji: emojiInput || ''`), which
round-trips through `update_list`'s `coalesce(?4, default_emoji)` — since
`''` is non-null, `coalesce` accepts it and stores `''` in the `list`
table, not `NULL`. That in itself matches the pre-existing icon/color
precedent (not new). What's new is that, unlike `icon`/`color`, this value
gets *copied onto newly created tasks*: `createLocalWithOptions`'s
`defaultEmoji` becomes `''` (client-side `?? undefined` only nullish-
coalesces, and `''` is not nullish), and `opts?.emoji ?? defaultEmoji`
returns `''` when the caller didn't specify a tag (`undefined ?? '' ===
''`). Reproduced live against the actual store code (temporary test,
removed after, tree left clean):
```
created.emoji = ""   // via tasks.createLocalWithOptions('New task', 'goal-management')
                      // after lists.setAll([...,{ ...l, default_emoji: '' }])
```
and against the actual `grouping.ts`, feeding one real-tagged task, one
`emoji: ''` task, and one `emoji: undefined` task: the `''` task does NOT
join the "Untagged" group (`'' ?? UNTAGGED_KEY === ''`, not
`UNTAGGED_KEY`, since `??` doesn't treat `''` as nullish) — it forms its
own group with `key: ''` and `label: ''`, i.e. a rendered section with a
blank header. Concrete scenario: an admin sets a grocery list's default
tag, uses it for a while, then clears it from Sidebar; every task
subsequently created in that list without an explicit tag (manual add or
markdown import with no matching existing item) silently gets `emoji: ''`
baked in and will render in a nameless, mis-sorted group the first time
that list has any other tagged task in it. This also isn't caught by
`hasChangesSinceCreate`'s `current.emoji !== sent.emoji` check narrowly,
but it does mean a `Task.emoji` value can be `''` in the wild, which no
test in this diff (`tasks.test.ts`'s two new D10 tests, `grouping.test.ts`)
exercises — both only ever use a real palette emoji or `undefined`, never
`''`. Fix is small (either `createLocalWithOptions`/`importBatch` should
treat falsy-but-defined `default_emoji` as "no default" — e.g. `defaultEmoji
|| undefined` — or `lists.ts`'s wire mapping should normalize `''` to
`undefined` the same way it already does for `null`/`undefined`), but as
shipped this is a real, reachable data-shape bug that violates D1 and
produces a visibly broken UI state, not just a suspicion.

**Finding 3 (WARNING) — D7/Step 4 is claimed done but was never
implemented; `shared/types/backup.ts` has zero changes on this branch.**
`git diff 039a87f..b7520cd -- shared/types/backup.ts` is empty. Both
`SpaceBackupTask` (missing `emoji?: string`, explicitly required by D7 and
by name in Step 4 of the Build plan) and `SpaceBackupList` (missing
`default_emoji?: string`, needed for the same reason D7 gives for the task
field — "hand-maintained mirror... not derived from `Task`/`List`") are
unchanged from before this feature existed. The Progress log's Steps 1-4
entry states this was done ("`SpaceBackupTask` gains `emoji?: string`
(D7)") — that sentence is false as written. Functionally this is *not* a
runtime data-loss bug today: `Sidebar.svelte`'s backup download/restore
flow treats the bundle as opaque JSON (`JSON.parse`/`JSON.stringify`, no
field-by-field reconstruction), so `emoji`/`default_emoji` do survive a
real download+reupload cycle in practice despite the stale TS types (the
server's actual wire payload, from `BackupTaskRow`/`BackupListRow`, does
include both fields — confirmed by reading `auth.rs`). I did not find a
live call site that would silently drop the field because of the missing
TS declaration. But this is exactly the risk class D7 itself was written
to guard against ("this field will not appear in a backup automatically
and needs one explicit line") — the fact that it currently doesn't bite is
incidental to the JSON-passthrough implementation of the restore UI, not
because anyone verified it. It's also flatly a false "done" claim in the
plan doc's own progress log for a step in the explicit Build plan and
Acceptance section ("The tag survives an admin space-backup download and
restore (D7)"), which the gate's honesty norms require flagging regardless
of current blast radius. Minimum fix: add the two missing optional fields
to `shared/types/backup.ts` and correct the progress-log claim.

No CRITICAL findings. All three are WARNING: none lose data or break the
build/tests today, but each contradicts an explicit, named acceptance
guarantee in this piece's own decision register (D9's fixed order, D1's
absent-by-default convention, D7's backup completeness), two of them are
demonstrated with a runnable repro against the real committed code (not
reasoned-about), and none of the three has any test in this diff that
would have caught it.

Gate: CHANGES r1 @b7520cddbab676b67fabc296558392435a73192e — adversary

### r2 — delta re-review @c816a220fbd3bd99d7fb50417a3672e7d11e170d

Re-verified each r1 finding against the actual fix commit (`git show
--stat c816a220` confirms it touches exactly: this plan doc,
`shared/types/backup.ts`, `web/src/lib/stores/tasks.ts` +
`tasks.test.ts`, `web/src/lib/tags/{grouping,palette}.ts` +
`grouping.test.ts`, and `web/src/routes/+page.svelte` +
`web/src/routes/list/[id]/+page.svelte` — no server-side files touched,
consistent with the claim that these were client-only bugs).

- **Finding 1 (group-order tie-break) — fixed as prescribed, re-broken by
  mutation-testing my own r1 repro against the fix.** `tagRank` now gives
  unrecognized emoji their own bucket (`TAG_ORDER.length`), strictly below
  every known palette rank and strictly above untagged
  (`TAG_ORDER.length + 1`), so "Recurring" (a real, last-defined palette
  entry) can no longer tie with an unknown emoji. `groupTasksByTag` breaks
  remaining ties among multiple unknown emoji on the raw emoji string
  (`a.key < b.key`), which is a pure, order-independent function of the
  tag itself. Re-ran my exact r1 repro (🛸/🦄/🔁, forward vs. reversed
  input array) against the fixed source: now produces identical
  `['🔁', '🛸', '🦄']` both directions (previously flipped to
  `['🔁',...]` vs. `[...,'🔁']`). Also checked a three-way tie among only
  unknown emoji (🛸/🦄/🐉, two different input orderings) — also now
  identical. `grouping.test.ts` gained a directly-on-point test
  (`'orders multiple unrecognized emoji deterministically, independent of
  input order'`) plus one confirming "Recurring" ordering ahead of an
  unknown emoji. **Resolved.**
- **Finding 2 (`default_emoji: ''` leak) — fixed as prescribed, re-broken
  by mutation-testing my own r1 repro against the fix.** Both
  `createLocalWithOptions` and `importBatch` now read
  `list.default_emoji || undefined` before using it as a task default (the
  comments correctly explain why: `''` is a real, coalesce-persisted
  server value from the icon/color-style clear idiom, not a valid tag).
  Re-ran my exact r1 repro (list with `default_emoji: ''`, create a task
  with no explicit tag) against the fixed source, both entry points: both
  now produce `emoji: undefined`, not `emoji: ''`. `tasks.test.ts` gained
  a directly-on-point test for both paths. **Resolved.**
- **Finding 3 (stale `shared/types/backup.ts`) — fixed exactly as
  prescribed.** `git diff 039a87f..c816a220 -- shared/types/backup.ts`
  now shows `default_emoji?: string` added to `SpaceBackupList` and
  `emoji?: string` added to `SpaceBackupTask` — the two fields I found
  missing, nothing more, nothing less. The progress-log's earlier false
  "done" claim is superseded by this commit's own log entry, which
  correctly attributes the miss. **Resolved.**

**Regression check:** `cd web && npm run test` → 392 passed, 0 failed (up
3 from the 389 at r1, matching the 5 new tests this fix commit claims to
add — 2 in `grouping.test.ts`, plus the ones in `tasks.test.ts`).
`npm run check` / `npm run lint` clean. `npx playwright test
tests/e2e/task-tags.spec.ts --project=chromium` → 2 passed. No server
files touched by this commit, so the r1 server-side verification (95
passed, bind-order audit, migration safety) still stands unchanged and
was not re-run.

**New-issue sweep:** read the full diff of the fix commit (not just the
three touched call sites) for anything the fix itself might have broken —
the `data-testid="completed-section"` move (a QA r1 item, not mine) and
the `+page.svelte`/`list/[id]/+page.svelte` grouping-render restructuring
were both exercised by the still-green Playwright spec and full vitest
run; found nothing new to flag from the adversary seat's brief.

Aside: HEAD's working tree also shows an unrelated uncommitted
modification to `.claude/agents/security-brief.md` (adds `Edit` to that
agent's tool list) — confirmed via `git show --stat` that this is not
part of commit `c816a220` and predates this delta round; not mine, not
touched, not in scope for this verdict.

Gate: APPROVED r2 @c816a220fbd3bd99d7fb50417a3672e7d11e170d — adversary

## Gate — qa (r2, delta re-confirmation)

Re-reviewed at `c816a220fbd3bd99d7fb50417a3672e7d11e170d` (one commit on top
of the r1 sha: "fix: address r1 gate findings on task emoji tag").
`git diff b7520cd..c816a22` read in full; both my own r1 findings and the
adversary's three r1 findings re-verified against the actual fix, not the
commit message's description of it. All test suites re-run for real (not
re-reported from the commit message).

**Re-verified test runs:**
- `npm run lint` — clean.
- `npm run check` — `svelte-check found 0 errors and 0 warnings`.
- `npm run test` — `Test Files 26 passed (26)` / `Tests 392 passed (392)`
  (+3 over r1's 389: two new `grouping.test.ts` determinism cases, one new
  `tasks.test.ts` empty-string-default case — matches the three new tests
  the fix commit claims).
- `cargo fmt --check` — clean.
- `cargo clippy --all-targets -- -D warnings` — clean.
- `cargo test` (server) — `test result: ok. 95 passed; 0 failed` (unchanged
  from r1, correctly — none of the three adversary fixes touched server
  code).
- `npx playwright test --project=chromium --workers=2` — `60 passed`,
  including both `task-tags.spec.ts` cases; zero regressions.

**My own r1 findings:**

1. Duplicate `data-testid="completed-section"` per tag group — **fixed as
   prescribed**. `web/src/routes/+page.svelte` and
   `web/src/routes/list/[id]/+page.svelte` both moved the testid from the
   per-group `.stack` div onto the outer `<section class="block">` wrapper;
   the per-group `.stack` divs are now unmarked. Confirmed by diff and by
   re-reading the surrounding markup: there is exactly one
   `data-testid="completed-section"` element per page regardless of how
   many tag groups the completed tasks split into, restoring the
   single-element contract the existing `myday.spec.ts` selectors
   (`[data-testid="completed-section"] [data-testid="task-row"]`) rely on —
   and since that's a CSS descendant combinator, it still matches task rows
   correctly through the added grouping wrapper divs (re-ran the full
   Playwright suite including every `myday.spec.ts` case that uses this
   selector — all pass).
2. D8 palette order undisclosed deviation — **fixed as prescribed**. The
   plan doc's D8 listing (this doc, lines ~106-115) now lists Time/priority
   first, matching `palette.ts`, with an explicit added note explaining why
   ("the direct replacement for the owner's `0.`-prefix trick, which needs
   to sort to the top") — the doc and the code now agree, and the
   deviation is disclosed rather than silent. My r1 prescription (either
   fix the doc or fix the code, and say why) was correctly satisfied by
   fixing the doc.

**Adversary's r1 findings (independent sanity-check, not just re-reading the fix):**

1. `tagRank` tie-breaking non-determinism — **fixed at the root cause, not
   papered over**. `palette.ts`'s `tagRank` now gives unrecognized emoji
   their own bucket (`TAG_ORDER.length`), distinct from both every real
   palette rank and untagged (`TAG_ORDER.length + 1`); `groupTasksByTag`
   now breaks same-rank ties on the emoji string itself. I did not just
   read this — I ran the new `grouping.test.ts` cases myself (they're part
   of the `npm run test` run above, all passing), including the
   forward-vs-reversed-input determinism case, which is the actual repro
   shape the adversary used. I also manually re-derived the fix's
   correctness: real palette ranks are `0..N-1`, the new unknown-bucket
   rank is exactly `N`, so no real tag can ever collide with the unknown
   bucket, and untagged at `N+1` can't collide with either — three
   disjoint bands, ties only possible *within* the unknown band, which is
   exactly where the new string tie-break applies. Holds.
2. Empty-string `default_emoji` leaking as `Task.emoji: ''` — **fixed at
   both call sites named in the finding**. `createLocalWithOptions` and
   `importBatch`'s `defaultEmojiByListId` both changed from `??` to
   `|| undefined` when reading `list.default_emoji`, exactly the fix the
   adversary suggested. Ran the new `tasks.test.ts` case myself (in the
   392-passing run above) covering both the manual-create and import
   paths. Checked for the same bug pattern elsewhere in case the fix was
   too narrow: `Sidebar.svelte`'s own `listTagDisplay` and picker-value
   reads already used `||` (not `??`) before this fix, so they were never
   affected; `normalizeListFromApi` in `lists.ts` still maps with `??`
   (leaves `''` as `''` in the list store itself), but that's fine — the
   fix correctly guards at the point of *use* (task creation), which is
   the only place D1's absent-by-default contract actually mattered; the
   list's own stored value being `''` vs `undefined` has no other
   consumer that treats them differently. No gap found.
3. `shared/types/backup.ts` missing `emoji`/`default_emoji` despite the r1
   progress log claiming it was done — **fixed**. Both fields now present
   on `SpaceBackupTask`/`SpaceBackupList`, matching the server's
   `BackupTaskRow`/`BackupListRow`. Independently confirmed the adversary's
   own characterization of this as a type/doc-accuracy bug rather than a
   live data-loss bug: grepped for consumers of `SpaceBackupTask`/
   `SpaceBackupList` directly (none — only the enclosing `SpaceBackupBundle`
   is used, by `Sidebar.svelte`'s download/restore flow via
   `api.getSpaceBackup()`/`restoreSpaceBackup()`, both of which pass the
   JSON through opaquely without field-by-field reconstruction), so the
   fix closes the stale-contract/future-footgun risk D7 exists to prevent,
   without there having been an actual runtime backup data-loss bug in
   this diff as shipped.

**New issues introduced by the fix round:** none found. The fix commit
touches `shared/types/backup.ts`, `web/src/lib/stores/tasks.ts` (+tests),
`web/src/lib/tags/{palette,grouping}.ts` (+tests), the two page components
(testid move only), and the plan doc; no new server-side changes, no new
route/endpoint, no new dependency. Full suite re-run green across the
board, counts match the fix commit's own claims exactly.

**Note (out of scope for this verdict):** `git status` at review time also
shows `.claude/agents/security-brief.md` modified in the working tree
(granting that seat an `Edit` tool, scoped to appending its verdict line).
This is a harness/tooling config change unrelated to the task-emoji
feature diff under review here, was not made by me, and I have not
evaluated it as part of this gate — noting it only so the clean-tree claim
below is accurate about what's present, not silent about it.

**Clean-tree check:** `git status` shows only my addition to this doc plus
the pre-existing `.claude/agents/security-brief.md` working-tree edit
(untouched by me, described above). No other untracked or modified files.

Gate: APPROVED r2 @c816a220fbd3bd99d7fb50417a3672e7d11e170d — qa

## Post-gate owner feedback (2026-09-18)

Owner reviewed the merged-ready PR on a real device (My Day, phone width)
and gave four pieces of feedback:

1. **Fixed now, blocking.** The My Day "Group by tag" toggle (a full
   `ghost-pill` with text) crowded the header next to `SortControls` on a
   phone, pushing the date/title into an awkward wrap. Replaced with a
   34x34 icon-only toggle (🏷️, `aria-label`/`title="Group by tag"`,
   `data-testid` unchanged so the existing E2E spec didn't need updating).
   Owner noted the underlying cause is the app having no token-based
   design system yet ("my fault, not this piece's") — not chasing that
   further here.
2. **Discussed, not built yet.** Owner asked whether tapping a task's
   emoji indicator directly in the list (not just via the detail drawer)
   should open the picker inline, to cut the current 3-step path (open row
   menu → Details → Tag toggle → pick) down to one tap. Architect's read:
   good, bounded idea (reuses `EmojiPicker.svelte` as-is, just needs a new
   tap target + popover anchoring on `TaskRow`) — recommended as a small
   follow-up piece rather than folding into this one.
3. **Documented, not resolved** — tech-debt #049: `Task.priority`/Starred
   and the tag system's "Time / priority" section (⭐/⏰/🎯) are now two
   independent concepts that can visually collide. Owner's explicit call:
   flag it, don't fix it now.
4. **Confirmed, no code needed.** Owner asked whether palette order in
   `tags/palette.ts` actually drives group/sort order end-to-end. Yes —
   already true and already tested (`grouping.test.ts`, "groups tagged
   items in fixed palette order, not insertion order"); pointed the owner
   at the mechanism rather than having them hand-verify it.

Fix for (1) re-verified: `npm run check`/`lint`/`test` (392 passed),
`task-tags.spec.ts` (2 passed), and a manual phone-width (390px) screenshot
confirming the header no longer crowds. Re-engaging the same r2 seat
instances for r3 delta confirmation before merge, since the sha moves
again.
