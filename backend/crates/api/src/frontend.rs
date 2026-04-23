use std::path::{Component, Path, PathBuf};

use axum::{
    body::Body,
    extract::State,
    http::{
        header::{CACHE_CONTROL, EXPIRES, PRAGMA},
        HeaderValue, Request, StatusCode, Uri,
    },
    response::{IntoResponse, Response},
};
use tower::ServiceExt;
use tower_http::services::ServeFile;

use crate::state::AppState;

pub async fn serve_frontend(State(state): State<AppState>, uri: Uri) -> Response {
    let path = uri.path().to_owned();

    if is_api_path(&path) {
        return StatusCode::NOT_FOUND.into_response();
    }

    let frontend_root = Path::new(&state.config.frontend_dist_dir);
    let index_path = frontend_root.join("index.html");
    let target_path = if is_asset_path(&path) {
        match resolve_public_path(frontend_root, &path) {
            Some(path) => path,
            None => return StatusCode::NOT_FOUND.into_response(),
        }
    } else {
        index_path.clone()
    };
    let cache_kind = cache_kind_for_path(&path, &target_path, &index_path);

    match serve_file(target_path, uri).await {
        Some(response) => apply_cache_headers(response, cache_kind),
        None if is_asset_path(&path) => StatusCode::NOT_FOUND.into_response(),
        None => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[derive(Clone, Copy, Debug)]
enum FrontendCacheKind {
    /// HTML entry document (or SPA fallback). Must never be served stale after deploy.
    EntryHtml,
    /// Fingerprinted bundles under `/assets/` (Vite output). Safe to cache "forever".
    ImmutableAsset,
    /// Other static files (favicon, manifest, etc). Allow caching but force revalidation.
    Revalidate,
}

fn cache_kind_for_path(request_path: &str, target_path: &Path, index_path: &Path) -> FrontendCacheKind {
    if target_path == index_path || request_path == "/index.html" {
        return FrontendCacheKind::EntryHtml;
    }

    if request_path.starts_with("/assets/") {
        return FrontendCacheKind::ImmutableAsset;
    }

    FrontendCacheKind::Revalidate
}

fn apply_cache_headers(mut response: Response, cache_kind: FrontendCacheKind) -> Response {
    match cache_kind {
        FrontendCacheKind::EntryHtml => {
            response.headers_mut().insert(
                CACHE_CONTROL,
                HeaderValue::from_static("no-store, max-age=0"),
            );
            response
                .headers_mut()
                .insert(PRAGMA, HeaderValue::from_static("no-cache"));
            response
                .headers_mut()
                .insert(EXPIRES, HeaderValue::from_static("0"));
        }
        FrontendCacheKind::ImmutableAsset => {
            response.headers_mut().insert(
                CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=31536000, immutable"),
            );
        }
        FrontendCacheKind::Revalidate => {
            response.headers_mut().insert(
                CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=0, must-revalidate"),
            );
        }
    }

    response
}

fn is_api_path(path: &str) -> bool {
    path == "/api" || path.starts_with("/api/")
}

fn is_asset_path(path: &str) -> bool {
    path.starts_with("/assets/") || Path::new(path).extension().is_some()
}

fn resolve_public_path(root: &Path, request_path: &str) -> Option<PathBuf> {
    let relative = request_path.strip_prefix('/')?;
    let mut resolved = PathBuf::from(root);

    for component in Path::new(relative).components() {
        match component {
            Component::Normal(part) => resolved.push(part),
            Component::CurDir => continue,
            Component::RootDir | Component::Prefix(_) | Component::ParentDir => return None,
        }
    }

    Some(resolved)
}

async fn serve_file(path: PathBuf, uri: Uri) -> Option<Response> {
    let request = Request::builder().uri(uri).body(Body::empty()).ok()?;
    ServeFile::new(path)
        .oneshot(request)
        .await
        .ok()
        .map(IntoResponse::into_response)
}
