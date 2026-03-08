# Exec Plan: Font & Completion Quotes Settings

**Branch:** `feat/font-and-completion-quotes-settings`
**Date:** 2026-03-08
**Author:** Claude (planned with user)

## Goal

Add two new user-configurable settings:
1. **Font** — dropdown to choose from Sora, Sono, Inter, or System (default). Persists like theme.
2. **Completion quotes** — newline-separated textarea of messages shown when all tasks are done. Replaces the hardcoded `blissMessages` array in `+page.svelte`.

Both settings live in the settings menu as new sections, sync to the server, and degrade gracefully offline.

## Scope

| Layer | What changes |
|---|---|
| `shared/types/settings.ts` | Add `UiFont` type; add `font` and `completionQuotesJson` to `UiPreferences` and `UiPreferencesWire` |
| `server/migrations/` | `0014_user_font_and_quotes.sql` — two new nullable columns on `user` |
| `server/src/routes.rs` | Add fields to response/body structs; add `normalize_ui_font()`; update SQL queries; update backup query |
| `web/src/lib/stores/preferences.ts` | Add `font` + `completionQuotes` normalization, `toWire`/`fromWire`, `setFont`, `setCompletionQuotes` |
| `web/src/lib/components/settingsMenu.ts` | Add `'appearance'` and `'quotes'` section IDs |
| `web/src/routes/+layout.svelte` | Preload all fonts upfront; apply selected font via `data-ui-font` attribute + CSS |
| `web/src/lib/components/Sidebar.svelte` | Add Appearance section (font dropdown) and Quotes section (textarea) to settings panel |
| `web/src/routes/+page.svelte` | Read `completionQuotes` from `$uiPreferences`; fall back to built-in defaults |

## Key decisions

### Font loading strategy
Load all candidate fonts via `<link>` tags in `<head>` upfront (not lazily). This avoids FOUT when the user switches fonts — the font file is already cached. Apply the active font via a `data-ui-font` attribute on `<html>`, similar to how `data-ui-theme` works today.

```css
/* in +layout.svelte :global */
:root { --ui-font: 'Sora', ...; }
html[data-ui-font='sora']   { --ui-font: 'Sora', sans-serif; }
html[data-ui-font='sono']   { --ui-font: 'Sono', sans-serif; }
html[data-ui-font='inter']  { --ui-font: 'Inter', sans-serif; }
html[data-ui-font='system'] { --ui-font: system-ui, sans-serif; }
body { font-family: var(--ui-font); }
```

The two "tasksync" wordmarks retain their explicit `font-family` override and are unaffected.

### Wire format
`font` is a plain string field on the wire (like `theme`). `completionQuotesJson` is a JSON-encoded string (like `sidebarPanelsJson`) — this avoids newline/escaping issues in the SQLite column and keeps the wire format consistent.

### Server validation
- `normalize_ui_font()` mirrors `normalize_ui_theme()`: accepts only known values (`sora`, `sono`, `inter`, `system`), rejects unknown values with `400`.
- `completionQuotesJson` is opaque on the server — stored and returned as-is after a length cap (max 8 KB). No structural validation server-side.

### Completion quotes default
Defaults live client-side only. If the user has no custom quotes set (`completionQuotesJson` is null/empty), the existing hardcoded `blissMessages` array in `+page.svelte` is used as-is. This avoids needing to seed defaults into the DB.

### Settings sections
Two new non-admin sections added to `settingsMenu.ts`:
- `'appearance'` — Font picker
- `'quotes'` — Completion quotes

Both are user-level (not `adminOnly`). Inserted after `'sound'` in the menu order.

## Steps

### 1. Shared types
- Add `UiFont = 'sora' | 'sono' | 'inter' | 'system'` to `shared/types/settings.ts`
- Add `font?: UiFont` to `UiPreferences`
- Add `font?: string` to `UiPreferencesWire`
- Add `completionQuotesJson?: string` to both

### 2. Server migration
```sql
-- 0014_user_font_and_quotes.sql
alter table user add column ui_font text;
alter table user add column ui_completion_quotes text;
```

### 3. Server routes.rs
- Add `font: Option<String>` + `completion_quotes_json: Option<String>` to `UiPreferencesResponse` and `UpdateUiPreferencesBody`
- Add `ui_font: Option<String>` + `ui_completion_quotes: Option<String>` to the user row struct (used in backup)
- Add `normalize_ui_font()` (allow-list: `sora`, `sono`, `inter`, `system`)
- Add `normalize_completion_quotes_json()` — length cap only, no structural check
- Update `load_ui_preferences_for_user` SQL to select new columns
- Update `auth_update_preferences` to apply new fields
- Update backup query to include new columns

### 4. Preferences store
- Add `normalizeFont()`, `normalizeCompletionQuotes()` helpers
- Extend `defaultPreferences()`, `toWire()`, `fromWire()`, `readLocal()`, `writeLocal()` / `setAll()`
- Add `setFont(font: UiFont)` and `setCompletionQuotes(raw: string)` methods
- Wire `applyFontToDocument()` subscriber (sets `data-ui-font` on `<html>`)

### 5. Settings menu
- Add `'appearance'` and `'quotes'` to `SettingsSectionId` union type
- Add both sections to `baseSections` array (non-admin, after `'sound'`)

### 6. Layout — font loading + application
- Add `<link>` tags for Sora, Sono, Inter (currently only Sora is loaded)
- Remove hardcoded `font-family: 'Sora'` from `:global(body)`
- Add `body { font-family: var(--ui-font); }` pattern with `data-ui-font` CSS selectors

### 7. Sidebar — settings UI
- Appearance section: `<select>` with options Sora / Sono / Inter / System, bound to `$uiPreferences.font`, calls `uiPreferences.setFont()`
- Quotes section: `<textarea>` (newline-separated), debounced save on `blur` or explicit save button, calls `uiPreferences.setCompletionQuotes()`; show built-in default count as hint

### 8. +page.svelte — use quotes from preferences
- Import `uiPreferences`
- Derive active quote list: if `$uiPreferences.completionQuotes?.length`, use those; else fall back to hardcoded `blissMessages`
- Replace `blissMessages[Math.random()…]` with derived list pick

## Tests to add / update

- `preferences.test.ts`: add cases for `setFont`, `setCompletionQuotes`, `fromWire`/`toWire` round-trips, unknown font normalization
- Server: add `user_can_update_font_and_completion_quotes` test mirroring `user_can_update_ui_preferences`
- No new E2E tests required — this is purely settings UI; existing smoke tests cover the shell

## Out of scope

- Adding more font options beyond the three above
- Per-list or per-view font overrides
- Font size controls

## Progress log

- 2026-03-08: Plan written, branch created.
