# tasksync

A fast, offline-friendly task manager you host yourself.

<p align="center">
    <img src="assets/images/tasksync_icon.png" alt="tasksync app icon" width="120">
</p>

<table>
    <tr>
        <td align="center">
            <img src="assets/images/desktop_example.png" alt="tasksync on a desktop browser" width="620">
        </td>
        <td align="center">
            <img src="assets/images/iphone_example.png" alt="tasksync on an iPhone" width="280">
        </td>
    </tr>
</table>

tasksync is a personal task app designed to open fast, work offline, and sync when a connection is available. It runs on your own server so your data stays with you.

## Features

- **Works offline** — tasks save to your device immediately. Changes sync to the server when you reconnect.
- **Installable on your phone** — add it to your home screen like a native app (PWA).
- **My Day workflow** — plan your day with recurring tasks, due dates, notes, and list views.
- **Multi-user support** — invite others as contributors while keeping admin controls server-side.
- **Backup and restore** — admin tools for exporting and importing your data.
- **Self-hosted with Docker** — one `docker compose up` to get running.

## Quick Start (Docker)

You'll need **Docker** and **Docker Compose** installed on your machine.
If you don't have them yet, follow the [Docker install guide](https://docs.docker.com/get-docker/).

### 1. Download the project

```bash
git clone https://github.com/dtammam/tasksync.git
cd tasksync
```

### 2. Set up your environment file

Copy the example configuration and open it in a text editor:

```bash
cp .env.example .env
```

Open `.env` and change these values:

| Variable | What to put | Why |
|----------|------------|-----|
| `JWT_SECRET` | A long random string (32+ characters) | Secures login sessions |
| `SEED_ADMIN_PASSWORD` | A password you'll remember | Your admin login |
| `SEED_CONTRIB_PASSWORD` | A different password | Login for additional users |

The other values have sensible defaults. You can change the ports (`SERVER_HOST_PORT`, `WEB_HOST_PORT`) if they conflict with something else on your machine.

### 3. Start it up (first time)

```bash
docker compose pull
COMPOSE_PROFILES=setup docker compose up -d
```

This downloads the app images and creates two default accounts:

- **Admin:** `admin@example.com` with the password you set in `SEED_ADMIN_PASSWORD`
- **Contributor:** `contrib@example.com` with the password you set in `SEED_CONTRIB_PASSWORD`

### 4. Open the app

- **Web app:** [http://localhost:5173](http://localhost:5173)
- **API:** [http://localhost:3000](http://localhost:3000)

(If you changed the port numbers in `.env`, use those instead.)

### 5. Day-to-day usage

After the first run, you don't need the setup profile. Just start normally:

```bash
docker compose up -d
```

To update to the latest version:

```bash
docker compose pull
docker compose up -d
```

To stop:

```bash
docker compose down
```

## Operating Notes

- Your database is stored in a Docker volume (`tasksync_data` by default). Your data persists across restarts and updates.
- **Reverse proxy:** if you're putting tasksync behind nginx or Caddy, set `VITE_API_URL` (often `/api`) and `VITE_ALLOWED_HOSTS` in `.env`.
- **Multiple environments:** to run separate prod/beta stacks, use different values for `TASKSYNC_DATA_SOURCE`, `SERVER_HOST_PORT`, and `WEB_HOST_PORT`.
- **Image channels:** the `main` branch publishes Docker images as `latest`; other branches publish as `beta`. Set `TASKSYNC_IMAGE_TAG` in `.env` to choose.

## Developing Locally (Optional)

This section is for people who want to modify the code or run tests. If you just want to use tasksync, the Docker setup above is all you need.

### What you'll need

- **Node.js 22+** — [nodejs.org](https://nodejs.org) or via [nvm](https://github.com/nvm-sh/nvm)
- **Rust (stable)** — [rustup.rs](https://rustup.rs) (installs `cargo`, `rustfmt`, `clippy`)
- **Playwright browsers** (for end-to-end tests) — run once after installing Node dependencies:

```bash
cd web && npx playwright install --with-deps chromium
```

### Running from source

Start the server:

```bash
cd server
cargo run
```

In a separate terminal, start the web app:

```bash
cd web
npm install
npm run dev
```

### Git hooks

The repo includes pre-commit and pre-push hooks for automated checks. Set them up once after cloning:

```bash
ln -sf ../../hooks/pre-commit .git/hooks/pre-commit
ln -sf ../../hooks/pre-push .git/hooks/pre-push
chmod +x .git/hooks/pre-commit .git/hooks/pre-push
```

What they check:
- **Pre-commit:** linting, TypeScript types, unit tests (web), code formatting and lint (server)
- **Pre-push:** unit tests, browser smoke tests (Chromium), server tests — set `SKIP_PLAYWRIGHT=1` to skip browser tests locally

## Project History

This project started on 2026-01-31 and became a fully functional system by 2026-02-08, with Docker images published and a complete transition off Microsoft To Do - updates since have been scratching itches as they come up, which can be followed in `docs/exec-plans/completed`. For deeper technical docs, start at `docs/index.md`.

## License

[MIT](LICENSE)
