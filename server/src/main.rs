mod routes;

use axum::{
    http::{
        header::{AUTHORIZATION, CONTENT_TYPE},
        HeaderValue,
    },
    routing::get,
    Router,
};
use routes::{auth_routes, list_routes, sync_routes, task_routes, validate_boot_secrets};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::{env, net::SocketAddr, path::PathBuf, str::FromStr};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// Origins that are always allowed, regardless of `CORS_ALLOWED_ORIGINS`:
/// the Capacitor iOS shell (no `server.iosScheme` override in
/// `web/capacitor.config.ts`, so Capacitor's default scheme applies), the
/// SvelteKit dev server, and the Playwright preview server. Baked in so an
/// operator can never accidentally drop them.
const DEFAULT_ALLOWED_ORIGINS: [&str; 3] =
    ["capacitor://localhost", "http://localhost:5173", "http://localhost:4173"];

/// Parses `CORS_ALLOWED_ORIGINS` (comma-separated exact origins) into the
/// effective CORS allow-list: the union of the baked-in defaults and every
/// entry in `raw`. Unset/empty/whitespace-only input yields the defaults
/// only. A malformed entry is a boot failure (`Err` naming the entry) —
/// fail-closed, because a silently dropped origin would mean a silently
/// broken production frontend.
fn parse_allowed_origins(raw: Option<String>) -> Result<Vec<HeaderValue>, String> {
    let mut origins: Vec<HeaderValue> =
        DEFAULT_ALLOWED_ORIGINS.iter().map(|origin| HeaderValue::from_static(origin)).collect();

    let raw = match raw {
        Some(value) if !value.trim().is_empty() => value,
        _ => return Ok(origins),
    };

    for entry in raw.split(',') {
        let entry = entry.trim();
        if entry.is_empty() {
            // A stray comma drops nothing, so it is not a fail-closed concern.
            continue;
        }
        origins.push(parse_origin_entry(entry)?);
    }
    Ok(origins)
}

/// Validates a single allow-list entry as an exact origin —
/// scheme + host [+ port], no path, no trailing slash.
fn parse_origin_entry(entry: &str) -> Result<HeaderValue, String> {
    let err = || {
        format!(
            "invalid CORS_ALLOWED_ORIGINS entry \"{entry}\": expected an exact origin \
             (scheme://host[:port], no path, no trailing slash), e.g. https://tasks.example.com"
        )
    };

    let (scheme, host) = entry.split_once("://").ok_or_else(err)?;
    let scheme_valid = scheme.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && scheme.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    let host_valid =
        !host.is_empty() && !host.contains(['/', '?', '#']) && !host.contains(char::is_whitespace);
    if !scheme_valid || !host_valid {
        return Err(err());
    }
    HeaderValue::from_str(entry).map_err(|_| err())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Local-dev secret sourcing: load the repo-root `.env` if present.
    // dotenvy never overrides already-set process env, so real environment
    // variables (production/Docker) always win.
    match dotenvy::dotenv() {
        Ok(path) => tracing::info!("loaded .env from {}", path.display()),
        Err(err) if err.not_found() => {
            tracing::info!("no .env file found; using process environment only");
        }
        Err(err) => return Err(err.into()),
    }

    // Fail-closed boot preflight: refuse default/placeholder secrets in every
    // run mode, before touching the database.
    if let Err(message) = validate_boot_secrets() {
        tracing::error!("boot preflight failed:\n{message}");
        anyhow::bail!("boot preflight failed — fix the secret configuration above and restart");
    }

    // Fail-closed CORS preflight: a malformed allow-list entry refuses to
    // boot rather than silently dropping an origin.
    let cors_origins = match parse_allowed_origins(env::var("CORS_ALLOWED_ORIGINS").ok()) {
        Ok(origins) => origins,
        Err(message) => {
            tracing::error!("boot preflight failed:\n{message}");
            anyhow::bail!("boot preflight failed — fix CORS_ALLOWED_ORIGINS above and restart");
        }
    };

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
                .allow_origin(AllowOrigin::list(cors_origins))
                .allow_methods([
                    axum::http::Method::GET,
                    axum::http::Method::POST,
                    axum::http::Method::PATCH,
                    axum::http::Method::PUT,
                    axum::http::Method::DELETE,
                    axum::http::Method::OPTIONS,
                ])
                .allow_headers([AUTHORIZATION, CONTENT_TYPE]),
        );

    let addr: SocketAddr = SocketAddr::from(([0, 0, 0, 0], 3000));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("listening on {addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origin_strs(origins: &[HeaderValue]) -> Vec<&str> {
        origins.iter().map(|v| v.to_str().expect("origin is valid ASCII")).collect()
    }

    #[test]
    fn unset_input_yields_exactly_the_three_baked_in_defaults() {
        let origins = parse_allowed_origins(None).expect("unset input is valid");
        assert_eq!(
            origin_strs(&origins),
            vec!["capacitor://localhost", "http://localhost:5173", "http://localhost:4173"]
        );
    }

    #[test]
    fn empty_and_whitespace_input_yield_defaults_only() {
        for raw in ["", "   ", "\t"] {
            let origins = parse_allowed_origins(Some(raw.to_string()))
                .unwrap_or_else(|_| panic!("input {raw:?} should be valid"));
            assert_eq!(origins.len(), 3, "input {raw:?} should yield the defaults only");
        }
    }

    #[test]
    fn valid_list_yields_union_of_defaults_and_entries() {
        let raw = "https://tasks.example.com, https://beta.example.com:8443";
        let origins = parse_allowed_origins(Some(raw.to_string())).expect("valid list");
        assert_eq!(
            origin_strs(&origins),
            vec![
                "capacitor://localhost",
                "http://localhost:5173",
                "http://localhost:4173",
                "https://tasks.example.com",
                "https://beta.example.com:8443",
            ]
        );
    }

    #[test]
    fn entries_are_trimmed_and_stray_commas_are_ignored() {
        let raw = "  https://tasks.example.com  ,, https://beta.example.com ,";
        let origins = parse_allowed_origins(Some(raw.to_string())).expect("valid list");
        assert_eq!(
            origin_strs(&origins)[3..],
            ["https://tasks.example.com", "https://beta.example.com"]
        );
    }

    #[test]
    fn malformed_entry_error_names_the_offending_entry_and_shows_an_example() {
        for bad in [
            "https://tasks.example.com/",    // trailing slash
            "https://tasks.example.com/app", // path
            "tasks.example.com",             // missing scheme
            "://tasks.example.com",          // empty scheme
            "https://",                      // empty host
            "https://tasks example.com",     // whitespace in host
        ] {
            let raw = format!("https://ok.example.com,{bad}");
            let err = parse_allowed_origins(Some(raw))
                .expect_err(&format!("entry {bad:?} should be rejected"));
            assert!(err.contains(bad.trim()), "error should name the entry {bad:?}, got: {err}");
            assert!(
                err.contains("https://tasks.example.com"),
                "error should show a valid example, got: {err}"
            );
        }
    }
}
