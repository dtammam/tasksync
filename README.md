# tasksync

tasksync is a cross-platform, self-hostable task management platform with recurrence, lists and attachments.

<table>
    <tr>
        <td align="center">
            <img src="assets/images/desktop_example.png" alt="tasksync desktop view" width="620">
        </td>
        <td align="center">
            <img src="assets/images/iphone_example.png" alt="tasksync iPhone view" width="280">
        </td>
    </tr>
</table>

This project was inspired by one very specific frustration: opening Microsoft To Do on phone and waiting 5-7 seconds each time made my soul sad. tasksync is the "open now, move now" version of that workflow, with local-first behavior and simple self-hosting.

## Highlights

- Local-first PWA with per-user device cache (IndexedDB) and background sync.
- Shared lists with roles: admin + contributor.
- Quick My Day flow with due dates, recurrence, notes, list moves, and task details.
- Team management in sidebar (member creation, password reset, list grants).
- Self-host ready: Rust + SQLite backend, SvelteKit frontend, Docker images published.

## Quick Start (Dev)

- Server: `cd server` then `cargo run`.
- Web: `cd web` then `npm install` and `npm run dev`.
- Optional seed data: `cd server` then `cargo run --bin seed`.
- Full local checks: `scripts/4-prepush.ps1`.

Default seed users:
- `admin@example.com` / `tasksync`
- `contrib@example.com` / `tasksync`

## Self-Hosting (Docker Hub Latest)

Published images:
- `deantammam/tasksync-server:latest`
- `deantammam/tasksync-web:latest`

`docker-compose.yml` already references these `latest` tags.

Typical flow:
1. Set env vars (`DATABASE_URL`, `JWT_SECRET`, seed passwords).
2. Run `docker compose up -d`.
3. Seed once: `docker compose --profile setup run --rm seed`.
4. Log in with seeded admin/contributor accounts and change passwords.

Reverse proxy setup (recommended):
- Set `VITE_API_URL=/api` for the web container.
- Set `VITE_ALLOWED_HOSTS` to your hostnames (example: `tasksync.example.com`).
- Route `/api/*` to the server container and `/` to the web container.

## Offline and Sync Behavior

- Signed-in users keep a local cache on each device.
- If server connectivity drops, edits stay local and queued.
- When the app regains focus/connectivity, background sync reconciles changes.
- Manual `Refresh` is available in the header for a full page reload.

## Repository Layout

- `web/`: SvelteKit app, Vitest + Playwright tests.
- `server/`: Axum + SQLx + SQLite API server.
- `shared/`: shared TypeScript types.
- `docs/`: architecture and workflow docs.
- `assets/images/`: screenshots used in this README.

## Project History

- See `PROGRESS.md` for release-style milestones in human/goal context.

## License

[MIT](LICENSE)
