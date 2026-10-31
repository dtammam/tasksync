# Integration API

A static-token HTTP API for scripts, shortcuts, and assistants that need to read
TaskSync tasks and check them off without a login. Everything is under `/api` on
the server (for example `https://api.example.com/api/tasks`).

Completing a task here does exactly what tapping it in the web app does. Open
apps pick the change up on their next sync.

## Setup

| Variable | Required | Meaning |
|---|---|---|
| `TASK_API_TOKEN` | no | Create-only token: `POST /api/tasks`. At least 24 characters. |
| `TASK_AGENT_TOKEN` | no | Read, complete, uncomplete and create. At least 24 characters, and must differ from `TASK_API_TOKEN`. Without it, the read and complete routes do not exist (empty `404`). |
| `TASK_API_USER_EMAIL` | no | The member both tokens act as. "Today" and permissions follow this member. Unset means the oldest admin. If the email matches no member, the server refuses to boot. |
| `TZ` | recommended | IANA zone (`America/New_York`) or a POSIX TZ string. Decides the server's "today". Unset means the host zone (UTC in the stock image), with a boot warning. An unknown zone refuses to boot. |

Leave unused tokens out of the environment rather than setting them to an empty
value: an empty token fails the length check at boot.

Generate a token with `openssl rand -hex 24`.

Send the token in the `X-TaskSync-Api-Token` header. Never put it in a URL.

### Scopes

| Route | `TASK_API_TOKEN` | `TASK_AGENT_TOKEN` |
|---|---|---|
| `POST /api/tasks` | yes | yes |
| `GET /api/tasks`, `GET /api/lists` | `403 forbidden_scope` | yes |
| `POST /api/tasks/:id/complete`, `/uncomplete` | `403 forbidden_scope` | yes |

## Errors

Every error after the feature-off gate has the same shape:

```json
{ "error": { "code": "due_date_mismatch", "message": "expected_due_date does not match the task's current due_date — re-read the task" } }
```

Branch on `code`. The `message` text is for humans and may change.

| Status | `code` | When |
|---|---|---|
| 401 | `unauthorized` | Header missing or wrong, or the acting member cannot be resolved. |
| 403 | `forbidden_scope` | The token lacks the scope this route needs. |
| 403 | `forbidden` | The acting member is a contributor and did not create this task. |
| 404 | `not_found` | No task with this id in the space. |
| 404 | `unknown_list` | `POST /api/tasks` named a `list_id` that does not exist. |
| 400 | `invalid_query` | `GET /api/tasks` got a bad `view`, `status` or `include_done_today`. |
| 400 | `invalid_request` | A malformed JSON body, an unknown body field, or a date that is not `YYYY-MM-DD`. |
| 409 | `due_date_mismatch` | `expected_due_date` is not the task's current `due_date`, and the task was not completed today. Your copy is stale: re-read it. |
| 409 | `not_completed` | Uncomplete found nothing to undo. |
| 409 | `concurrent_update` | The task changed while the request ran. Re-read and retry. |
| 409 | `conflict` | `POST /api/tasks` with an id that exists and could not be reconciled. |
| 500 | `internal_error` | Server fault. |

An empty-bodied `404` with no `Content-Type` means the route is switched off
(no token configured for it), not that a task is missing.

## Task shape

`GET /api/tasks`, `complete` and `uncomplete` return the stored task row:

```json
{
  "id": "6b0f…",
  "space_id": "s1",
  "title": "Morning meditation",
  "status": "pending",
  "list_id": "e4f7b340-91cc-4141-a02e-6b4315e4c092",
  "my_day": 1,
  "priority": 0,
  "order": "a",
  "updated_ts": 1793462400123,
  "created_ts": 1790000000000,
  "url": null,
  "recur_rule": "daily",
  "due_date": "2026-10-31",
  "punted_from_due_date": null,
  "punted_on_date": null,
  "emoji": "🧘",
  "occurrences_completed": 41,
  "completed_ts": 1793380000000,
  "notes": null,
  "assignee_user_id": null,
  "created_by_user_id": "u-…"
}
```

Timestamps are Unix milliseconds. Dates are `YYYY-MM-DD`. `recur_rule` is one of
`daily`, `weekdays`, `weekly`, `biweekly`, `monthly`, `quarterly`, `biannual`,
`annual`, `lastDayOfMonth`, or `null` for a one-off task.

## `GET /api/lists`

Returns every list visible to the acting member, with the same rows the app uses.

```sh
curl -s https://api.example.com/api/lists -H "X-TaskSync-Api-Token: $TASK_AGENT_TOKEN"
```

```json
[
  { "id": "l-inbox", "space_id": "s1", "name": "Inbox", "icon": "📥", "color": null, "default_emoji": null, "order": "a" }
]
```

## `GET /api/tasks`

| Parameter | Default | Meaning |
|---|---|---|
| `view` | `today` | `today` returns the web app's My Day for the acting member: pending tasks with `my_day` set or due today, not overdue. `all` returns every visible task. |
| `include_done_today` | `true` | With `view=today`, also returns My Day items completed today, including recurring tasks completed today. Ignored for `view=all`. |
| `q` | | Case-insensitive substring match on the title. The server does no fuzzy matching: fetch candidates and match on your side. |
| `list_id` | | Only tasks in this list. |
| `status` | | `pending`, `done` or `cancelled`. |

```sh
curl -s "https://api.example.com/api/tasks?view=today" -H "X-TaskSync-Api-Token: $TASK_AGENT_TOKEN"
```

```json
{
  "today": "2026-10-31",
  "view": "today",
  "tasks": [
    { "id": "6b0f…", "title": "Morning meditation", "recur_rule": "daily", "due_date": "2026-10-31", "…": "…",
      "is_recurring": true, "done_today": false, "next_due_date": "2026-11-01" }
  ]
}
```

- `today` is the server's date (from `TZ`). Use it rather than your own clock.
- `done_today`: this task's current occurrence was completed today. A recurring
  task stays `pending` after completion and moves to its next `due_date`, so this
  flag is how you tell it is done.
- `next_due_date`: the due date that completing the task now would move it to,
  or `null` for a one-off task.

## `POST /api/tasks/:id/complete`

Body (optional):

```json
{ "expected_due_date": "2026-10-31" }
```

Send the `due_date` you read. It makes retries safe and stops a stale caller from
completing the wrong occurrence.

What completion does:

- **Recurring task:** `status` stays `pending`. `due_date` moves to the next
  occurrence after the current one, counted from `punted_from_due_date` if the
  task was punted, otherwise from `due_date`. `occurrences_completed` goes up by
  1, `completed_ts` becomes now, and punt fields are cleared. Everything else,
  including `emoji`, is untouched.
- **One-off task:** `status` becomes `done` and `completed_ts` becomes now.

Idempotency. The first two cases return `200` and write nothing:

| Situation | Result |
|---|---|
| One-off already `done` | `200`, `already_done: true` |
| Recurring, `expected_due_date` ≠ current `due_date`, completed today | `200`, `already_done: true` (your retry) |
| Recurring, `expected_due_date` ≠ current `due_date`, not completed today | `409 due_date_mismatch` |
| Recurring, no `expected_due_date`, completed today | `200`, `already_done: true` |
| Recurring, `expected_due_date` = current `due_date` | Completes that occurrence, even if an earlier one was completed today |

```sh
curl -s -X POST https://api.example.com/api/tasks/6b0f…/complete \
  -H "X-TaskSync-Api-Token: $TASK_AGENT_TOKEN" -H "Content-Type: application/json" \
  -d '{"expected_due_date":"2026-10-31"}'
```

```json
{
  "task": { "id": "6b0f…", "status": "pending", "due_date": "2026-11-01", "occurrences_completed": 42, "completed_ts": 1793466000000, "…": "…" },
  "completed": true,
  "already_done": false,
  "previous_due_date": "2026-10-31",
  "next_due_date": "2026-11-01"
}
```

When `already_done` is `true`, `previous_due_date` is `null` and `next_due_date`
is the task's current due date (or `null` for a one-off task).

## `POST /api/tasks/:id/uncomplete`

The "undo that" call. Body (optional; both fields come from the complete
response):

```json
{ "previous_due_date": "2026-10-31", "expected_due_date": "2026-11-01" }
```

- **Recurring task completed today:** `due_date` steps back,
  `occurrences_completed` goes down by 1 (never below 0), and `completed_ts` is
  cleared. When `previous_due_date` is within one recurrence step before the
  current due date, it is restored exactly. That matters at month ends and for
  punted tasks. Otherwise the server steps back one occurrence, as the web
  app's undo does. Punt state is not restored.
- **Done task:** `status` becomes `pending` and `completed_ts` is cleared.
- **Nothing to undo** (a recurring task not completed today, or a task that is
  not `done`): `409 not_completed`.
- `expected_due_date` ≠ current `due_date`: `409 due_date_mismatch`.

```sh
curl -s -X POST https://api.example.com/api/tasks/6b0f…/uncomplete \
  -H "X-TaskSync-Api-Token: $TASK_AGENT_TOKEN" -H "Content-Type: application/json" \
  -d '{"previous_due_date":"2026-10-31","expected_due_date":"2026-11-01"}'
```

```json
{ "task": { "id": "6b0f…", "due_date": "2026-10-31", "occurrences_completed": 41, "completed_ts": null, "…": "…" }, "uncompleted": true }
```

## `POST /api/tasks`

Creates a task. Both tokens can call it. The body is the app's create shape;
`title` and `list_id` are required. Send your own `id` (a UUID) to make retries
idempotent.

```sh
curl -s -X POST https://api.example.com/api/tasks \
  -H "X-TaskSync-Api-Token: $TASK_AGENT_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Buy milk","list_id":"l-inbox","my_day":true}'
```

Returns `201` with the task row, or `200` with the existing row on an idempotent
retry.

## Notes

- **Month ends:** monthly, quarterly, biannual and annual steps clamp to the
  last day of a shorter month (Jan 31 → Feb 28). From then on the task stays on
  the 28th. For a true end-of-month task, use `lastDayOfMonth`.
- **Streaks:** completions made here don't add to the app's combo. If one
  finishes My Day, the day-complete celebration plays on the device at its next
  sync.
- **Concurrency:** each write applies only if the task has not changed since
  the server read it. Otherwise you get `409 concurrent_update`.
