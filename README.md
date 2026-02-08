# tasksync

tasksync is a cross-platform, self-hosted task management system built for speed, privacy, and flexibility.

<p align="center">
    <img src="assets/images/tasksync_icon.png" alt="tasksync app icon" width="120">
</p>

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

I personally use this in two ways:
1. As a PWA app on my iPhone (Launched it in Safari, saved to home screen as a web ap)
2. As a PWA in Windows (launched in Edge, installed as a Progressive Web app)

It works well in a web browser, but that "app" experience is pretty nifty.

## Highlights

- Local-first PWA with per-user IndexedDB cache, offline queueing, and resilient background sync.
- Customizable completion sound effects: up to 8 user-selected sounds played in randomized sequence, with persisted profile settings.
- Color-coding for lists and tasks to improve scanability and visual organization.
- Multi-user management with tiered permissions: admins have full access, contributors can add/edit only on explicitly granted lists.
- Team administration in sidebar: member creation, password lifecycle flows, and list-grant controls.
- Fast My Day execution flow with due dates, recurrence, notes, attachments, and missed-task recovery actions.
- Admin-gated JSON backup/restore for recoverable space snapshots.
- Self-host ready: Rust + SQLite backend, SvelteKit frontend, Docker/Compose deployment support.

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

- This started on 2026-01-31 and by god, with Codex, Cursor, a framework of linting and testing in real-time, by 2026-02-08 I had a fully functional system with Docker images published and fully transitioned off of Microsoft To-Do. The future is now and it is amazing!
- See `PROGRESS.md` for release-style milestones in human/goal context.

## License

[MIT](LICENSE)
