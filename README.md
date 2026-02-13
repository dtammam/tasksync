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
1. As a PWA app on my iPhone (Launched it in Safari, saved to home screen as a web app)
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

## Self-Hosting (Docker Hub Channels)

Published images:
- `deantammam/tasksync-server:latest`
- `deantammam/tasksync-web:latest`

- `deantammam/tasksync-server:beta`
- `deantammam/tasksync-web:beta`

Tag policy:
- `main` branch pushes publish `:latest` (stable channel).
- any non-`main` branch push publishes `:beta` (working channel).

`docker-compose.yml` defaults to `latest` and can switch channels with `TASKSYNC_IMAGE_TAG`.

Portainer-first context (current revision):
- This compose file uses a declared volume alias (`tasksync_data`) mounted at `/data`.
- `TASKSYNC_DATA_SOURCE` controls the actual Docker volume name used by that alias.
- Default is `tasksync_data`.
- In Portainer, give each stack its own value (for example `tasksync_prod_data` and `tasksync_beta_data`) so prod/beta stay isolated.

Create a `.env` file in this folder (same level as `docker-compose.yml`):

```env
DATABASE_URL=sqlite:///data/tasksync.db
JWT_SECRET=super-long-randomsecret
DEV_LOGIN_PASSWORD=tasksync
RUST_LOG=info
TASKSYNC_IMAGE_TAG=latest
SERVER_HOST_PORT=3000
TASKSYNC_DATA_SOURCE=tasksync_data
WEB_HOST_PORT=5173
SEED_ADMIN_PASSWORD=Replacethis
SEED_CONTRIB_PASSWORD=Replacethistoo
# Remove post-first seed:
COMPOSE_PROFILES=setup
```

Optional web/reverse-proxy variables:
- `VITE_ALLOWED_HOSTS=tasksync.example.com` (comma-separated hostnames)
- `VITE_API_URL=/api` (runtime env, can be set directly in Portainer stack env vars)

### Stack Variable Reference

- `DATABASE_URL`: SQLite DSN used by server and seed job. Keep as `sqlite:///data/tasksync.db` for default container path.
- `JWT_SECRET`: Required signing secret for auth tokens.
- `DEV_LOGIN_PASSWORD`: Legacy/dev fallback password for rows that do not yet have a password hash.
- `RUST_LOG`: Server log verbosity (for example `info`).
- `TASKSYNC_IMAGE_TAG`: Optional Docker image tag channel used by server/web/seed services (`latest` or `beta`), uses `latest` if undefined.
- `SERVER_HOST_PORT`: Host port mapped to server container port `3000` (for example `3000` prod, `3001` beta).
- `WEB_HOST_PORT`: Host port mapped to web container port `5173` (for example `5173` prod, `5174` beta).
- `TASKSYNC_DATA_SOURCE`: Docker volume name used for persistent `/data` storage (for example `tasksync_prod_data` or `tasksync_beta_data`).
- `SEED_ADMIN_PASSWORD`: Password used by one-time seed flow for `admin@example.com`.
- `SEED_CONTRIB_PASSWORD`: Password used by one-time seed flow for `contrib@example.com`.
- `VITE_API_URL`: Runtime API base URL injected into web container startup config (for example `https://api-beta.example.com` or `/api`).
- `VITE_ALLOWED_HOSTS`: Comma-separated host allow-list for Vite preview server (for example `tasksync.example.com,tasksync-beta.example.com`).
- `COMPOSE_PROFILES`: One-time profile selector for seeding. Set to `setup` for first deploy, then remove (or clear) it for normal deploys.

Example split for parallel stacks on one host:
- prod: `TASKSYNC_IMAGE_TAG=latest`, `SERVER_HOST_PORT=3000`, `WEB_HOST_PORT=5173`, `TASKSYNC_DATA_SOURCE=tasksync_prod_data`
- beta: `TASKSYNC_IMAGE_TAG=beta`, `SERVER_HOST_PORT=3001`, `WEB_HOST_PORT=5174`, `TASKSYNC_DATA_SOURCE=tasksync_beta_data`

Typical flow:
1. Fill out `.env` values (`JWT_SECRET` and seed passwords should be replaced).
2. Run `docker compose pull`.
3. Run `docker compose up -d`.
4. First deploy only: set `COMPOSE_PROFILES=setup` so seed runs automatically as part of the stack deploy.
5. After initial successful seed, remove `COMPOSE_PROFILES` (or set it empty) for normal deploys.
6. Manual fallback seed once (if needed): `docker compose --profile setup run --rm seed`.
7. Log in with seeded admin/contributor accounts and change passwords.

Reverse proxy setup (recommended):
- Set `VITE_ALLOWED_HOSTS` to your hostnames (example: `tasksync.example.com`).
- Route `/api/*` to the server container and `/` to the web container.

## CI Docker Publishing Setup

The repository now publishes Docker images directly from GitHub Actions (`.github/workflows/ci.yml` publish job).
Publishing only runs after the web/server CI jobs pass.

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
- See [PROGRESS.md](PROGRESS.md) for release-style milestones in human/goal context.
- See [ROADMAP.md](ROADMAP.md) for what's next.

## License

[MIT](LICENSE)
