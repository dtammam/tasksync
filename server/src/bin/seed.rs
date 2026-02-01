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
        "insert or ignore into user (id, email, display) values (?1,'admin@example.com','Admin')",
    )
    .bind(admin)
    .execute(&pool)
    .await?;
    sqlx::query(
        "insert or ignore into user (id, email, display) values (?1,'contrib@example.com','Contributor')",
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

    sqlx::query("insert or ignore into list (id, space_id, name, list_order) values ('l-inbox',?1,'Inbox','a')")
        .bind(space_id)
        .execute(&pool)
        .await?;

    sqlx::query("insert or ignore into list_grant (id, space_id, list_id, user_id) values ('g-contrib-inbox',?1,'l-inbox',?2)")
        .bind(space_id)
        .bind(contrib)
        .execute(&pool)
        .await?;

    println!("Seeded space={}, admin={}, contributor={}, list=l-inbox", space_id, admin, contrib);
    Ok(())
}
