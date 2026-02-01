mod routes;

use axum::{routing::get, Router};
use routes::{list_routes, task_routes};
use sqlx::sqlite::SqlitePoolOptions;
use std::{env, net::SocketAddr, path::Path};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let database_url =
        env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://./data/tasksync.db".to_string());

    if database_url.starts_with("sqlite://") {
        let path = database_url.trim_start_matches("sqlite://");
        if let Some(dir) = Path::new(path).parent() {
            std::fs::create_dir_all(dir)?;
        }
    }

    let pool = SqlitePoolOptions::new().max_connections(5).connect(&database_url).await?;

    sqlx::migrate!().run(&pool).await?;

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .nest("/lists", list_routes(&pool))
        .nest("/tasks", task_routes(&pool));

    let addr: SocketAddr = SocketAddr::from(([0, 0, 0, 0], 3000));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("listening on {addr}");
    axum::serve(listener, app).await?;
    Ok(())
}
