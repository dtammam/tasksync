# Dynamic Font Loading to Eliminate Font Swap Layout Shift

## Goal

Eliminate the visible FOUT (Flash of Unstyled Text) on cold PWA launches by replacing the static all-fonts Google Fonts `<link>` with a dynamic injection in the existing FOUC-prevention inline script that loads only the single font family the user has selected.

## Non-goals

- Self-hosting fonts (serving font files from the tasksync server).
- Font subsetting (limiting character sets or glyph ranges).
- Preloading multiple font weights simultaneously (only the family's stylesheet URL is injected; Google Fonts handles weight loading).
- Changing which weights are requested per family (the existing weight sets per family are preserved verbatim from the current all-fonts URL).
- Adding new font families.
- Removing or changing the font selection UI in preferences.
- Service-worker caching of font files (out of scope; fonts are browser-cached by Google Fonts CDN headers).
- Changes to any server-side code.

## Constraints

1. **Offline-first:** The injected `<link>` must use `rel="stylesheet"` with `display=swap` so that text always renders in the fallback font if the network is unavailable. The app shell and task data must remain usable offline regardless of whether the font loads. Font loading must never block app initialization.
2. **Performance budget:** Cold PWA startup must remain under 800 ms TTI (ARCHITECTURE.md). Loading one font family instead of twenty reduces the font stylesheet payload by ~95%, which is an improvement. The preload hint must not introduce new render-blocking resources.
3. **System fonts:** `georgia`, `sf-pro`, and `system` are OS-resident fonts. For these three slugs, the inline script must inject no Google Fonts `<link>` and no preconnect hints. Only the `<link rel="preload" as="style">` and `<link rel="stylesheet">` for Google Fonts are suppressed; the preconnect hints in `+layout.svelte` are removed entirely since they move into the inline script for web-font users.
4. **Whitelist sync:** The font-to-URL mapping in `app.html` must be covered by an updated or new unit test. The existing `fouc-whitelist.test.ts` sync test must continue to pass. Any new mapping structure introduced in `app.html` must have corresponding test coverage verifying it stays in sync with `validFonts` in `preferences.ts`.
5. **No `@ts-nocheck`:** All TypeScript must remain strict-typed (the inline script is plain JavaScript; this constraint applies to any TypeScript files touched).
6. **No silent catch blocks:** The inline script runs at HTML parse time before logging infrastructure is available; its existing outer `try/catch` is intentionally silent. No new silent catches may be added in TypeScript files.
7. **iOS/WKWebView target:** WKWebView aggressively evicts HTTP caches. The fix must make cold loads download only the one selected font family's stylesheet, not all twenty. The `<link rel="preload" as="style">` must be injected before the `<link rel="stylesheet">` to give the font request highest network priority.
8. **display=swap required:** The Google Fonts URL must continue to include `display=swap`. Text must always be visible in a fallback font while the web font loads or if it never loads.
9. **SSR/Capacitor safety:** The inline script extension must remain guarded by the existing `typeof localStorage !== 'undefined'` check. No changes that could throw in Node/SSG build environments.
10. **Default font:** `sora` is the default font (first-time / anonymous users). The injection must work correctly for `sora` on a fresh visit with no localStorage entry (using the hardcoded default).

## Current state

`web/src/routes/+layout.svelte` lines 401–403 contain:
- `<link rel="preconnect" href="https://fonts.googleapis.com" />`
- `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />`
- A single `<link rel="stylesheet">` loading all 20 Google Font families at once with `display=swap`

`web/src/app.html` contains an inline FOUC-prevention script that already reads localStorage, validates the font slug against `validFonts`, and sets `data-ui-font` on `<html>`. It already knows the correct font before first paint. It does not currently inject any `<link>` elements.

The `fouc-whitelist.test.ts` test verifies that the `validThemes` and `validFonts` arrays in `app.html` match those exported from `preferences.ts`. Any new mapping structure (font slug → Google Fonts URL) in `app.html` must also be covered.

## Proposed approach

1. **Extend the inline script in `app.html`**: After reading and validating the font slug (existing code), build the Google Fonts family string from a hardcoded slug-to-family map. For web-font slugs, inject:
   - `<link rel="preconnect" href="https://fonts.googleapis.com" />` (if not already present)
   - `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />`
   - `<link rel="preload" as="style" href="<google-fonts-url>" />`
   - `<link rel="stylesheet" href="<google-fonts-url>" />`

   For system font slugs (`georgia`, `sf-pro`, `system`), skip all four injections.

   For anonymous/first-time users (no localStorage entry), apply the default font (`sora`) using its hardcoded URL.

2. **Remove lines 401–403 from `+layout.svelte`**: The preconnect hints and all-fonts stylesheet are replaced entirely by the inline script injection. No other changes to `+layout.svelte`.

3. **Font-to-URL mapping lives in `app.html` inline script**: The map is a plain JavaScript object literal inside the `<script>` block. It cannot import from `preferences.ts` (not a module context). The mapping is the canonical source for which URL corresponds to each slug.

4. **Update `fouc-whitelist.test.ts`**: Add a test that extracts the font-to-URL mapping from `app.html` and verifies that every slug in `validFonts` (from `preferences.ts`) that is not a system font has a corresponding entry in the map, and that the three system-font slugs do not have entries.

## Design

### Approach

The existing inline FOUC-prevention script in `app.html` already reads the user's font
preference from localStorage, validates it against a hardcoded `validFonts` whitelist, and
sets `data-ui-font` on `<html>`. The design extends this script with two additions: (1) a
`fontUrls` object literal mapping each web-font slug to its complete, single-family Google
Fonts CSS2 URL (including exact weight sets and `display=swap`), and (2) a conditional DOM
injection block that uses this map to append preconnect hints, a preload link, and a
stylesheet link to `document.head` -- but only when the resolved font slug has an entry in
`fontUrls`. System fonts (`georgia`, `sf-pro`, `system`) are absent from the map, so the
lookup returns `undefined` and the injection block is skipped entirely.

The static all-fonts `<link rel="stylesheet">` and its two preconnect `<link>` elements in
`+layout.svelte` (lines 401--403) are deleted. This removes the ~20-family CSS payload
from every cold page load. The `<svelte:head>` block retains all other existing `<link>`
and `<meta>` elements (favicon, manifest, apple-touch-icon, etc.) unchanged.

The font resolution has three branches: (a) scoped localStorage entry found and slug is
valid -- use it; (b) no localStorage entry found -- fall through to the default slug
`sora`; (c) localStorage entry found but slug is invalid -- fall through to `sora`. In all
three cases, the resolved slug feeds into the `fontUrls` lookup. The default is `sora`,
matching `defaultPreferences()` in `preferences.ts`.

### Component changes

- **`web/src/app.html`**: Extend the inline `<script>` block. After the existing
  `data-ui-font` attribute is set, add a `fontUrls` object literal (20 entries, one per
  web-font slug) and a conditional injection block. The injection block runs only when
  `fontUrls[fontSlug]` is truthy. It creates and appends four elements to
  `document.head` in this order:
  1. `<link rel="preconnect" href="https://fonts.googleapis.com" />`
  2. `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />`
  3. `<link rel="preload" as="style" href="<url>" />`
  4. `<link rel="stylesheet" href="<url>" />`

  The `fontSlug` variable must be derived from the validated font value or from the
  hardcoded default (`'sora'`). Specifically: when no localStorage entry exists or the
  parsed font value fails validation, the script must still set `fontSlug = 'sora'` and
  perform the `fontUrls` lookup for it.

  Structure of the `fontUrls` map (plain JS object literal, not JSON):

  ```javascript
  var fontUrls = {
    'sora': 'https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&display=swap',
    'sono': 'https://fonts.googleapis.com/css2?family=Sono:wght@400;500;600;700;800&display=swap',
    'inter': 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
    'inter-tight': 'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&display=swap',
    'jetbrains-mono': 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap',
    'atkinson-hyperlegible': 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap',
    'atkinson-hyperlegible-next': 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@400;700&display=swap',
    'ibm-plex-sans': 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap',
    'ibm-plex-mono': 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap',
    'ibm-plex-serif': 'https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@400;600;700&display=swap',
    'roboto': 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700&display=swap',
    'roboto-slab': 'https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@400;500;600;700&display=swap',
    'roboto-mono': 'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;600;700&display=swap',
    'dm-mono': 'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap',
    'comfortaa': 'https://fonts.googleapis.com/css2?family=Comfortaa:wght@400;500;600;700&display=swap',
    'poppins': 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap',
    'victor-mono': 'https://fonts.googleapis.com/css2?family=Victor+Mono:wght@400;500;600;700&display=swap',
    'pt-sans': 'https://fonts.googleapis.com/css2?family=PT+Sans:wght@400;700&display=swap',
    'pt-serif': 'https://fonts.googleapis.com/css2?family=PT+Serif:wght@400;700&display=swap',
    'pt-mono': 'https://fonts.googleapis.com/css2?family=PT+Mono&display=swap'
  };
  ```

  Key details on the map:
  - Every URL uses the CSS2 API (`/css2?family=...`) with `display=swap` appended.
  - Family names use `+` for spaces (URL encoding for the `family` query parameter).
  - Weight sets are verbatim from the existing all-fonts URL on line 403 of
    `+layout.svelte`. `PT+Mono` has no `:wght@...` suffix because the original URL
    specifies no weight range (Google Fonts serves its single available weight by default).
  - `georgia`, `sf-pro`, and `system` are intentionally absent.

  The injection block pseudocode:

  ```javascript
  var fontSlug = /* resolved slug or 'sora' default */;
  var url = fontUrls[fontSlug];
  if (url) {
    var pc1 = document.createElement('link');
    pc1.rel = 'preconnect';
    pc1.href = 'https://fonts.googleapis.com';
    document.head.appendChild(pc1);
    var pc2 = document.createElement('link');
    pc2.rel = 'preconnect';
    pc2.href = 'https://fonts.gstatic.com';
    pc2.crossOrigin = 'anonymous';
    document.head.appendChild(pc2);
    var pl = document.createElement('link');
    pl.rel = 'preload';
    pl.as = 'style';
    pl.href = url;
    document.head.appendChild(pl);
    var sl = document.createElement('link');
    sl.rel = 'stylesheet';
    sl.href = url;
    document.head.appendChild(sl);
  }
  ```

  All of this lives inside the existing `try { if (typeof localStorage !== 'undefined') { ... } } catch(e) {}` block. No new outer try/catch is added.

- **`web/src/routes/+layout.svelte`**: Delete lines 401--403 (the two `<link
  rel="preconnect">` elements and the single `<link rel="stylesheet">` for all Google
  Fonts). No other lines in this file change. The `<style>` block with font-family CSS
  variable mappings (lines 567--590) is unaffected -- those CSS rules still reference the
  font names and work correctly once the corresponding Google Fonts stylesheet is loaded
  by the inline script.

- **`web/src/lib/stores/fouc-whitelist.test.ts`**: Add new test cases within the existing
  `describe('FOUC whitelist sync', ...)` block. The new tests parse `app.html` as text
  to extract the `fontUrls` map and validate it against `validFonts` from
  `preferences.ts`. No JSDOM or browser simulation needed -- pure text parsing
  suffices, matching the existing pattern.

### Data model changes

None. No IndexedDB, localStorage schema, server database, or sync protocol changes.

### API changes

None. No new endpoints, no changed signatures, no server-side changes.

### Font slug resolution logic

The inline script's font resolution must produce a `fontSlug` variable that feeds the
`fontUrls` lookup. The current script structure sets `data-ui-font` only when a valid
font is found in localStorage. For the URL injection, the script must additionally
track the resolved font slug so the `fontUrls` lookup can use it. The design:

1. Initialize `var fontSlug = 'sora';` (the default) at the top of the localStorage
   block, before the preference-reading loop.
2. When a valid font is read from localStorage and the `data-ui-font` attribute is set,
   also assign `fontSlug = prefs.font;`.
3. After the preference-reading block, perform the `fontUrls[fontSlug]` lookup and
   conditional injection. This covers all three branches: valid preference found
   (uses it), no preference found (uses `sora`), invalid preference (uses `sora`).

### Test strategy refinement

The existing `extractInlineArray` helper in `fouc-whitelist.test.ts` extracts array
literals by regex. The new tests need a similar helper to extract the `fontUrls` object
literal from `app.html`.

**New helper: `extractInlineObjectMap`**. Given the HTML string and variable name
`fontUrls`, it matches the `var fontUrls = { ... };` block using a regex that captures
the content between `{` and `}`. Within that content, it extracts key-value pairs by
matching `'<key>': '<value>'` patterns. Returns a `Record<string, string>`.

**New tests (3 total):**

1. **Font-to-URL map covers all web-font slugs**: Extract `fontUrls` from `app.html`.
   Filter `validFonts` (from `preferences.ts`) to exclude `georgia`, `sf-pro`, `system`.
   Assert `Object.keys(fontUrls)` matches the filtered set exactly (same elements, any
   order). This catches both missing entries and stale/extra entries.

2. **System-font slugs are absent from the map**: Assert that `fontUrls['georgia']`,
   `fontUrls['sf-pro']`, and `fontUrls['system']` are all `undefined`.

3. **Every URL contains `display=swap`**: Iterate all values in the extracted `fontUrls`
   map and assert each URL string includes `display=swap`.

The existing two tests (theme whitelist sync, font whitelist sync) continue to pass
without modification because the `validFonts` and `validThemes` arrays in `app.html`
remain unchanged.

### Alternatives considered

**Alternative: Move the font-to-URL mapping to `preferences.ts` and expose it as an export.** This would allow the test to import the map directly rather than parsing `app.html`. However, `preferences.ts` is a TypeScript module that runs after hydration; the inline script cannot import from it. The map would need to be duplicated anyway (once in `preferences.ts`, once as a literal in the inline script), worsening the drift risk. Keeping the map in `app.html` with a test that validates it against `preferences.ts` is the lower-risk approach.

**Alternative: Use a Service Worker to intercept and cache font requests.** This would solve the cold-load problem on subsequent offline visits but does not help the very first cold load. It also adds significant complexity to the service worker. The simpler inline-script approach directly reduces payload on cold load and is sufficient.

**Alternative: Use `<link rel="preload" as="font" type="font/woff2" crossorigin>` for specific font files.** This requires knowing the exact WOFF2 URLs from Google Fonts, which are not stable and change with font version updates. Preloading the stylesheet URL (as `as="style"`) is the correct and stable approach.

**Alternative: Store only the family query fragment (e.g., `Sora:wght@400;500;600;700;800`) in the map and construct the full URL at runtime.** This would reduce the map's byte size by ~40% since the base URL and `display=swap` suffix would be shared. Rejected because (a) the savings are negligible (~800 bytes of inline HTML), (b) full URLs are easier to validate in tests and visually audit in code review, and (c) URL construction with string concatenation in the inline script adds an extra failure surface for zero practical benefit.

**Alternative: Inject only the `<link rel="stylesheet">` without the preload hint.** This would simplify the injection to three elements instead of four. Rejected because the preload hint (`as="style"`) gives the browser the earliest possible signal to start fetching the CSS, which is especially important on iOS/WKWebView where the HTTP cache is aggressively evicted. The four-element injection is the standard Google Fonts optimization pattern.

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| Font-to-URL map in `app.html` drifts from `validFonts` in `preferences.ts` when new fonts are added | A unit test in `fouc-whitelist.test.ts` asserts that every non-system slug in `validFonts` has a map entry, and that no unknown slugs appear in the map. Test fails immediately on drift. |
| The `<link rel="preload" as="style">` injection changes browser resource prioritization in unexpected ways | The preload hint only elevates network priority for a resource the page was going to fetch anyway. Removing it would cause a regression to prior behavior; it cannot make things worse than the old all-fonts link. |
| Anonymous/first-time users (no localStorage) see `sora` loaded even if they later choose a different font | This is acceptable: `sora` is the design-time default. On next load after they save a preference, the correct font loads. This matches current behavior. |
| Injecting `<link>` elements via `document.createElement` in the inline script may behave differently across browsers on the first parse | Standard DOM API available in all target browsers. WKWebView (iOS 16+), Chrome, Firefox, and Safari all support synchronous `document.head.appendChild` of `<link>` elements in inline scripts. |
| Removing the preconnect hints from `+layout.svelte` for system-font users has no negative effect but could cause a regression if the script fails to run | The inline script's outer `try/catch` is the only failure mode. If the script throws, no `<link>` is injected and no preconnect is set — the font simply does not load on that page load, and the fallback font is shown. This is the same degraded behavior as today when the network is unavailable. |
| The inline script now does more work (building URLs, creating DOM elements) than before | The additional work is O(1): one object lookup, two string concatenations, four `createElement`/`appendChild` calls. Expected additional runtime: sub-1 ms. No impact on the 800 ms TTI budget. |
| Inline script size growth from the 20-entry `fontUrls` map (~2 KB of object literal) could affect HTML parse time | 2 KB of JavaScript object literal adds negligible parse time (well under 1 ms). The all-fonts CSS URL being removed from `+layout.svelte` is itself ~900 bytes, so the net inline increase is ~1.1 KB. This is dwarfed by the ~95% reduction in font CSS payload fetched over the network. |
| The `fontUrls` variable name could collide with SvelteKit-injected or user-created global variables | The variable is declared with `var` inside the existing FOUC `try` block, scoping it to that block's execution context. The name `fontUrls` is sufficiently specific. No collision risk with SvelteKit internals (which use `__sveltekit_*` prefixes) or with the existing `window.__TASKSYNC_RUNTIME_CONFIG__`. |

### Performance impact

This change is strictly positive for the 800 ms cold PWA startup TTI budget:

- **Network payload reduction**: The current all-fonts `<link rel="stylesheet">` fetches a
  CSS response containing `@font-face` declarations for 20 families (~15--25 KB depending
  on user-agent negotiation). The new single-family URL fetches declarations for one family
  only (~0.5--1.5 KB). This is a ~90--95% reduction in CSS bytes.
- **Font file downloads**: The browser previously received `@font-face` rules for all 20
  families and could speculatively initiate connections for fonts referenced in CSS
  selectors matching the page. With single-family loading, only the active font's WOFF2
  files are downloaded.
- **Inline script cost**: The `fontUrls` map adds ~2 KB to the HTML document. The
  `createElement`/`appendChild` calls add sub-1 ms of synchronous JS execution. Both are
  negligible compared to the network savings.
- **No new render-blocking resources**: The `<link rel="preload" as="style">` is a
  non-render-blocking fetch hint. The `<link rel="stylesheet">` is render-blocking but
  fetches a much smaller payload than before.

No other performance budgets in `docs/RELIABILITY.md` are affected (interaction latency,
completion sound onset, search performance, sync ack time).

## Acceptance criteria

- [ ] The static all-fonts `<link rel="stylesheet">` is removed from `+layout.svelte` (line 403). After this change, no Google Fonts stylesheet is loaded statically; all font loading is dynamic.
- [ ] The two `<link rel="preconnect">` hints for `fonts.googleapis.com` and `fonts.gstatic.com` are removed from `+layout.svelte` (lines 401–402). They move into the inline script and are only injected for web-font users.
- [ ] On a cold load where the user's saved font is a Google Fonts slug (e.g., `inter`), the inline script injects exactly one `<link rel="preload" as="style">` and one `<link rel="stylesheet">` pointing to the correct Google Fonts URL for that family only.
- [ ] On a cold load where the user's saved font is `georgia`, `sf-pro`, or `system`, the inline script injects no Google Fonts `<link>` elements and no preconnect hints.
- [ ] On a fresh/anonymous visit (no localStorage preferences), the inline script loads the default font (`sora`) using its correct Google Fonts URL. No font-not-found or broken-stylesheet condition occurs.
- [ ] The Google Fonts URL injected for each family includes `display=swap`. Text is always visible in a fallback font while the web font loads or if it fails to load.
- [ ] The Google Fonts URL for each slug uses the same family name and weight set that was present in the original all-fonts URL (no weights are dropped or added compared to the prior implementation).
- [ ] All 20 Google Fonts slugs from `validFonts` have a corresponding entry in the font-to-URL map inside `app.html`.
- [ ] A unit test in `fouc-whitelist.test.ts` (or a new adjacent test file) verifies that every non-system-font slug in `validFonts` from `preferences.ts` has an entry in the `app.html` font-to-URL map, and that the three system-font slugs (`georgia`, `sf-pro`, `system`) do not have entries.
- [ ] The existing `fouc-whitelist.test.ts` tests (theme whitelist sync and font whitelist sync) continue to pass without modification.
- [ ] `npm run lint` passes with no new errors.
- [ ] `npm run check` passes with no new type errors.
- [ ] `npm run test` passes with no regressions (all existing and new unit tests pass).
- [ ] `npm run test:e2e:smoke` passes with no regressions.

## Test plan

| What | How | Where |
|------|-----|-------|
| Font-to-URL map completeness | Parse `app.html` as text; extract the map object; assert every non-system slug from `validFonts` has an entry; assert the three system-font slugs do not. | `fouc-whitelist.test.ts` (extend existing file) |
| System-font slug produces no injection | Parse `app.html` inline script logic; trace the branch for `georgia`/`sf-pro`/`system`; assert no `createElement('link')` path is reachable. | Unit test (code-path analysis or DOM simulation with `jsdom`) |
| Web-font slug produces correct URL | For a representative sample of slugs (e.g., `sora`, `inter`, `jetbrains-mono`, `pt-mono`), assert the constructed URL contains the correct family string and `display=swap`. | Unit test (extract URL-builder logic or test against map entries) |
| Whitelist sync (existing) | `validThemes` and `validFonts` in `app.html` match `preferences.ts` exports. | Existing tests in `fouc-whitelist.test.ts` — must continue to pass |
| No regression on all quality gates | Run `npm run lint`, `npm run check`, `npm run test`, `npm run test:e2e:smoke`. | CI and pre-push hook |

## Rollout / migration plan

No data migration required. The change is purely in the HTML shell and SvelteKit layout:

1. Remove lines 401–403 from `+layout.svelte`.
2. Extend the inline script in `app.html`.
3. Update `fouc-whitelist.test.ts`.
4. Run all quality gates locally before push.

No server changes. No IDB schema changes. No sync protocol changes. No feature flags needed — the change is atomic and fully backward-compatible (the fallback behavior when the script fails is identical to the prior degraded state).

## Tasks

### T1: Extend app.html inline script with fontUrls map and DOM injection; remove static links from +layout.svelte

**Files:** `web/src/app.html`, `web/src/routes/+layout.svelte`

1. In the inline FOUC-prevention script in `app.html`, add `var fontSlug = 'sora';` at the top of the `if (typeof localStorage !== 'undefined')` block, before the preference-reading loop.
2. After the existing `data-ui-font` attribute is set (line 43), also assign `fontSlug = prefs.font;`.
3. After the preference-reading block (after the `if (raw !== null)` block closes), add the `fontUrls` object literal with 20 entries (one per web-font slug, no entries for `georgia`, `sf-pro`, `system`). Weight sets must match those in the existing all-fonts URL verbatim.
4. Add the conditional injection block: if `fontUrls[fontSlug]` is truthy, create and append four `<link>` elements to `document.head` in order: preconnect to `fonts.googleapis.com`, preconnect to `fonts.gstatic.com` (with `crossOrigin = 'anonymous'`), preload (`as="style"`), and stylesheet.
5. Delete lines 401-403 from `+layout.svelte` (two preconnect links and the all-fonts stylesheet link).

**Done when:** The inline script contains the fontUrls map with exactly 20 entries. The conditional injection block works for web-font slugs and skips system fonts. fontSlug defaults to `sora`. The three static font links are removed from `+layout.svelte`. `npm run lint`, `npm run check` pass.

### T2: Add fontUrls sync tests to fouc-whitelist.test.ts

**Files:** `web/src/lib/stores/fouc-whitelist.test.ts`

1. Add an `extractInlineObjectMap` helper function that parses `var fontUrls = { ... };` from `app.html` and returns a `Record<string, string>` of key-value pairs.
2. Add test: "font-to-URL map covers all web-font slugs" -- extract fontUrls from app.html, filter validFonts to exclude `georgia`, `sf-pro`, `system`, assert the keys match exactly.
3. Add test: "system-font slugs are absent from the map" -- assert `georgia`, `sf-pro`, `system` are all undefined in the extracted map.
4. Add test: "every font URL contains display=swap" -- iterate all values and assert each includes `display=swap`.

**Done when:** Three new passing tests exist. The `extractInlineObjectMap` helper correctly parses the fontUrls map. All existing tests continue to pass. `npm run test` passes with no regressions.

## Progress log

- 2026-05-08: Discovery complete. Exec plan written. Requirements defined from user request, codebase inspection of `app.html`, `+layout.svelte` lines 401–403, `preferences.ts` `validFonts`, and `fouc-whitelist.test.ts`. Conflict check: no overlap with active exec plans (the referenced `2026-05-08-polish-fouc-skip-drag.md` plan is complete; this feature builds directly on its delivered FOUC inline script). No contradiction with ARCHITECTURE.md or RELIABILITY.md.
- 2026-05-08: Design complete. PE validated PM's proposed approach, specified the exact `fontUrls` object literal with all 20 slug-to-URL mappings (weight sets extracted verbatim from the existing all-fonts URL), defined the DOM injection sequence (preconnect, preload, stylesheet), specified font slug resolution logic with `sora` default fallback, detailed the `extractInlineObjectMap` test helper and 3 new unit tests, added 2 additional alternatives considered and 2 additional risks. Confirmed no data model, API, or architecture changes. Performance impact is strictly positive.

## Decision log

- 2026-05-08: Font-to-URL map lives entirely in `app.html` inline script (not in `preferences.ts`) because the inline script is not a module and cannot import TypeScript exports. Drift is mitigated by a unit test that parses `app.html` and cross-checks against `validFonts`. This is the same pattern used for `validThemes` and `validFonts` whitelists today.
- 2026-05-08: `<link rel="preload" as="style">` is included before the stylesheet link to give the font request highest network priority. This is the standard pattern for eliminating render-blocking font loads and is especially important on iOS/WKWebView with aggressive cache eviction.
- 2026-05-08: System fonts (`georgia`, `sf-pro`, `system`) produce zero Google Fonts DOM injections. Preconnect hints are also suppressed for these users since there is no Google Fonts request to warm up.
- 2026-05-08: Default font for anonymous users is `sora` (matching the `defaultPreferences()` value in `preferences.ts`). This is hardcoded in the inline script alongside the map so first-time users get the correct font without a localStorage entry.
