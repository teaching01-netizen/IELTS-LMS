use bytes::Bytes;
use chrono::{Duration, Utc};
use ielts_backend_domain::grading::{
    CompleteUploadRequest, MediaAsset, MediaAssetStatus, UploadIntent, UploadIntentRequest,
};
use ielts_backend_infrastructure::object_store::{MediaObjectStore, MediaObjectStoreError};
use sqlx::MySqlPool;
use thiserror::Error;
use uuid::Uuid;

pub const ACT_SCIENCE_CHOICE_IMAGE_MAX_BYTES: usize = 5 * 1024 * 1024;
const ACT_SCIENCE_CHOICE_IMAGE_TYPES: [&str; 3] = ["image/jpeg", "image/png", "image/webp"];

#[derive(Error, Debug)]
pub enum MediaError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Storage error: {0}")]
    Storage(#[from] MediaObjectStoreError),
    #[error("Invalid media upload: {0}")]
    InvalidUpload(String),
    #[error("Not found")]
    NotFound,
}

pub struct MediaService {
    pool: MySqlPool,
    object_store: MediaObjectStore,
}

impl MediaService {
    pub fn new(
        pool: MySqlPool,
        object_store: Option<MediaObjectStore>,
    ) -> Result<Self, MediaError> {
        Ok(Self {
            pool,
            object_store: object_store.unwrap_or(MediaObjectStore::from_env()?),
        })
    }

    pub async fn create_upload_intent(
        &self,
        req: UploadIntentRequest,
        csrf_token: &str,
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
        .bind(format!("media/{asset_id}"))
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
            headers: serde_json::json!({
                "content-type": content_type,
                "x-csrf-token": csrf_token,
            }),
        })
    }

    pub async fn store_upload(
        &self,
        asset_id: Uuid,
        content_type: &str,
        bytes: Bytes,
    ) -> Result<(), MediaError> {
        let asset = self.get_asset(asset_id).await?;
        if asset.upload_status != MediaAssetStatus::Pending {
            return Err(MediaError::InvalidUpload(
                "The media asset is no longer pending upload.".to_owned(),
            ));
        }
        if asset.content_type != content_type {
            return Err(MediaError::InvalidUpload(
                "The uploaded content type does not match the upload intent.".to_owned(),
            ));
        }
        if matches!(
            asset.owner_kind.as_str(),
            "act_science_choice" | "act_science_question"
        ) && (!ACT_SCIENCE_CHOICE_IMAGE_TYPES.contains(&content_type)
            || bytes.len() > ACT_SCIENCE_CHOICE_IMAGE_MAX_BYTES)
        {
            return Err(MediaError::InvalidUpload(
                "ACT Science images must be JPG, PNG, or WebP files of 5 MB or less.".to_owned(),
            ));
        }

        self.object_store.put(asset_id, content_type, bytes).await?;
        Ok(())
    }

    pub async fn complete_upload(
        &self,
        asset_id: Uuid,
        req: CompleteUploadRequest,
    ) -> Result<MediaAsset, MediaError> {
        let current_asset = self.get_asset(asset_id).await?;
        if matches!(
            current_asset.owner_kind.as_str(),
            "act_science_choice" | "act_science_question"
        ) {
            let stored = self.object_store.get(asset_id).await?;
            if let Some(size_bytes) = req.size_bytes {
                if size_bytes != stored.bytes.len() as i64 {
                    return Err(MediaError::InvalidUpload(
                        "The declared file size does not match the uploaded file.".to_owned(),
                    ));
                }
            }
        }
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

    pub async fn get_asset_content(&self, asset_id: Uuid) -> Result<(String, Bytes), MediaError> {
        let asset = self.get_asset(asset_id).await?;
        if asset.upload_status != MediaAssetStatus::Finalized {
            return Err(MediaError::NotFound);
        }
        let stored = self.object_store.get(asset_id).await?;
        Ok((asset.content_type, stored.bytes))
    }

    pub async fn get_asset(&self, asset_id: Uuid) -> Result<MediaAsset, MediaError> {
        sqlx::query_as::<_, MediaAsset>("SELECT * FROM media_assets WHERE id = ?")
            .bind(asset_id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or(MediaError::NotFound)
    }
}
