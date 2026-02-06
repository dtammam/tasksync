use sqlx::SqlitePool;
use std::env;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let database_url =
        env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://../data/tasksync.db".to_string());
    let pool = SqlitePool::connect(&database_url).await?;
    sqlx::migrate!("./migrations").run(&pool).await?;

    let space_id = "s1";
    let admin = "admin";
    let contrib = "contrib";

    sqlx::query("insert or ignore into space (id, name) values (?1, 'Default')")
        .bind(space_id)
        .execute(&pool)
        .await?;

    sqlx::query(
        "insert or ignore into user (id, email, display, avatar_icon) values (?1,'admin@example.com','Admin','🛠')",
    )
    .bind(admin)
    .execute(&pool)
    .await?;
    sqlx::query(
        "insert or ignore into user (id, email, display, avatar_icon) values (?1,'contrib@example.com','Contributor','✨')",
    )
    .bind(contrib)
    .execute(&pool)
    .await?;

    sqlx::query("insert or ignore into membership (id, space_id, user_id, role) values ('m-admin',?1,?2,'admin')")
        .bind(space_id)
        .bind(admin)
        .execute(&pool)
        .await?;
    sqlx::query("insert or ignore into membership (id, space_id, user_id, role) values ('m-contrib',?1,?2,'contributor')")
        .bind(space_id)
        .bind(contrib)
        .execute(&pool)
        .await?;

    let lists = vec![
        ("my-day", "My Day", "a"),
        ("l-inbox", "Inbox", "b"),
        ("goal-management", "Goal Management", "c"),
        ("daily-management", "Daily Management", "d"),
        ("tasks", "Tasks", "e"),
        ("health", "Health", "f"),
        ("tech", "Tech Ideas", "g"),
    ];

    for (id, name, order) in &lists {
        sqlx::query(
            "insert or ignore into list (id, space_id, name, list_order) values (?1,?2,?3,?4)",
        )
        .bind(id)
        .bind(space_id)
        .bind(name)
        .bind(order)
        .execute(&pool)
        .await?;
        sqlx::query("insert or ignore into list_grant (id, space_id, list_id, user_id) values (?1,?2,?3,?4)")
            .bind(format!("g-contrib-{}", id))
            .bind(space_id)
            .bind(id)
            .bind(contrib)
            .execute(&pool)
            .await?;
    }

    println!("Seeded space={}, admin={}, contributor={}, list=l-inbox", space_id, admin, contrib);
    Ok(())
}
