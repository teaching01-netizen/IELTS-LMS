use chrono::{Duration, Utc};
use ielts_backend_domain::grading::{
    CompleteUploadRequest, MediaAsset, UploadIntent, UploadIntentRequest,
};
use ielts_backend_infrastructure::object_store::LocalObjectStore;
use sqlx::MySqlPool;
use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum MediaError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Not found")]
    NotFound,
}

pub struct MediaService {
    pool: MySqlPool,
    object_store: LocalObjectStore,
}

impl MediaService {
    pub fn new(pool: MySqlPool) -> Self {
        Self {
            pool,
            object_store: LocalObjectStore::from_env(),
        }
    }

    pub async fn create_upload_intent(
        &self,
        req: UploadIntentRequest,
    ) -> Result<UploadIntent, MediaError> {
        let asset_id = Uuid::new_v4();
        let upload_url = self.object_store.upload_url(asset_id);
        let content_type = req.content_type.clone();
        sqlx::query(
            r#"
            INSERT INTO media_assets (
                id, owner_kind, owner_id, content_type, file_name, upload_status,
                object_key, upload_url, delete_after_at, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, NOW(), NOW())
            "#,
        )
        .bind(asset_id.to_string())
        .bind(req.owner_kind)
        .bind(req.owner_id)
        .bind(req.content_type)
        .bind(req.file_name.clone())
        .bind(format!("media/{asset_id}/{}", req.file_name))
        .bind(&upload_url)
        .bind(Utc::now() + Duration::days(7))
        .execute(&self.pool)
        .await?;

        let asset = sqlx::query_as::<_, MediaAsset>("SELECT * FROM media_assets WHERE id = ?")
            .bind(asset_id.to_string())
            .fetch_one(&self.pool)
            .await?;

        Ok(UploadIntent {
            asset,
            upload_url,
            headers: serde_json::json!({ "content-type": content_type }),
        })
    }

    pub async fn complete_upload(
        &self,
        asset_id: Uuid,
        req: CompleteUploadRequest,
    ) -> Result<MediaAsset, MediaError> {
        let download_url = self.object_store.download_url(asset_id);
        sqlx::query(
            r#"
            UPDATE media_assets
            SET
                upload_status = 'finalized',
                size_bytes = ?,
                checksum_sha256 = ?,
                download_url = ?,
                delete_after_at = NULL,
                updated_at = NOW()
            WHERE id = ?
            "#,
        )
        .bind(req.size_bytes)
        .bind(req.checksum_sha256)
        .bind(download_url)
        .bind(asset_id.to_string())
        .execute(&self.pool)
        .await?;

        sqlx::query_as::<_, MediaAsset>("SELECT * FROM media_assets WHERE id = ?")
            .bind(asset_id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or(MediaError::NotFound)
    }

    pub async fn get_asset(&self, asset_id: Uuid) -> Result<MediaAsset, MediaError> {
        sqlx::query_as::<_, MediaAsset>("SELECT * FROM media_assets WHERE id = ?")
            .bind(asset_id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or(MediaError::NotFound)
    }
}
