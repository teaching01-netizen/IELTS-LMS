use std::{env, fmt, fs, path::PathBuf, sync::Arc};

use bytes::Bytes;
use object_store::{
    aws::AmazonS3Builder, memory::InMemory, path::Path, Attribute, AttributeValue, Attributes,
    ObjectStore, PutOptions, PutPayload,
};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum MediaObjectStoreError {
    #[error("media storage configuration is invalid: {0}")]
    Configuration(String),
    #[error("media storage operation failed: {0}")]
    Backend(#[from] object_store::Error),
    #[error("media storage path is invalid")]
    InvalidPath,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredMedia {
    pub bytes: Bytes,
    pub content_type: String,
}

#[derive(Clone)]
pub struct MediaObjectStore {
    store: Arc<dyn ObjectStore>,
    base_url: String,
}

impl fmt::Debug for MediaObjectStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MediaObjectStore")
            .field("base_url", &self.base_url)
            .finish()
    }
}

impl MediaObjectStore {
    pub fn from_env() -> Result<Self, MediaObjectStoreError> {
        let backend = env::var("OBJECT_STORAGE_BACKEND")
            .unwrap_or_else(|_| "minio".to_owned())
            .to_ascii_lowercase();
        let base_url = env::var("MEDIA_ROUTE_BASE_URL")
            .unwrap_or_else(|_| "/api/v1/media".to_owned())
            .trim_end_matches('/')
            .to_owned();

        let store: Arc<dyn ObjectStore> = match backend.as_str() {
            "memory" => Arc::new(InMemory::new()),
            "local" => {
                let root = env::var("OBJECT_STORAGE_LOCAL_ROOT")
                    .map(PathBuf::from)
                    .unwrap_or_else(|_| PathBuf::from(".data/object-store"));
                fs::create_dir_all(&root)
                    .map_err(|err| MediaObjectStoreError::Configuration(err.to_string()))?;
                Arc::new(
                    object_store::local::LocalFileSystem::new_with_prefix(root)
                        .map_err(|err| MediaObjectStoreError::Configuration(err.to_string()))?,
                )
            }
            "minio" | "s3" => {
                let bucket =
                    env::var("OBJECT_STORAGE_BUCKET").unwrap_or_else(|_| "ielts-media".to_owned());
                let region =
                    env::var("OBJECT_STORAGE_REGION").unwrap_or_else(|_| "us-east-1".to_owned());
                let endpoint = env::var("OBJECT_STORAGE_ENDPOINT").ok();
                let access_key = env::var("OBJECT_STORAGE_ACCESS_KEY").ok();
                let secret_key = env::var("OBJECT_STORAGE_SECRET_KEY").ok();
                let force_path_style = env::var("OBJECT_STORAGE_FORCE_PATH_STYLE")
                    .map(|value| {
                        matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes")
                    })
                    .unwrap_or(true);

                let mut builder = AmazonS3Builder::new()
                    .with_bucket_name(bucket)
                    .with_region(region)
                    .with_virtual_hosted_style_request(!force_path_style);
                if let Some(endpoint) = endpoint {
                    builder = builder
                        .with_endpoint(endpoint.clone())
                        .with_allow_http(endpoint.starts_with("http://"));
                }
                if let Some(access_key) = access_key {
                    builder = builder.with_access_key_id(access_key);
                }
                if let Some(secret_key) = secret_key {
                    builder = builder.with_secret_access_key(secret_key);
                }

                Arc::new(
                    builder
                        .build()
                        .map_err(|err| MediaObjectStoreError::Configuration(err.to_string()))?,
                )
            }
            other => {
                return Err(MediaObjectStoreError::Configuration(format!(
                    "unsupported OBJECT_STORAGE_BACKEND: {other}"
                )))
            }
        };

        Ok(Self { store, base_url })
    }

    pub fn in_memory() -> Self {
        Self {
            store: Arc::new(InMemory::new()),
            base_url: "/api/v1/media".to_owned(),
        }
    }

    pub fn upload_url(&self, asset_id: Uuid) -> String {
        format!("{}/uploads/{}", self.base_url, asset_id)
    }

    pub fn download_url(&self, asset_id: Uuid) -> String {
        format!("{}/{}/content", self.base_url, asset_id)
    }

    pub async fn put(
        &self,
        asset_id: Uuid,
        content_type: &str,
        bytes: Bytes,
    ) -> Result<(), MediaObjectStoreError> {
        let mut attributes = Attributes::new();
        attributes.insert(
            Attribute::ContentType,
            AttributeValue::from(content_type.to_owned()),
        );
        self.store
            .put_opts(
                &Self::object_path(asset_id)?,
                PutPayload::from(bytes),
                PutOptions {
                    attributes,
                    ..Default::default()
                },
            )
            .await?;
        Ok(())
    }

    pub async fn get(&self, asset_id: Uuid) -> Result<StoredMedia, MediaObjectStoreError> {
        let result = self.store.get(&Self::object_path(asset_id)?).await?;
        let content_type = result
            .attributes
            .get(&Attribute::ContentType)
            .map(|value| value.to_string())
            .unwrap_or_else(|| "application/octet-stream".to_owned());
        Ok(StoredMedia {
            bytes: result.bytes().await?,
            content_type,
        })
    }

    fn object_path(asset_id: Uuid) -> Result<Path, MediaObjectStoreError> {
        Path::parse(format!("media/{asset_id}")).map_err(|_| MediaObjectStoreError::InvalidPath)
    }
}

#[cfg(test)]
mod tests {
    use super::MediaObjectStore;
    use bytes::Bytes;
    use uuid::Uuid;

    #[tokio::test]
    async fn stores_and_reads_media_bytes() {
        let store = MediaObjectStore::in_memory();
        let asset_id = Uuid::new_v4();
        let expected = Bytes::from_static(b"act-choice-image");

        store
            .put(asset_id, "image/png", expected.clone())
            .await
            .expect("store media bytes");

        let actual = store.get(asset_id).await.expect("read media bytes");

        assert_eq!(actual.content_type, "image/png");
        assert_eq!(actual.bytes, expected);
    }
}
