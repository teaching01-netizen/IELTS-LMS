use sqlx::MySqlPool;

#[tokio::main]
async fn main() -> Result<(), sqlx::Error> {
    let database_url = "mysql://2R1r5CYK7fivnEK.root:wE8vSg2icaaJSTRu@gateway01.ap-southeast-1.prod.alicloud.tidbcloud.com:4000/test";
    let pool = MySqlPool::connect(database_url).await?;

    // Get all table names
    let tables: Vec<String> = sqlx::query_scalar("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()")
        .fetch_all(&pool)
        .await?;

    println!("Found {} tables to drop", tables.len());

    // Drop each table
    for table in &tables {
        let query = format!("DROP TABLE IF EXISTS `{}`", table);
        sqlx::query(&query).execute(&pool).await?;
        println!("Dropped table: {}", table);
    }

    println!("All tables dropped successfully");
    Ok(())
}
