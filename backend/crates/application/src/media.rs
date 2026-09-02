use chrono::{Duration, Utc};
use ielts_backend_domain::grading::{
    CompleteUploadRequest, MediaAsset, UploadIntent, UploadIntentRequest,
};
use ielts_backend_infrastructure::{
    actor_context::{AccessScope, ActorContext},
    object_store::LocalObjectStore,
};
use sqlx::{MySql, MySqlPool, QueryBuilder};
use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum MediaError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Not found")]
    NotFound,
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Object storage unavailable: {0}")]
    ObjectStore(String),
}

pub struct MediaService {
    pool: MySqlPool,
    object_store: LocalObjectStore,
}

fn ensure_media_writer(ctx: &ActorContext) -> Result<(), MediaError> {
    if matches!(
        ctx.role,
        ielts_backend_infrastructure::actor_context::ActorRole::AdminObserver
    ) {
        Err(MediaError::NotFound)
    } else {
        Ok(())
    }
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
        ctx: &ActorContext,
        req: UploadIntentRequest,
    ) -> Result<UploadIntent, MediaError> {
        ensure_media_writer(ctx)?;
        if req.file_name.trim().is_empty()
            || req.file_name.contains('/')
            || req.file_name.contains('\\')
            || req.file_name == "."
            || req.file_name == ".."
        {
            return Err(MediaError::Validation(
                "The file name must be a single path-safe file name.".to_owned(),
            ));
        }
        let (owner_kind, owner_id, _organization_id) = self
            .resolve_authoritative_owner(ctx, &req.owner_kind, &req.owner_id)
            .await?;
        let checksum_sha256 = req.checksum_sha256.as_deref().map(str::to_ascii_lowercase);
        if let Some(checksum) = checksum_sha256.as_deref() {
            validate_checksum(checksum)?;
        }
        let asset_id = Uuid::new_v4();
        let object_key = format!("media/{asset_id}/{}", req.file_name);
        let upload_url = self
            .object_store
            .upload_url(asset_id, &object_key, checksum_sha256.as_deref())
            .map_err(MediaError::ObjectStore)?;
        let content_type = req.content_type.clone();
        let mut upload_headers = serde_json::json!({ "content-type": content_type });
        if let Some(checksum) = checksum_sha256.as_deref() {
            upload_headers["x-amz-meta-checksum-sha256"] = serde_json::json!(checksum);
        }
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
        .bind(owner_kind)
        .bind(owner_id)
        .bind(req.content_type)
        .bind(req.file_name.clone())
        .bind(object_key)
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
            headers: upload_headers,
        })
    }

    pub async fn upload_local_object(
        &self,
        ctx: &ActorContext,
        asset_id: Uuid,
        bytes: &[u8],
    ) -> Result<(), MediaError> {
        ensure_media_writer(ctx)?;
        let mut tx = self.pool.begin().await?;
        let mut query = QueryBuilder::<MySql>::new("SELECT m.* FROM media_assets m WHERE m.id = ");
        query.push_bind(asset_id.to_string());
        append_asset_scope(&mut query, ctx);
        query.push(" FOR UPDATE");
        let asset = query
            .build_query_as::<MediaAsset>()
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(MediaError::NotFound)?;
        if asset.upload_status != ielts_backend_domain::grading::MediaAssetStatus::Pending {
            return Err(MediaError::Validation(
                "The media asset is no longer accepting uploads.".to_owned(),
            ));
        }
        self.object_store
            .put_local_object(&asset.object_key, bytes)
            .await
            .map_err(MediaError::ObjectStore)?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn read_local_object(
        &self,
        ctx: &ActorContext,
        asset_id: Uuid,
    ) -> Result<(String, Vec<u8>), MediaError> {
        let asset = self.get_asset(ctx, asset_id).await?;
        if asset.upload_status != ielts_backend_domain::grading::MediaAssetStatus::Finalized {
            return Err(MediaError::NotFound);
        }
        let bytes = self
            .object_store
            .read_local_object(&asset.object_key)
            .await
            .map_err(MediaError::ObjectStore)?;
        Ok((asset.content_type, bytes))
    }

    pub async fn complete_upload(
        &self,
        ctx: &ActorContext,
        asset_id: Uuid,
        req: CompleteUploadRequest,
    ) -> Result<MediaAsset, MediaError> {
        ensure_media_writer(ctx)?;
        let size_bytes = req.size_bytes.ok_or_else(|| {
            MediaError::Validation("The uploaded object size is required.".to_owned())
        })?;
        if size_bytes < 0 {
            return Err(MediaError::Validation(
                "The uploaded object size cannot be negative.".to_owned(),
            ));
        }
        let checksum_sha256 = req.checksum_sha256.ok_or_else(|| {
            MediaError::Validation("The uploaded object checksum is required.".to_owned())
        })?;
        validate_checksum(&checksum_sha256)?;
        let expected_checksum = checksum_sha256.to_ascii_lowercase();
        let mut tx = self.pool.begin().await?;
        let mut query = QueryBuilder::<MySql>::new("SELECT m.* FROM media_assets m WHERE m.id = ");
        query.push_bind(asset_id.to_string());
        append_asset_scope(&mut query, ctx);
        query.push(" FOR UPDATE");
        let asset = query
            .build_query_as::<MediaAsset>()
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(MediaError::NotFound)?;
        if asset.upload_status != ielts_backend_domain::grading::MediaAssetStatus::Pending {
            if asset.size_bytes != Some(size_bytes)
                || !asset
                    .checksum_sha256
                    .as_deref()
                    .is_some_and(|checksum| checksum.eq_ignore_ascii_case(&expected_checksum))
            {
                return Err(MediaError::Validation(
                    "The uploaded object does not match the finalized asset metadata.".to_owned(),
                ));
            }
            tx.commit().await?;
            return Ok(asset);
        }
        let metadata = self
            .object_store
            .head_object(&asset.object_key)
            .await
            .map_err(MediaError::ObjectStore)?;
        if metadata.size_bytes != size_bytes || metadata.checksum_sha256 != expected_checksum {
            return Err(MediaError::Validation(
                "The uploaded object metadata does not match the completion request.".to_owned(),
            ));
        }
        let download_url = self.object_store.download_url(asset_id);
        let result = sqlx::query(
            r#"
            UPDATE media_assets
            SET
                upload_status = 'finalized',
                size_bytes = ?,
                checksum_sha256 = ?,
                download_url = ?,
                delete_after_at = CASE
                    WHEN owner_kind = 'assessment_import' THEN DATE_ADD(NOW(), INTERVAL 1 DAY)
                    ELSE NULL
                END,
                updated_at = NOW()
            WHERE id = ?
              AND upload_status = 'pending'
            "#,
        )
        .bind(size_bytes)
        .bind(&expected_checksum)
        .bind(download_url)
        .bind(asset_id.to_string())
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() != 1 {
            return Err(MediaError::Validation(
                "The media asset changed while it was being completed.".to_owned(),
            ));
        }
        tx.commit().await?;
        self.get_asset(ctx, asset_id).await
    }

    pub async fn get_asset(
        &self,
        ctx: &ActorContext,
        asset_id: Uuid,
    ) -> Result<MediaAsset, MediaError> {
        let mut query = QueryBuilder::<MySql>::new("SELECT m.* FROM media_assets m WHERE m.id = ");
        query.push_bind(asset_id.to_string());
        append_asset_scope(&mut query, ctx);
        query
            .build_query_as::<MediaAsset>()
            .fetch_optional(&self.pool)
            .await?
            .ok_or(MediaError::NotFound)
    }

    async fn resolve_authoritative_owner(
        &self,
        ctx: &ActorContext,
        owner_kind: &str,
        owner_id: &str,
    ) -> Result<(String, String, Option<String>), MediaError> {
        let owner: Option<(String, Option<String>)> = match owner_kind {
            "assessment_exam" => sqlx::query_as(
                "SELECT id, organization_id FROM exam_entities WHERE id = ? LIMIT 1",
            )
            .bind(owner_id)
            .fetch_optional(&self.pool)
            .await?,
            "assessment_import" => sqlx::query_as(
                "SELECT i.id, e.organization_id FROM sat_workbook_imports i JOIN exam_entities e ON e.id = i.exam_id WHERE i.id = ? LIMIT 1",
            )
            .bind(owner_id)
            .fetch_optional(&self.pool)
            .await?,
            "assessment_question" => sqlx::query_as(
                "SELECT q.id, e.organization_id FROM assessment_questions q JOIN assessment_exam_questions eq ON eq.question_id = q.id JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id JOIN exam_versions v ON v.id = s.exam_version_id JOIN exam_entities e ON e.id = v.exam_id WHERE q.id = ? LIMIT 1",
            )
            .bind(owner_id)
            .fetch_optional(&self.pool)
            .await?,
            "submission" => sqlx::query_as(
                "SELECT ss.id, es.organization_id FROM student_submissions ss JOIN exam_schedules es ON es.id = ss.schedule_id WHERE ss.id = ? LIMIT 1",
            )
            .bind(owner_id)
            .fetch_optional(&self.pool)
            .await?,
            "attempt" => sqlx::query_as(
                "SELECT sa.id, sa.organization_id FROM student_attempts sa WHERE sa.id = ? LIMIT 1",
            )
            .bind(owner_id)
            .fetch_optional(&self.pool)
            .await?,
            _ => {
                return Err(MediaError::Validation(
                    "Unsupported media owner kind.".to_owned(),
                ))
            }
        };
        let Some((owner_id, organization_id)) = owner else {
            return Err(MediaError::NotFound);
        };
        match ctx.access_scope() {
            Some(AccessScope::PlatformWrite) => {}
            Some(AccessScope::Tenant {
                organization_id: actor_org,
                ..
            }) if organization_id.as_deref() == Some(actor_org.as_str()) => {}
            _ => return Err(MediaError::NotFound),
        }
        Ok((owner_kind.to_owned(), owner_id, organization_id))
    }
}

fn validate_checksum(checksum: &str) -> Result<(), MediaError> {
    if checksum.len() != 64
        || !checksum
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err(MediaError::Validation(
            "The uploaded object checksum must be a SHA-256 hex digest.".to_owned(),
        ));
    }
    Ok(())
}

fn append_asset_scope(query: &mut QueryBuilder<'_, MySql>, ctx: &ActorContext) {
    match ctx.access_scope() {
        Some(AccessScope::PlatformRead | AccessScope::PlatformWrite) => {}
        Some(AccessScope::Tenant {
            organization_id, ..
        }) => {
            query.push(
                " AND ((m.owner_kind = 'assessment_exam' AND EXISTS (SELECT 1 FROM exam_entities e WHERE e.id = m.owner_id AND e.organization_id = ",
            );
            query.push_bind(organization_id.clone());
            query.push(
                ")) OR (m.owner_kind = 'assessment_import' AND EXISTS (SELECT 1 FROM sat_workbook_imports i JOIN exam_entities e2 ON e2.id = i.exam_id WHERE i.id = m.owner_id AND e2.organization_id = ",
            );
            query.push_bind(organization_id.clone());
            query.push(")) OR (m.owner_kind = 'assessment_question' AND EXISTS (SELECT 1 FROM assessment_questions q JOIN assessment_exam_questions eq ON eq.question_id = q.id JOIN assessment_modules am ON am.id = eq.module_id JOIN assessment_sections s ON s.id = am.section_id JOIN exam_versions v ON v.id = s.exam_version_id JOIN exam_entities e3 ON e3.id = v.exam_id WHERE q.id = m.owner_id AND e3.organization_id = ");
            query.push_bind(organization_id.clone());
            query.push(")) OR (m.owner_kind = 'submission' AND EXISTS (SELECT 1 FROM student_submissions ss JOIN exam_schedules es ON es.id = ss.schedule_id WHERE ss.id = m.owner_id AND es.organization_id = ");
            query.push_bind(organization_id.clone());
            query.push(")) OR (m.owner_kind = 'attempt' AND EXISTS (SELECT 1 FROM student_attempts sa WHERE sa.id = m.owner_id AND sa.organization_id = ");
            query.push_bind(organization_id);
            query.push(")))");
        }
        None => {
            query.push(" AND 1 = 0");
        }
    };
}
