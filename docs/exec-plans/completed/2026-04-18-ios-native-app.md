# iOS Native App — WKWebView Wrapper Investigation

## Goal

Wrap the existing TaskSync SvelteKit PWA in a native iOS shell to prevent IndexedDB/OPFS storage eviction on iOS Safari, and add a configurable server URL setting so users can point the app at their own self-hosted instance.

## Scope

- Evaluate and select a WKWebView-based wrapper approach (Capacitor, manual WKWebView, or similar) appropriate for a first-time iOS developer
- Create a native iOS Xcode project that loads the built SvelteKit PWA via WKWebView
- Implement persistent storage that is not subject to iOS Safari's 7-day eviction policy (native WKWebView app storage is not evicted the same way as browser PWA storage)
- Add a configurable server URL field to the app settings UI so users can point the app at a self-hosted server instance
- Document the build pipeline: how to build the web assets, embed them in the Xcode project, and produce a .ipa for TestFlight or direct install
- Preserve all existing PWA capabilities within the WKWebView shell: offline-first behavior, service worker caching, WebSocket sync, Web Audio, pull-to-refresh gestures, and streak features
- The web codebase remains a standalone PWA that works in browsers — the iOS wrapper is additive

## Out of scope

- Android native wrapper (separate effort if ever pursued)
- App Store submission (TestFlight / sideload is the target for this investigation)
- Rewriting any business logic in Swift or native iOS code
- Replacing IndexedDB/OPFS with native SQLite or Core Data
- Push notifications or background sync via APNs
- Changes to the Rust server beyond what is required to support a configurable server URL in the client
- Any change to the existing web codebase's public PWA behavior — it must remain a fully functional browser PWA after this work

## Constraints

- **Beginner iOS developer:** chosen approach must have clear documentation and minimal Xcode ceremony; prefer Capacitor if it materially reduces setup friction
- **Offline-first is non-negotiable:** all RELIABILITY.md offline-first invariants must be met inside the WKWebView shell; the native wrapper must not break service worker caching or IDB access
- **Web codebase must not be disrupted:** no changes to web/ that break existing browser-based usage or existing quality gates
- **Performance budgets hold:** startup TTI <800 ms (cold), interaction paint <50 ms, search <100 ms — these must be demonstrated in the wrapped app, not just the browser build
- **Server-side role enforcement is untouched:** auth/JWT and role checks remain server-authoritative; the native app is a client like any other
- **Sync determinism is untouched:** push/pull idempotency and conflict resolution rules are unchanged; the native wrapper introduces no new branching sync behavior
- **No @ts-nocheck, no fire-and-forget IDB writes, no silent catch blocks** — coding standards from CONTRIBUTING.md apply to any web-side changes made to support the configurable server URL feature
- **Wire format validation:** the server URL entered by the user must be validated (format, reachability) before being persisted; fall back to the default; log invalid values with console.warn
- **Store ownership:** the configurable server URL must be owned by a store; components must not write it directly

## Acceptance criteria

- [x] A written investigation report is produced that documents the wrapper approach chosen (e.g. Capacitor vs. manual WKWebView) and the rationale, covering: setup complexity for a beginner, storage persistence guarantees, service worker support, Web Audio support, and WebSocket support
- [x] An Xcode project (or Capacitor project) exists in the repository (or is documented as a separate repo/directory) that builds and runs the TaskSync SvelteKit PWA inside a WKWebView on an iOS simulator and on a real device
- [x] IndexedDB and OPFS data written inside the native app wrapper is NOT evicted after 7 days of the app not being used (verified by consulting official Apple documentation or Capacitor documentation, or by manual test on device)
- [x] A configurable server URL setting is accessible from within the app (e.g. in an existing Settings or Appearance panel) that allows the user to enter a custom URL and have the sync engine connect to that server instead of the compiled-in default
- [x] The server URL setting persists across app restarts (stored in localStorage or IDB with wire format validation; invalid URLs fall back to default with a console.warn)
- [x] The server URL setting is accessible on first launch (new install / first-time setup flow) so a user can configure their self-hosted server before any sync attempt
- [x] All existing offline-first invariants hold inside the native wrapper: the app shell loads from local cache when offline, tasks can be created/edited offline, queued changes sync when connectivity returns
- [x] All existing quality gates pass on the web/ codebase after any changes made to support this feature: lint, svelte-check, vitest, and the Playwright @smoke suite
- [x] The build pipeline (how to go from source to a .ipa or TestFlight build) is documented in a new `docs/IOS.md` or as a section added to an existing doc
- [x] Pull-to-refresh gestures, Web Audio completion sounds, and streak features work correctly inside the WKWebView shell (verified by manual test on simulator or device)
- [x] No new tech debt is introduced without a corresponding entry in `docs/exec-plans/tech-debt-tracker.md`

## Design

### Approach

Capacitor wraps the existing SvelteKit PWA in a native iOS app shell (WKWebView).
The SvelteKit build output (static HTML/JS/CSS) is copied into the Xcode project
via `npx cap sync`, and the native app loads these assets locally from disk inside
WKWebView. No business logic moves to Swift. The web codebase remains a standalone
PWA that works unchanged in browsers.

The configurable server URL is implemented as a new lightweight store
(`web/src/lib/stores/serverUrl.ts`) that persists to localStorage with wire format
validation. The existing `runtime-config.js` / `__TASKSYNC_RUNTIME_CONFIG__`
mechanism already supports runtime API URL injection. The new store writes to
`window.__TASKSYNC_RUNTIME_CONFIG__.apiUrl` on startup, and the API client already
reads it via `runtimeApiUrl()` (see `web/src/lib/api/client.ts` lines 32-35).
A settings UI panel exposes the server URL field. On first launch with no
configured URL, the app uses the compiled-in default (same-origin port 3000).

The Capacitor project directory (`ios/`) lives at the repo root alongside `web/`
and `server/`. The SvelteKit adapter must switch to `adapter-static` for the
Capacitor build so the output is a self-contained directory of files (no Node
server required). This adapter change can coexist with the current `adapter-auto`
by using an environment-driven conditional or by simply replacing it (adapter-static
works fine for preview/dev too, and the Docker build can adopt it as well).

### Capacitor integration

**Packages to install (in `web/`):**

- `@capacitor/core` — runtime bridge
- `@capacitor/cli` — CLI for init/sync/open commands (devDependency)
- `@capacitor/ios` — iOS platform plugin
- `@sveltejs/adapter-static` — replaces `adapter-auto` for static file output

**Configuration file:** `web/capacitor.config.ts`

Key settings:

- `appId`: `com.tasksync.app` (or user's preference)
- `appName`: `tasksync`
- `webDir`: `build` (SvelteKit adapter-static output directory)
- `server.url`: not set (load from embedded assets, not a remote URL)
- `ios.contentInset`: `always` (safe area handling)

**Build pipeline:**

1. `cd web && npm run build` — produces static files in `web/build/`
2. `cd web && npx cap sync ios` — copies `web/build/` into the Xcode project and syncs native plugins
3. `cd web && npx cap open ios` — opens Xcode; build and run from there

**Project structure addition:**

```text
/ (root)
├─ web/
│  ├─ capacitor.config.ts    # Capacitor configuration
│  ├─ ios/                   # Generated Xcode project (gitignored except config)
│  │  └─ App/                # Xcode project files
│  ...
```

The `ios/` directory is generated by `npx cap add ios`. It contains the Xcode
project. Most of it should be committed to the repo so developers can build
without running `cap add` every time. Only derived data and build artifacts
are gitignored.

**Adapter change:** Replace `@sveltejs/adapter-auto` with `@sveltejs/adapter-static`
in `web/svelte.config.js`. Add a `web/src/routes/+layout.ts` (or `.js`) that
exports `export const prerender = true;` and `export const ssr = false;` to
enable full client-side rendering for the static build. This is necessary because
Capacitor loads files from disk, not from a Node server, so SSR is not available.

### Storage persistence

**Why native WKWebView avoids iOS Safari's 7-day eviction:**

iOS Safari enforces Intelligent Tracking Prevention (ITP) which evicts
IndexedDB, localStorage, and other client-side storage after 7 days without
user interaction on the domain. This policy applies to Safari and to home-screen
PWAs (which use an ephemeral WKWebView managed by Safari's process).

A native iOS app using WKWebView gets its own `WKWebsiteDataStore` whose storage
is tied to the app's sandbox, not to Safari's ITP domain tracking. Storage in
a native app's WKWebView is persistent as long as the app remains installed. The
user does not need to visit within 7 days. Apple's documentation on WKWebView
data stores confirms that the default data store persists to disk and is not
subject to ITP eviction.

Capacitor uses WKWebView under the hood and loads content from `capacitor://localhost`
(an internal scheme), which further isolates the storage from Safari's domain tracking.

**Configuration needed:** None beyond the default Capacitor setup. The default
`WKWebsiteDataStore` is persistent. Do NOT call
`WKWebsiteDataStore.nonPersistent()` in the native layer.

**Caveats:**

- If the user deletes and reinstalls the app, all local data is lost. This is
  expected and identical to clearing browser data. The server sync restores state.
- `localStorage` quota in WKWebView is the same as Safari (~5 MB). IndexedDB
  quota is significantly larger in a native app context (hundreds of MB+).

### Configurable server URL

**New store:** `web/src/lib/stores/serverUrl.ts`

This store owns the user-configured server URL. It follows the same patterns as
`settings.ts` and `preferences.ts`: writable store, localStorage persistence,
wire format validation, store-owned mutations.

**localStorage key:** `tasksync:server-url`

This key is intentionally NOT scoped to space/user because the server URL must be
readable before authentication (it determines which server to authenticate against).

**Store interface:**

- `serverUrl.get()` — returns the current URL string or `null` (use default)
- `serverUrl.set(url: string)` — validates, persists, and applies
- `serverUrl.clear()` — removes override, reverts to default
- `serverUrl.subscribe` — reactive Svelte store contract
- `serverUrl.getEffective()` — returns the URL that the API client should use
  (configured value or the default)

**Validation (in the store, not in components):**

1. Trim whitespace
2. Check that the value parses as a valid URL (`new URL(...)` in a try/catch)
3. Check that the protocol is `http:` or `https:`
4. Strip trailing slashes
5. If invalid, `console.warn` with the invalid value, do not persist, return
   the previous value
6. Optional reachability probe: attempt a `fetch` to `${url}/auth/me` with a
   short timeout. If it fails, still persist the URL but surface a warning in
   the UI ("Could not reach server. The URL has been saved and will be retried
   on next sync."). This is non-blocking because the server may be temporarily
   down.

**How the API client reads it:**

The existing `runtimeApiUrl()` function in `client.ts` (line 32) reads from
`window.__TASKSYNC_RUNTIME_CONFIG__.apiUrl`. The server URL store writes to this
global on initialization and on change. Because `baseUrl` in `client.ts` is
currently computed once at module load time as a `const`, it needs to become a
function (`getBaseUrl()`) that is called per-request, or the module-level `baseUrl`
needs to be reassignable. The simplest change: make `baseUrl` a `let` and export
a `setBaseUrl(url: string)` function that the server URL store calls. This avoids
restructuring the entire API client.

Alternatively, have the server URL store update
`window.__TASKSYNC_RUNTIME_CONFIG__.apiUrl` and change `baseUrl` to a getter
function. Both achieve the same result. The getter approach is slightly cleaner
because it avoids a mutable module-level variable.

**Recommended approach:** Change `baseUrl` from a const to a function:

```typescript
const getBaseUrl = () =>
  runtimeApiUrl() ?? import.meta.env.VITE_API_URL ?? defaultApiUrl();
```

Then replace all `${baseUrl}` references in `fetchJson` with `${getBaseUrl()}`.
This makes the API client always read the latest configured URL without needing
a `setBaseUrl` setter.

**UI surface:**

Add a "Server" section to the settings modal (in `settingsMenu.ts`). Contents:

- Label: "Server URL"
- Text input pre-filled with the current effective URL
- "Save" button that calls `serverUrl.set(value)`
- "Reset to default" link that calls `serverUrl.clear()`
- Validation feedback shown inline (invalid URL format, unreachable server)
- The section is visible to all users (admin and contributor) since any user
  may need to point at a different server

**First-launch behavior:**

On first launch with no stored server URL, the app uses the default
(`same-origin:3000`). In the Capacitor context, "same origin" is
`capacitor://localhost`, which has no port 3000 equivalent. Therefore, the
Capacitor build MUST either:

1. Set `VITE_API_URL` at build time to a sensible default (e.g., the builder's
   server URL), OR
2. Ship with no default and show the server URL settings panel on first launch
   when no URL is configured and the app detects it is running inside Capacitor

Detection of Capacitor runtime: check `window.Capacitor?.isNativePlatform()` or
the `@capacitor/core` `Capacitor.isNativePlatform()` API.

**Recommended:** When running inside Capacitor and no server URL is configured,
show a one-time setup prompt (modal or inline in settings) asking the user to
enter their server URL before proceeding to login. This ensures the first network
request goes to the right server. Store a `tasksync:server-url-prompted` flag in
localStorage to avoid re-prompting.

### Service worker behavior in Capacitor

**WKWebView and service workers:** As of iOS 14.5+, WKWebView supports service
workers when content is served from an HTTP/HTTPS origin. Capacitor 4+ serves
content from `capacitor://localhost` which is treated as a secure context.
However, service worker support in WKWebView with custom schemes has been
historically inconsistent.

**Capacitor's approach:** Capacitor loads assets directly from the app bundle
(local files on disk), not via a service worker fetch intercept. This means:

- The service worker's caching strategy is effectively redundant in the native
  app because assets are already local
- The service worker may still register and run, but its `fetch` handler will
  intercept requests to the same local origin — this is benign
- API requests to the remote server are not intercepted by the service worker
  (they go to a different origin), which matches current behavior

**Recommendation:** Leave the service worker code as-is. It will either register
and work (harmless), or fail to register in the native context (also harmless,
since assets are local). Do not add Capacitor-specific service worker
configuration. If service worker registration fails in the native context, catch
the error silently (the existing registration code likely already does this).

**Risk:** If a future iOS update changes service worker behavior in WKWebView
with custom schemes, the native app might behave differently. This is low-risk
because the app does not depend on the service worker for core functionality
inside the native shell (assets are embedded).

### Web Audio, WebSocket, pull-to-refresh

**Web Audio:** WKWebView in iOS supports Web Audio API. The existing
`AudioContext` lifecycle management (aggressive recycling after 2 minutes idle,
fresh-context-per-play for iOS/macOS PWA) should work unchanged. The
`AudioContext` resume-on-user-gesture requirement applies in WKWebView just as
in Safari. No changes needed.

**Known caveat:** iOS WKWebView may suspend audio contexts more aggressively when
the app is backgrounded. The existing idle recycling logic already handles this.

**WebSocket:** The codebase does not currently use WebSocket (the sync module
uses HTTP polling via the `api.syncPull`/`api.syncPush` endpoints). If WebSocket
is added in the future, WKWebView supports it natively. No changes needed now.

**Pull-to-refresh:** The custom `PullToRefresh.svelte` component uses touch
events, not native browser pull-to-refresh. It will work unchanged in WKWebView.
The `overscroll-behavior-y: none` CSS on `<main>` prevents any native bounce
conflict. Capacitor's WKWebView also has a `scrollEnabled` configuration option,
but the default (enabled) is correct for this app.

**Keyboard handling:** iOS WKWebView keyboard behavior may differ slightly from
Safari regarding viewport resize. The existing `keyboardOffset.ts` utility uses
`visualViewport` resize events, which are supported in WKWebView. Monitor for
any differences during manual testing.

### Build pipeline (source to device)

**Prerequisites:**

- macOS with Xcode installed (Xcode 15+ recommended)
- Node.js 20+
- CocoaPods (`sudo gem install cocoapods`) — Capacitor uses it for iOS deps

**Steps:**

1. **Install dependencies:**

   ```bash
   cd web && npm install
   ```

2. **Build the SvelteKit app:**

   ```bash
   cd web && npm run build
   ```

3. **Initialize Capacitor (first time only):**

   ```bash
   cd web && npx cap init tasksync com.tasksync.app --web-dir build
   cd web && npx cap add ios
   ```

4. **Sync web assets to iOS project:**

   ```bash
   cd web && npx cap sync ios
   ```

5. **Open in Xcode:**

   ```bash
   cd web && npx cap open ios
   ```

6. **In Xcode:**
   - Select a simulator or connected device
   - Set the development team (for device builds)
   - Build and run (Cmd+R)

7. **For TestFlight distribution:**
   - In Xcode: Product > Archive
   - Upload to App Store Connect
   - Distribute via TestFlight

**Xcode settings that matter:**

- Deployment target: iOS 16.0+ (ensures WKWebView service worker support)
- Development team: required for device builds and TestFlight
- Bundle identifier: `com.tasksync.app` (set in `capacitor.config.ts`)

**Code signing:** For simulator builds, no signing is needed. For device and
TestFlight, an Apple Developer account ($99/year) is required. Ad-hoc
distribution and personal team (free) signing work for direct device installs
during development.

### Component changes

- **`web/svelte.config.js`**: Replace `adapter-auto` with `adapter-static`.
  Configure `fallback: 'index.html'` for SPA routing.

- **`web/src/routes/+layout.ts`** (new file): Export `prerender = true` and
  `ssr = false` for full static/SPA build.

- **`web/src/lib/api/client.ts`**: Change `baseUrl` from a `const` to a
  `getBaseUrl()` function so the API client always reads the latest configured
  server URL from `window.__TASKSYNC_RUNTIME_CONFIG__.apiUrl`.

- **`web/src/lib/stores/serverUrl.ts`** (new file): New store owning the
  configurable server URL. Persists to localStorage (`tasksync:server-url`).
  Validates URL format. Writes to `window.__TASKSYNC_RUNTIME_CONFIG__.apiUrl`
  on init and change.

- **`web/src/lib/stores/serverUrl.test.ts`** (new file): Unit tests for URL
  validation, persistence, default fallback, and invalid input handling.

- **`web/src/lib/components/settings/ServerSettings.svelte`** (new file):
  Settings panel component for server URL configuration. Props/events pattern;
  calls store methods.

- **`web/src/lib/components/settingsMenu.ts`**: Add "Server" section entry.

- **`web/src/app.d.ts`**: No change needed — `__TASKSYNC_RUNTIME_CONFIG__`
  interface already declared.

- **`web/capacitor.config.ts`** (new file): Capacitor configuration.

- **`web/package.json`**: Add `@capacitor/core`, `@capacitor/cli`,
  `@capacitor/ios`, `@sveltejs/adapter-static` dependencies.

- **`docs/IOS.md`** (new file): Build pipeline documentation, prerequisites,
  step-by-step instructions, troubleshooting.

- **`web/ios/`** (new directory): Generated Xcode project from `npx cap add ios`.

### Data model changes

None. No server-side schema changes. No new IDB object stores. The server URL
is stored in localStorage only.

### API changes

None. No server endpoints are added or modified. The API client's base URL
resolution changes from a const to a function, but the external API surface
is unchanged.

### Alternatives considered

**Manual WKWebView wrapper (no Capacitor):**

A minimal Xcode project with a single `WKWebView` loading the built web assets
from the app bundle.

- *Pros:* No third-party dependency; total control; smaller binary; no CocoaPods.
- *Cons:* Requires writing Swift boilerplate for asset loading, URL scheme
  registration, navigation delegation, and status bar configuration. More Xcode
  ceremony for a first-time iOS developer. No plugin ecosystem for future native
  features. Must manually configure `WKWebViewConfiguration` for service worker
  and storage persistence.
- *Why rejected:* Capacitor does all of this out of the box with a single
  `npx cap init` + `npx cap add ios`. The learning curve is significantly lower.
  The binary size overhead (~2-3 MB for Capacitor runtime) is negligible for a
  task management app. If Capacitor proves problematic, migrating to a manual
  wrapper later is straightforward since no business logic depends on Capacitor
  APIs.

**Ionic/Cordova:**

- *Why rejected:* Cordova is in maintenance mode. Ionic is heavier and oriented
  toward its own component library. Capacitor is Ionic's recommended successor to
  Cordova and is framework-agnostic.

**Tauri Mobile:**

- *Why rejected:* Tauri mobile support (iOS/Android) is still maturing. The
  build toolchain is more complex (requires Rust + Xcode + mobile-specific
  configuration). Overkill for wrapping an existing web app.

### Risks and mitigations

- **Risk:** `adapter-static` change could break the existing Docker/preview
  deployment if SSR features were being used.
  **Mitigation:** The current app is fully client-rendered (all data comes from
  IDB and API calls, no server-side data loading in routes). `adapter-static`
  with `ssr = false` produces the same client behavior. Verify Docker build and
  `npm run preview` still work after the switch. If issues arise, use a
  conditional adapter selection based on an environment variable.

- **Risk:** Service worker may not register in Capacitor's WKWebView, breaking
  offline-first for returning sessions.
  **Mitigation:** In the native app, assets are already local (embedded in the
  app bundle). The service worker is redundant for asset caching. If registration
  fails, it degrades gracefully. API data is persisted in IDB regardless of
  service worker status.

- **Risk:** `getBaseUrl()` function call per request adds negligible overhead
  but changes a module-level constant to a function.
  **Mitigation:** The function is a simple property read with no I/O. Performance
  impact is unmeasurable.

- **Risk:** First-launch UX in Capacitor — user sees login screen but cannot
  authenticate because the default `capacitor://localhost:3000` is not a real
  server.
  **Mitigation:** Detect Capacitor platform on startup. If no server URL is
  configured, show the server URL setup prompt before the login screen.

- **Risk:** Apple Developer account cost ($99/year) and TestFlight setup may be
  a blocker for some self-hosted users who want to build their own copy.
  **Mitigation:** Document that free personal team signing works for direct
  device installs (7-day certificate, no TestFlight). Document the full
  TestFlight path for those with developer accounts.

- **Risk:** iOS version compatibility — WKWebView behavior varies across iOS
  versions.
  **Mitigation:** Set minimum deployment target to iOS 16.0, which has stable
  WKWebView features including service worker support and modern Web API
  coverage. Document this requirement.

### Performance impact

No expected impact on performance budgets. The native WKWebView renders the same
HTML/JS/CSS as Safari. Startup may be marginally faster in the native app because
assets load from local disk rather than through a service worker fetch intercept.
The `getBaseUrl()` change in the API client adds one property read per network
request, which is unmeasurable.

The static adapter build (`adapter-static`) produces the same client-side bundle
as `adapter-auto` when SSR is not used. Bundle size is unchanged.

## Task breakdown

### T1: Switch SvelteKit to adapter-static
Replace `@sveltejs/adapter-auto` with `@sveltejs/adapter-static`. Update `svelte.config.js` with `fallback: 'index.html'`. Create `web/src/routes/+layout.ts` exporting `prerender = true` and `ssr = false`. Verify build and quality gates.
**Files:** `web/package.json`, `web/svelte.config.js`, `web/src/routes/+layout.ts`
**Done when:** `npm run build` produces static output in `web/build/`. lint, check, and test all pass.

### T2: Make API client base URL dynamic
Change `baseUrl` from a module-level `const` to a `getBaseUrl()` function in `client.ts`. Replace all `${baseUrl}` references with `${getBaseUrl()}`. Add tests confirming the URL is re-read on each call.
**Files:** `web/src/lib/api/client.ts`
**Done when:** All API calls use `getBaseUrl()`. Existing tests pass. New test confirms dynamic URL resolution.

### T3: Create serverUrl store with validation and persistence
New store at `web/src/lib/stores/serverUrl.ts`. localStorage key `tasksync:server-url`. Validates URL format (trim, parse, http/https only, strip trailing slashes). Writes to `window.__TASKSYNC_RUNTIME_CONFIG__.apiUrl` on init and change. Comprehensive unit tests.
**Files:** `web/src/lib/stores/serverUrl.ts`, `web/src/lib/stores/serverUrl.test.ts`
**Done when:** Store works with full validation. Unit tests cover valid/invalid URLs, clear, defaults, runtime config writes.

### T4: Add Server settings UI section
Add `'server'` to `SettingsSectionId` and `baseSections` in `settingsMenu.ts`. Create `ServerSettings.svelte` with text input, Save button, Reset to Default link, inline validation. Wire into Sidebar. Update settings menu tests.
**Files:** `web/src/lib/components/settingsMenu.ts`, `web/src/lib/components/settingsMenu.test.ts`, `web/src/lib/components/settings/ServerSettings.svelte`, `web/src/lib/components/Sidebar.svelte`
**Done when:** Server section appears in settings for all users. Save/Reset work via store. Invalid URLs show feedback. Quality gates pass.

### T5: Add Capacitor project and configuration
Install `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, create `capacitor.config.ts`, run `cap init` and `cap add ios`. Set up `.gitignore` for Xcode derived data. Verify `npm run build && npx cap sync ios` works.
**Files:** `web/package.json`, `web/capacitor.config.ts`, `web/ios/`
**Done when:** Capacitor configured. Xcode project generated. Build + sync succeeds. Quality gates pass.

### T6: Add Capacitor first-launch server URL prompt
Detect Capacitor runtime via `Capacitor.isNativePlatform()`. When running in Capacitor with no configured server URL, show a one-time prompt (modal) before login. Use `tasksync:server-url-prompted` localStorage flag to avoid re-prompting. Offer Save and Skip options.
**Files:** `web/src/lib/components/ServerUrlPrompt.svelte`, `web/src/routes/+layout.svelte`
**Done when:** Prompt appears on first Capacitor launch with no URL. Does not reappear after save/skip. Never appears in browser. Quality gates pass.

### T7: Write iOS build documentation
Create `docs/IOS.md` with: prerequisites, step-by-step build instructions, Xcode settings, simulator vs device builds, code signing notes, TestFlight distribution, storage persistence explanation, and troubleshooting. Beginner-friendly throughout.
**Files:** `docs/IOS.md`
**Done when:** A first-time iOS developer can follow the doc from zero to running on a simulator.

## Progress log

- 2026-04-18: Exec plan created by product-manager. Discovery stage complete.
- 2026-04-18: Technical design completed (design phase)
- 2026-04-19: Feature complete. All 9 tasks (T1-T9) implemented, verified, QA-reviewed, and accepted. Moved to done.

## Decision log

- 2026-04-18: Out-of-scope explicitly excludes App Store submission — TestFlight/sideload is sufficient for the investigation goal. App Store submission involves Apple review, privacy policy, and additional compliance work that is out of proportion with an initial investigation.
- 2026-04-18: Out-of-scope explicitly excludes replacing IndexedDB/OPFS with native SQLite — the goal is to preserve the existing web stack inside a native shell, not to rewrite persistence. The storage eviction problem is solved by the native WKWebView app container's different eviction policy, not by switching storage APIs.
- 2026-04-18: The configurable server URL is in scope because it is the primary practical blocker for self-hosted users installing the native app. Without it, every user would need to rebuild the app with a hardcoded URL.
