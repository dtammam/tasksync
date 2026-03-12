mod auth;
mod lists;
mod sync;
mod tasks;
pub(super) mod types;

pub use auth::auth_routes;
pub use lists::list_routes;
pub use sync::sync_routes;
pub use tasks::task_routes;

#[cfg(test)]
mod tests {
    use axum::extract::{Path, State};
    use axum::http::header::AUTHORIZATION;
    use axum::http::HeaderMap;
    use axum::Json;
    use sqlx::SqlitePool;
    use std::collections::BTreeSet;

    use super::auth::{
        auth_change_password, auth_create_member, auth_delete_member, auth_export_backup,
        auth_get_preferences, auth_get_sound, auth_grants, auth_members, auth_restore_backup,
        auth_set_grant, auth_set_member_password, auth_update_me, auth_update_preferences,
        auth_update_sound, login, ChangePasswordBody, CreateMemberBody, LoginBody,
        SetListGrantBody, SetMemberPasswordBody, UpdateProfileBody, UpdateSoundSettingsBody,
        UpdateUiPreferencesBody,
    };
    use super::lists::{create_list, delete_list, get_lists, update_list, CreateList, UpdateList};
    use super::sync::{sync_pull, sync_push, SyncPullBody, SyncPushBody, SyncPushChange};
    use super::tasks::{
        create_task, delete_task, get_tasks, update_task_meta, update_task_status, CreateTask,
        UpdateTaskMeta, UpdateTaskStatus,
    };
    use super::types::{
        ctx_from_headers, hash_password, AppState, Role, BACKUP_SCHEMA_V1, UI_FONTS, UI_THEMES,
    };

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.expect("in-memory sqlite");
        sqlx::migrate!("./migrations").run(&pool).await.expect("migrations");
        let test_password_hash = hash_password("test-pass").expect("hash test password");

        sqlx::query("insert into space (id, name) values ('s1', 'Default')")
            .execute(&pool)
            .await
            .expect("insert space");
        sqlx::query(
            "insert into user (id, email, display, password_hash) values ('u-admin', 'admin@example.com', 'Admin', ?1)",
        )
        .bind(&test_password_hash)
        .execute(&pool)
        .await
        .expect("insert user");
        sqlx::query(
            "insert into membership (id, space_id, user_id, role) values ('m-admin', 's1', 'u-admin', 'admin')",
        )
        .execute(&pool)
        .await
        .expect("insert membership");
        sqlx::query(
            "insert into user (id, email, display, password_hash) values ('u-contrib', 'contrib@example.com', 'Contributor', ?1)",
        )
        .bind(&test_password_hash)
        .execute(&pool)
        .await
        .expect("insert contributor");
        sqlx::query(
            "insert into membership (id, space_id, user_id, role) values ('m-contrib', 's1', 'u-contrib', 'contributor')",
        )
        .execute(&pool)
        .await
        .expect("insert contributor membership");
        sqlx::query(
            "insert into list (id, space_id, name, list_order) values ('goal-management', 's1', 'Goal Management', 'a')",
        )
        .execute(&pool)
        .await
        .expect("insert list");
        sqlx::query(
            "insert into list_grant (id, space_id, list_id, user_id) values ('g-contrib-goal', 's1', 'goal-management', 'u-contrib')",
        )
        .execute(&pool)
        .await
        .expect("insert grant");

        pool
    }

    fn test_state(pool: &SqlitePool) -> AppState {
        AppState {
            pool: pool.clone(),
            jwt_secret: "test-secret".to_string(),
            login_password: "test-pass".to_string(),
        }
    }

    fn shared_ui_themes_from_contract() -> Vec<String> {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let path = manifest_dir.join("../shared/types/settings.ts");
        let source = std::fs::read_to_string(&path)
            .unwrap_or_else(|err| panic!("failed to read {}: {err}", path.display()));

        let mut in_ui_theme_block = false;
        let mut themes = Vec::new();
        for line in source.lines() {
            let trimmed = line.trim();
            if !in_ui_theme_block {
                if trimmed.starts_with("export type UiTheme") {
                    in_ui_theme_block = true;
                }
                continue;
            }

            if let Some(start) = trimmed.find('\'') {
                let rest = &trimmed[start + 1..];
                if let Some(end) = rest.find('\'') {
                    themes.push(rest[..end].to_string());
                }
            }

            if trimmed.ends_with(';') {
                break;
            }
        }

        assert!(!themes.is_empty(), "no UiTheme entries parsed from {}", path.display());
        themes
    }

    #[tokio::test]
    async fn login_returns_token_for_valid_credentials() {
        let pool = setup_pool().await;
        let state = test_state(&pool);

        let response = login(
            State(state.clone()),
            Json(LoginBody {
                email: "admin@example.com".to_string(),
                password: "test-pass".to_string(),
                space_id: Some("s1".to_string()),
            }),
        )
        .await
        .expect("login should succeed")
        .0;

        assert!(!response.token.is_empty());

        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            format!("Bearer {}", response.token).parse().expect("auth header"),
        );
        let ctx = ctx_from_headers(&headers, &state).await.expect("ctx");
        assert_eq!(ctx.user_id, "u-admin");
        assert_eq!(ctx.space_id, "s1");
        assert_eq!(ctx.role, Role::Admin);
    }

    #[tokio::test]
    async fn login_rejects_invalid_password() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let result = login(
            State(state),
            Json(LoginBody {
                email: "admin@example.com".to_string(),
                password: "wrong".to_string(),
                space_id: Some("s1".to_string()),
            }),
        )
        .await;
        assert_eq!(result.err(), Some(axum::http::StatusCode::UNAUTHORIZED));
    }

    #[tokio::test]
    async fn login_supports_legacy_password_and_upgrades_hash() {
        let pool = setup_pool().await;
        sqlx::query("update user set password_hash = null where id = 'u-admin'")
            .execute(&pool)
            .await
            .expect("clear password hash");
        let state = test_state(&pool);

        let response = login(
            State(state),
            Json(LoginBody {
                email: "admin@example.com".to_string(),
                password: "test-pass".to_string(),
                space_id: Some("s1".to_string()),
            }),
        )
        .await
        .expect("login should succeed")
        .0;
        assert!(!response.token.is_empty());

        let upgraded_hash: Option<String> =
            sqlx::query_scalar("select password_hash from user where id = 'u-admin'")
                .fetch_optional(&pool)
                .await
                .expect("load upgraded hash");
        assert!(upgraded_hash.as_deref().map(|value| value.starts_with("$2")).unwrap_or(false));
    }

    #[tokio::test]
    async fn update_profile_sets_avatar_icon() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let updated = auth_update_me(
            State(state),
            headers,
            Json(UpdateProfileBody {
                display: Some("Admin Prime".to_string()),
                avatar_icon: Some("⭐".to_string()),
            }),
        )
        .await
        .expect("update profile should work")
        .0;

        assert_eq!(updated.display, "Admin Prime");
        assert_eq!(updated.avatar_icon.as_deref(), Some("⭐"));
    }

    #[tokio::test]
    async fn user_can_update_and_clear_sound_settings() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let defaults = auth_get_sound(State(state.clone()), headers.clone())
            .await
            .expect("sound defaults should load")
            .0;
        assert_eq!(defaults.theme, "chime_soft");
        assert_eq!(defaults.volume, 60);
        assert!(defaults.enabled);

        let updated = auth_update_sound(
            State(state.clone()),
            headers.clone(),
            Json(UpdateSoundSettingsBody {
                enabled: Some(false),
                volume: Some(23),
                theme: Some("wood_tick".to_string()),
                custom_sound_file_id: Some("snd-1".to_string()),
                custom_sound_file_name: Some("ding.wav".to_string()),
                custom_sound_data_url: Some("data:audio/wav;base64,AAAA".to_string()),
                custom_sound_files_json: Some(
                    "[{\"id\":\"snd-1\",\"name\":\"ding.wav\",\"dataUrl\":\"data:audio/wav;base64,AAAA\"}]"
                        .to_string(),
                ),
                profile_attachments_json: Some("[{\"id\":\"att-1\"}]".to_string()),
                clear_custom_sound: Some(false),
            }),
        )
        .await
        .expect("update sound should work")
        .0;

        assert!(!updated.enabled);
        assert_eq!(updated.volume, 23);
        assert_eq!(updated.theme, "wood_tick");
        assert_eq!(updated.custom_sound_file_name.as_deref(), Some("ding.wav"));
        assert_eq!(updated.custom_sound_data_url.as_deref(), Some("data:audio/wav;base64,AAAA"));
        assert_eq!(
            updated.custom_sound_files_json.as_deref(),
            Some("[{\"id\":\"snd-1\",\"name\":\"ding.wav\",\"dataUrl\":\"data:audio/wav;base64,AAAA\"}]")
        );
        assert_eq!(updated.profile_attachments_json.as_deref(), Some("[{\"id\":\"att-1\"}]"));

        let cleared = auth_update_sound(
            State(state),
            headers,
            Json(UpdateSoundSettingsBody {
                enabled: None,
                volume: None,
                theme: None,
                custom_sound_file_id: None,
                custom_sound_file_name: None,
                custom_sound_data_url: None,
                custom_sound_files_json: None,
                profile_attachments_json: None,
                clear_custom_sound: Some(true),
            }),
        )
        .await
        .expect("clear custom sound should work")
        .0;

        assert_eq!(cleared.custom_sound_file_id, None);
        assert_eq!(cleared.custom_sound_file_name, None);
        assert_eq!(cleared.custom_sound_data_url, None);
        assert_eq!(cleared.custom_sound_files_json, None);
        assert_eq!(cleared.profile_attachments_json.as_deref(), Some("[{\"id\":\"att-1\"}]"));
    }

    #[tokio::test]
    async fn user_can_update_ui_preferences() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let defaults = auth_get_preferences(State(state.clone()), headers.clone())
            .await
            .expect("preferences defaults should load")
            .0;
        assert_eq!(defaults.theme, "default");
        assert_eq!(defaults.sidebar_panels_json, None);
        assert_eq!(defaults.list_sort_json, None);

        let updated = auth_update_preferences(
            State(state.clone()),
            headers.clone(),
            Json(UpdateUiPreferencesBody {
                theme: Some("butterfly".to_string()),
                font: None,
                completion_quotes_json: None,
                sidebar_panels_json: Some(
                    "{\"lists\":true,\"members\":false,\"sound\":true,\"backups\":false,\"account\":true}"
                        .to_string(),
                ),
                list_sort_json: Some("{\"mode\":\"due_date\",\"direction\":\"desc\"}".to_string()),
                streak_settings_json: None,
                streak_state_json: None,
            }),
        )
        .await
        .expect("update preferences should work")
        .0;

        assert_eq!(updated.theme, "butterfly");
        assert_eq!(
            updated.sidebar_panels_json.as_deref(),
            Some("{\"lists\":true,\"members\":false,\"sound\":true,\"backups\":false,\"account\":true}")
        );
        assert_eq!(
            updated.list_sort_json.as_deref(),
            Some("{\"direction\":\"desc\",\"mode\":\"due_date\"}")
        );
    }

    #[tokio::test]
    async fn user_preferences_reject_unknown_ui_theme() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let result = auth_update_preferences(
            State(state),
            headers,
            Json(UpdateUiPreferencesBody {
                theme: Some("unknown-theme".to_string()),
                font: None,
                completion_quotes_json: None,
                sidebar_panels_json: None,
                list_sort_json: None,
                streak_settings_json: None,
                streak_state_json: None,
            }),
        )
        .await;

        assert_eq!(result.err(), Some(axum::http::StatusCode::BAD_REQUEST));
    }

    #[tokio::test]
    async fn user_can_update_font_and_completion_quotes() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let updated = auth_update_preferences(
            State(state),
            headers,
            Json(UpdateUiPreferencesBody {
                theme: None,
                font: Some("jetbrains-mono".to_string()),
                completion_quotes_json: Some("[\"Nice work.\",\"All done!\"]".to_string()),
                sidebar_panels_json: None,
                list_sort_json: None,
                streak_settings_json: None,
                streak_state_json: None,
            }),
        )
        .await
        .expect("update should succeed");

        assert_eq!(updated.font.as_deref(), Some("jetbrains-mono"));
        assert_eq!(
            updated.completion_quotes_json.as_deref(),
            Some("[\"Nice work.\",\"All done!\"]")
        );
    }

    #[tokio::test]
    async fn user_preferences_reject_unknown_ui_font() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let result = auth_update_preferences(
            State(state),
            headers,
            Json(UpdateUiPreferencesBody {
                theme: None,
                font: Some("comic-sans".to_string()),
                completion_quotes_json: None,
                sidebar_panels_json: None,
                list_sort_json: None,
                streak_settings_json: None,
                streak_state_json: None,
            }),
        )
        .await;

        assert_eq!(result.err(), Some(axum::http::StatusCode::BAD_REQUEST));
    }

    #[test]
    fn server_ui_theme_allow_list_matches_shared_contract() {
        let server_themes: BTreeSet<String> =
            UI_THEMES.iter().map(|theme| (*theme).to_string()).collect();
        let shared_themes: BTreeSet<String> =
            shared_ui_themes_from_contract().into_iter().collect();

        assert_eq!(
            server_themes, shared_themes,
            "ui theme mismatch: keep server UI_THEMES aligned with shared/types/settings.ts UiTheme"
        );
    }

    fn shared_ui_fonts_from_contract() -> Vec<String> {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let path = manifest_dir.join("../shared/types/settings.ts");
        let source = std::fs::read_to_string(&path)
            .unwrap_or_else(|err| panic!("failed to read {}: {err}", path.display()));

        let mut in_ui_font_block = false;
        let mut fonts = Vec::new();
        for line in source.lines() {
            let trimmed = line.trim();
            if !in_ui_font_block {
                if trimmed.starts_with("export type UiFont") {
                    in_ui_font_block = true;
                }
                continue;
            }

            if let Some(start) = trimmed.find('\'') {
                let rest = &trimmed[start + 1..];
                if let Some(end) = rest.find('\'') {
                    fonts.push(rest[..end].to_string());
                }
            }

            if trimmed.ends_with(';') {
                break;
            }
        }

        assert!(!fonts.is_empty(), "no UiFont entries parsed from {}", path.display());
        fonts
    }

    #[test]
    fn server_ui_font_allow_list_matches_shared_contract() {
        let server_fonts: BTreeSet<String> =
            UI_FONTS.iter().map(|font| (*font).to_string()).collect();
        let shared_fonts: BTreeSet<String> = shared_ui_fonts_from_contract().into_iter().collect();

        assert_eq!(
            server_fonts, shared_fonts,
            "ui font mismatch: keep server UI_FONTS aligned with shared/types/settings.ts UiFont"
        );
    }

    #[tokio::test]
    async fn admin_can_export_space_backup_snapshot() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, created_by_user_id, assignee_user_id) values ('t-backup', 's1', 'Backup seed task', 'pending', 'goal-management', 0, 'a', 1, 1, 'u-admin', 'u-admin')",
        )
        .execute(&pool)
        .await
        .expect("insert seed task");

        let backup =
            auth_export_backup(State(state), headers).await.expect("export backup should work").0;

        assert_eq!(backup.schema, BACKUP_SCHEMA_V1);
        assert_eq!(backup.space.id, "s1");
        assert!(backup.users.iter().any(|user| user.id == "u-admin"));
        assert!(backup.memberships.iter().any(|membership| membership.user_id == "u-admin"));
        assert!(backup.lists.iter().any(|list| list.id == "goal-management"));
        assert!(backup.tasks.iter().any(|task| task.id == "t-backup"));
    }

    #[tokio::test]
    async fn admin_can_restore_space_backup_snapshot() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, created_by_user_id, assignee_user_id) values ('t-restore', 's1', 'Restore seed task', 'pending', 'goal-management', 0, 'a', 1, 1, 'u-admin', 'u-admin')",
        )
        .execute(&pool)
        .await
        .expect("insert seed task");

        let backup = auth_export_backup(State(state.clone()), headers.clone())
            .await
            .expect("export backup should work")
            .0;

        sqlx::query("update space set name = 'Broken' where id = 's1'")
            .execute(&pool)
            .await
            .expect("mutate space");
        sqlx::query("delete from task where space_id = 's1'")
            .execute(&pool)
            .await
            .expect("clear tasks");
        sqlx::query("delete from list_grant where space_id = 's1'")
            .execute(&pool)
            .await
            .expect("clear grants");
        sqlx::query("delete from list where id = 'goal-management' and space_id = 's1'")
            .execute(&pool)
            .await
            .expect("remove managed list");

        let restored = auth_restore_backup(State(state), headers, Json(backup))
            .await
            .expect("restore backup should work")
            .0;

        assert_eq!(restored.space_id, "s1");
        assert!(restored.tasks >= 1);
        assert!(restored.lists >= 1);

        let space_name: Option<String> =
            sqlx::query_scalar("select name from space where id = 's1' limit 1")
                .fetch_optional(&pool)
                .await
                .expect("load space name");
        assert_eq!(space_name.as_deref(), Some("Default"));

        let restored_task_title: Option<String> = sqlx::query_scalar(
            "select title from task where id = 't-restore' and space_id = 's1' limit 1",
        )
        .fetch_optional(&pool)
        .await
        .expect("load restored task");
        assert_eq!(restored_task_title.as_deref(), Some("Restore seed task"));
    }

    #[tokio::test]
    async fn user_can_change_password_and_login_with_new_password() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let status = auth_change_password(
            State(state.clone()),
            headers,
            Json(ChangePasswordBody {
                current_password: "test-pass".to_string(),
                new_password: "new-test-pass".to_string(),
            }),
        )
        .await
        .expect("change password should work");
        assert_eq!(status, axum::http::StatusCode::NO_CONTENT);

        let old_login = login(
            State(state.clone()),
            Json(LoginBody {
                email: "admin@example.com".to_string(),
                password: "test-pass".to_string(),
                space_id: Some("s1".to_string()),
            }),
        )
        .await;
        assert_eq!(old_login.err(), Some(axum::http::StatusCode::UNAUTHORIZED));

        let new_login = login(
            State(state),
            Json(LoginBody {
                email: "admin@example.com".to_string(),
                password: "new-test-pass".to_string(),
                space_id: Some("s1".to_string()),
            }),
        )
        .await
        .expect("new password login should work")
        .0;
        assert_eq!(new_login.user_id, "u-admin");
    }

    #[tokio::test]
    async fn change_password_rejects_wrong_current_password() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let result = auth_change_password(
            State(state),
            headers,
            Json(ChangePasswordBody {
                current_password: "wrong-pass".to_string(),
                new_password: "new-test-pass".to_string(),
            }),
        )
        .await;
        assert_eq!(result.err(), Some(axum::http::StatusCode::UNAUTHORIZED));
    }

    #[tokio::test]
    async fn admin_can_create_member_and_manage_grants() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let created = auth_create_member(
            State(state.clone()),
            headers.clone(),
            Json(CreateMemberBody {
                email: "wife@example.com".to_string(),
                display: "Wife".to_string(),
                role: "contributor".to_string(),
                password: "password123".to_string(),
                avatar_icon: Some("🦊".to_string()),
            }),
        )
        .await
        .expect("create member should work")
        .1
         .0;
        assert_eq!(created.role, "contributor");
        assert_eq!(created.avatar_icon.as_deref(), Some("🦊"));

        let granted = auth_set_grant(
            State(state.clone()),
            headers.clone(),
            Json(SetListGrantBody {
                user_id: created.user_id.clone(),
                list_id: "goal-management".to_string(),
                granted: true,
            }),
        )
        .await
        .expect("set grant should work")
        .0;
        assert_eq!(granted.user_id, created.user_id);
        assert_eq!(granted.list_id, "goal-management");

        let grants = auth_grants(State(state), headers).await.expect("load grants should work").0;
        assert!(grants
            .iter()
            .any(|grant| grant.user_id == created.user_id && grant.list_id == "goal-management"));
    }

    #[tokio::test]
    async fn created_member_can_login_with_member_password() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let created = auth_create_member(
            State(state.clone()),
            headers,
            Json(CreateMemberBody {
                email: "newmember@example.com".to_string(),
                display: "New Member".to_string(),
                role: "contributor".to_string(),
                password: "memberpass123".to_string(),
                avatar_icon: None,
            }),
        )
        .await
        .expect("create member should work")
        .1
         .0;

        let login_response = login(
            State(state),
            Json(LoginBody {
                email: created.email,
                password: "memberpass123".to_string(),
                space_id: Some("s1".to_string()),
            }),
        )
        .await
        .expect("member login should work")
        .0;
        assert_eq!(login_response.user_id, created.user_id);
    }

    #[tokio::test]
    async fn admin_create_member_rejects_short_password() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let result = auth_create_member(
            State(state),
            headers,
            Json(CreateMemberBody {
                email: "weakpass@example.com".to_string(),
                display: "Weak Pass".to_string(),
                role: "contributor".to_string(),
                password: "short".to_string(),
                avatar_icon: None,
            }),
        )
        .await;
        assert_eq!(result.err(), Some(axum::http::StatusCode::BAD_REQUEST));
    }

    #[tokio::test]
    async fn admin_can_reset_member_password() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut admin_headers = HeaderMap::new();
        admin_headers.insert("x-space-id", "s1".parse().expect("space"));
        admin_headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let status = auth_set_member_password(
            State(state.clone()),
            admin_headers,
            Path("u-contrib".to_string()),
            Json(SetMemberPasswordBody { password: "contrib-reset-pass".to_string() }),
        )
        .await
        .expect("admin reset should work");
        assert_eq!(status, axum::http::StatusCode::NO_CONTENT);

        let old_login = login(
            State(state.clone()),
            Json(LoginBody {
                email: "contrib@example.com".to_string(),
                password: "test-pass".to_string(),
                space_id: Some("s1".to_string()),
            }),
        )
        .await;
        assert_eq!(old_login.err(), Some(axum::http::StatusCode::UNAUTHORIZED));

        let new_login = login(
            State(state),
            Json(LoginBody {
                email: "contrib@example.com".to_string(),
                password: "contrib-reset-pass".to_string(),
                space_id: Some("s1".to_string()),
            }),
        )
        .await
        .expect("contrib login with reset password should work")
        .0;
        assert_eq!(new_login.user_id, "u-contrib");
    }

    #[tokio::test]
    async fn admin_can_delete_member() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let status =
            auth_delete_member(State(state.clone()), headers, Path("u-contrib".to_string()))
                .await
                .expect("delete member should work");
        assert_eq!(status, axum::http::StatusCode::NO_CONTENT);

        let membership_count: i64 = sqlx::query_scalar(
            "select count(1) from membership where space_id = 's1' and user_id = 'u-contrib'",
        )
        .fetch_one(&pool)
        .await
        .expect("count memberships");
        assert_eq!(membership_count, 0);
    }

    #[tokio::test]
    async fn admin_cannot_delete_self() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let result = auth_delete_member(State(state), headers, Path("u-admin".to_string())).await;
        assert_eq!(result.err(), Some(axum::http::StatusCode::BAD_REQUEST));
    }

    #[tokio::test]
    async fn contributor_cannot_manage_members_or_grants() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-contrib".parse().expect("user"));

        let create_result = auth_create_member(
            State(state.clone()),
            headers.clone(),
            Json(CreateMemberBody {
                email: "blocked@example.com".to_string(),
                display: "Blocked".to_string(),
                role: "contributor".to_string(),
                password: "password123".to_string(),
                avatar_icon: Some("🚫".to_string()),
            }),
        )
        .await;
        assert_eq!(create_result.err(), Some(axum::http::StatusCode::FORBIDDEN));

        let reset_result = auth_set_member_password(
            State(state.clone()),
            headers.clone(),
            Path("u-admin".to_string()),
            Json(SetMemberPasswordBody { password: "blocked123".to_string() }),
        )
        .await;
        assert_eq!(reset_result.err(), Some(axum::http::StatusCode::FORBIDDEN));

        let delete_result =
            auth_delete_member(State(state.clone()), headers.clone(), Path("u-admin".to_string()))
                .await;
        assert_eq!(delete_result.err(), Some(axum::http::StatusCode::FORBIDDEN));

        let grant_result = auth_set_grant(
            State(state),
            headers,
            Json(SetListGrantBody {
                user_id: "u-contrib".to_string(),
                list_id: "goal-management".to_string(),
                granted: true,
            }),
        )
        .await;
        assert_eq!(grant_result.err(), Some(axum::http::StatusCode::FORBIDDEN));
    }

    #[tokio::test]
    async fn contributor_task_creation_assigns_creator_even_if_other_assignee_requested() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-contrib".parse().expect("user"));

        let created = create_task(
            State(state),
            headers,
            Json(CreateTask {
                id: None,
                title: "Assigned by contributor".to_string(),
                list_id: "goal-management".to_string(),
                order: Some("z".to_string()),
                my_day: Some(true),
                priority: None,
                url: None,
                recur_rule: None,
                due_date: None,
                punted_from_due_date: None,
                punted_on_date: None,
                notes: None,
                assignee_user_id: Some("u-admin".to_string()),
            }),
        )
        .await
        .expect("create should work")
        .1
         .0;

        assert_eq!(created.assignee_user_id.as_deref(), Some("u-contrib"));
        assert_eq!(created.created_by_user_id.as_deref(), Some("u-contrib"));
        assert_eq!(created.my_day, 0);
    }

    #[tokio::test]
    async fn create_task_is_idempotent_when_client_retries_same_id() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));
        let retried_id = uuid::Uuid::new_v4().to_string();

        let first = create_task(
            State(state.clone()),
            headers.clone(),
            Json(CreateTask {
                id: Some(retried_id.clone()),
                title: "Idempotent create".to_string(),
                list_id: "goal-management".to_string(),
                order: Some("z".to_string()),
                my_day: Some(false),
                priority: None,
                url: None,
                recur_rule: None,
                due_date: None,
                punted_from_due_date: None,
                punted_on_date: None,
                notes: None,
                assignee_user_id: Some("u-admin".to_string()),
            }),
        )
        .await
        .expect("first create should succeed");
        assert_eq!(first.0, axum::http::StatusCode::CREATED);
        let first_task = first.1 .0;
        assert_eq!(first_task.id, retried_id);

        let second = create_task(
            State(state),
            headers,
            Json(CreateTask {
                id: Some(retried_id.clone()),
                title: "Idempotent create".to_string(),
                list_id: "goal-management".to_string(),
                order: Some("z".to_string()),
                my_day: Some(false),
                priority: None,
                url: None,
                recur_rule: None,
                due_date: None,
                punted_from_due_date: None,
                punted_on_date: None,
                notes: None,
                assignee_user_id: Some("u-admin".to_string()),
            }),
        )
        .await
        .expect("retry create should succeed");
        assert_eq!(second.0, axum::http::StatusCode::OK);
        assert_eq!(second.1 .0.id, retried_id);

        let count: i64 = sqlx::query_scalar("select count(1) from task where id = ?1")
            .bind(retried_id)
            .fetch_one(&pool)
            .await
            .expect("count task rows");
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn admin_can_delete_task() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, occurrences_completed, assignee_user_id, created_by_user_id) values ('t-delete', 's1', 'Delete me', 'pending', 'goal-management', 0, 'a', 1, 1, 0, 'u-admin', 'u-admin')",
        )
        .execute(&pool)
        .await
        .expect("insert task");

        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let status = delete_task(State(state), headers, Path("t-delete".to_string()))
            .await
            .expect("delete task should work");
        assert_eq!(status, axum::http::StatusCode::NO_CONTENT);

        let remaining: i64 = sqlx::query_scalar("select count(1) from task where id = 't-delete'")
            .fetch_one(&pool)
            .await
            .expect("count tasks");
        assert_eq!(remaining, 0);
    }

    #[tokio::test]
    async fn contributor_cannot_delete_admin_task() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, occurrences_completed, assignee_user_id, created_by_user_id) values ('t-admin-owned', 's1', 'Locked', 'pending', 'goal-management', 0, 'a', 1, 1, 0, 'u-admin', 'u-admin')",
        )
        .execute(&pool)
        .await
        .expect("insert task");

        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-contrib".parse().expect("user"));

        let status = delete_task(State(state), headers, Path("t-admin-owned".to_string())).await;
        assert_eq!(status.err(), Some(axum::http::StatusCode::FORBIDDEN));
    }

    #[tokio::test]
    async fn admin_can_clear_my_day_flag_via_task_meta_update() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, occurrences_completed, assignee_user_id, created_by_user_id) values ('t-myday', 's1', 'My Day item', 'pending', 'goal-management', 1, 'a', 1, 1, 0, 'u-admin', 'u-admin')",
        )
        .execute(&pool)
        .await
        .expect("insert task");

        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let updated = update_task_meta(
            State(state),
            headers,
            Path("t-myday".to_string()),
            Json(UpdateTaskMeta {
                title: None,
                status: None,
                list_id: None,
                my_day: Some(false),
                priority: None,
                url: None,
                recur_rule: None,
                due_date: None,
                punted_from_due_date: None,
                punted_on_date: None,
                notes: None,
                occurrences_completed: None,
                completed_ts: None,
                assignee_user_id: None,
            }),
        )
        .await
        .expect("update should work")
        .0;
        assert_eq!(updated.my_day, 0);
    }

    #[tokio::test]
    async fn admin_can_preserve_completed_ts_when_recurring_instance_rolls_forward() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, due_date, recur_rule, occurrences_completed, assignee_user_id, created_by_user_id) values ('t-recurring', 's1', 'Stretch', 'pending', 'goal-management', 0, 'a', 1, 1, '2026-02-05', 'daily', 0, 'u-admin', 'u-admin')",
        )
        .execute(&pool)
        .await
        .expect("insert recurring task");

        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));
        let completed_ts = chrono::Utc::now().timestamp_millis();

        let updated = update_task_meta(
            State(state),
            headers,
            Path("t-recurring".to_string()),
            Json(UpdateTaskMeta {
                title: None,
                status: Some("pending".to_string()),
                list_id: None,
                my_day: None,
                priority: None,
                url: None,
                recur_rule: None,
                due_date: Some("2026-02-06".to_string()),
                punted_from_due_date: None,
                punted_on_date: None,
                notes: None,
                occurrences_completed: Some(1),
                completed_ts: Some(completed_ts),
                assignee_user_id: None,
            }),
        )
        .await
        .expect("recurring roll-forward should keep completion timestamp")
        .0;

        assert_eq!(updated.status, "pending");
        assert_eq!(updated.occurrences_completed, 1);
        assert_eq!(updated.due_date.as_deref(), Some("2026-02-06"));
        assert_eq!(updated.completed_ts, Some(completed_ts));
    }

    #[tokio::test]
    async fn contributor_cannot_update_or_reassign_task() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, occurrences_completed, assignee_user_id, created_by_user_id) values ('t1', 's1', 'Task', 'pending', 'goal-management', 0, 'a', 1, 1, 0, 'u-admin', 'u-admin')",
        )
        .execute(&pool)
        .await
        .expect("insert task");

        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-contrib".parse().expect("user"));

        let result = update_task_meta(
            State(state),
            headers,
            Path("t1".to_string()),
            Json(UpdateTaskMeta {
                title: None,
                status: None,
                list_id: None,
                my_day: None,
                priority: None,
                url: None,
                recur_rule: None,
                due_date: None,
                punted_from_due_date: None,
                punted_on_date: None,
                notes: None,
                occurrences_completed: None,
                completed_ts: None,
                assignee_user_id: Some("u-contrib".to_string()),
            }),
        )
        .await;
        assert_eq!(result.err(), Some(axum::http::StatusCode::FORBIDDEN));
    }

    #[tokio::test]
    async fn contributor_can_update_and_complete_owned_task() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, occurrences_completed, assignee_user_id, created_by_user_id) values ('t-owned', 's1', 'Contributor task', 'pending', 'goal-management', 0, 'a', 1, 1, 0, 'u-admin', 'u-contrib')",
        )
        .execute(&pool)
        .await
        .expect("insert owned task");

        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-contrib".parse().expect("user"));

        let updated = update_task_meta(
            State(state.clone()),
            headers.clone(),
            Path("t-owned".to_string()),
            Json(UpdateTaskMeta {
                title: Some("Updated by contributor".to_string()),
                status: None,
                list_id: None,
                my_day: Some(false),
                priority: None,
                url: None,
                recur_rule: None,
                due_date: Some("2026-02-09".to_string()),
                punted_from_due_date: None,
                punted_on_date: None,
                notes: Some("note".to_string()),
                occurrences_completed: None,
                completed_ts: None,
                assignee_user_id: Some("u-admin".to_string()),
            }),
        )
        .await
        .expect("owned task update should work")
        .0;
        assert_eq!(updated.title, "Updated by contributor");
        assert_eq!(updated.due_date.as_deref(), Some("2026-02-09"));
        assert_eq!(updated.my_day, 0);

        let completed = update_task_status(
            State(state),
            headers,
            Path("t-owned".to_string()),
            Json(UpdateTaskStatus { status: "done".to_string() }),
        )
        .await
        .expect("owned task status update should work")
        .0;
        assert_eq!(completed.status, "done");
    }

    #[tokio::test]
    async fn contributor_cannot_set_my_day_on_owned_task() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, occurrences_completed, assignee_user_id, created_by_user_id) values ('t-owned-myday', 's1', 'Contributor task', 'pending', 'goal-management', 0, 'a', 1, 1, 0, 'u-admin', 'u-contrib')",
        )
        .execute(&pool)
        .await
        .expect("insert owned task");

        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-contrib".parse().expect("user"));

        let result = update_task_meta(
            State(state),
            headers,
            Path("t-owned-myday".to_string()),
            Json(UpdateTaskMeta {
                title: None,
                status: None,
                list_id: None,
                my_day: Some(true),
                priority: None,
                url: None,
                recur_rule: None,
                due_date: None,
                punted_from_due_date: None,
                punted_on_date: None,
                notes: None,
                occurrences_completed: None,
                completed_ts: None,
                assignee_user_id: None,
            }),
        )
        .await;
        assert_eq!(result.err(), Some(axum::http::StatusCode::FORBIDDEN));
    }

    #[tokio::test]
    async fn contributor_reads_only_granted_lists_and_admin_tasks_within_them() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        sqlx::query(
            "insert into list (id, space_id, name, list_order) values ('admin-private', 's1', 'Admin Private', 'z')",
        )
        .execute(&pool)
        .await
        .expect("insert private list");
        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, occurrences_completed, assignee_user_id, created_by_user_id) values ('t-visible', 's1', 'Admin visible task', 'pending', 'goal-management', 0, 'a', 1, 1, 0, 'u-admin', 'u-admin')",
        )
        .execute(&pool)
        .await
        .expect("insert visible task");
        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, occurrences_completed, assignee_user_id, created_by_user_id) values ('t-hidden', 's1', 'Admin hidden task', 'pending', 'admin-private', 0, 'b', 1, 1, 0, 'u-admin', 'u-admin')",
        )
        .execute(&pool)
        .await
        .expect("insert hidden task");

        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-contrib".parse().expect("user"));

        let visible_lists =
            get_lists(State(state.clone()), headers.clone()).await.expect("lists should load").0;
        assert_eq!(visible_lists.len(), 1);
        assert_eq!(visible_lists[0].id, "goal-management");

        let visible_tasks = get_tasks(State(state), headers).await.expect("tasks should load").0;
        assert_eq!(visible_tasks.len(), 1);
        assert_eq!(visible_tasks[0].id, "t-visible");
        assert_eq!(visible_tasks[0].created_by_user_id.as_deref(), Some("u-admin"));
    }

    #[tokio::test]
    async fn sync_pull_filters_by_since_and_role_scope() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        sqlx::query(
            "insert into list (id, space_id, name, list_order) values ('admin-private', 's1', 'Admin Private', 'z')",
        )
        .execute(&pool)
        .await
        .expect("insert private list");
        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, occurrences_completed, assignee_user_id, created_by_user_id) values ('t-old', 's1', 'Old visible task', 'pending', 'goal-management', 0, 'a', 100, 1, 0, 'u-admin', 'u-admin')",
        )
        .execute(&pool)
        .await
        .expect("insert old visible task");
        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, occurrences_completed, assignee_user_id, created_by_user_id) values ('t-new', 's1', 'New visible task', 'pending', 'goal-management', 0, 'b', 200, 1, 0, 'u-admin', 'u-admin')",
        )
        .execute(&pool)
        .await
        .expect("insert new visible task");
        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, occurrences_completed, assignee_user_id, created_by_user_id) values ('t-hidden', 's1', 'Hidden task', 'pending', 'admin-private', 0, 'c', 300, 1, 0, 'u-admin', 'u-admin')",
        )
        .execute(&pool)
        .await
        .expect("insert hidden task");

        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-contrib".parse().expect("user"));

        let response = sync_pull(State(state), headers, Json(SyncPullBody { since_ts: Some(150) }))
            .await
            .expect("sync pull should work")
            .0;

        assert_eq!(response.protocol, "delta-v1");
        assert_eq!(response.cursor_ts, 200);
        assert_eq!(response.lists.len(), 1);
        assert_eq!(response.lists[0].id, "goal-management");
        assert_eq!(response.tasks.len(), 1);
        assert_eq!(response.tasks[0].id, "t-new");
        assert!(response.deleted_tasks.is_empty());
    }

    #[tokio::test]
    async fn sync_pull_includes_task_tombstones_after_delete() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, occurrences_completed, assignee_user_id, created_by_user_id) values ('t-deleted', 's1', 'Delete sync', 'pending', 'goal-management', 0, 'a', 100, 1, 0, 'u-admin', 'u-admin')",
        )
        .execute(&pool)
        .await
        .expect("insert task");

        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let status =
            delete_task(State(state.clone()), headers.clone(), Path("t-deleted".to_string()))
                .await
                .expect("delete task should work");
        assert_eq!(status, axum::http::StatusCode::NO_CONTENT);

        let response = sync_pull(State(state), headers, Json(SyncPullBody { since_ts: Some(0) }))
            .await
            .expect("sync pull should include tombstone")
            .0;

        assert_eq!(response.tasks.len(), 0);
        assert_eq!(response.deleted_tasks.len(), 1);
        assert_eq!(response.deleted_tasks[0].id, "t-deleted");
        assert!(response.deleted_tasks[0].deleted_ts >= 100);
        assert!(response.cursor_ts >= response.deleted_tasks[0].deleted_ts);
    }

    #[tokio::test]
    async fn sync_push_applies_create_then_status_update_for_admin() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let response = sync_push(
            State(state),
            headers,
            Json(SyncPushBody {
                changes: vec![
                    SyncPushChange::CreateTask {
                        op_id: "op-create".to_string(),
                        body: CreateTask {
                            id: Some("123e4567-e89b-12d3-a456-426614174900".to_string()),
                            title: "Created by sync push".to_string(),
                            list_id: "goal-management".to_string(),
                            order: Some("z".to_string()),
                            my_day: Some(false),
                            priority: None,
                            url: None,
                            recur_rule: None,
                            due_date: None,
                            punted_from_due_date: None,
                            punted_on_date: None,
                            notes: None,
                            assignee_user_id: Some("u-admin".to_string()),
                        },
                    },
                    SyncPushChange::UpdateTaskStatus {
                        op_id: "op-status".to_string(),
                        task_id: "123e4567-e89b-12d3-a456-426614174900".to_string(),
                        status: "done".to_string(),
                    },
                ],
            }),
        )
        .await
        .expect("sync push should work")
        .0;

        assert_eq!(response.protocol, "delta-v1");
        assert!(response.rejected.is_empty());
        assert_eq!(response.applied.len(), 2);
        assert_eq!(response.applied[1].status, "done");

        let saved_status: String = sqlx::query_scalar(
            "select status from task where id = '123e4567-e89b-12d3-a456-426614174900'",
        )
        .fetch_one(&pool)
        .await
        .expect("load task status");
        assert_eq!(saved_status, "done");
    }

    #[tokio::test]
    async fn sync_push_rejects_contributor_status_update() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, occurrences_completed, assignee_user_id, created_by_user_id) values ('t-locked', 's1', 'Locked task', 'pending', 'goal-management', 0, 'a', 1, 1, 0, 'u-admin', 'u-admin')",
        )
        .execute(&pool)
        .await
        .expect("insert locked task");

        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-contrib".parse().expect("user"));

        let response = sync_push(
            State(state),
            headers,
            Json(SyncPushBody {
                changes: vec![SyncPushChange::UpdateTaskStatus {
                    op_id: "op-forbidden".to_string(),
                    task_id: "t-locked".to_string(),
                    status: "done".to_string(),
                }],
            }),
        )
        .await
        .expect("sync push should return payload")
        .0;

        assert!(response.applied.is_empty());
        assert_eq!(response.rejected.len(), 1);
        assert_eq!(response.rejected[0].op_id, "op-forbidden");
        assert_eq!(response.rejected[0].status, axum::http::StatusCode::FORBIDDEN.as_u16());
    }

    #[tokio::test]
    async fn admin_can_create_list() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let (status, Json(created)) = create_list(
            State(state),
            headers,
            Json(CreateList {
                name: "New List".to_string(),
                icon: Some("📋".to_string()),
                color: Some("#ff0000".to_string()),
                order: Some("b".to_string()),
            }),
        )
        .await
        .expect("create list should succeed");

        assert_eq!(status, axum::http::StatusCode::CREATED);
        assert_eq!(created.name, "New List");
        assert_eq!(created.icon.as_deref(), Some("📋"));
        assert_eq!(created.color.as_deref(), Some("#ff0000"));
        assert_eq!(created.order, "b");
        assert_eq!(created.space_id, "s1");
        assert!(!created.id.is_empty());
    }

    #[tokio::test]
    async fn admin_can_get_all_lists() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let Json(lists) = get_lists(State(state), headers).await.expect("get lists should succeed");

        // setup_pool seeds "goal-management"
        assert!(!lists.is_empty());
        let ids: Vec<&str> = lists.iter().map(|l| l.id.as_str()).collect();
        assert!(ids.contains(&"goal-management"), "seeded list should be returned");
    }

    #[tokio::test]
    async fn admin_can_update_list_name_icon_color() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let Json(updated) = update_list(
            State(state),
            headers,
            Path("goal-management".to_string()),
            Json(UpdateList {
                name: Some("Goals".to_string()),
                icon: Some("🎯".to_string()),
                color: Some("#00ff00".to_string()),
                order: None,
            }),
        )
        .await
        .expect("update list should succeed");

        assert_eq!(updated.id, "goal-management");
        assert_eq!(updated.name, "Goals");
        assert_eq!(updated.icon.as_deref(), Some("🎯"));
        assert_eq!(updated.color.as_deref(), Some("#00ff00"));
    }

    #[tokio::test]
    async fn admin_can_delete_empty_list() {
        let pool = setup_pool().await;
        let state = test_state(&pool);

        // Create a fresh list to delete (goal-management may have tasks in other tests)
        let create_headers = {
            let mut h = HeaderMap::new();
            h.insert("x-space-id", "s1".parse().expect("space"));
            h.insert("x-user-id", "u-admin".parse().expect("user"));
            h
        };
        let (_, Json(new_list)) = create_list(
            State(state.clone()),
            create_headers,
            Json(CreateList {
                name: "Temp List".to_string(),
                icon: None,
                color: None,
                order: None,
            }),
        )
        .await
        .expect("create temp list");

        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let status = delete_list(State(state), headers, Path(new_list.id))
            .await
            .expect("delete list should succeed");

        assert_eq!(status, axum::http::StatusCode::NO_CONTENT);
    }
}
