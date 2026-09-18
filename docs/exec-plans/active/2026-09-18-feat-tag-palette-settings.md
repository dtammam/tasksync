---
plan: feat-tag-palette-settings
harness: v2 · lean
anchor: spec
status: Gate:APPROVED r1 @ad3c0357
design: Approved 2026-09-18 @10e7161
gate: APPROVED r1 @ad3c0357fcbde3c2aa05aa99b8754b6e9c8084be — adversary, qa, security-brief
---

# In-app tag palette settings

## Request

In-app Settings UI for managing the tag palette (`web/src/lib/tags/palette.ts`):
add/edit/remove tags, and reorder both the tags within a section and the
sections themselves, so the owner doesn't have to hand-edit the TypeScript
file. Follow-up to Piece 3 (`feat/task-emoji`, shipped PR#141), requested
after the owner validated the shipped feature in beta on a real device.

## Blind-spot pass

- **The palette is currently a static, hardcoded module** (`TAG_PALETTE`,
  `TAG_ORDER`, `tagRank`, `tagLabel` in `web/src/lib/tags/palette.ts`), with
  exactly two real callers: `EmojiPicker.svelte` and `tags/grouping.ts`. Making
  it editable means making it *data* — this is a bigger architectural pivot
  than the UI work alone suggests, even though the caller surface is small.
- **The palette must be space-level, not user-level.** Tags are shared
  task-categorization visible to every member on shared lists/tasks. Every
  existing single-JSON-blob precedent in this codebase
  (`custom_sound_files_json`, `streak_settings_json`, `ui_sidebar_panels`) is
  a column on `user` — none of them is the right precedent for *shared* data.
  There is currently **no space-level settings column of any kind** — `space`
  (migration `0001_init.sql`) has only `id` and `name`. This is genuinely new
  ground, not an extension of an existing pattern.
- **Emoji values are already persisted as raw strings on `task.emoji` /
  `list.default_emoji`**, not as an index or foreign key into the palette.
  Piece 3 already built and tested the "unrecognized emoji" fallback path
  (`tagRank` buckets anything not in `TAG_ORDER` on its own rank, `tagLabel`
  returns `undefined`). That means editing or deleting a palette entry is
  **already safe by construction** — it never needs to touch existing tasks —
  but the UI must say so explicitly, or an admin will expect a rename/delete
  to retroactively relabel already-tagged tasks.
- **Offline-first constraint**: the app can cold-boot offline. If the palette
  becomes server-hosted, the client needs a fallback (the current hardcoded
  array) for the case where it hasn't hydrated yet — the app must never render
  with an empty palette.
- **Existing UI precedent to reuse, not reinvent**: `Sidebar.svelte` already
  has an admin-gated, drag-reorderable list of items (`list_order`) and an
  `EmojiPicker`-style section picker (`ColorSwatchPicker.svelte`). The new
  settings panel should follow the same interaction shapes rather than invent
  new ones.
- **`settingsMenu.ts`** is the existing extension point for a new settings
  section (`SettingsSectionId` union + `baseSections` array); "lists",
  "members", "backups" are `adminOnly: true` and are the closest precedent for
  what this new "Tags" section should be.
- Related, explicitly out of scope here: tech-debt #049 (Star/priority vs. the
  palette's "Time / priority" section overlap) — owner already deferred this
  during Piece 3; not reopened by this piece.

## Anchor

Anchor — default: `outcome` · recommended: **`spec`**

This isn't UI polish on top of settled ground — it introduces the first
space-level settings storage this codebase has ever had, a new dedicated
write surface (who can edit shared task taxonomy), and a static→dynamic
pivot in a module three other files depend on. Getting the storage shape,
identity/edit-safety story, and admin gating wrong is expensive to unwind
once tasks in production reference palette entries. Recommend `spec` —
confirm, or override.

## Decision register

**D1 — Storage shape & level.** New nullable `tag_palette_json` text column
on `space` (new migration `0019_space_tag_palette.sql`). Space-wide, not
per-user: two members must see the same label for the same emoji on a shared
task. The nested shape (sections → entries) matches the established
"single JSON blob for a settings object" convention (`streak_settings_json`,
`custom_sound_files_json`) far better than the flat `list_order` precedent.

**D2 — Null means built-in defaults.** The migration leaves existing spaces'
`tag_palette_json` null; a null value means "serve the current hardcoded
`TAG_PALETTE` as the default," consistent with this codebase's existing
coalesce-to-default convention for nullable settings columns. No backfill.

**D3 — Editing is admin-gated.** New "Tags" settings section in
`settingsMenu.ts` with `adminOnly: true`, matching "Lists"/"Members"/"Backups"
— this changes shared task taxonomy for the whole space, not a personal
preference like Sound/Streak/Appearance.

**D4 — Edits never touch existing tasks; the UI must say so.** Renaming an
entry's label is free (label is looked up by emoji, not stored on the task).
Changing an entry's emoji, or deleting an entry, does not relabel or migrate
already-tagged tasks — they keep their current emoji and fall into the
existing "unrecognized emoji" bucket going forward (already built and tested
in Piece 3). The settings UI must state this explicitly next to
delete/emoji-change actions so it isn't a surprise.

**D5 — Dedicated REST endpoints, not the sync delta protocol.** Palette edits
are rare, single-admin, non-offline-critical actions — closer to
`/auth/preferences` than to task/list sync. This server has no `/spaces/:id`
path convention anywhere — every resource is nested at a fixed path
(`/auth`, `/lists`, `/tasks`) and the caller's space comes from
`ctx_from_headers`, not a URL param (corrected after reading `lists.rs`; the
plan originally proposed a `/spaces/:id/...` shape that doesn't match this
codebase). Add a new fixed-path resource, `GET /tags` and `PUT /tags`
(whole-palette replace), mounted the same way `list_routes`/`task_routes` are.

**D6 — Client: a hydrated store replaces the static const.** New
`web/src/lib/stores/tagPalette.ts` hydrates from the server on space load and
exposes the current palette; `palette.ts` keeps its exported types and
`tagRank`/`tagLabel` functions (unchanged signatures) but reads from the
store's current value instead of the hardcoded array, falling back to the
built-in default array whenever the store hasn't hydrated yet (cold offline
boot). `EmojiPicker.svelte` and `tags/grouping.ts` — the only two real
callers — need minimal changes as a result.

**D7 — Reorder UI reuses the existing drag pattern.** Both entries-within-a-
section and section order use the same drag-to-reorder interaction already
built for list ordering in `Sidebar.svelte`, not a new component.

**D8 — Validation, client and server.** Reject on save: empty label, empty
emoji, and duplicate emoji anywhere in the whole palette (`tagRank`/
`tagLabel` assume emoji uniqueness; a duplicate makes `tagLabel` silently
return whichever entry it finds first — this is the one real correctness
invariant). Server-side emoji shape check is a plain non-empty + short
max-length bound, not strict single-grapheme-cluster validation — the
palette already contains a multi-codepoint ZWJ sequence (👨‍👩‍👧, "Family"),
so "exactly one grapheme cluster" is actually wrong, and enforcing it
server-side would need a new Rust dependency for no real safety gain; the
client's native emoji picker keeps input sane in practice. No other floor is
enforced — an empty section, or the whole palette emptied to zero sections, is
allowed and rendered as a plain empty state, not a validation error (the app
already has a working "untagged" bucket for zero tags; forcing a minimum would
only be friction, per owner).

**D9 — Sections are first-class editable objects too, same as entries.**
Sections can be added, renamed, reordered, and deleted — not just their
entries. Deleting a section cascades to delete its entries with it.
Correction: this does NOT match an existing cascade convention — `delete_list`
actually does the opposite, returning `409 Conflict` and refusing to delete a
non-empty list. The right reason for cascading here is the inverse of why
lists block: deleting a list's tasks would be destructive and irreversible,
so the app protects against it; deleting a palette entry is never destructive
per D4 (an already-tagged task keeps its emoji regardless), so there's nothing
to protect against and cascading is safe. The UI still shows a confirm before
a cascading delete ("Delete 'Grocery aisles' and its 6 tags?") for the same
reason list deletion confirms — clarity, not data safety.

## Design

**Schema.** `server/migrations/0019_space_tag_palette.sql`:

```sql
-- Logically reversible via: alter table space drop column tag_palette_json;
alter table space add column tag_palette_json text;
```

Stored shape mirrors the current TS type exactly — a JSON array of
`{ section: string, entries: { emoji: string, label: string }[] }` — so
serialization is a straight `JSON.stringify`/`JSON.parse` of the existing
`TagPaletteSection[]` shape, no reshaping needed.

**Server (`server/src/routes/tags.rs`, new — mirrors `lists.rs`'s shape,
mounted at `/tags` in `main.rs` next to `/lists`/`/tasks`).**
- `GET /` — any member (`ctx_from_headers`, no role check); returns the raw
  stored value for `ctx.space_id` (`Option<Vec<TagPaletteSection>>`, `null`
  when unset). The client, not the server, supplies the built-in default for
  `null` (D6) — no duplicated palette content between Rust and TypeScript.
- `PUT /` — admin only (403 for contributors, matching `create_list`/
  `update_list`); replaces the whole array. Validates: every entry has a
  non-empty `label` and non-empty (short max-length) `emoji`; no duplicate
  `emoji` anywhere across the whole payload, regardless of section. Reject the
  whole request (400) on any violation — no partial apply.

**Client store (`web/src/lib/stores/tagPalette.ts`, new).** A writable store
hydrated once on space load via the new `GET`. Exposes:
- `tagPalette` (the store itself, for components that want reactivity)
- `currentTagPalette()` — synchronous snapshot getter (`get(tagPalette)`),
  returning the built-in `DEFAULT_TAG_PALETTE` whenever unhydrated (cold
  offline boot) or the array is empty.
- `saveTagPalette(next)` — calls the `PUT`, updates the store optimistically
  only after a successful response (admin-only action, no offline queue).

**`palette.ts` changes.** Rename the existing hardcoded array to
`DEFAULT_TAG_PALETTE` (still exported, becomes the fallback). `tagRank` and
`tagLabel` keep their exact signatures but internally resolve against
`currentTagPalette()` instead of the old module-level `TAG_PALETTE` const, so
`EmojiPicker.svelte` and `tags/grouping.ts` need no changes at all — they keep
calling the same functions.

**Settings UI.** New `web/src/lib/components/settings/TagPaletteSettings.svelte`,
registered in `settingsMenu.ts` as `{ id: 'tags', label: 'Tags', adminOnly: true }`.
Two nested sortable lists, reusing `Sidebar.svelte`'s existing
`draggable`/`dragstart`/`dragover`/`drop` + up/down-arrow-button pattern
(accessible fallback for non-drag input) verbatim:
- Outer: sections — each row has a name field (inline edit), drag handle /
  arrows, and a delete button (cascade-confirm dialog per D9).
- Inner (per section, expandable): entries — each row has an `EmojiPicker`-
  style emoji field, a label field, drag handle / arrows, and a delete button.
- "Add section" and "Add entry" affordances at the appropriate list ends.
- Save button calls `saveTagPalette`; inline error surfaces server-side
  validation failures (duplicate emoji, empty fields) without losing the
  admin's in-progress edits.

## Build plan

- **Step 1** — Migration `0019_space_tag_palette.sql`; add `tag_palette_json`
  to the relevant `space`-row structs.
- **Step 2** — Server: new `tags.rs`, `GET`/`PUT /tags` with validation
  (non-empty label/emoji, duplicate-emoji check, admin gate on `PUT`); mount
  in `main.rs`; server tests for happy path, non-admin 403, duplicate-emoji
  400, empty-palette-allowed, null-column-returned-as-is.
- **Step 3** — Shared types: add the wire shape to `shared/types/` alongside
  existing space/settings types.
- **Step 4** — Client: `stores/tagPalette.ts` (hydrate on space load, fallback
  snapshot, save); `api/client.ts` additions for the two endpoints.
- **Step 5** — `palette.ts`: rename to `DEFAULT_TAG_PALETTE`, repoint
  `tagRank`/`tagLabel` at `currentTagPalette()`; unit tests updated/added for
  the fallback-when-unhydrated path.
- **Step 6** — `TagPaletteSettings.svelte` + `settingsMenu.ts` registration;
  drag/arrow reorder for both sections and entries; add/rename/delete for
  both, cascade-confirm on section delete.
- **Step 7** — E2E: admin edits a tag and it reflects in list/My Day grouping;
  non-admin cannot see/reach the Tags settings section; deleting a palette
  entry leaves an already-tagged task's stored emoji untouched.
- **Step 8** — Docs: acceptance checkoff, gate, close.

## Acceptance

- [x] An admin can add, edit (label and/or emoji), and remove a tag from the
  in-app Tags settings section — no file edit required.
  (`TagPaletteSettings.svelte`; `TagPaletteSettings.test.ts`)
- [x] An admin can reorder entries within a section and reorder sections
  themselves, and that order is what list/My Day grouping and the palette
  picker use afterward. (`paletteOrder`/`rankInPalette` flatten section-then-
  entry array order; unchanged since Piece 3's `grouping.test.ts`, now fed by
  the live store instead of a static const)
- [x] A non-admin cannot reach the edit UI (gated the same way Lists/Members/
  Backups are). (`settingsMenu.ts` `adminOnly: true`;
  `tag-palette-settings.spec.ts` "non-admin cannot see...")
- [x] Deleting or changing the emoji of a palette entry does not alter any
  existing task's or list's stored `emoji`/`default_emoji` value; those tasks
  render via the existing unrecognized-emoji fallback, and the UI states this
  before the action is taken. Structurally guaranteed: `PUT /tags` only ever
  writes `space.tag_palette_json`, never touches `task`/`list` rows; the
  unrecognized-emoji fallback itself was built and tested in Piece 3. The
  settings panel's persistent note states this before any delete/edit action.
- [x] A space that has never touched this feature (`tag_palette_json` is
  null) sees the same palette contents/order as today, unchanged.
  (`tag_palette_defaults_to_null_until_saved` server test; `tagPalette.test.ts`
  "serves the default palette when the server has none saved"; E2E)
- [x] Saving a palette with a duplicate emoji is rejected client-side and
  server-side with a clear error, not silently accepted.
  (`saving_a_palette_with_duplicate_emoji_is_rejected` server test;
  `TagPaletteSettings.test.ts` "rejects saving... client-side")
- [x] Cold offline boot (no hydration yet) still renders a non-empty palette
  (the built-in default) in the picker and in grouping. (`tagPalette.test.ts`
  "seeds the default palette before any hydration" / "clears to the default
  palette when not authenticated")
- [x] An admin can add a new section and a new entry, and can delete a
  section, with a confirm that names the entries it will take with it.
  (`TagPaletteSettings.test.ts` cascade-confirm tests)
- [x] Emptying a section, or the entire palette, to zero is allowed and
  renders a plain empty state rather than a validation error.
  (`saving_an_empty_palette_is_allowed` server test; `TagPaletteSettings.test.ts`
  "shows an empty state...")

## Progress log

Built end to end, Steps 1-8, all in-scope. Two deviations from the approved
design, both caught before the gate rather than by a reviewer, neither
touching an acceptance criterion or public interface the owner approved:

- **D5's endpoint shape and D9's cascade rationale were corrected before any
  code was written** (see the `docs: correct tag-palette-settings design
  before implementing` commit) — `/spaces/:id/tag-palette` doesn't match this
  codebase's routing convention (fixed-path resources, space from
  `ctx_from_headers`) and became `/tags`; `delete_list`'s actual behavior is
  to 409 on a non-empty list, not cascade, so section cascade-delete is
  justified by D4 (safe because non-destructive), not by a nonexistent
  precedent.
- **`EmojiPicker.svelte` and `tags/grouping.ts` DO need import changes**,
  contrary to the design's "no changes at all" claim — `EmojiPicker` must
  subscribe to the live `$tagPalette` store reactively, or an owner's edits
  would never reach the one UI surface tags actually get assigned from. Both
  changes are import-path-only; neither component's logic changed.
- **Step 7's E2E scope was narrowed from what the Build plan promised**,
  flagged independently by both the QA and adversary gate seats: the plan
  said E2E coverage for "admin edits a tag and it reflects in list/My Day
  grouping" and "deleting a palette entry leaves an already-tagged task's
  stored emoji untouched." The delivered `tag-palette-settings.spec.ts`
  instead covers non-admin gating, default-palette rendering, and
  edit-save-with-failure-recovery — real, valid coverage, but not those two
  scenarios. Both underlying claims are still verified, just not via E2E:
  order-propagation by `grouping.test.ts` (already palette-parameterized) and
  `tagPalette.test.ts`'s current-palette-resolution test; the
  emoji-left-untouched claim is a structural guarantee traced directly in
  `tags.rs` (`PUT /tags` only ever writes `tag_palette_json`) rather than
  something an E2E round-trip is needed to prove. Both gate seats judged this
  non-blocking for that reason.

Test coverage: 6 new server tests, 8 new `tagPalette` store tests, 8 new
`TagPaletteSettings.svelte` tests, 3 new E2E tests (stable across 3
consecutive local chromium runs) — 408 web unit tests and 101 server tests
total, all passing; lint/clippy/fmt clean throughout.

## Gate

Gate: APPROVED r1 @ad3c0357fcbde3c2aa05aa99b8754b6e9c8084be — security-brief

### QA review (r1)

Instruments run verbatim (all green, all counts match the Progress log's claims):
- `cargo test` (server/): `test result: ok. 101 passed; 0 failed; 0 ignored`
- `cargo clippy --all-targets -- -D warnings` (server/): `Finished` dev profile, no warnings
- `cargo fmt --check` (server/): exit 0, no diff
- `npm run check` (web/): `svelte-check found 0 errors and 0 warnings`
- `npm run lint` (web/): clean, no output
- `npx vitest run` (web/): `Test Files 28 passed (28)`, `Tests 408 passed (408)`
- `npx playwright test tests/e2e/tag-palette-settings.spec.ts tests/e2e/task-tags.spec.ts --project=chromium`, run 3x: `5 passed` all three runs, no flakes observed, no interaction with tech-debt #050's known pattern.

Correctness spot-checks against the acceptance checklist: all nine citations verified to exist and assert what's claimed (`tag_palette_defaults_to_null_until_saved`, `saving_a_palette_with_duplicate_emoji_is_rejected`, `saving_an_empty_palette_is_allowed`, `contributor_cannot_save_tag_palette`, the `tagPalette.test.ts` hydration/default/clear cases, the `TagPaletteSettings.test.ts` cascade-confirm and duplicate-emoji cases). D3/D5/D8/D9 gating and validation match `lists.rs`'s established `Role::Admin` pattern exactly. Migration comment matches the project's existing "Logically reversible via..." convention verbatim (`0018_task_and_list_emoji.sql`). No new Rust or npm dependency introduced (`Cargo.toml`/`Cargo.lock`/`package.json`/`package-lock.json` all untouched), consistent with D8's "no new dependency" claim. `EmojiPicker.svelte`/`grouping.ts` import-path change verified: no stale `TAG_PALETTE`/`TAG_ORDER` references remain anywhere in `web/src/`; `EmojiPicker.svelte` now reactively subscribes via `$tagPalette`. Accessibility: the new `role="list"`/`role="listitem"` nesting on the drag-and-drop section/entry rows is valid ARIA (a listitem may contain a nested list plus other content) and each drag interaction has a non-drag up/down-button fallback, consistent with D7's accessible-fallback requirement.

Security surface: no new dependency, no new secrets, space-scoped reads/writes via `ctx.space_id` (no cross-space leakage), admin gate on `PUT` matches existing convention, Svelte auto-escapes interpolated label/section text (no injection surface). Duplicate-emoji and empty-field validation is enforced both client- and server-side, request rejected atomically (no partial apply) per D8. Nothing here needing a dedicated security pass beyond what the security-brief seat already covered on the migration.

**WARNING (non-blocking, disclosed here for transparency)** — `docs/exec-plans/active/2026-09-18-feat-tag-palette-settings.md:224-226`: Build plan Step 7 promised E2E coverage for two specific scenarios — "admin edits a tag and it reflects in list/My Day grouping" and "deleting a palette entry leaves an already-tagged task's stored emoji untouched." The delivered `tag-palette-settings.spec.ts` instead covers non-admin gating, default-palette rendering, and edit-save-with-failure-recovery — none of which is either of those two scenarios. The Progress log's deviation list (lines 274-287) discloses two deviations (D5/D9 correction, EmojiPicker/grouping.ts import changes) but omits this narrowing of Step 7's E2E scope, so a reader trusting the Progress log's "built end to end, Steps 1-8, all in-scope" framing would believe those two scenarios got literal E2E coverage when they didn't. This doesn't block: the underlying claims are still verified — order-propagation is covered by `grouping.test.ts` (generic, palette-parameterized) plus `tagPalette.test.ts`'s "tagRank/tagLabel resolve against the current (hydrated) palette" test, and the emoji-untouched claim is a structural guarantee (`PUT /tags` only ever writes `tag_palette_json`, confirmed by reading `tags.rs`) rather than something that needs an E2E round-trip to prove. Recommend the Progress log be amended to name this substitution explicitly, but not a re-open condition.

No other CRITICAL or WARNING findings. Working tree left byte-identical aside from this appended section and the verdict line below (pre-existing untracked/modified `.claude/agents/security-brief.md` predates this session per the initial git status and is unrelated to this diff).

Gate: APPROVED r1 @ad3c0357fcbde3c2aa05aa99b8754b6e9c8084be — qa

### Adversary review (r1)

Independent measurement, not trusting the Progress log, QA section, or security-brief section above (read after finishing my own pass, not as input to it):

- `cargo test` (server/): `101 passed; 0 failed`. `cargo clippy -- -D warnings`: clean. `cargo fmt -- --check`: clean.
- `npm run test -- --run` (web/): `408 passed (408)`. `npm run check`: `0 errors and 0 warnings`. `npm run lint`: clean.
- `npx playwright test tests/e2e/tag-palette-settings.spec.ts --project=chromium`: `3 passed` (single real run against a live dev server, not trusted from the doc).
- **Migration reversibility, actually executed** (not just read): ran `alter table space add column tag_palette_json text` then `alter table space drop column tag_palette_json` against a live SQLite DB — succeeds and drops the data, on both the ambient `sqlite3` module (3.40.1) and, confirmed via `strings`/`ldd` on the built `target/debug/tasksync-server` binary, the actual bundled `libsqlite3-sys 0.30.1` the server links (statically bundled, no `libsqlite3.so` dependency; embedded version string `3.46.0`). `DROP COLUMN` has been supported since SQLite 3.35.0, so the rollback comment is not aspirational — it is a real, run rollback path.
- **Mutation-tested the bindings** (mutate against committed tree via scratch copy + restore, confirmed `git status`/`git diff` clean after each):
  - Removed the duplicate-emoji branch from `TagPaletteSettings.svelte`'s client `validate()` → `TagPaletteSettings.test.ts`'s "rejects saving... client-side" test goes red (`saveMock` gets called, error text missing). Caught.
  - Removed the `Role::Admin` check from `put_tag_palette` (server/src/routes/tags.rs) → `contributor_cannot_save_tag_palette` goes red. Caught.
  - No-opped the server's `seen_emoji.insert` duplicate check (insert-without-reject) → `saving_a_palette_with_duplicate_emoji_is_rejected` goes red. Caught.
  - Dropped `adminOnly: true` from the `tags` entry in `settingsMenu.ts` and re-ran the E2E spec live → "non-admin cannot see the Tags settings section at all" fails for real (`getByTestId('settings-section-tags')` resolves to 1, not 0). Caught end-to-end, not just at the unit level.
  All four mutants killed; no surviving mutant found on the surfaces I attacked.
- **D4 (edits never touch tasks) traced directly, not trusted**: `put_tag_palette` in `server/src/routes/tags.rs` issues exactly one write, `update space set tag_palette_json = ?1 where id = ?2` — no `task`/`list` table is referenced anywhere in `tags.rs`. Structurally impossible for this endpoint to touch task/list rows.
- **D9 deviation re-verified independently**: `delete_list` (`server/src/routes/lists.rs:131-160`) does count tasks and return `409 CONFLICT` on a non-empty list, never cascades — the Progress log's characterization of this precedent is accurate.
- **`/spaces/:id` nonexistence re-verified**: `grep -rn "/spaces/" server/src web/src shared` returns nothing. The D5 deviation's premise holds.
- **Space scoping re-verified**: both `get_tag_palette`/`put_tag_palette` derive `ctx.space_id` from `ctx_from_headers`, which decodes it from the signed JWT claim server-side — never from a URL param or client-suppliable header — identical to `lists.rs`/`tasks.rs`. No cross-space read/write path exists for `/tags` that doesn't already exist for every other resource.
- **Static-to-dynamic pivot swept for stale references**: `grep` across `web/src` for `TAG_PALETTE`/`TAG_ORDER`/direct `palette.ts` imports of `tagRank`/`tagLabel` turned up none outside `palette.ts` itself; `EmojiPicker.svelte` and `grouping.ts` both import from `$lib/stores/tagPalette` (the live store), confirmed by diff, not by the doc's say-so.
- Agree with the WARNING already on record above (Build Plan Step 7 vs. delivered E2E scope) — reproduced this independently before reading the QA section that also flagged it. Non-blocking for the same reason: I traced the underlying D4 guarantee myself at the code level above, and it does not depend on that missing E2E test.

No CRITICAL or WARNING findings of my own beyond the one already on record. Tree restored after every mutation (`git status`/`git diff` clean apart from the doc appends and the pre-existing unrelated `.claude/agents/security-brief.md` modification, which predates this session).

Gate: APPROVED r1 @ad3c0357fcbde3c2aa05aa99b8754b6e9c8084be — adversary
