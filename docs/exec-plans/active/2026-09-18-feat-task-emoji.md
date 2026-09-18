---
plan: feat-task-emoji
harness: v2 · lean
anchor: spec
status: Draft
gate: pending
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
(not scattered across components):
- Grocery aisles — 🥦 produce, 🥛 dairy, 🥩 meat, 🍞 bakery, 🧊 frozen,
  🧺 household/other
- Household & chores — 🧹 cleaning, 🔧 maintenance, 🐾 pets
- Money — 💰 financial
- Health — 💊 health/medical
- Family — 👨‍👩‍👧 family
- Time / priority — ⭐ starred, ⏰ time-sensitive, 🎯 goal-focused
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
  explicitly). Register above reflects the final, confirmed state. Ready
  for the owner's sign-off on the written doc, then Build.
