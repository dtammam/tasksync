---
plan: e2e-flake-elimination
harness: v2 · lean
anchor: outcome
status: Building
next: App-side (data-synced marker, cache-first auth, data-ptr-ready), then deterministic test waits, then /gate.
gate: pending
---

# Fix: eliminate e2e test flakes at their root (#050 + sidebar-drag + same class)

## Request

Owner directive: "I want it all fixed. I don't want flakes." Eliminate the
recurring e2e flakiness at its root — tech-debt #050 (`offline.spec.ts`, two
signatures), the sidebar-drag count-5 failure (new, untracked), and the
same-class latent flakes surfaced by the sweep. Owner approved the **full root
fix (app + tests)**, including the auth-boot behavior change.

## Blind-spot pass (diagnosis complete — both signatures + sidebar-drag reproduced deterministically)

**Unifying root cause:** `data-ready` (`+layout.svelte` `appReady`, line 259/406)
marks only **local/seed IndexedDB hydration**, not **server-sync-applied** state.
The startup pull (`requestSync('startup')`, `+layout.svelte:280`) is fired *after*
`data-ready` and not gated by it, so any test asserting server-origin rows/lists
right after `data-ready` races the pull.

- **sidebar-drag count=5 (CONFIRMED, reproduced):** `lists.ts:6-14` seeds 6
  hardcoded lists (5 visible after `my-day` is filtered). On a fresh context
  `hydrateFromDb()` (`lists.ts:66-72`) falls back to those seeds; `data-ready`
  fires; only when the mocked `/sync/pull` resolves does `lists.setAll` (`sync/
  sync.ts:203`) replace them with the 2 mocked lists. Under load the poll sees 5.
- **offline (b) (CONFIRMED):** seeded task row comes from `/sync/pull`
  (`tasks.mergeRemote`, `stores/tasks.ts:309`), not gated by `data-ready`; the
  row assertion (`offline.spec.ts:604` and siblings 567/616/638/673/686/707)
  times out under load with the "Nothing scheduled" empty state.
- **offline (a) (CONFIRMED, distinct cause):** `auth.hydrate()` (`stores/auth.ts:
  148`) sets `loading`, then **awaits `api.me()`** (line 174) before promoting to
  `authenticated`. The `app-shell` (carrying `data-ready`) only renders in the
  `{:else}` (authenticated) branch (`+layout.svelte:397/403`). `api.me()` is
  cross-origin (`client.ts`), outside SW scope, so on an offline reload it can
  stall and the shell never renders. A real offline-first UX bug.

**Same-class latent (from sweep):**
- `sidebar-zones.spec.ts:33` and `pull-to-refresh.spec.ts:140/198` — fixed
  `waitForTimeout` sleeps as readiness proxies.
- `task-tags.spec.ts` — direct-IDB-write vs app re-persist race (`repo.ts:66-72`
  clears+re-puts in-memory tasks, can clobber a helper's direct IDB emoji write
  before `page.reload()`); plus weak `toHaveCount(0)` assertions (`:129`) and in
  `auth-gate.spec.ts` (already gated by a positive assertion — hardening only).

**Standing decisions honored (`AGENTS.md`):** role checks are
**server-authoritative** (§Auth) and the API token is never logged — cache-first
auth changes only what the CLIENT optimistically renders; every real API call
still hits the server, so it cannot bypass authorization. Offline-first (§) is a
stated principle this fix advances. No overlapping active plan touches auth or
these specs.

## Anchor

Anchor — default: `outcome` · recommended: `outcome` (match). Flake elimination
with directly measurable results (suite reliably green under load + on CI; no
readiness-proxy sleeps left). The one genuine design point — cache-first auth
behavior — is verified by the security gate + tests, not by a pre-committed
interface spec, so `spec` is not warranted.

## Acceptance (measurable)

1. **Reliability, proven not asserted.** For each reproduced flake (offline
   `@smoke ... survives reload`, sidebar-drag, sidebar-zones, PTR pointer/wheel):
   a controlled local A/B on this box shows the **pre-fix** code failing under
   induced load/injected latency and the **fixed** code passing (target ≥20/20
   under the same load); AND the full e2e matrix is **green on real CI across
   chromium, firefox, and webkit**.
2. **No readiness proxies left.** `grep -nE "waitForTimeout" web/tests/e2e/{offline,sidebar-drag,sidebar-zones,pull-to-refresh,task-tags}.spec.ts` returns no sleep used as a readiness/settle proxy. App exposes `data-synced` on `app-shell` (true once the first authenticated `/sync/pull` settles) and `data-ptr-ready` on `.ptr-wrap` (true once listeners attach); the touched specs wait on those / on the `/sync/pull` response + identity assertions (mocked rows present AND seed rows absent).
3. **Cache-first auth boot, safe.** With a cached token+user, `app-shell`/`data-ready` renders WITHOUT awaiting `api.me()` (verified by a test that stalls `api.me()` yet still gets `data-ready`); background reconcile still demotes to anonymous on a definitive 401/403 (unit test in `auth.test.ts`); no `server/**` diff (server remains authoritative). Full gate incl. **security-brief** seat APPROVED.
4. **Debt closed with evidence.** `tech-debt-tracker.md` #050 moved to Closed and a new sidebar-drag row added+closed, each linked to this PR, only after CI is green — not asserted. (The separate #051 PR is CI-green and unblocks once these land to main.)

## Notes

- Base branch: `fix/e2e-flake-elimination` (off latest `origin/main`).
- The `data-synced` signal keys off the startup sync promise settling (success
  OR errored/offline pull) while authenticated, so it never hangs the app or a
  test on the offline path. It applies only to an AUTHENTICATED session — an
  anonymous session renders the login wall, not `app-shell`, so neither marker
  exists there; `expectAppSynced` is documented authenticated-only (per qa r1).

## Scope adjustments discovered during build

- **Offline signature (a) root cause was NOT auth-blocking.** Under load repro
  showed `app-shell` never renders after an offline `page.reload()` because e2e
  ran against the **Vite dev server**, whose SW precaches nothing (`build`/
  `files` from `$service-worker` are empty in dev) — so offline reload can't
  re-load Vite's dynamic ESM modules and the app never boots. Fixed by running
  e2e against a **production build** (`playwright.config.ts` webServer →
  `vite build && vite preview`); the built SW precaches all assets. Cache-first
  auth is kept as a correct, independent offline-first improvement (not the (a)
  fix). Owner approved the build+preview change (test-only; production already
  ships this bundle).
- **#051 wheel fix folded in.** This branch was off main (no #051 fix), so the
  wheel test flaked here too; merged `fix/webkit-ptr-wheel-debounce-race` in so
  one branch makes the whole suite green (supersedes standalone PR #153).
- **task-tags deferred.** The suspected direct-IDB-write vs app-re-persist race
  and weak `toHaveCount(0)` assertions were NOT CI-confirmed flakes; fixing them
  needs a UI-driven tag-set rewrite that risks a passing test. Filed as its own
  tech-debt row rather than forced into this PR.

## Verification (local, pre-gate)

- `npm run lint` / `npm run check`: clean. `npx vitest run`: **414 passed** (28
  files; +3 new cache-first auth tests).
- Production build succeeds (`vite build`, adapter-static, ~6s).
- **Full e2e suite on the preview build** (chromium + webkit): **120 passed, 8
  skipped, 0 failed** — build+preview regressed nothing.
- **Under induced CPU load (2× `yes`, `--workers=2`, load avg 7–11.5 on 6 cores):**
  - `offline.spec.ts` (all offline tests) chromium ×12: **66 passed, 0 failed**
    (6 graceful SW-not-ready skips under extreme load — pre-existing
    `allowUnregistered` behavior, not failures).
  - `offline.spec.ts:589` (the #050 (a)+(b) test) chromium ×25: **23 passed, 0
    failed**, 2 graceful skips. (Pre-fix on the dev server this failed ~2/30 with
    `app-shell` absent after reload.)
  - `sidebar-drag` + `sidebar-zones` chromium ×15: **30 passed, 0 failed**.
  - wheel gesture (webkit) ×15: **15 passed, 0 failed**.
- Firefox IS installed locally (corrected from an earlier wrong claim). Against
  the preview build, firefox's SW claims the page, so the offline-RELOAD tests
  would proceed into `page.reload()` while offline and firefox throws
  `NS_ERROR_OFFLINE` (a Playwright-firefox limitation: it will not serve a
  SW-controlled navigation under `context.setOffline`). Adversary r1 caught this
  as a CRITICAL. Fix: `ensureServiceWorkerControlsPage` now reports
  "not controllable" on firefox, so the offline-reload tests skip gracefully on
  firefox after their pre-reload assertions — matching webkit (which skips the
  whole describe) and firefox's own prior dev-server behavior. Offline-reload
  continuity is validated on chromium; firefox/webkit run the rest of the suite.
  Re-verified locally on firefox (see Gate r2 evidence). CI remains the arbiter.

## Gate

### security-brief (r1 @2e8e8e7)

Tool gap (verbatim): I have no Bash, so I could NOT run
`git diff --name-only b6b930b HEAD -- server/` myself to confirm the empty
server delta. I verified the security question a different way (below): the
server authorization boundary enforces access regardless of any client edit,
and I read every security-relevant client path directly.

- **Q1 optimistic-auth escalation — no exploitable escalation (verified).**
  `hydrate()` (`auth.ts:201-215`) promotes to `authenticated` from cached
  token+user with no await, but the token sent on every request is unchanged
  (`headers.ts buildHeaders` → `Authorization: Bearer`). Client UI optimism
  cannot grant access the server denies: all data/role mutations go through
  `fetchJson` to server endpoints (`client.ts` — members/grants/lists/tasks),
  which are server-authoritative per AGENTS.md §Auth. Cached `role`
  (`admin`/`contributor`) is trusted only for the optimistic UI window, then
  overwritten by `api.me()` in `reconcileSession()`. A tampered localStorage
  `role:"admin"` renders admin UI but the server rejects the actual call — and
  in this self-hosted single-family context the only actor who can tamper their
  own localStorage is the device owner attacking themselves. Not exploitable.
  Note: the client always trusted the localStorage user; this change only
  widens the pre-reconcile window, it introduces no new trust of the server.
- **Q2 revoked/expired token window — not a real risk here (verified).**
  On 401/403 `reconcileSession()` (`auth.ts:152-158`) clears token + user and
  goes anonymous after one background round-trip. During the window only the
  user's own already-local cached data renders; any background `/sync/pull`
  with a stale token 401s and leaks nothing. Acceptable for the deployment
  context.
- **Q3 token handling — clean (verified).** No new code logs the token; the
  token travels only in the `Authorization` header, never the URL, DOM, or
  error payloads (`ApiError` carries only status/statusText/server detail).
  `setAuthToken(null)` (`headers.ts:9-16`) does `localStorage.removeItem` —
  confirmed it clears on 401/403.
- **Q4 new DOM markers — booleans only (verified).** `data-synced`
  (`+layout.svelte:423`, backed by `firstSyncSettled` bool) and `data-ptr-ready`
  (`PullToRefresh.svelte:562`, backed by `ptrReady` bool) expose no sensitive
  data.
- **Q5 server scope — not independently run (see tool gap); moot for the
  boundary.** Could not run the git command; regardless, the authorization
  boundary is server-side and no client change can weaken it.
- **Q6 other surfaces — none found.** Remaining diff is test/config/client boot.

INFO (advisory, non-blocking): the optimistic window trusts cached `role` until
reconcile; if any purely-client-gated destructive affordance is ever added
without a server check, revisit. Today none exists — every mutation is
server-enforced.

No CRITICAL/HIGH/MEDIUM/LOW findings.

Gate: APPROVED r1 @2e8e8e7555d8d4931adf6fc10ea854b49b865c1f — security-brief

### qa (r1 @2e8e8e7)

Instruments (verbatim, run on this box):
- `npm run lint` → clean (eslint, no output).
- `npm run check` → `svelte-check found 0 errors and 0 warnings`.
- `npx vitest run` → **414 passed (28 files)** on a clean re-run. NOTE: the first
  full run showed 1 failure — `auth.test.ts > promotes to authenticated from
  cache immediately` timed out at 5000ms — but the file passes 20/20 in isolation
  (~18ms) and the full suite passed 414/414 on immediate re-run under lower load
  (uptime load avg ~1.8). Diagnosis: event-loop starvation of the 5s test timeout
  under parallel load, not a code defect (the test intentionally holds a
  never-settling `api.me()` promise). Verified, not merely reasoned.
- Server: `git diff --name-only b6b930b HEAD -- server/` is **empty** — cargo
  steps correctly skipped; server remains authoritative.
- e2e: my first full-matrix run (chromium+webkit, 119 passed / 9 skipped / 0
  failed, exit 0) executed against `npm run dev` because a concurrent seat had
  transiently reverted `playwright.config.ts`'s webServer to the dev command
  during my run (since reverted; working tree now matches HEAD's production-build
  command). That run therefore did NOT exercise the committed production-build
  path, so I re-ran the focus specs against a production preview I built + served
  myself (committed config content; build/ is gitignored; throwaway config in
  scratchpad, removed) — chromium+webkit, retries=0:
  **15 passed, 7 skipped, 0 failed (exit 0).**
  - Decisive: on the production build **chromium ran ALL 6 offline-reload tests
    incl. `offline.spec.ts:589` (the #050 (a)+(b) test) — all PASS**, whereas on
    the dev server `:589` skipped (SW never claimed). Confirms the webServer
    change is load-bearing and fixes the chromium offline determinism as claimed.
  - webkit offline-reload tests skip locally on BOTH dev and prod (webkit +
    Playwright SW-control limitation, graceful `allowUnregistered`); pointer +
    wheel gestures and sidebar-drag/zones PASS on both engines. Firefox binary
    absent. Full webkit/firefox offline coverage rests on CI — consistent with
    the plan's stated CI-arbiter stance and the honest #050 deferral.

Correctness (re-derived from code):
- `auth.ts` cache-first hydrate (201-215): promotes authenticated from cache with
  no await; `void reconcileSession()` refreshes on success, demotes+clears token
  on 401/403 (`isAuthFailure`), keeps cached session on network error; no-cache
  path awaits `reconcileSession` (loading→authenticated/anonymous). login/logout/
  setup/revoke untouched. The 4 new auth.test cases each bind a distinct path and
  are meaningful. No regression.
- `+layout.svelte` `firstSyncSettled`/`data-synced` (282-297, 423): leader settles
  via `startupSync.finally` (runSync catches internally → always resolves, incl.
  offline errored pull); follower settles immediately; `if (startupSync)` guards
  the theoretical undefined. Verified offline settle via chromium offline passes.
- `PullToRefresh.svelte` `data-ptr-ready` (562): set after all listeners attach;
  gestures pass on both engines — the marker replaces the CDP/sleep proxy soundly.
- `ready.ts`, spec edits: `expectAppSynced` is a bounded real-condition wait;
  sidebar-drag asserts by identity (`toHaveCount(2)` + `Goal Management` seed
  absent — 'Goal Management' confirmed a real seed list); sidebar-zones polls the
  bounding box; wheel test's single-`evaluate` dispatch+read is correct. No
  weakened coverage vs originals; the touch test rightly keeps CDP (chromium-only).
- Comments (data-synced, cache-first, data-ptr-ready, webServer rationale) match
  the code. tech-debt-tracker: #052 added, #051 reopened, #050/sidebar-drag kept
  open pending CI — honest.

Security (standing brief; concur with security-brief seat): no `server/**` diff;
token travels only in the Authorization header, never logged/exposed; cache-first
optimism cannot bypass server-authoritative authorization; the two new DOM markers
are booleans exposing nothing sensitive. No new security surface.

Findings:
- SUGGESTION (`+layout.svelte:284-297`): for a truly anonymous (no-token) session
  `firstSyncSettled` never flips, so `data-synced` stays `"false"` forever;
  `expectAppSynced` would hang the full 30s then fail if ever called on an
  anonymous session (no current caller does — all touched specs authenticate
  first). The plan's Notes phrase "offline/anonymous must still resolve" is
  imprecise vs the code (the OFFLINE-authenticated case does settle; pure
  anonymous does not), though leaving it false is semantically defensible. Latent
  trap for future tests — consider settling the marker for anonymous or
  documenting the authenticated-only precondition on `expectAppSynced`.
- SUGGESTION (`sidebar-zones.spec.ts`): the poll predicate returns a bare boolean,
  so a failure reports `false` rather than the offending coordinates — mildly
  weaker diagnostics than the original per-edge asserts. Non-blocking.

No CRITICAL or WARNING findings. The committed diff is correct, standards-
compliant, introduces no regression I can construct, and its core claim (the
production-build offline fix) is verified on chromium. WebKit/firefox offline +
the full matrix remain CI's to confirm, as the plan states.

Working tree left byte-identical apart from this verdict block (playwright.config.ts
drift was a concurrent seat's transient mutation, since reverted; no untracked
files remain).

Gate: APPROVED r1 @2e8e8e7555d8d4931adf6fc10ea854b49b865c1f — qa

### adversary (r1 @2e8e8e7)

Instruments (verbatim, this box; shared 6-core, load noted):
- `npm run lint` → exit 0, no output. `npm run check` → `svelte-check found 0 errors and 0 warnings`. `npx vitest run` → **414 passed (28 files)**, exit 0 (stderr traces are the negative-path tests' own console.warn — not failures).
- `git diff --name-only b6b930b HEAD -- server/` → **empty**. Server untouched; cargo steps correctly skipped.
- `grep -nE "waitForTimeout" offline/sidebar-drag/sidebar-zones/pull-to-refresh/task-tags .spec.ts` → **no matches**.
- Production build: `vite build` exit 0; built `build/service-worker.js` precaches **519 asset refs** (dev precaches 0 — the causal basis for the signature-(a) fix).

Mutation tests (committed tree, restored after each):
- auth cache-first: changed `void reconcileSession()` → `await reconcileSession()` → the "promotes from cache immediately" test **fails (times out)**. Binding real.
- auth 401 demotion: `if (isAuthFailure(err))` → `if (false && …)` → the "clears session on background 401" test **fails**. Binding real.
- `data-synced` gate: neutralized both `firstSyncSettled = true` assignments in `+layout.svelte`, rebuilt+served → `sidebar-drag.spec.ts` **fails at the `expectAppSynced` call (line 176)**. The marker genuinely gates; not vacuous.
- Source verified: `runSync` try/catch/finally always resolves (offline/errored pull still settles → `startupSync.finally` fires); `data-synced` renders only in the `{:else}` authenticated branch (405/414/418); follower path (`startupSync` undefined) settles immediately.

Under induced CPU load (3× `yes`, load avg 12–21), PREVIEW build, `--workers=2 --retries=0`:
- `offline.spec.ts:589` (#050 a+b) ×20 → **18 passed, 2 graceful SW skips, 0 failed**.
- `sidebar-drag` + `sidebar-zones` ×15 → **30 passed, 0 failed**.
- wheel gesture (webkit) ×15 → **15 passed, 0 failed**.
- Causal A/B for signature (a): webServer→dev, `offline.spec.ts:589` ×20 under same load → **2 failed / 18 passed** (`app-shell`/task-row absent after offline reload); webServer→preview → **0 failed**. Confirms build+preview is load-bearing. Config restored.
- Full suites isolated, `--workers=2`: chromium **64 passed / 0 failed**; webkit **56 passed / 8 skipped / 0 failed**. (A combined `--project=chromium --project=webkit --workers=3` run showed webkit failures — reproduced as worker over-subscription on this loaded shared box, NOT a code defect: each project is green run alone; CI uses `workers: 2`.)
- #051 wheel fix present in merged `pull-to-refresh.spec.ts` (single-`evaluate` dispatch+microtask read) and green (above).

CRITICAL — Firefox offline-reload regression introduced by the dev→preview webServer change (MEASURED, deterministic):
The firefox binary IS present and runnable locally (`firefox-1509`, the exact revision Playwright 1.58.1 — the pinned/CI version — installs); the plan's "Firefox not locally runnable (binary absent)" is factually wrong. Against the PREVIEW build the built SW now claims the page in firefox, so `ensureServiceWorkerControlsPage` returns true and the offline-reload tests NO LONGER take the `if (!swReady) test.skip()` path — they proceed into `page.reload({waitUntil:'domcontentloaded'})` while `context.setOffline(true)` and firefox's Playwright driver throws **`page.reload: NS_ERROR_OFFLINE`**. Measured `offline.spec.ts:589` firefox **3/3 FAILED** (deterministic); the full firefox focus set failed **:483, :589, :658** (3 failed / 9 passed / 2 skipped). A/B proof this is the fix's doing: same test on the DEV server → **1 skipped** (SW never claims); on PREVIEW → hard fail.
CI (`.github/workflows/ci.yml:101`) runs `npx playwright test --project=firefox` — the FULL suite, including `offline.spec.ts`, against this same preview config. This branch is UNPUSHED (ahead of `origin/main` by 10; no `origin/fix/e2e-flake-elimination`), so CI has NEVER validated firefox on the preview config — the prior "webkit green @63b99d2" was a different, now-merged branch. Therefore acceptance criterion #1 ("full e2e matrix green on chromium, firefox, and webkit on CI") is unverified and, by local measurement, CI firefox will either go RED (if its SW claims, as it does locally) or degrade to a timing-gated skip-vs-fail FLAKE — the exact failure class this branch exists to kill (owner: "I don't want flakes"). Blocks.
Repro: `cd web && npx playwright test offline.spec.ts:589 --project=firefox --retries=0 --workers=1` (against the committed preview config) → `NS_ERROR_OFFLINE`.
Suggested fix: guard the offline-reload block for firefox as already done for webkit (`test.skip(({browserName}) => browserName === 'webkit')` at ~line 441), i.e. skip firefox for the SW-offline-reload pattern (Playwright firefox does not serve SW responses under `setOffline`); or push and confirm firefox on CI BEFORE merge and handle explicitly. Also correct the plan's false "firefox binary absent" claim.

SUGGESTION (concur with qa): pure-anonymous session never flips `firstSyncSettled`, so `expectAppSynced` would hang 30s then fail if ever called pre-auth; no current caller does. Document the authenticated-only precondition on `expectAppSynced`, or settle the marker for anonymous.

Working tree left byte-identical apart from this verdict block: `git status` shows only this plan.md modified; all source/config/`+layout.svelte` mutations restored (`git checkout`/backup-restore), `build/` and `test-results/` are gitignored, no stray processes.

Gate: CHANGES r1 @2e8e8e7555d8d4931adf6fc10ea854b49b865c1f — adversary
