# Handoff — TaskSync harness v2 migration + Sept 2026 roadmap

**Written:** 2026-09-16 · **For:** a fresh Opus session · **Repo:** `/home/coder/projects/tasksync`

Delete this file once the migration is merged — it is a one-shot handoff, not a doc.

---

## Read these first, in this order

1. `AGENTS.md` — the entry point now. Its `project keep` region carries every rule
   the old `CLAUDE.md` used to hold (attack surfaces, coding standards, commands).
2. `.harness/flow.md` — the five phases and what the anchor dial changes.
3. `docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md` — the roadmap
   you are executing. It carries per-piece acceptance + blind-spot lists.

**Do not** invoke `engineering-manager`, `product-manager`, `principal-engineer`,
`software-developer`, `build-specialist`, or `quality-assurance`. That v1 pipeline is
retired; those files are pending deletion (see Task 1). You are the **Architect** —
you design and implement directly. You never approve your own work: `/gate` does.

---

## Exact state right now

- **Branch:** `chore/harness-v2-migration` (base `main` @ `f8a429b`, which is `origin/main`)
- **Everything is uncommitted.** Nothing has been gated. Nothing has been pushed.
- Working tree:
  - Modified: `AGENTS.md`, `CLAUDE.md`, `.claude/commands/seed.md`,
    `.claude/hooks/session-start.sh`, `.claude/settings.json`
  - New: `.harness/**`, `.claude/agents/{adversary,qa,security-brief}.md`,
    `.claude/commands/{start,gate,status,release}.md`,
    `.state/plans/legacy/20260916-232013/**`, the roadmap doc
- `.claude/settings.json` also contains an **unrelated personal tweak**
  (`spinnerVerbs: {mode: replace, verbs: ["Processing"]}`). The owner said to leave it
  alone. Do not revert it; decide with the owner whether it rides along in this commit.

---

## Task 1 — finish the migration (do this first, it is blocking)

### 1a. Prune the v1 pipeline

A prior session was blocked by the permission classifier on this. All files are
committed in git history and archived under `.state/plans/legacy/20260916-232013/`,
so this is recoverable. Ask the owner to run it, or run it yourself if permitted:

```
git rm -q .claude/agents/{engineering-manager,product-manager,principal-engineer,software-developer,build-specialist,quality-assurance}.md .claude/commands/{kickoff,kickoff-complex,show-me,prep-build-verify,prep-em-done,prep-em-tasks,prep-pe-design,prep-pm-accept,prep-pm-discover,prep-qa-review,prep-sde-implement,run-build,run-pe,run-pm,run-qa,run-sde}.md scripts/run-{product-manager,software-developer,quality-assurance,principal-engineer,build-specialist}.sh .state/feature-state.json .state/inbox/.gitkeep && rm -rf .state/inbox
```

Keep `.claude/commands/commit-only.md` and `commit-and-push.md` — still useful.

### 1b. Retire the v1 prose

`docs/AI-REPO-MAINTENANCE.md` and `docs/CLAUDE.BLUEPRINT.md` still describe the
EM/inbox pipeline in detail. Either delete them or rewrite them for v2. Confirm which
with the owner — they may have sentimental/reference value.

### 1c. Gate and commit

This diff touches `.claude/**` + `.harness/**` → `scrutiny.toml` row
`harness-and-config` → **slim gate, adversary only**. Run `/gate`, let the Adversary
write its verdict into a plan doc bound to the sha, fix anything it finds, then commit
**staged by name** (never `git add .`). Then open a PR to `main`.

### 1d. Report the upstream bug

The public bootstrap at `dtammam/handoff-harness` `install.sh:22-25` passes
`--source <path>` / `--target <path>` (space-separated), but `harnesses/install.sh`
parses only `--source=<path>` / `--target=<path>`. Result:
`curl ... | bash -s -- --migrate` dies with `unknown flag: --source`. The migration
here only completed because the inner installer was invoked directly. **Fix it in the
harness repo** — every other repo the owner migrates will hit this.

---

## Task 2 — the roadmap (after the migration merges)

Three pieces, each its **own branch + own plan doc**. Full acceptance criteria and
blind-spot questions are in the roadmap doc; do not re-derive them.

| Order | Piece | Branch | Anchor |
|-------|-------|--------|--------|
| 1st | Add-task resilience — opening details on a just-added task remounts/reloads during the temp→saved swap | `fix/add-task-details-reload` | `outcome` |
| 2nd | Bulk task ops — quick delete, multi-select, bulk delete, clone, bulk move to another list | `feat/bulk-task-ops` | `outcome` (bulk delete auto-forces **full gate** via `deletes-data`) |
| 3rd | Optional per-task emoji — dropdown field, sort/group within a list, carried into exports | `feat/task-emoji` | **`spec`** (differs from project default) |

### Two open questions — ask the owner at intake, do not assume

1. **Is this order right?** It was recommended, not confirmed. Rationale: the bug fix
   is the daily friction and is smallest; bulk ops are UI/store work on an unchanged
   data model; emoji is last because it touches client store + IDB schema + sync wire
   format + SQLite + exports simultaneously, and deserves the most context.
2. **What does "emoji sort" mean?** Group-by-emoji sections within a list, or a sort
   key alongside existing sorts? The roadmap recommends group-by (it is what the
   grocery use-case actually wants) but the owner has not answered.

### Why emoji gets a `spec` anchor

The project default is `outcome`. Adding a field to the task model is precisely the
case `AGENTS.md` flags as an attack surface — "a partial change corrupts sync." A
decision register (field name, nullability, wire encoding, sort semantics, export
column, migration path) should be approved at a sha *before* code exists. Argue this
with the owner at intake per Phase 1; they decide.

---

## Standing constraints (these bite on all three pieces)

- **Offline-first.** Every new behavior works with no server reachable. The server is
  a sync rendezvous, not a runtime dependency.
- **Sync stays idempotent** in both directions, including with a mixed client
  population that predates a new field.
- **Performance budgets** in `docs/RELIABILITY.md` are hard stops — flag regression
  risk *before* building, not after.
- **Never self-merge, never `--no-verify`, never force-push, stage by name.**
- **Report failures verbatim** with counts before any framing.

## Context on the owner

Uses TaskSync every single day and is deeply invested in polish — friction is a bug,
not a nice-to-have. The roadmap was drafted under a tight model-budget constraint
specifically so an Opus session could execute without re-doing the thinking. Respect
that: read the roadmap doc rather than re-planning from scratch.
