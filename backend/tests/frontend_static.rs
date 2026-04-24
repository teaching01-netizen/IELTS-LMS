use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    body::{to_bytes, Body},
    http::{
        header::CACHE_CONTROL,
        Request, StatusCode,
    },
};
use ielts_backend_api::{router::build_router, state::AppState};
use ielts_backend_infrastructure::config::AppConfig;
use tower::ServiceExt;

fn create_frontend_fixture() -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time should move forward")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("ielts-frontend-fixture-{suffix}"));
    let assets_dir = dir.join("assets");

    fs::create_dir_all(&assets_dir).expect("fixture directory should be creatable");
    fs::write(
        dir.join("index.html"),
        "<!doctype html><html><body>frontend-index</body></html>",
    )
    .expect("index fixture should be writable");
    fs::write(assets_dir.join("app.js"), "console.log('frontend-asset');")
        .expect("asset fixture should be writable");

    dir
}

#[tokio::test]
async fn spa_routes_serve_index_assets_and_keep_api_404s() {
    let frontend_dist_dir = create_frontend_fixture();
    let app = build_router(AppState::new(AppConfig {
        frontend_dist_dir: frontend_dist_dir.to_string_lossy().into_owned(),
        ..AppConfig::default()
    }));

    let spa_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/admin/exams")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(spa_response.status(), StatusCode::OK);
    let spa_cache_control = spa_response
        .headers()
        .get(CACHE_CONTROL)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    assert!(
        spa_cache_control.contains("no-store"),
        "expected no-store for SPA entry HTML, got: {spa_cache_control}"
    );
    let spa_body = to_bytes(spa_response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert!(String::from_utf8(spa_body.to_vec())
        .unwrap()
        .contains("frontend-index"));

    let asset_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/assets/app.js")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(asset_response.status(), StatusCode::OK);
    let asset_cache_control = asset_response
        .headers()
        .get(CACHE_CONTROL)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    assert!(
        asset_cache_control.contains("immutable"),
        "expected immutable caching for fingerprinted assets, got: {asset_cache_control}"
    );
    let asset_body = to_bytes(asset_response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert!(String::from_utf8(asset_body.to_vec())
        .unwrap()
        .contains("frontend-asset"));

    let api_response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/does-not-exist")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(api_response.status(), StatusCode::NOT_FOUND);
}
