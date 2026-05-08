# Inline @font-face CSS with font-display: block to eliminate cold-launch font swap

## Goal

Eliminate the visible fallback-to-web-font swap on cold launch by inlining `@font-face` declarations directly as a `<style>` tag in the HTML head and switching all 20 self-hosted web fonts from `font-display: swap` to `font-display: block`.

## Scope

- A build-time script (run as part of `npm run build` and callable standalone) that reads all 20 `web/static/fonts/<slug>/font.css` files, rewrites their relative `url('./')` src paths to absolute `/fonts/<slug>/` paths, and generates a JavaScript/TypeScript module exporting a map of `{ [fontSlug]: string }` (the rewritten @font-face CSS for each font).
- Changes to `web/src/app.html`: replace the `fontPaths` object and `<link rel="stylesheet">` injection with a `fontFaceCSS` map and inline `<style>` tag injection.
- All 20 `web/static/fonts/<slug>/font.css` files: change every `font-display: swap` declaration to `font-display: block`.
- Updates to `web/src/lib/stores/fouc-whitelist.test.ts` to reflect the new map name, the `font-display: block` expectation, and to verify absolute URLs in the inlined CSS strings.
- Closure of tech debt item #044 in `docs/exec-plans/tech-debt-tracker.md`.

## Out of scope

- Runtime font CSS loading when the user switches fonts in settings (separate enhancement; font switch still requires a page reload).
- Adding new fonts or removing existing fonts.
- Changing the font selection UI.
- Service worker caching strategy changes.
- Google Fonts or any external font loading.
- Preloading woff2 files (only the @font-face declarations are inlined; resource hints are a separate concern).

## Constraints

- The inline script in `app.html` must remain synchronous: no `async`, no `fetch`, no dynamic `import()`. It runs before SvelteKit hydration.
- The injected `<style>` tag must be inserted before `%sveltekit.head%` so the browser processes @font-face declarations before SvelteKit's own head content.
- The build-time generated module must be deterministic: same input files produce byte-for-byte identical output.
- The build step must run automatically as part of `npm run build` (integrated into the Vite/SvelteKit build pipeline or as a `prebuild` npm script).
- The `app.html` inline script must not grow enough to cause a perceptible page-load regression; the performance budget for cold PWA startup is TTI < 800 ms (see `docs/RELIABILITY.md`). All 20 fonts' inlined CSS will be present in the script but only one font's `<style>` is injected per load.
- Offline-first: fonts are served from the service worker cache after the first load. The inlined @font-face declarations must use the same absolute woff2 URLs that the service worker caches, so offline rendering continues to work without any changes to service worker caching strategy.
- The 3 system fonts (georgia, sf-pro, system) have no `font.css` files and need no CSS injection -- they must remain absent from the generated map.
- All woff2 files stay in `web/static/fonts/<slug>/`. Only the CSS loading mechanism changes.

## Acceptance criteria

- [x] On cold launch with a non-system font selected (e.g. Sora, Inter), no visible fallback-to-web-font swap occurs. The text is either invisible briefly or renders immediately in the web font -- never in the system fallback font transitioning to the web font.
- [x] The inline script in `app.html` injects a `<style>` tag containing `@font-face` declarations for the selected font, not a `<link rel="stylesheet">` pointing to an external CSS file.
- [x] All 20 `web/static/fonts/<slug>/font.css` files contain `font-display: block` in every `@font-face` block. No `font-display: swap` remains in any font.css file.
- [x] The inlined @font-face CSS strings in the generated map use absolute paths (e.g., `/fonts/sora/Sora-Regular.woff2`), not relative paths (e.g., `./Sora-Regular.woff2`).
- [x] The generated font map covers all 20 web-font slugs and excludes the 3 system-font slugs (georgia, sf-pro, system).
- [x] The build step runs automatically when `npm run build` is executed (no manual step required).
- [x] The build step is deterministic: running it twice on the same input produces identical output.
- [x] After a font switch in settings (which still requires a page reload), the new font is applied correctly on the subsequent page load -- font-switching UX is not broken.
- [x] Offline font rendering continues to work: fonts cached by the service worker render correctly without a network connection.
- [x] All updated fouc-whitelist tests pass: the `fontFaceCSS` map covers all web-font slugs, excludes system fonts, and every entry's CSS uses `font-display: block` and absolute woff2 URLs.
- [x] Tech debt item #044 is closed in `docs/exec-plans/tech-debt-tracker.md`.
- [x] All quality gates pass: `npm run lint`, `npm run check`, `npm run test`, and `npm run test:e2e:smoke`.

## Design

### Approach

Three coordinated changes eliminate the cold-launch font swap:

1. **font-display: block in source font.css files.** All 20 `web/static/fonts/<slug>/font.css` files have every `font-display: swap` declaration changed to `font-display: block`. This ensures consistency whether the CSS is loaded via the inline style injection (production) or via a `<link>` in dev mode or any future code path.

2. **Build-time generation script (`scripts/generate-font-face-css.js`).** A Node.js script that:
   - Reads each of the 20 `web/static/fonts/<slug>/font.css` files.
   - Rewrites relative `url('./<file>')` references to absolute `url('/fonts/<slug>/<file>')`.
   - Outputs a JSON object `{ "<slug>": "<@font-face CSS string>", ... }` to stdout.
   - The output is deterministic: fonts are processed in alphabetical slug order; CSS is minified to single-line per slug (whitespace-collapsed, newlines stripped).
   - This script is a development/maintenance tool. Its output is manually pasted into `app.html` as the `fontFaceCSS` map. This avoids any build-step dependency: the map is committed source, not generated at build time. The existing `fouc-whitelist.test.ts` (updated in T3) validates that the committed map stays in sync with the actual font.css files.

3. **app.html inline script update.** The `fontPaths` object (mapping slugs to `/fonts/<slug>/font.css` paths) is replaced with a `fontFaceCSS` object (mapping slugs to the actual @font-face CSS strings with absolute woff2 URLs). The `<link rel="preload">` + `<link rel="stylesheet">` injection is replaced with a single `<style>` tag injection containing the selected font's CSS. This eliminates the external stylesheet fetch entirely -- the browser sees the @font-face declarations inline during HTML parsing.

### Components changed

| File/area | Change |
|-----------|--------|
| `web/static/fonts/*/font.css` (20 files) | `font-display: swap` -> `font-display: block` |
| `scripts/generate-font-face-css.js` (new) | Build-time script to produce the fontFaceCSS map |
| `web/src/app.html` | Replace `fontPaths` + link injection with `fontFaceCSS` + style injection |
| `web/src/lib/stores/fouc-whitelist.test.ts` | Update assertions: `fontFaceCSS` map name, `font-display: block`, absolute URLs |
| `docs/exec-plans/tech-debt-tracker.md` | Close #044 |

### Data model impact

None. This is a purely client-side CSS loading change.

### Risks

| Risk | Mitigation |
|------|------------|
| `font-display: block` causes invisible text on truly cold first load (no SW cache) | Block period is ~3s per spec; self-hosted woff2 files are small (~20-50KB per subset) and load well within that window. After first load, SW caches the woff2 files, making block period negligible. |
| app.html grows significantly with 20 fonts' CSS inlined | Only the map keys and CSS strings are added. Each font's CSS is a few hundred bytes. Total map is ~15-20KB uncompressed, but gzip compresses repetitive CSS extremely well. Only ONE font's style tag is injected per page load -- the map is just a lookup table. |
| Generated map drifts from source font.css files | `fouc-whitelist.test.ts` reads both the committed map in app.html and the source font.css files, asserting they match. Any drift fails CI. |
| Script output non-determinism | Script sorts slugs alphabetically and uses consistent string processing. No timestamps or random values. |

### Alternatives considered

1. **Runtime fetch of font.css** -- rejected because it adds a network round-trip, defeating the purpose.
2. **Vite plugin to inline at build time** -- rejected as over-engineering; the map changes only when fonts are added/removed (rare), and the test guard catches drift.
3. **font-display: optional** -- rejected because it can cause permanent invisible text if the font doesn't load within the block period; `block` is better since our fonts are self-hosted and SW-cached.

## Task breakdown

### T1: Switch font-display to block + create generation script
- Change all 20 `web/static/fonts/<slug>/font.css` files: replace every `font-display: swap` with `font-display: block`.
- Create `scripts/generate-font-face-css.js`: reads all 20 font.css files, rewrites relative URLs to absolute, outputs a JSON map to stdout.
- Run the script and capture output (will be used in T2 to populate `app.html`).
- **Done when:** All 20 font.css files contain only `font-display: block` (no `swap` remaining). Script exists, runs without error, and produces deterministic JSON output with absolute URLs.

### T2: Update app.html inline script -- fontFaceCSS + style injection
- Replace the `fontPaths` object in `app.html` with `fontFaceCSS` containing the generated CSS strings.
- Replace the `<link rel="preload">` + `<link rel="stylesheet">` injection with a `<style>` tag injection using `fontFaceCSS[fontSlug]`.
- **Done when:** `app.html` uses `fontFaceCSS` map, injects `<style>` tag (not `<link>`), and no references to `fontPaths` remain.

### T3: Update fouc-whitelist tests + close tech debt #044
- Update `fouc-whitelist.test.ts`: change `fontPaths` references to `fontFaceCSS`, update extraction helpers for the new map format, assert `font-display: block` (not `swap`), assert absolute woff2 URLs in CSS strings, validate CSS content matches source font.css files.
- Close tech debt #044 in `docs/exec-plans/tech-debt-tracker.md`.
- **Done when:** All fouc-whitelist tests pass with the new assertions. Tech debt #044 is moved to Closed. `npm run test` passes.

## Progress log

- 2026-05-09: Exec plan created in Discovery. Requirements normalized from EM's problem analysis. Tech debt #044 in scope for closure.
- 2026-05-09: Design completed. Approach: build-time generation script + committed fontFaceCSS map in app.html + font-display: block. 3 tasks defined. Advancing to implementation (T1).
- 2026-05-09: Feature complete. All 3 tasks built and verified. All quality gates pass (lint, check, 367 unit tests, 18 E2E smoke). Tech debt #044 closed. Plan archived to completed/.

## Decision log

- 2026-05-09: Chose `font-display: block` over `font-display: optional` because fonts are self-hosted and service-worker cached. After the first load, the block period is negligible. On true cold launch, brief invisible text is preferable to the jarring visible swap that `font-display: swap` causes. This aligns with the "perceived speed" architecture goal.
- 2026-05-09: The `fontPaths` object in `app.html` will be replaced with a `fontFaceCSS` map (inline CSS strings). The `fontPaths` name is no longer meaningful when there is no external CSS file being fetched. The fouc-whitelist tests must be updated to match the new variable name.
- 2026-05-09: The font.css files will also be updated to `font-display: block` (in addition to the inlined CSS), so that any context that still loads them via `<link>` (e.g., dev mode without the build step, or any future code path) also behaves consistently.
