use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct LocalObjectStore {
    base_url: String,
}

impl LocalObjectStore {
    pub fn from_base_url(base_url: &str) -> Self {
        Self {
            base_url: base_url.to_owned(),
        }
    }

    pub fn upload_url(&self, asset_id: Uuid) -> String {
        format!("{}/uploads/{}", self.base_url, asset_id)
    }

    pub fn download_url(&self, asset_id: Uuid) -> String {
        format!("{}/assets/{}", self.base_url, asset_id)
    }
}
