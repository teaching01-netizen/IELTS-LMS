use std::{
    env,
    path::{Path, PathBuf},
};

use chrono::Utc;
use hmac::{Hmac, Mac};
use reqwest::header::HeaderValue;
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Debug)]
enum ObjectStorageBackend {
    Local,
    S3Compatible,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ObjectMetadata {
    pub size_bytes: i64,
    pub checksum_sha256: String,
}

#[derive(Clone, Debug)]
pub struct LocalObjectStore {
    base_url: String,
    backend: ObjectStorageBackend,
    endpoint: Option<Url>,
    bucket: Option<String>,
    region: String,
    access_key: Option<String>,
    secret_key: Option<String>,
    local_root: PathBuf,
    client: reqwest::Client,
}

impl LocalObjectStore {
    pub fn from_env() -> Self {
        let backend = match env::var("OBJECT_STORAGE_BACKEND")
            .unwrap_or_else(|_| "local".to_owned())
            .to_ascii_lowercase()
            .as_str()
        {
            "minio" | "s3" | "s3-compatible" => ObjectStorageBackend::S3Compatible,
            _ => ObjectStorageBackend::Local,
        };
        let endpoint = env::var("OBJECT_STORAGE_ENDPOINT")
            .ok()
            .and_then(|value| Url::parse(value.trim_end_matches('/')).ok());

        Self {
            base_url: env::var("MEDIA_BASE_URL")
                .unwrap_or_else(|_| "https://media.local.invalid".to_owned())
                .trim_end_matches('/')
                .to_owned(),
            backend,
            endpoint,
            bucket: env::var("OBJECT_STORAGE_BUCKET").ok(),
            region: env::var("OBJECT_STORAGE_REGION").unwrap_or_else(|_| "us-east-1".to_owned()),
            access_key: env::var("OBJECT_STORAGE_ACCESS_KEY").ok(),
            secret_key: env::var("OBJECT_STORAGE_SECRET_KEY").ok(),
            local_root: env::var("OBJECT_STORAGE_LOCAL_ROOT")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from(".data/object-store")),
            client: reqwest::Client::new(),
        }
    }

    pub fn upload_url(
        &self,
        asset_id: Uuid,
        object_key: &str,
        checksum_sha256: Option<&str>,
    ) -> Result<String, String> {
        if matches!(self.backend, ObjectStorageBackend::S3Compatible) {
            return self.presigned_put_url(object_key, checksum_sha256);
        }
        // Local deployments upload through the authenticated API route. Keeping
        // this relative makes the intent work behind any reverse proxy/base URL.
        Ok(format!("/api/v1/media/uploads/{asset_id}"))
    }

    fn presigned_put_url(
        &self,
        object_key: &str,
        checksum_sha256: Option<&str>,
    ) -> Result<String, String> {
        validate_object_key(object_key)?;
        let endpoint = self
            .endpoint
            .as_ref()
            .ok_or_else(|| "OBJECT_STORAGE_ENDPOINT is not configured".to_owned())?;
        let bucket = self
            .bucket
            .as_deref()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "OBJECT_STORAGE_BUCKET is not configured".to_owned())?;
        let access_key = self
            .access_key
            .as_deref()
            .ok_or_else(|| "OBJECT_STORAGE_ACCESS_KEY is not configured".to_owned())?;
        let secret = self
            .secret_key
            .as_deref()
            .ok_or_else(|| "OBJECT_STORAGE_SECRET_KEY is not configured".to_owned())?;
        let url = object_url(endpoint, bucket, object_key)?;
        let host = url
            .host_str()
            .ok_or_else(|| "object storage endpoint has no host".to_owned())?;
        let host_header = match url.port() {
            Some(port) => format!("{host}:{port}"),
            None => host.to_owned(),
        };
        let amz_date = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
        let date = &amz_date[..8];
        let scope = format!("{date}/{}/{}/aws4_request", self.region, "s3");
        let credential = format!("{access_key}/{scope}");
        let checksum_sha256 = checksum_sha256
            .ok_or_else(|| "a SHA-256 checksum is required for S3-compatible uploads".to_owned())?;
        let signed_headers = "host;x-amz-meta-checksum-sha256";
        let query = format!(
            "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={}&X-Amz-Date={amz_date}&X-Amz-Expires=900&X-Amz-SignedHeaders={}",
            percent_encode(&credential),
            percent_encode(signed_headers)
        );
        let canonical_headers =
            format!("host:{host_header}\nx-amz-meta-checksum-sha256:{checksum_sha256}\n");
        let canonical_request = format!(
            "PUT\n{}\n{query}\n{canonical_headers}\n{signed_headers}\nUNSIGNED-PAYLOAD",
            url.path()
        );
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
            hex::encode(Sha256::digest(canonical_request.as_bytes()))
        );
        let signing_key = signing_key(secret, date, &self.region, "s3")?;
        let signature = hex::encode(hmac_bytes(&signing_key, string_to_sign.as_bytes())?);
        let signed_url = format!("{}?{query}&X-Amz-Signature={signature}", url);
        Ok(signed_url)
    }

    pub fn download_url(&self, asset_id: Uuid) -> String {
        if matches!(self.backend, ObjectStorageBackend::Local) {
            return format!("/api/v1/media/assets/{asset_id}");
        }
        format!("{}/assets/{asset_id}", self.base_url)
    }

    /// Read metadata from the object store, rather than trusting completion payloads.
    ///
    /// S3-compatible stores are queried with HEAD and require a checksum metadata
    /// header. ETag is intentionally not accepted because it is not a SHA-256
    /// checksum for multipart uploads. The local backend is used by single-node
    /// deployments and computes the digest from the authoritative file contents.
    pub async fn head_object(&self, object_key: &str) -> Result<ObjectMetadata, String> {
        validate_object_key(object_key)?;
        match self.backend {
            ObjectStorageBackend::Local => self.head_local(object_key).await,
            ObjectStorageBackend::S3Compatible => self.head_s3(object_key).await,
        }
    }

    pub async fn put_local_object(&self, object_key: &str, bytes: &[u8]) -> Result<(), String> {
        if !matches!(self.backend, ObjectStorageBackend::Local) {
            return Err(
                "local object upload is not available for S3-compatible storage".to_owned(),
            );
        }
        let path = safe_local_path(&self.local_root, object_key)?;
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|error| format!("object store directory creation failed: {error}"))?;
        }
        // Publish in one rename so completion/HEAD can never observe a partially
        // written object. The temporary file stays in the same directory for an
        // atomic rename on local filesystems.
        let temporary_path = path.with_file_name(format!(
            ".{}.upload-{}",
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("object"),
            Uuid::new_v4()
        ));
        if let Err(error) = tokio::fs::write(&temporary_path, bytes).await {
            return Err(format!(
                "object store write failed for {}: {error}",
                path.display()
            ));
        }
        if let Err(error) = tokio::fs::rename(&temporary_path, &path).await {
            let _ = tokio::fs::remove_file(&temporary_path).await;
            return Err(format!(
                "object store publish failed for {}: {error}",
                path.display()
            ));
        }
        Ok(())
    }

    pub async fn read_local_object(&self, object_key: &str) -> Result<Vec<u8>, String> {
        if !matches!(self.backend, ObjectStorageBackend::Local) {
            return Err(
                "local object download is not available for S3-compatible storage".to_owned(),
            );
        }
        let path = safe_local_path(&self.local_root, object_key)?;
        tokio::fs::read(&path)
            .await
            .map_err(|error| format!("object store read failed for {}: {error}", path.display()))
    }

    async fn head_local(&self, object_key: &str) -> Result<ObjectMetadata, String> {
        let path = safe_local_path(&self.local_root, object_key)?;
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|error| format!("object store read failed for {}: {error}", path.display()))?;
        let size_bytes = i64::try_from(bytes.len())
            .map_err(|_| "object size exceeds supported range".to_owned())?;
        let checksum_sha256 = hex::encode(Sha256::digest(&bytes));
        Ok(ObjectMetadata {
            size_bytes,
            checksum_sha256,
        })
    }

    async fn head_s3(&self, object_key: &str) -> Result<ObjectMetadata, String> {
        let endpoint = self
            .endpoint
            .as_ref()
            .ok_or_else(|| "OBJECT_STORAGE_ENDPOINT is not configured".to_owned())?;
        let bucket = self
            .bucket
            .as_deref()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "OBJECT_STORAGE_BUCKET is not configured".to_owned())?;
        let url = object_url(endpoint, bucket, object_key)?;
        let host = url
            .host_str()
            .ok_or_else(|| "object storage endpoint has no host".to_owned())?;
        let host_header = match url.port() {
            Some(port) => format!("{host}:{port}"),
            None => host.to_owned(),
        };
        let payload_hash = hex::encode(Sha256::digest([]));
        let amz_date = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
        let date = &amz_date[..8];
        let canonical_uri = url.path().to_owned();
        let canonical_headers = format!(
            "host:{host_header}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
        );
        let signed_headers = "host;x-amz-content-sha256;x-amz-date";
        let canonical_request = format!(
            "HEAD\n{canonical_uri}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
        );
        let scope = format!("{date}/{}/{}/aws4_request", self.region, "s3");
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
            hex::encode(Sha256::digest(canonical_request.as_bytes()))
        );
        let secret = self
            .secret_key
            .as_deref()
            .ok_or_else(|| "OBJECT_STORAGE_SECRET_KEY is not configured".to_owned())?;
        let access_key = self
            .access_key
            .as_deref()
            .ok_or_else(|| "OBJECT_STORAGE_ACCESS_KEY is not configured".to_owned())?;
        let signing_key = signing_key(secret, date, &self.region, "s3")?;
        let signature = hex::encode(hmac_bytes(&signing_key, string_to_sign.as_bytes())?);
        let authorization = format!(
            "AWS4-HMAC-SHA256 Credential={access_key}/{scope}, SignedHeaders={signed_headers}, Signature={signature}"
        );

        let response = self
            .client
            .head(url)
            .header(
                "host",
                HeaderValue::from_str(&host_header).map_err(|e| e.to_string())?,
            )
            .header("x-amz-content-sha256", &payload_hash)
            .header("x-amz-date", &amz_date)
            .header("authorization", authorization)
            .send()
            .await
            .map_err(|error| format!("object store HEAD failed: {error}"))?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Err("object was not found".to_owned());
        }
        if !response.status().is_success() {
            return Err(format!("object store HEAD returned {}", response.status()));
        }
        let size_bytes = response
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .ok_or_else(|| "object store response omitted Content-Length".to_owned())?
            .to_str()
            .map_err(|error| format!("invalid object Content-Length: {error}"))?
            .parse::<i64>()
            .map_err(|error| format!("invalid object Content-Length: {error}"))?;
        let checksum_sha256 = [
            "x-amz-checksum-sha256",
            "x-amz-meta-checksum-sha256",
            "x-checksum-sha256",
        ]
        .into_iter()
        .find_map(|name| response.headers().get(name))
        .ok_or_else(|| "object store response omitted SHA-256 checksum metadata".to_owned())?
        .to_str()
        .map_err(|error| format!("invalid object checksum metadata: {error}"))?
        .to_ascii_lowercase();
        if checksum_sha256.len() != 64 || !checksum_sha256.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("object store returned an invalid SHA-256 checksum".to_owned());
        }
        Ok(ObjectMetadata {
            size_bytes,
            checksum_sha256,
        })
    }
}

fn validate_object_key(object_key: &str) -> Result<(), String> {
    if object_key.is_empty()
        || object_key.starts_with('/')
        || object_key
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("invalid object key".to_owned());
    }
    Ok(())
}

fn safe_local_path(root: &Path, object_key: &str) -> Result<PathBuf, String> {
    let path = root.join(object_key);
    // The key validator rejects traversal components; this additional check protects
    // against platform-specific path normalization surprises.
    if path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("invalid object key".to_owned());
    }
    Ok(path)
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                char::from(byte).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

fn object_url(endpoint: &Url, bucket: &str, object_key: &str) -> Result<Url, String> {
    let mut url = endpoint.clone();
    let base_path = url.path().trim_end_matches('/');
    let encoded_key = object_key
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                char::from(byte).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect::<String>();
    url.set_path(&format!("{base_path}/{bucket}/{encoded_key}"));
    Ok(url)
}

fn hmac_bytes(key: &[u8], value: &[u8]) -> Result<Vec<u8>, String> {
    let mut mac = HmacSha256::new_from_slice(key).map_err(|error| error.to_string())?;
    mac.update(value);
    Ok(mac.finalize().into_bytes().to_vec())
}

fn signing_key(secret: &str, date: &str, region: &str, service: &str) -> Result<Vec<u8>, String> {
    let date_key = hmac_bytes(format!("AWS4{secret}").as_bytes(), date.as_bytes())?;
    let region_key = hmac_bytes(&date_key, region.as_bytes())?;
    let service_key = hmac_bytes(&region_key, service.as_bytes())?;
    hmac_bytes(&service_key, b"aws4_request")
}
