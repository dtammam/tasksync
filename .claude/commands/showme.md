# Show me what happened.

A read-only status command that provides visibility into what the last agent did, where we are in the workflow, and what comes next. Useful after running a specialist agent in a second session.

## Input

$ARGUMENTS is not typically needed.

## Procedure

Do ALL of the following, then present a single cohesive summary:

### 1. Identify the current stage and last agent

Read `.state/feature-state.json`. From the `history` array, identify:
- The **current stage** (the `stage` field at the top level)
- The **last history entry** — this tells you what stage just completed and often which agent was involved
- All **tasks** and their statuses

Map the last stage transition to the agent that ran:
- `discovery` → Product Manager
- `design` → Principal Engineer
- `tasks` → Engineering Manager
- `implementation` → Software Developer
- `verification` → Build Specialist
- `review` → Quality Assurance
- `acceptance` → Product Manager

### 2. Read the last agent's inbox

Based on the agent identified above, read the corresponding inbox file from `.state/inbox/`:
- Product Manager → `.state/inbox/product-manager.md`
- Principal Engineer → `.state/inbox/principal-engineer.md`
- Software Developer → `.state/inbox/software-developer.md`
- Build Specialist → `.state/inbox/build-specialist.md`
- Quality Assurance → `.state/inbox/quality-assurance.md`

Summarize what the agent was asked to do (the "mission" from the inbox).

### 3. Check what files changed

Run `git diff --stat` and `git diff --name-only` to see what files were modified since the last commit. If there are no uncommitted changes, check `git log --oneline -5` for recent commits on this branch.

This tells you what the agent actually touched.

### 4. Check the exec plan

Read the exec plan from the `artifacts.exec_plan` path in the state file. Note any progress log entries, task completions, or open items.

### 5. Present the summary

Format your output as:

```
## Status: [feature name]

**Stage:** [current stage]
**Last agent:** [agent name] ([what it was asked to do — 1 sentence])

### What changed
[List of files touched with brief description of changes]

### Where we are
[Current task status — which tasks are done, which are pending]
[Any relevant notes from the history or progress log]

### Next step
[What the user should do next — which command to run]
```

Keep it concise. The goal is a quick, clear snapshot — not a deep analysis.

---

## Rules

- This is READ-ONLY. Do not modify any state files, inbox files, or code.
- Do not invoke any agents. Do not route to the EM.
- If there is no active feature (empty or missing state file), say so and stop.
- If an inbox file is empty or missing, note that the agent hasn't been routed yet.
