# ROADMAP

This file captures directional intent only.
Items here are not commitments.

Authoritative plans live in `docs/exec-plans/`.

## Planned (Prioritized Next)
1. Improve user-facing error messages (including clearer login error mapping, such as 404 cases).
2. Add list import support for plain-text and Joplin-compatible formats.
3. Add a checklist "Uncheck all" action for repeat-use lists (for example grocery workflows).

## Recently Completed
- Sync delete determinism hardening shipped: cross-device delete tombstones now converge reliably so deleted tasks do not reappear after refresh.
- Punt behavior refined: punting is instance-scoped, daily recurrences are excluded, and My Day treatment reflects punted tasks as addressed for today while preserving tomorrow visibility.
- Task attachments were intentionally retired after implementation review; task URL references remain the supported lightweight alternative.

## Deferred
- Full local-client expansion with deeper long-horizon cached data (Actual Budget-like model) is intentionally deferred to a later phase.

## Later / Ideas
- Multi-user team workflow improvements
- Admin UX refinements
- Mobile-specific UX pass
- Advanced analytics / insights
