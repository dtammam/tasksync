# tasksync server

Axum + SQLx scaffold.

## Run
- Install Rust toolchain (1.82+ recommended).
- `cargo run -p tasksync-server` to start (defaults to `0.0.0.0:3000`).
- `cargo fmt`, `cargo clippy -- -D warnings`, `cargo test` before committing.

## Notes
- SQLite WAL expected; migrations live in `server/migrations/`.
- Health check is available at `/health`.
