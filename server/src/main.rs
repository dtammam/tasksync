mod routes;

use axum::{routing::get, Router};
use routes::{auth_routes, list_routes, sync_routes, task_routes};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::{env, net::SocketAddr, path::PathBuf, str::FromStr};
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let database_url = env::var("DATABASE_URL").unwrap_or_else(|_| {
        let mut path = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        path.push("../data/tasksync.db");
        let normalized = path.canonicalize().unwrap_or(path).to_string_lossy().replace('\\', "/");
        format!("sqlite://{}", normalized)
    });

    if let Some(path_str) = database_url.strip_prefix("sqlite://") {
        let path = PathBuf::from(path_str);
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
    }

    let connect_opts =
        SqliteConnectOptions::from_str(&database_url)?.create_if_missing(true).foreign_keys(true);

    let pool = SqlitePoolOptions::new().max_connections(5).connect_with(connect_opts).await?;

    sqlx::migrate!().run(&pool).await?;

    let app = Router::new()
        .route("/", get(|| async { "tasksync server ready" }))
        .route("/health", get(|| async { "ok" }))
        .nest("/auth", auth_routes(&pool))
        .nest("/lists", list_routes(&pool))
        .nest("/tasks", task_routes(&pool))
        .nest("/sync", sync_routes(&pool))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([
                    axum::http::Method::GET,
                    axum::http::Method::POST,
                    axum::http::Method::PATCH,
                    axum::http::Method::PUT,
                    axum::http::Method::DELETE,
                    axum::http::Method::OPTIONS,
                ])
                .allow_headers(Any),
        );

    let port =
        env::var("PORT").ok().and_then(|value| value.trim().parse::<u16>().ok()).unwrap_or(3000);
    let addr: SocketAddr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("listening on {addr}");
    axum::serve(listener, app).await?;
    Ok(())
}
