---
plan: ios-portrait-lock
harness: v2 · lean
branch: chore/ios-portrait-lock
anchor: outcome
status: Complete (awaiting merge)
next: Dean — build on Mac, check portrait lock, merge
gate: APPROVED r1 @93dd2e1 (adversary + qa)
builder: standard
---

# iOS app: lock iPhone to portrait

## Request

Dean (2026-11-15): the iOS app rotates when the phone turns, and he never uses
it in landscape. Stop it rotating.

## Rulings (owner, 2026-11-15)

| # | Question | Ruling |
|---|----------|--------|
| R1 | Scope | **iPhone only.** iPad keeps all orientations (locking iPad would also force opting out of Split View / Slide Over). |

## Seams (verified 2026-11-15)

- `web/ios/App/App/Info.plist:35-40` — `UISupportedInterfaceOrientations`
  lists Portrait, LandscapeLeft, LandscapeRight. Reduce it to
  **`UIInterfaceOrientationPortrait` only**.
- `web/ios/App/App/Info.plist:41-47` — `UISupportedInterfaceOrientations~ipad`
  — **leave unchanged** (R1).
- No Capacitor config, Swift, or web change is needed. The web app's own
  layout is unaffected (the PWA in Safari is not covered by this — Safari
  can't lock orientation; out of scope).
- Building the iOS app needs macOS + Xcode (`docs/IOS.md`); this box is
  Linux. The builder edits and tests the plist; **Dean builds and installs**
  from his Mac (`cd web && npm run build && npx cap sync ios`, then Xcode).

## Acceptance

1. `Info.plist` iPhone orientations = Portrait only; iPad array byte-identical
   to `main`. Plist still well-formed (parse it — e.g. a small vitest using
   a plist/XML parse, or `python3 -c "import plistlib; plistlib.load(open(...,'rb'))"`).
2. A cheap guard test (vitest, e.g. `web/src/lib/ios/infoPlist.test.ts`)
   that reads the plist and asserts both arrays, so a future `cap sync` or
   Xcode edit that re-adds landscape fails CI.
3. `docs/IOS.md` gets one line: the iPhone app is portrait-only by design.
4. Full web suite green.

## Out of scope

- iPad orientation (R1). Safari/PWA orientation. Any web-layout change.
- The regroup-on-load fix (separate plan, `2026-11-15-fix-regroup-on-load.md`).

## Step 0 — builder setup

- **Read order:** `AGENTS.md` → this plan → `web/ios/App/App/Info.plist` →
  `docs/IOS.md`.
- **Environment:** worktree on `chore/ios-portrait-lock` (plan committed
  there). Web commands from `web/`.
- **Git rules:** stage by name, no force-push, no `--no-verify`, never
  self-merge. PR body leads with `## Summary`.
- **Stop rules — ask Dean:** the change appears to need anything beyond
  the plist, the guard test and the one doc line.

## Waves

- **W1** — plist edit + guard test + doc line. Commit.
- **Gate → PR.** `/gate` (adversary floor; no scrutiny row beyond it matches
  `web/ios/**` — confirm against `.harness/scrutiny.toml`). Open the PR;
  Dean merges, then builds on his Mac and checks: the iPhone app stays
  portrait when rotated.

## Evidence (builder fills)

- W1: `93dd2e1` — iPhone `UISupportedInterfaceOrientations` = Portrait only; iPad array unchanged (diff vs main: only the two Landscape strings removed from the iPhone array); `plistlib` parses OK; guard test `web/src/lib/ios/infoPlist.test.ts` (3 tests; mutation re-adding landscape -> red); `docs/IOS.md` Orientation line. Suite: lint clean, svelte-check 0 errors/0 warnings, vitest 34 files / 519 tests passed, @smoke 39 passed (Chromium).
- Gate: adversary + qa (qa escalated: `src/**` row may match the test file), both APPROVED r1 @93dd2e1. Notes, not fixed (tech-debt-worthy only): guard regex is not XML-comment-aware; well-formed check is tag-count only.
- PR: see PR link in the hand-off message.
- Dean owes (Mac, device): `cd web && npm run build && npx cap sync ios`, build in Xcode, install. Check: iPhone app stays portrait when rotated (incl. from Home-screen launch); iPad (if available) still rotates and Split View still works.

Gate: APPROVED r1 @93dd2e1d88868e83e4fbfdcb1214a2692d943934 — adversary
Gate: APPROVED r1 @93dd2e1d88868e83e4fbfdcb1214a2692d943934 — qa
