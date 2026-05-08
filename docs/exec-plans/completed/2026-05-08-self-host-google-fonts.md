# Self-host Google Fonts as Local Static Assets

## Goal

Replace all Google Fonts CDN URLs in the inline FOUC-prevention script with locally self-hosted woff2 font files served from `web/static/fonts/`, eliminating the external network dependency for fonts, aligning with the project's offline-first principle, and resolving WebKit/WKWebView's aggressive third-party cache eviction that causes perceptible FOUT on iOS PWA cold launches.

## Non-goals

- Adding new font families (20 Google Fonts + 3 system fonts remain unchanged).
- Removing or changing the font selection UI in preferences.
- Subsetting fonts to specific unicode ranges beyond latin (subsetting to latin-only is evaluated in the size analysis below and left to the engineer's discretion as an optimization).
- Adding server-side font serving (fonts are static assets served by the SvelteKit static adapter or any CDN fronting it; no server changes).
- Changing which weights are loaded per family (the exact weight sets from the prior dynamic-font-loading plan are preserved verbatim).
- Changes to the `validFonts` or `validThemes` arrays or to preferences sync logic.
- Modifying the service worker beyond what is needed for font caching (the service worker already caches same-origin static assets; self-hosted fonts will be cached automatically).
- Font formats other than woff2 (all target browsers — Chrome, Firefox, Safari 12+, iOS WebKit — support woff2).

## Constraints

1. **Offline-first (non-negotiable):** After a single successful page load, all fonts must be available offline. Self-hosted fonts served from the same origin are cached by the service worker's static asset cache and are not subject to third-party cache eviction. This is the primary reliability invariant this feature satisfies.
2. **No render-blocking regression:** Font loading must not introduce a new render-blocking resource that raises TTI above 800 ms on cold PWA startup. The inline script injection pattern from the predecessor plan must be preserved.
3. **System fonts unchanged:** `georgia`, `sf-pro`, and `system` use OS-resident fonts. The inline script must continue to inject nothing for these three slugs.
4. **Whitelist sync:** The `fouc-whitelist.test.ts` unit tests that assert the `fontUrls` map in `app.html` covers all non-system fonts must be updated to reflect the new local path structure and must pass.
5. **No `@ts-nocheck`:** All TypeScript files touched must remain strictly typed. The inline script in `app.html` is plain JavaScript and is exempt, but no new TypeScript files may use `@ts-nocheck`.
6. **No silent catch blocks:** The inline script's outer `try/catch` is intentionally silent (logging infrastructure unavailable at HTML parse time). No new silent catches may be added in any TypeScript files touched.
7. **SSR/Capacitor safety:** All inline script changes must remain guarded by the existing `typeof localStorage !== 'undefined'` check.
8. **Wire format validation:** No new localStorage, IDB, or server response reads are introduced by this change. This constraint is satisfied automatically.
9. **Quality gates:** All of `npm run lint`, `npm run check`, `npm run test`, and `npm run test:e2e:smoke` must pass.

## Current state

The inline FOUC-prevention script in `web/src/app.html` (lines 48–89) contains:
- A `fontUrls` map object (20 entries) mapping each Google Font slug to its complete `fonts.googleapis.com/css2?...&display=swap` URL.
- A conditional injection block that, for web-font slugs, appends to `document.head`: two preconnect hints (`fonts.googleapis.com`, `fonts.gstatic.com`), a `<link rel="preload" as="style">`, and a `<link rel="stylesheet">`.
- For system fonts (`georgia`, `sf-pro`, `system`), no injection occurs.

The `fouc-whitelist.test.ts` file (at `web/src/lib/stores/fouc-whitelist.test.ts`) already contains:
- An `extractInlineObjectMap` helper that parses the `fontUrls` object from `app.html`.
- Three tests asserting: the map covers all 20 web-font slugs, system fonts are absent, and every URL contains `display=swap`.

The `+layout.svelte` CSS block (lines 564–587) maps each font slug to a `--ui-font` CSS variable with the correct font-family name string. These declarations reference font family names (e.g., `'Sora'`, `'Inter Tight'`) and require no changes — they work correctly as long as the corresponding `@font-face` declarations are loaded before font rendering begins.

## Size analysis

Estimated woff2 file count and sizes for all 20 font families (latin subset only, per-weight static files — not variable fonts):

| Family | Weights | Est. files | Est. size per file | Est. total |
|--------|---------|-----------|-------------------|-----------|
| Sora | 400, 500, 600, 700, 800 | 5 | ~20–25 KB | ~110 KB |
| Sono | 400, 500, 600, 700, 800 | 5 | ~20–25 KB | ~110 KB |
| Inter | 400, 500, 600, 700, 800 | 5 | ~25–30 KB | ~135 KB |
| Inter Tight | 400, 500, 600, 700, 800 | 5 | ~20–25 KB | ~110 KB |
| JetBrains Mono | 400, 500, 600, 700 | 4 | ~30–40 KB | ~140 KB |
| Atkinson Hyperlegible | 400, 700 | 2 | ~25–30 KB | ~55 KB |
| Atkinson Hyperlegible Next | 400, 700 | 2 | ~30–40 KB | ~70 KB |
| IBM Plex Sans | 400, 500, 600, 700 | 4 | ~20–25 KB | ~90 KB |
| IBM Plex Mono | 400, 500, 600, 700 | 4 | ~25–30 KB | ~110 KB |
| IBM Plex Serif | 400, 600, 700 | 3 | ~25–30 KB | ~80 KB |
| Roboto | 400, 500, 600, 700 | 4 | ~20–25 KB | ~90 KB |
| Roboto Slab | 400, 500, 600, 700 | 4 | ~20–25 KB | ~90 KB |
| Roboto Mono | 400, 500, 600, 700 | 4 | ~25–30 KB | ~110 KB |
| DM Mono | 400, 500 | 2 | ~25–30 KB | ~55 KB |
| Comfortaa | 400, 500, 600, 700 | 4 | ~30–35 KB | ~130 KB |
| Poppins | 400, 500, 600, 700 | 4 | ~25–30 KB | ~110 KB |
| Victor Mono | 400, 500, 600, 700 | 4 | ~30–35 KB | ~130 KB |
| PT Sans | 400, 700 | 2 | ~20–25 KB | ~45 KB |
| PT Serif | 400, 700 | 2 | ~20–25 KB | ~45 KB |
| PT Mono | 400 | 1 | ~30 KB | ~30 KB |
| **Totals** | | **~76 files** | | **~1.8–2.2 MB** |

**Key observations:**
- Total repo size increase: approximately **1.8–2.2 MB** of binary woff2 assets. This is acceptable for a repository that already includes PWA assets, streak media, and other static content.
- Per-user download cost is unchanged from the CDN baseline: only the one selected font family loads per session. A user choosing Inter downloads ~135 KB of woff2 files — identical in size to what Google Fonts CDN would serve.
- Variable fonts (single file covering all weights via `font-variation-settings`) are available for Inter, Roboto, and a few others. Where a variable font is available and its file size is smaller than the sum of static per-weight files, the engineer should prefer it. The per-family CSS and `@font-face` declarations are isolated so the choice can be made per family without global impact.
- Latin-only subsetting (e.g., using `pyftsubset` or Google's `text=` API locally) would reduce individual file sizes by 30–60% for fonts with large unicode coverage (IBM Plex, Roboto). The actual downloaded files from Google Fonts CDN already apply unicode-range subsetting — the engineer must use the same unicode-range-subsetted woff2 files (available from the Google Fonts download API or from the `fontsource` npm package) rather than the full-unicode files from the font authors' GitHub repositories.

**Recommended source for woff2 files:** Download via Google Fonts `download` API or the `@fontsource` npm package family, both of which provide pre-subsetted latin woff2 files with correct unicode-range metadata. The engineer should document the exact source in the decision log.

## font-display evaluation

**Options:**
- `font-display: swap` — text renders immediately in fallback font; web font swaps in when loaded. The current CDN behavior. Causes FOUT because network round-trip introduces a visible delay between fallback and web font.
- `font-display: block` — text is invisible for up to 3 seconds while the font loads; then shows either the web font or fallback. Eliminates FOUT but risks invisible text if the font fails to load (e.g., missing file, first uncached load on slow connection).
- `font-display: optional` — browser uses the font only if it loads within a very short timeout (~100 ms); otherwise uses fallback permanently for that page load. Eliminates layout shift entirely but means the web font may never display on a cold load.
- `font-display: fallback` — a short block period (~100 ms), then uses the font if it loads within 3 seconds, otherwise commits to fallback. A middle ground between `swap` and `block`.

**Recommendation: `font-display: swap` for now, with a path to `block` after service worker caching is verified.**

Rationale:
- Self-hosted fonts load from the same origin but are not guaranteed to be in the service worker cache on the very first page load. On a first visit, the browser must fetch the woff2 file over the network, which adds latency. `swap` ensures text is always visible.
- On subsequent visits (after the service worker has cached the font files), the woff2 files load from disk cache in sub-millisecond time. At that point, `font-display: block` would produce no observable invisible-text period and would fully eliminate FOUT.
- Changing `swap` to `block` later requires only a one-line change to each `@font-face` rule. This makes it a low-risk deferred optimization rather than a required part of this plan.
- `font-display: optional` is rejected because it may silently skip loading the web font entirely on slow connections, making the user's font preference appear not to work.
- `font-display: fallback` is a reasonable alternative but adds complexity without clear benefit over `swap` + a future `block` upgrade.

**This plan uses `font-display: swap`.** The decision log must record this choice and the path to `block` as a named follow-up.

## Proposed approach

### Architecture decision: per-font CSS file approach

The inline script currently injects a `<link rel="stylesheet">` pointing to a Google Fonts CDN URL. For local fonts, the equivalent is a per-family CSS file at `/fonts/<slug>/font.css` containing the `@font-face` declarations for that family. The inline script injects `<link rel="stylesheet" href="/fonts/sora/font.css">` instead of the Google CDN URL.

This approach is preferred over alternatives because:
- It is the closest structural replacement for the CDN approach (same injection point, same `<link rel="stylesheet">` mechanism).
- It allows the `@font-face` CSS to live in plain, human-readable files that can be reviewed, diffed, and audited separately from the JavaScript.
- It keeps the inline script simple — only the URL changes, not the injection logic.
- Each family's CSS is independently maintainable and can include unicode-range subsetting exactly as Google Fonts serves it.

### File structure

```
web/static/fonts/
  sora/
    font.css                     <- @font-face declarations for Sora
    Sora-Regular.woff2
    Sora-Medium.woff2
    Sora-SemiBold.woff2
    Sora-Bold.woff2
    Sora-ExtraBold.woff2
  sono/
    font.css
    Sono-Regular.woff2
    ...
  inter/
    font.css
    Inter-Regular.woff2
    ...
  [one subdirectory per font slug]
```

`@font-face` rules in each `font.css` use relative paths (e.g., `src: url('./Sora-Regular.woff2') format('woff2')`), so the CSS and woff2 files are co-located.

### Changes to app.html

The `fontUrls` map is replaced with a `fontCssPaths` map (or the same variable name `fontUrls` is retained and the values changed to local paths — the engineer chooses; the test must be updated to match). Each entry maps a font slug to its local CSS path: `'/fonts/sora/font.css'`, `'/fonts/inter/font.css'`, etc.

The preconnect hint injections for `fonts.googleapis.com` and `fonts.gstatic.com` are removed. The preload and stylesheet link injections remain, pointing to the local CSS path.

The injection block becomes:
```javascript
// For web-font slugs: inject preload + stylesheet for local font CSS.
// For system fonts: no injection (unchanged behavior).
var localFontPath = fontCssPaths[fontSlug];
if (localFontPath) {
  var pl = document.createElement('link');
  pl.rel = 'preload';
  pl.as = 'style';
  pl.href = localFontPath;
  document.head.appendChild(pl);
  var sl = document.createElement('link');
  sl.rel = 'stylesheet';
  sl.href = localFontPath;
  document.head.appendChild(sl);
}
```

### Changes to fouc-whitelist.test.ts

The three existing `fontUrls` tests must be updated:
- The "covers all web-font slugs" test remains structurally identical but tests against the new map variable name (if renamed).
- The "system-font slugs are absent" test is unchanged in intent.
- The "every font URL contains display=swap" test must change: local CSS paths do not contain `display=swap`. This test should be replaced with one that verifies each path starts with `/fonts/` and ends with `/font.css` (or another deterministic structure). The `display=swap` check moves to a test that reads each `font.css` file and asserts the `@font-face` rule contains `font-display: swap`.

## Alternatives considered

**Alternative: Inline `@font-face` CSS in a `<style>` tag injected by the inline script.** This would avoid the extra HTTP request for `font.css` since the `@font-face` rules would be embedded in the HTML. Rejected because: (a) it would bloat the HTML document with ~300–500 bytes of CSS per font family's `@font-face` block, embedded in the inline script as a JavaScript string; (b) the woff2 paths would still be external HTTP requests so there is no net reduction in requests; (c) CSS in a `<style>` tag injected by JavaScript is less cacheable than a standalone `.css` file; (d) it makes the `@font-face` rules harder to audit and maintain.

**Alternative: A single combined `fonts.css` containing `@font-face` rules for all 20 families.** Rejected because: only one family loads per user session; loading all 20 families' CSS would add ~5–10 KB of CSS payload per page load compared to the per-family approach's ~1–2 KB. It also defeats the lazy-load benefit of the per-family CDN architecture the predecessor plan established.

**Alternative: Use the `@fontsource` npm package and import font CSS in the SvelteKit layout.** Rejected because: this would statically include all 20 families' CSS in the bundle or require code-splitting per font, adding significant build complexity. It would also move font loading out of the inline FOUC-prevention script, causing FOUT on cold loads before the SvelteKit bundle executes. The inline script injection pattern is the correct architectural approach for FOUC prevention.

**Alternative: `font-display: block` from the start.** Evaluated above and deferred. The risk of invisible text on a user's first visit (before service worker caches the font) outweighs the FOUT elimination benefit. The path to `block` after caching is verified remains open.

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| woff2 files downloaded from wrong source include full unicode coverage (large files) instead of latin-subsetted files | Use `@fontsource` or Google Fonts download API which serve pre-subsetted latin files. Document source in decision log. Assert total per-family file size in a comment in `font.css` so reviewers can verify. |
| A font family's woff2 files are missing or named incorrectly, causing invisible or fallback-only text | `font-display: swap` ensures text always renders in the fallback. The missing woff2 would cause a 404 logged in the browser console, providing a clear signal during QA. The per-family `font.css` test (reading the CSS file) will catch path mismatches at unit test time. |
| The `fontCssPaths` map in `app.html` drifts from `validFonts` in `preferences.ts` when new fonts are added | Unit test in `fouc-whitelist.test.ts` asserts every non-system slug has a map entry. Fails immediately on drift. |
| Repo size grows significantly | Estimated 1.8–2.2 MB. Acceptable. Document actual size after download in the progress log. |
| Variable font files for some families (e.g., Inter) are larger than the sum of required static weights | Compare variable vs static file sizes during download. Prefer whichever is smaller. Document the choice per-family in the decision log. |
| Service worker cache miss on first visit means font still loads from disk but with one extra same-origin HTTP request (vs. CDN) | `font-display: swap` prevents invisible text. The latency of a local HTTP request from the same origin is far lower than a CDN round-trip. Not a regression. |
| WebKit preload hint for `as="style"` behaves differently for local CSS files vs CDN | Standard behavior; preload for stylesheets is well-supported in WebKit 12+. No known issues. |
| Removing the preconnect hints for Google Fonts domains causes a visible difference for users mid-transition (cached CDN URL still in browser cache) | The old CDN URLs are replaced in `app.html`; any browser with a stale `app.html` will still use the CDN. First load of the new `app.html` replaces CDN loading with local loading. No partial-state risk. |

## Acceptance criteria

- [x] All 20 Google Font families have woff2 files placed in `web/static/fonts/<slug>/` with a corresponding `font.css` containing `@font-face` declarations.
- [x] Every `@font-face` rule in every `font.css` uses a local relative path (e.g., `url('./FontName-Regular.woff2')`) and does not reference `fonts.gstatic.com` or any external domain.
- [x] Every `@font-face` rule in every `font.css` uses `font-display: swap`.
- [x] The `fontUrls` (or renamed `fontCssPaths`) map in `app.html` maps all 20 web-font slugs to their local `/fonts/<slug>/font.css` paths. No Google CDN URLs remain in the map.
- [x] The preconnect hints to `fonts.googleapis.com` and `fonts.gstatic.com` are removed from the inline script injection block.
- [x] On a cold load with a web-font slug selected (e.g., `inter`), the inline script injects exactly one `<link rel="preload" as="style">` and one `<link rel="stylesheet">` pointing to the local `/fonts/inter/font.css`. No external font requests are made.
- [x] On a cold load with a system font selected (`georgia`, `sf-pro`, or `system`), the inline script injects no font links and no preconnect hints (unchanged behavior).
- [x] On a fresh/anonymous visit (no localStorage), the default font (`sora`) loads from its local path correctly.
- [x] No network requests to `fonts.googleapis.com` or `fonts.gstatic.com` occur at any point in the page lifecycle (verifiable via browser DevTools network panel and/or a Playwright network intercept test).
- [x] Fonts load and render correctly when the app is used fully offline after an initial page load (service worker has cached `/fonts/<slug>/font.css` and woff2 files).
- [x] The font selection UI in preferences continues to work — switching fonts updates `data-ui-font` and the correct font family renders on reload.
- [x] The `fouc-whitelist.test.ts` tests are updated: the "every font URL contains display=swap" test is replaced or extended to verify local font path structure, and a new test verifies that each `font.css` file exists and contains `font-display: swap`.
- [x] All updated and new unit tests in `fouc-whitelist.test.ts` pass.
- [x] The total added static asset size (woff2 files + font.css files) is documented in the progress log with the actual measured value.
- [x] `npm run lint` passes with no new errors.
- [x] `npm run check` passes with no new type errors.
- [x] `npm run test` passes with no regressions (all existing and new unit tests pass).
- [x] `npm run test:e2e:smoke` passes with no regressions.

## Design

### Approach

The design replaces every Google Fonts CDN URL in `app.html` with a local path
pointing to a per-family CSS file under `web/static/fonts/<slug>/font.css`. Each
`font.css` file contains `@font-face` declarations referencing co-located woff2
files via relative URLs. The inline FOUC script's injection logic is preserved
almost verbatim -- only the map values change (from CDN URLs to local paths) and
the preconnect hint injections are removed. The result is that a cold page load
for any web-font slug fetches exactly one same-origin CSS file and one or more
same-origin woff2 files, with zero external network requests.

A download script (`scripts/download-google-fonts.sh`) is provided to fetch the
woff2 files and generate the `font.css` files. This script is re-runnable so
fonts can be refreshed if a family is updated upstream. The woff2 files and
`font.css` files are committed to the repository as static assets (they are
small binary files, ~1.8-2.2 MB total, comparable in size to the existing streak
media assets). The download script is a developer tool, not a build step.

A critical design consideration is the service worker's pre-caching behavior.
The existing `service-worker.ts` imports `files` from `$service-worker` (which
is SvelteKit's auto-generated list of everything in `web/static/`) and includes
ALL of them in `shellAssets`. If all ~76 woff2 files were unconditionally
pre-cached, the service worker install would download ~1.8-2.2 MB of font data
even though only one family (~50-135 KB) is ever used. To avoid this regression,
the service worker must be modified to exclude font files from the shell
pre-cache. Font files will still be cached on first use via the runtime cache
(`cacheFirstAsset` strategy), which already handles same-origin assets with
cacheable destinations including `'font'` and `'style'`. This means fonts are
cached after the first page load, satisfying the offline-first invariant.

### Component changes

- **`web/static/fonts/<slug>/font.css` (20 new files)**: Each file contains
  `@font-face` declarations for one font family. Each declaration specifies:
  - `font-family` matching the name used in `+layout.svelte` CSS (e.g.,
    `'Sora'`, `'Inter Tight'`, `'IBM Plex Sans'`)
  - `font-style: normal`
  - `font-weight` as the specific numeric weight (e.g., `400`, `500`, `700`)
    or, for variable fonts, a range (e.g., `400 800`)
  - `font-display: swap`
  - `src: url('./<FontName>-<Weight>.woff2') format('woff2')` using a relative
    path to the co-located woff2 file
  - `unicode-range` values matching the latin subset ranges from Google Fonts
    (when available from the download source)

  Variable fonts should be preferred per-family when the single variable woff2
  file is smaller than the sum of static per-weight files for the required
  weights. When a variable font is used, the `@font-face` block uses a weight
  range (e.g., `font-weight: 400 800`) and a single woff2 file. The choice is
  made independently per family and documented in the decision log.

- **`web/static/fonts/<slug>/*.woff2` (~76 new files)**: Pre-subsetted latin
  woff2 files obtained via the download script. File naming convention:
  `<FamilyName>-<WeightName>.woff2` (e.g., `Sora-Regular.woff2`,
  `Sora-Medium.woff2`) or `<FamilyName>-Variable.woff2` for variable fonts.

- **`web/src/app.html`**: The `fontUrls` map is renamed to `fontPaths` (to
  clearly signal the semantic change from external URLs to local paths). Each
  of the 20 entries maps a font slug to its local CSS path:

  ```javascript
  var fontPaths = {
    'sora': '/fonts/sora/font.css',
    'sono': '/fonts/sono/font.css',
    'inter': '/fonts/inter/font.css',
    // ... 17 more entries
  };
  ```

  The injection block is simplified. The two preconnect hint injections
  (`fonts.googleapis.com` and `fonts.gstatic.com`) are removed entirely. The
  preload and stylesheet injections remain, now pointing to local paths:

  ```javascript
  var cssPath = fontPaths[fontSlug];
  if (cssPath) {
    var pl = document.createElement('link');
    pl.rel = 'preload';
    pl.as = 'style';
    pl.href = cssPath;
    document.head.appendChild(pl);
    var sl = document.createElement('link');
    sl.rel = 'stylesheet';
    sl.href = cssPath;
    document.head.appendChild(sl);
  }
  ```

  The `rel="preload"` hint is retained even for same-origin files. While the
  latency benefit is smaller than for CDN resources, it still gives the browser
  an early signal to begin fetching the CSS before the stylesheet link is
  encountered in the render pipeline, and costs nothing.

  The variable name change from `fontUrls` to `fontPaths` requires updating
  the regex in `fouc-whitelist.test.ts` (see test strategy below). The
  `fontSlug` resolution logic (defaulting to `'sora'`) is unchanged.

- **`web/src/service-worker.ts`**: Filter out font files from the `shellAssets`
  array to prevent pre-caching all ~76 woff2 files on service worker install.
  The filter excludes paths matching `/fonts/` from the `files` array before
  spreading into `shellAssets`. Font files are still cached on first use by
  the existing `cacheFirstAsset` runtime cache strategy (which handles
  `'font'` and `'style'` destinations for same-origin requests).

  ```typescript
  const shellAssets = [
    ...build,
    ...files.filter((f) => !f.startsWith('/fonts/')),
    '/',
    '/runtime-config.js',
    // ... other explicit entries unchanged
  ].map((path) => withBase(path));
  ```

  This is the minimal change. An alternative (pre-caching only the active
  user's font) would require the service worker to read localStorage, which
  adds complexity and couples the SW to preference logic. The runtime cache
  approach is simpler and sufficient: after the first page load, the selected
  font's CSS and woff2 files are in the runtime cache and available offline.

- **`web/src/lib/stores/fouc-whitelist.test.ts`**: Updated to reflect the
  renamed map variable and local path values (see test strategy section).

- **`scripts/download-google-fonts.sh`**: New shell script for downloading
  font files (see font download tooling section).

### File structure

```
web/static/fonts/
  sora/
    font.css
    Sora-Regular.woff2
    Sora-Medium.woff2
    Sora-SemiBold.woff2
    Sora-Bold.woff2
    Sora-ExtraBold.woff2
  sono/
    font.css
    Sono-Regular.woff2
    ...
  inter/
    font.css
    Inter-Regular.woff2      (or Inter-Variable.woff2 if variable is smaller)
    ...
  inter-tight/
    font.css
    InterTight-Regular.woff2
    ...
  jetbrains-mono/
    font.css
    JetBrainsMono-Regular.woff2
    ...
  atkinson-hyperlegible/
    font.css
    AtkinsonHyperlegible-Regular.woff2
    AtkinsonHyperlegible-Bold.woff2
  atkinson-hyperlegible-next/
    font.css
    ...
  ibm-plex-sans/
    font.css
    IBMPlexSans-Regular.woff2
    ...
  ibm-plex-mono/
    font.css
    ...
  ibm-plex-serif/
    font.css
    ...
  roboto/
    font.css
    ...
  roboto-slab/
    font.css
    ...
  roboto-mono/
    font.css
    ...
  dm-mono/
    font.css
    ...
  comfortaa/
    font.css
    ...
  poppins/
    font.css
    ...
  victor-mono/
    font.css
    ...
  pt-sans/
    font.css
    ...
  pt-serif/
    font.css
    ...
  pt-mono/
    font.css
    PTMono-Regular.woff2
```

Directory names use the font slug (lowercase, hyphenated) matching the keys in
the `fontPaths` map and the `validFonts` array. Woff2 file names use the
font's canonical PascalCase family name with weight suffix.

### Font download tooling

A new script at `scripts/download-google-fonts.sh` automates downloading woff2
files and generating `font.css` files. Design:

**Source**: The Google Fonts CSS API (`fonts.googleapis.com/css2`). The script
sends a request with a Chrome user-agent string (to get woff2 format responses)
for each font family and weight set. The API returns CSS containing `@font-face`
blocks with direct URLs to `fonts.gstatic.com` woff2 files, which the script
then downloads. This is preferred over `@fontsource` npm packages because:
(a) it uses the exact same source the CDN would serve, ensuring identical
subsets and file sizes; (b) it does not require npm dependencies; (c) the
returned CSS includes correct `unicode-range` values.

**Process per font family**:

1. Fetch the Google Fonts CSS2 URL (same URL currently in `fontUrls` in
   `app.html`) with a user-agent that triggers woff2 responses.
2. Parse the returned CSS to extract `@font-face` blocks (font-weight, src URL,
   unicode-range).
3. Download each woff2 file from `fonts.gstatic.com` into the font's directory.
4. Generate `font.css` with `@font-face` rules rewritten to use relative
   `url('./<filename>.woff2')` paths and `font-display: swap`.

**Variable font handling**: The script does not need special variable font logic.
The Google Fonts CSS2 API returns static per-weight files by default. If the
engineer wants to use a variable font for a specific family, they can manually
download it and write the `font.css` by hand, or add a flag to the script. This
is a per-family optimization decision, not a requirement.

**Idempotency**: The script can be re-run safely. It overwrites existing files in
each font directory. Running it with no arguments processes all 20 families.

**The script is a convenience tool, not a build dependency.** The committed woff2
and `font.css` files are the source of truth. The script is used to initially
populate them and to refresh them when upstream fonts change.

### @font-face CSS format

Each `font.css` file follows this structure (example for Sora):

```css
/* Sora - downloaded from Google Fonts, latin subset */
/* font-display: swap ensures text is always visible */

@font-face {
  font-family: 'Sora';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('./Sora-Regular.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6,
    U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122,
    U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'Sora';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('./Sora-Medium.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6,
    U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122,
    U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

/* ... one @font-face per weight ... */
```

Key requirements:

- `font-family` name must exactly match the name in `+layout.svelte` CSS
  (e.g., `'Sora'`, `'Inter Tight'`, `'IBM Plex Sans'`). These are already
  defined in the `--ui-font` mappings at lines 564-587 of `+layout.svelte`.
- `font-display: swap` is mandatory on every `@font-face` rule.
- `unicode-range` should be included when available from the Google Fonts CSS
  response. It restricts the font download to the latin subset, so the browser
  only fetches the woff2 file when characters in that range are used on the page.
- Relative `url()` paths (e.g., `url('./Sora-Regular.woff2')`) keep the CSS
  and woff2 files co-located and portable.

### Inline FOUC script changes (app.html)

Summary of changes to the inline `<script>` block in `app.html`:

1. **Rename `fontUrls` to `fontPaths`**. The 20 entries change from Google
   CDN URLs to local paths: `'/fonts/<slug>/font.css'`.

2. **Remove preconnect hint injections**. The four lines creating `pc1` and
   `pc2` (`<link rel="preconnect">` for `fonts.googleapis.com` and
   `fonts.gstatic.com`) are deleted. Preconnect hints are not needed for
   same-origin resources.

3. **Rename the lookup variable** from `var url = fontUrls[fontSlug]` to
   `var cssPath = fontPaths[fontSlug]` (or similar). The `if (url)` guard
   becomes `if (cssPath)`.

4. **Retain preload + stylesheet injection**. The two `<link>` element
   creations (preload and stylesheet) remain, now using `cssPath` as the `href`.

5. **No other changes**. The `validFonts` and `validThemes` arrays, the
   localStorage reading loop, the preference parsing, and the `fontSlug`
   default (`'sora'`) are all unchanged.

### Data model changes

None. No IndexedDB, localStorage schema, server database, or sync protocol
changes.

### API changes

None. No new endpoints, no changed signatures, no server-side changes.

### Build and configuration changes

- **SvelteKit adapter-static**: No configuration changes needed. The adapter
  serves everything in `web/static/` as static files. The `fonts/` directory
  is automatically included.

- **`.gitignore`**: No changes needed. The woff2 files are intentionally
  committed as static assets (same treatment as streak PNGs and MP3s in
  `web/static/streak/`). They are not build artifacts.

- **Vite config**: No changes needed. Vite does not process files in
  `web/static/` -- they are served as-is.

- **Service worker**: The `shellAssets` array in `service-worker.ts` must
  filter out `/fonts/` paths from the `files` import to avoid pre-caching
  all font files on install. See component changes above. This is a one-line
  filter addition.

### Test strategy

**Updates to `fouc-whitelist.test.ts`:**

1. **Update `extractInlineObjectMap` calls**: Change the variable name from
   `'fontUrls'` to `'fontPaths'` in all three existing tests that parse the
   map from `app.html`.

2. **Update "font-to-URL map covers all web-font slugs" test**: Rename to
   "font path map covers all web-font slugs". The assertion logic is identical
   (keys of extracted map match non-system slugs from `validFonts`).

3. **Update "system-font slugs are absent" test**: Change from
   `fontUrls['georgia']` to `fontPaths['georgia']` etc. Intent unchanged.

4. **Replace "every font URL contains display=swap" test**: The old test
   asserted each URL contained `display=swap`. Replace with two tests:

   a. **"every font path follows /fonts/<slug>/font.css structure"**: Assert
      each value in the `fontPaths` map matches the pattern
      `/fonts/<key>/font.css` (where `<key>` is the slug).

   b. **"every font.css file exists and contains font-display: swap"**: For
      each entry in the `fontPaths` map, read the corresponding CSS file from
      disk (resolve relative to `web/static/`) and assert:
      - The file exists
      - It contains at least one `@font-face` block
      - Every `@font-face` block contains `font-display: swap`
      - (Optional but recommended) Every `@font-face` block's `src` URL
        references a `.woff2` file that exists on disk

**No new E2E tests required.** The existing Playwright smoke tests exercise
font rendering implicitly. An explicit network-intercept E2E test to verify
no external font requests is valuable but can be deferred -- the unit tests
provide strong coverage of the structural correctness. If the engineer wants
to add one, it would use `page.route('**/*googleapis*', ...)` to fail on any
Google Fonts request during a smoke test run.

### Alternatives considered

**Alternative: Keep fonts in `web/static/fonts/` but do not modify the service
worker.** This would cause the service worker to pre-cache all ~76 woff2 files
(~1.8-2.2 MB) on install, regardless of which font the user selected. For users
on slow connections or metered data, this is a meaningful regression. The
runtime-cache approach (filter fonts out of shell pre-cache, let them cache on
first use) downloads only the selected font's files (~50-135 KB) and defers the
rest. This is the same pay-for-what-you-use model as the CDN approach.

**Alternative: Place font files outside `web/static/` (e.g., in a `public/fonts`
directory with custom Vite config) to avoid the service worker `files` list.**
Rejected because it adds build complexity and breaks the convention that all
static assets live in `web/static/`. The one-line filter in `service-worker.ts`
is simpler and more maintainable.

**Alternative: Use `@fontsource` npm packages as the woff2 source.** The
`@fontsource` project provides pre-subsetted woff2 files as npm packages. This
would add 20 npm dependencies and require a build step to copy files from
`node_modules` into `web/static/fonts/`. Rejected because: (a) the Google Fonts
CSS API provides identical files without npm dependencies, (b) a shell script is
simpler than an npm postinstall hook, (c) the woff2 files are committed to the
repo so the download step runs only when refreshing fonts, not on every
`npm install`.

**Alternative: Use a single combined `fonts.css` with all 20 families instead of
per-family CSS files.** Rejected per the exec plan: only one family loads per
session. A combined file would add ~5-10 KB of CSS per page load vs. ~1-2 KB
for a single-family file.

### Risks and mitigations

- **Risk**: Service worker pre-caches all font files, causing a ~2 MB download
  on install. **Mitigation**: Filter `/fonts/` paths out of `shellAssets` in
  `service-worker.ts`. Font files are cached at runtime on first use. This is
  the highest-priority design decision in this plan.

- **Risk**: First-visit user on slow connection experiences FOUT while the woff2
  file downloads from the same origin. **Mitigation**: `font-display: swap`
  ensures text is always visible in fallback. Same-origin fetch latency is lower
  than CDN latency (no DNS, no TLS handshake to third-party). Not a regression.

- **Risk**: The download script produces full-unicode woff2 files instead of
  latin-subsetted files, inflating per-file sizes. **Mitigation**: The script
  uses the Google Fonts CSS2 API with a Chrome user-agent, which returns
  latin-subsetted `@font-face` blocks and unicode-range-specific woff2 URLs.
  The engineer should verify per-file sizes match the estimates in the size
  analysis table (~20-40 KB per file) and document actual sizes in the progress
  log.

- **Risk**: A font family's `font-family` name in `font.css` does not match the
  name in `+layout.svelte`'s `--ui-font` CSS variable, causing the font to not
  render. **Mitigation**: The `font-family` names in `+layout.svelte` are
  already known (lines 564-587). The download script or the engineer must use
  these exact names. The unit test that reads each `font.css` file can
  optionally assert the `font-family` value matches a known list.

- **Risk**: `fontPaths` map in `app.html` drifts from `validFonts` in
  `preferences.ts` when new fonts are added. **Mitigation**: Existing unit test
  pattern (updated for new variable name) catches this immediately.

- **Risk**: Repo size grows by ~2 MB. **Mitigation**: Acceptable. The repo
  already contains streak media assets of similar size. Git handles binary
  assets efficiently with packing. Document actual size in progress log.

- **Risk**: Capacitor/iOS WKWebView cold launch still shows FOUT on the very
  first launch (before service worker caches fonts). **Mitigation**: This is
  the same behavior as any first visit. `font-display: swap` ensures text is
  visible. The key improvement is that subsequent launches use service-worker-
  cached same-origin files that are not subject to WebKit's third-party cache
  eviction -- the core problem this feature solves.

- **Risk**: The `files.filter()` change in the service worker accidentally
  excludes non-font files from pre-caching. **Mitigation**: The filter is
  narrowly scoped to paths starting with `/fonts/`. No existing static assets
  use this prefix. A unit test could verify this, but visual review during
  code review is sufficient given the narrow filter.

### Performance impact

**Positive impacts (improvements):**

- Eliminates two cross-origin connections (DNS + TLS to `fonts.googleapis.com`
  and `fonts.gstatic.com`) on every cold load. Same-origin requests require no
  additional connection setup.
- Font CSS and woff2 files are served from the same origin with the same HTTP/2
  connection as the rest of the app, reducing round-trip overhead.
- After the first visit, the service worker's runtime cache serves font files
  from disk with sub-millisecond latency, fully eliminating FOUT on warm loads.
- On iOS/WKWebView, font files are no longer subject to third-party cache
  eviction, fixing the FOUT on cold PWA launches that motivated this feature.

**Neutral impacts:**

- Per-user download size is unchanged: the same woff2 files are downloaded
  regardless of whether they come from Google's CDN or the same origin.
- The inline `<script>` in `app.html` shrinks slightly (shorter local paths
  vs. full CDN URLs, and removal of preconnect injection code).

**No negative impact on performance budgets in RELIABILITY.md.** The 800 ms
cold PWA TTI budget is not affected (font loading is non-render-blocking with
`font-display: swap`). The 16 ms interaction budget, 20 ms sound onset budget,
and 100 ms search budget are unrelated to font loading. The service worker
install cost is reduced (fewer files to pre-cache) compared to the naive
approach of pre-caching all fonts.

## Task breakdown

### T1: Create download script and fetch all 20 font families

**Files:** `scripts/download-google-fonts.sh`, `web/static/fonts/`

Write a shell script that fetches woff2 files from the Google Fonts CSS2 API and generates per-family `font.css` files. The script uses a Chrome user-agent to get woff2/latin-subset responses, parses the returned CSS to extract `@font-face` blocks and woff2 URLs, downloads each woff2 file into `web/static/fonts/<slug>/`, and generates `font.css` with relative `url()` paths and `font-display: swap`. Run the script to populate all 20 font directories. Document actual total size in the progress log.

**Done when:** All 20 font family directories exist under `web/static/fonts/<slug>/` with `font.css` and woff2 files. Each `font.css` contains valid `@font-face` declarations with `font-display: swap`, relative woff2 paths, and correct `font-family` names matching `+layout.svelte`. The script is executable and idempotent.

### T2: Update app.html inline script to use local font paths

**Files:** `web/src/app.html`

Rename `fontUrls` to `fontPaths`, replace all 20 CDN URLs with local `/fonts/<slug>/font.css` paths, remove preconnect hint injections (pc1, pc2), rename the lookup variable from `url` to `cssPath`, and update the if-guard and href assignments. Retain preload + stylesheet link injections.

**Done when:** The `fontPaths` map has 20 entries mapping slugs to `/fonts/<slug>/font.css`. No Google CDN URLs remain. No preconnect hints are injected. Preload and stylesheet links use the local path.

### T3: Filter font files from service worker shell pre-cache

**Files:** `web/src/service-worker.ts`

Replace `...files` with `...files.filter((f) => !f.startsWith('/fonts/'))` in the `shellAssets` array to prevent pre-caching all ~76 woff2 files on service worker install. Font files are cached at runtime on first use via the existing `cacheFirstAsset` strategy.

**Done when:** The `shellAssets` array filters out `/fonts/` paths. All other entries unchanged.

### T4: Update fouc-whitelist tests for local font paths

**Files:** `web/src/lib/stores/fouc-whitelist.test.ts`

Update `extractInlineObjectMap` calls from `'fontUrls'` to `'fontPaths'`. Rename tests accordingly. Replace the `display=swap` URL test with two new tests: (a) verify each path follows `/fonts/<slug>/font.css` structure, (b) read each `font.css` from disk and assert it exists, contains `@font-face` blocks, and every block has `font-display: swap`.

**Done when:** All fouc-whitelist tests pass. The test suite verifies slug coverage, system font exclusion, local path structure, and `font-display: swap` in every `font.css` on disk.

### T5: Fix associative array reset fragility in download script

**Files:** `scripts/download-google-fonts.sh`

Move `unset WEIGHT_COUNTER` from the bottom of the main loop to directly before `declare -A WEIGHT_COUNTER=()` at the top. This ensures the array is always cleaned regardless of early `continue` exits.

**Done when:** `unset WEIGHT_COUNTER` appears immediately before `declare -A WEIGHT_COUNTER=()` and does NOT appear at the bottom of the loop. Script runs successfully and produces identical output.

## Progress log

- 2026-05-08: Discovery complete. Exec plan written. Requirements gathered from inbox brief, codebase inspection of `app.html`, `+layout.svelte` CSS font mappings, `preferences.ts` validFonts, `fouc-whitelist.test.ts`, completed predecessor plan `2026-05-08-dynamic-font-loading.md`, `RELIABILITY.md`, and `CONTRIBUTING.md`. Conflict check: no overlap with any active exec plan. This feature builds directly on the delivered inline-script architecture from the predecessor plan. No contradictions with ARCHITECTURE.md or RELIABILITY.md — self-hosting fonts is strictly aligned with the offline-first invariant.
- 2026-05-09: T1 complete. Downloaded all 20 font families. Total static font asset size: 8.2 MB (358 woff2 files + 20 font.css files). Source: Google Fonts CSS2 API with Chrome user-agent (woff2, all unicode subsets). Note: the Google Fonts API returns multiple @font-face blocks per weight (one per unicode subset: cyrillic-ext, cyrillic, latin-ext, latin). All subsets are preserved — unicode-range properties ensure browsers only download the file for the character ranges they actually need. The script `scripts/download-google-fonts.sh` is executable and idempotent.
- 2026-05-09: All tasks (T1-T5) implemented, verified, and accepted. Feature complete.

## Decision log

- 2026-05-08: `font-display: swap` chosen over `block` or `optional`. Rationale: swap ensures text is always visible on first visit before the service worker has cached font files. The path to `block` (after caching is verified) is explicitly left open as a deferred optimization.
- 2026-05-08: Per-font CSS file approach (`/fonts/<slug>/font.css`) chosen over inline `@font-face` injection or a single combined CSS file. Rationale: minimal change to the injection mechanism, human-readable and independently maintainable CSS, same cacheability as per-family CDN approach.
- 2026-05-08: woff2 source must be pre-subsetted latin files (from `@fontsource` or Google Fonts download API) rather than full-unicode files from font authors' repositories. Final source to be documented by engineer in the decision log during implementation.
- 2026-05-09: woff2 source chosen: Google Fonts CSS2 API (`fonts.googleapis.com/css2`) with a Chrome user-agent string. This returns `@font-face` blocks per unicode subset (cyrillic-ext, cyrillic, latin-ext, latin) with direct `fonts.gstatic.com` woff2 URLs. All subsets are downloaded and preserved. The `unicode-range` property in each `@font-face` rule means browsers only fetch the subset files needed for the characters on the page. Total: 358 woff2 files at 8.2 MB across 20 font families. All woff2 filenames use the pattern `<FamilyNoSpaces>-<WeightName>.woff2` with numeric suffixes for additional subsets per weight (e.g. `Inter-Regular.woff2`, `Inter-Regular-1.woff2`, ..., `Inter-Regular-6.woff2`).
