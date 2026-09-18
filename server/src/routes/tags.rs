use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};

use super::types::{app_state, ctx_from_headers, AppState, Role};

#[derive(Serialize, Deserialize, Clone)]
pub(super) struct TagPaletteEntry {
    pub(super) emoji: String,
    pub(super) label: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub(super) struct TagPaletteSection {
    pub(super) section: String,
    pub(super) entries: Vec<TagPaletteEntry>,
}

const MAX_EMOJI_LEN: usize = 32;
const MAX_LABEL_LEN: usize = 80;
const MAX_SECTION_NAME_LEN: usize = 80;

fn validate_palette(sections: &[TagPaletteSection]) -> Result<(), StatusCode> {
    let mut seen_emoji = std::collections::HashSet::new();
    for section in sections {
        if section.section.trim().is_empty() || section.section.len() > MAX_SECTION_NAME_LEN {
            return Err(StatusCode::BAD_REQUEST);
        }
        for entry in &section.entries {
            if entry.emoji.trim().is_empty() || entry.emoji.len() > MAX_EMOJI_LEN {
                return Err(StatusCode::BAD_REQUEST);
            }
            if entry.label.trim().is_empty() || entry.label.len() > MAX_LABEL_LEN {
                return Err(StatusCode::BAD_REQUEST);
            }
            if !seen_emoji.insert(entry.emoji.clone()) {
                return Err(StatusCode::BAD_REQUEST);
            }
        }
    }
    Ok(())
}

pub(super) async fn get_tag_palette(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Option<Vec<TagPaletteSection>>>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    let raw: Option<String> =
        sqlx::query_scalar("select tag_palette_json from space where id = ?1")
            .bind(&ctx.space_id)
            .fetch_one(&state.pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let sections = match raw {
        Some(raw) => Some(
            serde_json::from_str::<Vec<TagPaletteSection>>(&raw)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
        ),
        None => None,
    };
    Ok(Json(sections))
}

pub(super) async fn put_tag_palette(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Vec<TagPaletteSection>>,
) -> Result<Json<Vec<TagPaletteSection>>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    if ctx.role != Role::Admin {
        return Err(StatusCode::FORBIDDEN);
    }
    validate_palette(&body)?;

    let raw = serde_json::to_string(&body).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = sqlx::query("update space set tag_palette_json = ?1 where id = ?2")
        .bind(&raw)
        .bind(&ctx.space_id)
        .execute(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if rows.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(Json(body))
}

pub fn tag_routes(pool: &sqlx::SqlitePool) -> Router {
    let state = app_state(pool);
    Router::new().route("/", get(get_tag_palette).put(put_tag_palette)).with_state(state)
}
