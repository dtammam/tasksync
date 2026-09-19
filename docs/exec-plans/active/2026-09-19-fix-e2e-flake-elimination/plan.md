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
- The `data-synced` signal keys off `syncStatus.pull` settling (running → idle/
  error) after startup while authenticated; for offline/anonymous it must still
  resolve (errored pull counts as settled) so it never hangs the app or a test.

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
- Firefox not locally runnable (binary absent); CI covers it — the real arbiter,
  as with #051.
