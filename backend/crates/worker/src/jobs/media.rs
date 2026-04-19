use std::time::Instant;

use sqlx::MySqlPool;

const CLEANUP_BATCH_LIMIT: i64 = 1000;

#[derive(Debug, Clone, Copy, Default)]
pub struct MediaRunReport {
    pub orphaned_rows: u64,
    pub deleted_rows: u64,
    pub duration_ms: u64,
}

impl MediaRunReport {
    pub fn total_rows(self) -> u64 {
        self.orphaned_rows + self.deleted_rows
    }
}

#[tracing::instrument(skip(pool))]
pub async fn run_once(pool: MySqlPool) -> Result<MediaRunReport, sqlx::Error> {
    let started = Instant::now();
    let orphaned_rows = sqlx::query(
        r#"
        UPDATE media_assets
        SET upload_status = 'orphaned', updated_at = NOW()
        WHERE upload_status = 'pending'
          AND created_at < NOW() - INTERVAL 24 HOUR
        ORDER BY created_at ASC
        LIMIT ?
        "#,
    )
    .bind(CLEANUP_BATCH_LIMIT)
    .execute(&pool)
    .await?;
    let deleted_rows = sqlx::query(
        r#"
        DELETE FROM media_assets
        WHERE delete_after_at IS NOT NULL
          AND delete_after_at < NOW()
        ORDER BY delete_after_at ASC
        LIMIT ?
        "#,
    )
    .bind(CLEANUP_BATCH_LIMIT)
    .execute(&pool)
    .await?;

    Ok(MediaRunReport {
        orphaned_rows: orphaned_rows.rows_affected(),
        deleted_rows: deleted_rows.rows_affected(),
        duration_ms: started.elapsed().as_millis() as u64,
    })
}
