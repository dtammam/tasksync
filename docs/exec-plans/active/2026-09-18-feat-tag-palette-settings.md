---
plan: feat-tag-palette-settings
harness: v2 · lean
anchor: spec
status: Draft
gate: pending
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
`/auth/preferences` than to task/list sync. Add
`GET /spaces/:id/tag-palette` and `PUT /spaces/:id/tag-palette` (whole-palette
replace) as dedicated endpoints, not new sync change types.

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

**D8 — Validation, client and server.** Reject on save: empty label, empty or
multi-grapheme-cluster-invalid emoji, and duplicate emoji anywhere in the
whole palette (`tagRank`/`tagLabel` assume emoji uniqueness; a duplicate makes
`tagLabel` silently return whichever entry it finds first). No other floor is
enforced — an empty section, or the whole palette emptied to zero sections, is
allowed and rendered as a plain empty state, not a validation error (the app
already has a working "untagged" bucket for zero tags; forcing a minimum would
only be friction, per owner).

**D9 — Sections are first-class editable objects too, same as entries.**
Sections can be added, renamed, reordered, and deleted — not just their
entries. Deleting a section cascades to delete its entries with it, matching
this codebase's existing cascade convention (deleting a list deletes its
tasks); per D4 this is already safe for any already-tagged task regardless.
The UI shows a confirm before a cascading delete ("Delete 'Grocery aisles' and
its 6 tags?"), matching the existing delete-list confirmation pattern.

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

**Server (`server/src/routes/`, new `tags.rs` or folded into `lists.rs`'s
space-scoped routes).**
- `GET /spaces/:id/tag-palette` — any member; returns the space's palette, or
  the built-in default array if the column is null.
- `PUT /spaces/:id/tag-palette` — admin only (403 for contributors); replaces
  the whole array. Validates: every entry has a non-empty `label` and a
  non-empty `emoji` that is exactly one grapheme cluster (`Intl.Segmenter`,
  same primitive Piece 3 already uses client-side); no duplicate `emoji`
  anywhere across the whole payload, regardless of section. Reject the whole
  request (400) on any violation — no partial apply.

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
- **Step 2** — Server: `GET`/`PUT /spaces/:id/tag-palette` with validation
  (grapheme-cluster emoji check, duplicate-emoji check, admin gate on `PUT`);
  server tests for happy path, non-admin 403, duplicate-emoji 400,
  empty-palette-allowed, null-column-serves-default.
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

- [ ] An admin can add, edit (label and/or emoji), and remove a tag from the
  in-app Tags settings section — no file edit required.
- [ ] An admin can reorder entries within a section and reorder sections
  themselves, and that order is what list/My Day grouping and the palette
  picker use afterward.
- [ ] A non-admin cannot reach the edit UI (gated the same way Lists/Members/
  Backups are).
- [ ] Deleting or changing the emoji of a palette entry does not alter any
  existing task's or list's stored `emoji`/`default_emoji` value; those tasks
  render via the existing unrecognized-emoji fallback, and the UI states this
  before the action is taken.
- [ ] A space that has never touched this feature (`tag_palette_json` is
  null) sees the same palette contents/order as today, unchanged.
- [ ] Saving a palette with a duplicate emoji is rejected client-side and
  server-side with a clear error, not silently accepted.
- [ ] Cold offline boot (no hydration yet) still renders a non-empty palette
  (the built-in default) in the picker and in grouping.
- [ ] An admin can add a new section and a new entry, and can delete a
  section, with a confirm that names the entries it will take with it.
- [ ] Emptying a section, or the entire palette, to zero is allowed and
  renders a plain empty state rather than a validation error.
