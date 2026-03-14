# Fix: iOS PWA stale audio after extended idle

## Goal

Eliminate silent audio failures on iOS standalone PWA (and all platforms) when the app has been open for an extended period. Structurally solve the problem so it never recurs.

## Non-goals

- Changing audio playback API surface (`playUrl`, `playCompletion`)
- Fixing audio on non-PWA Safari tabs (different lifecycle)
- Adding new sound features

## Constraints

- **Completion sound onset < 20ms** (RELIABILITY.md budget)
- **Offline-first** — fix must work without server
- **No regression on macOS/Android standalone PWA**

## Current state

### The recurring pattern
Four separate fixes have tried to solve stale AudioContext:
1. `47918ea` — general stale audio recovery
2. `2f2619d` — iOS: lifecycle watchers (`visibilitychange`, `pagehide`, `pageshow`) + 120s TTL
3. `0206205` — macOS: extend aggressive recycling to all standalone PWAs
4. Now — iOS again, different trigger

Each fix detects a specific staleness trigger and recycles the singleton context. But iOS keeps finding new ways to silently kill the audio session without firing any detectable event. **Detection-based approaches are fundamentally fragile.**

### Root cause
There is no reliable Web API to determine whether an AudioContext will actually produce sound. `AudioContext.state === "running"` does not guarantee the underlying hardware audio session is alive. iOS WebKit can invalidate the session via:
- Device idle without screen lock (no `visibilitychange`)
- Audio session interruption (phone call, Siri, alarm) without `onstatechange`
- Thermal/low-power throttling
- Long foreground idle (hours)

## Proposed approach: fresh context per play

**Instead of detecting staleness, eliminate it.** Create a new AudioContext for every playback, use it, and close it.

### What changes
- `ensureRunningContext()` → always creates a fresh `AudioContext`, calls `resume()`, returns it
- After playback completes, `close()` the context (fire-and-forget cleanup)
- Delete all lifecycle machinery: `needsContextReset`, `lifecycleWatchersBound`, `bindLifecycleWatchers()`, `shouldRecycleLiveContext()`, `shouldAggressivelyRecycleContext()`, `isStandaloneDisplayMode()`, `markContextStale()`, `audioContextCreatedAt`, `IOS_STANDALONE_CONTEXT_MAX_AGE_MS`
- Delete `dropAudioContext()` (no singleton to drop)
- Buffer cache keyed on URL string still works (AudioBuffers are transferable; re-decode if context changes). Actually, `decodeAudioData` is context-specific, so the cache must be cleared per context or we re-decode each time. Given our files are small (< 500KB), re-decode is fine and simpler.

### Why this is safe
- `new AudioContext()` + `resume()` costs ~2-5ms — well within 20ms budget
- Every sound play originates from a user gesture (task toggle tap), so iOS will always honor the new context
- Synthesized themes are stateless oscillators — no setup cost beyond context creation
- Custom file decode is fast for small files (< 5ms for typical clips)
- `playUrl` (streak announcer/drop) uses small static assets (< 500KB)

### What we lose
- Buffer cache across plays (minor — files are small, decode is fast)
- Shared context reuse (minor — context creation is cheap)

### What we gain
- **Zero platform-specific code** — no iOS/macOS/standalone detection
- **Zero lifecycle management** — no event listeners, no staleness flags
- **Immune to future OS audio session changes** — fresh context every time
- **~60% less code in sound.ts**

## Alternatives considered

1. **More lifecycle events + lower TTL** (original plan v1) — Same detection-based pattern that has failed 3 times. Rejected.
2. **Permanent HTML Audio fallback on iOS** — Doesn't support synthesized themes, has its own autoplay restrictions. Rejected.
3. **Singleton with play-and-verify probe** — Still detection-based, adds latency for the probe. Rejected.

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Context creation overhead per play | ~2-5ms added latency | Well within 20ms budget; measure in tests |
| Buffer re-decode per play | ~2-5ms for small files | Files are < 500KB; acceptable tradeoff |
| Max AudioContext limit on some browsers | Could fail to create | Close context after each play; never accumulate |
| Regression on desktop browsers | Unnecessary churn | Context creation is equally fast on desktop |

## Acceptance criteria

- [ ] iOS standalone PWA plays audio after 5+ minutes of foreground idle
- [ ] iOS standalone PWA plays audio after returning from lock screen
- [ ] iOS standalone PWA plays audio after phone call interruption
- [ ] macOS standalone PWA audio continues to work (no regression)
- [ ] Desktop browser audio continues to work (no regression)
- [ ] Completion sound onset stays < 20ms
- [ ] All sound.test.ts tests pass (rewritten for new architecture)
- [ ] No platform-specific detection code remains in sound.ts

## Test plan

- **Unit** (sound.test.ts — rewrite):
  - Fresh context created per `playCompletion` call
  - Context closed after play
  - Resume failure triggers rebuild
  - All 7 built-in themes produce oscillators
  - Custom file decode + buffer source per play
  - HTML Audio fallback when WebAudio unavailable
  - Invalid custom payload falls back to chime
  - Disabled/muted produces no context
- **Manual (iOS device)**:
  - Open PWA, complete tasks (sound plays)
  - Leave open 5+ minutes idle, complete task → sound plays
  - Lock screen, wait, unlock, complete task → sound plays
  - Trigger Siri/phone call, return, complete task → sound plays
- **Regression**: pre-push Playwright smoke + existing CI matrix

## Rollout / migration plan

No data migration. Pure client-side behavior change. Ships with next web deploy.

## Progress log

- 2026-03-14: Branch `fix/ios-pwa-stale-audio` created. Reviewed git history of 3 prior audio fixes. Initial plan was incremental (more events, lower TTL). Pivoted to structural fix after recognizing the detection-based pattern has failed repeatedly.
- 2026-03-14: Plan finalized — fresh context per play, delete all lifecycle machinery.

## Decision log

- 2026-03-14: **Rejected incremental fix** (more lifecycle events + lower TTL). Reason: same detection-based pattern that has failed 3 times across 3 separate PRs. Each fix addresses one trigger but leaves others.
- 2026-03-14: **Chose fresh-context-per-play**. Reason: eliminates the entire class of staleness bugs by removing the singleton. Trades ~2-5ms per play (well within budget) for zero platform-specific code and permanent immunity to OS audio session changes.
