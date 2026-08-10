use axum::{
    extract::{Request, State},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, patch, post, put},
    Router,
};

use crate::{
    frontend,
    http::request_id::request_id_middleware,
    routes::{
        answer_history, auth, exams, grading, health, library, media, proctor, results, schedules,
        settings, student, ws,
    },
    state::AppState,
};
use std::time::Instant;
use tower_http::compression::CompressionLayer;

pub fn build_router(state: AppState) -> Router {
    let middleware_state = state.clone();
    let background_state = state.clone();

    Router::new()
        .route("/healthz", get(health::healthz))
        .route("/readyz", get(health::readyz))
        .route("/metrics", get(health::metrics))
        .nest(
            "/api/v1/answer-history",
            Router::new()
                .route(
                    "/submissions/:submission_id/overview",
                    get(answer_history::get_overview),
                )
                .route(
                    "/submissions/:submission_id/targets/:target_id",
                    get(answer_history::get_target_detail),
                )
                .route(
                    "/submissions/:submission_id/export",
                    get(answer_history::export_target),
                )
                .route(
                    "/attempts/:attempt_id/overview",
                    get(answer_history::get_overview_by_attempt),
                )
                .route(
                    "/attempts/:attempt_id/targets/:target_id",
                    get(answer_history::get_target_detail_by_attempt),
                ),
        )
        .nest(
            "/api/v1/auth",
            Router::new()
                .route("/login", post(auth::login))
                .route("/student/entry", post(auth::student_entry))
                .route("/session", get(auth::session))
                .route("/logout", post(auth::logout))
                .route("/logout-all", post(auth::logout_all))
                .route("/activate", post(auth::activate_account))
                .route(
                    "/password/reset-request",
                    post(auth::request_password_reset),
                )
                .route(
                    "/password/reset-complete",
                    post(auth::complete_password_reset),
                ),
        )
        .nest(
            "/api/v1/exams",
            Router::new()
                .route("/", get(exams::list_exams).post(exams::create_exam))
                .route(
                    "/:id",
                    get(exams::get_exam)
                        .patch(exams::update_exam)
                        .delete(exams::delete_exam),
                )
                .route("/:id/draft", patch(exams::save_draft))
                .route("/:id/publish", post(exams::publish_exam))
                .route("/:id/events", get(exams::list_events))
                .route("/:id/validation", get(exams::get_validation))
                .route("/:id/versions", get(exams::list_versions))
                .route("/:id/versions/summary", get(exams::list_version_summaries)),
        )
        .nest(
            "/api/v1/versions",
            Router::new().route("/:version_id", get(exams::get_version_with_projection)),
        )
        .nest(
            "/api/v1/schedules",
            Router::new()
                .route(
                    "/",
                    get(schedules::list_schedules).post(schedules::create_schedule),
                )
                .route(
                    "/:id",
                    get(schedules::get_schedule)
                        .patch(schedules::update_schedule)
                        .delete(schedules::delete_schedule),
                )
                .route("/:id/runtime", get(schedules::get_runtime))
                .route(
                    "/:id/runtime/commands",
                    post(schedules::apply_runtime_command),
                )
                .route(
                    "/:id/register",
                    post(schedules::create_student_registration),
                ),
        )
        .nest(
            "/api/v1/student",
            Router::new().nest(
                "/sessions",
                Router::new()
                    .route("/:schedule_id", get(student::get_student_session))
                    .route(
                        "/:schedule_id/static",
                        get(student::get_student_static_session),
                    )
                    .route("/:schedule_id/live", get(student::get_student_live_session))
                    .route("/:schedule_id/precheck", post(student::save_precheck))
                    .route(
                        "/:schedule_id/bootstrap",
                        post(student::bootstrap_student_session),
                    )
                    .route(
                        "/:schedule_id/mutations:batch",
                        post(student::apply_mutation_batch),
                    )
                    .route("/:schedule_id/heartbeat", post(student::record_heartbeat))
                    .route("/:schedule_id/audit", post(student::record_audit))
                    .route(
                        "/:schedule_id/submit",
                        post(student::submit_student_session),
                    ),
            ),
        )
        .nest(
            "/api/v1/proctor",
            Router::new()
                .route("/sessions", get(proctor::list_sessions))
                .route("/sessions/:schedule_id", get(proctor::get_session))
                .route(
                    "/sessions/:schedule_id/presence",
                    post(proctor::refresh_presence),
                )
                .route(
                    "/sessions/:schedule_id/control/end-section-now",
                    post(proctor::end_section_now),
                )
                .route(
                    "/sessions/:schedule_id/control/extend-section",
                    post(proctor::extend_section),
                )
                .route(
                    "/sessions/:schedule_id/control/complete-exam",
                    post(proctor::complete_exam),
                )
                .route(
                    "/sessions/:schedule_id/attempts/:attempt_id/warn",
                    post(proctor::warn_attempt),
                )
                .route(
                    "/sessions/:schedule_id/attempts/:attempt_id/pause",
                    post(proctor::pause_attempt),
                )
                .route(
                    "/sessions/:schedule_id/attempts/:attempt_id/resume",
                    post(proctor::resume_attempt),
                )
                .route(
                    "/sessions/:schedule_id/attempts/:attempt_id/terminate",
                    post(proctor::terminate_attempt),
                )
                .route("/alerts/:alert_id/ack", post(proctor::acknowledge_alert))
                .route("/live-mode", get(proctor::live_mode)),
        )
        .nest(
            "/api/v1/library",
            Router::new()
                .route(
                    "/passages",
                    get(library::list_passages).post(library::create_passage),
                )
                .route(
                    "/passages/:id",
                    get(library::get_passage)
                        .patch(library::update_passage)
                        .delete(library::delete_passage),
                )
                .route(
                    "/questions",
                    get(library::list_questions).post(library::create_question),
                )
                .route(
                    "/questions/:id",
                    get(library::get_question)
                        .patch(library::update_question)
                        .delete(library::delete_question),
                ),
        )
        .nest(
            "/api/v1/settings",
            Router::new()
                .route(
                    "/exam-defaults",
                    get(settings::get_exam_defaults).put(settings::update_exam_defaults),
                )
                .route(
                    "/export-profiles",
                    get(settings::list_grading_export_profiles)
                        .post(settings::create_grading_export_profile),
                ),
        )
        .nest(
            "/api/v1/grading",
            Router::new()
                .route("/sessions", get(grading::list_sessions))
                .route("/sessions/:session_id", get(grading::get_session))
                .route(
                    "/schedules/:schedule_id/objective-overrides",
                    get(grading::list_objective_overrides),
                )
                .route(
                    "/schedules/:schedule_id/objective-grading-source",
                    get(grading::get_objective_grading_source),
                )
                .route(
                    "/schedules/:schedule_id/objective-integrity",
                    get(grading::get_objective_integrity_overview),
                )
                .route(
                    "/schedules/:schedule_id/objective-overrides/:question_id",
                    put(grading::upsert_objective_override)
                        .delete(grading::delete_objective_override),
                )
                .route(
                    "/schedules/:schedule_id/objective-regrade-latest-draft",
                    post(grading::regrade_objective_latest_draft),
                )
                .route("/submissions/:submission_id", get(grading::get_submission))
                .route(
                    "/submissions/:submission_id/sections",
                    get(grading::get_submission_sections),
                )
                .route(
                    "/submissions/:submission_id/sections/:section/questions/:question_id/override",
                    put(grading::override_objective_question),
                )
                .route(
                    "/submissions/:submission_id/writing-tasks",
                    get(grading::get_submission_writing_tasks),
                )
                .route(
                    "/submissions/:submission_id/start-review",
                    post(grading::start_review),
                )
                .route(
                    "/submissions/:submission_id/review-draft",
                    get(grading::get_review_draft).put(grading::save_review_draft),
                )
                .route(
                    "/submissions/:submission_id/mark-grading-complete",
                    post(grading::mark_grading_complete),
                )
                .route(
                    "/submissions/:submission_id/mark-ready-to-release",
                    post(grading::mark_ready_to_release),
                )
                .route(
                    "/submissions/:submission_id/release-now",
                    post(grading::release_now),
                )
                .route(
                    "/submissions/:submission_id/schedule-release",
                    post(grading::schedule_release),
                )
                .route(
                    "/submissions/:submission_id/reopen-review",
                    post(grading::reopen_review),
                )
                .route(
                    "/results/:result_id/events",
                    get(grading::get_result_events),
                ),
        )
        .nest(
            "/api/v1/results",
            Router::new()
                .route("/", get(results::list_results))
                .route("/analytics", get(results::analytics))
                .route("/export", post(results::export_results))
                .route("/:result_id/events", get(results::result_events))
                .route("/:result_id", get(results::get_result)),
        )
        .nest(
            "/api/v1/media",
            Router::new()
                .route("/uploads", post(media::create_upload))
                .route("/uploads/:asset_id/complete", post(media::complete_upload))
                .route("/:asset_id", get(media::get_asset)),
        )
        .route("/api/v1/ws/*path", get(ws::websocket_live))
        .fallback(frontend::serve_frontend)
        .layer(middleware::from_fn_with_state(
            background_state,
            background_activity_middleware,
        ))
        .layer(middleware::from_fn_with_state(
            middleware_state,
            request_id_middleware,
        ))
        .layer(CompressionLayer::new())
        .with_state(state)
}

async fn background_activity_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    if matches!(request.uri().path(), "/healthz" | "/readyz" | "/metrics") {
        return next.run(request).await;
    }

    let Some(background) = state.background_runtime.clone() else {
        return next.run(request).await;
    };

    let wake_started = Instant::now();
    let _request_guard = match background.request_started().await {
        Ok(guard) => {
            state
                .telemetry
                .observe_background_wake("success", wake_started.elapsed());
            guard
        }
        Err(error) => {
            state
                .telemetry
                .observe_background_wake(error.as_label(), wake_started.elapsed());
            tracing::error!(error = %error, "request background recovery failed");
            return (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                "Service recovery failed; retry the request.",
            )
                .into_response();
        }
    };
    next.run(request).await
}

#[cfg(test)]
mod tests {
    use super::build_router;
    use crate::{
        background::{spawn_background_runtime_with_jobs, BackgroundJobs},
        state::AppState,
    };
    use async_trait::async_trait;
    use axum::{body::Body, http::Request};
    use ielts_backend_infrastructure::config::{AppConfig, BackgroundRuntimeMode};
    use std::time::Duration;
    use tower::ServiceExt;

    struct FailingRecovery;

    #[async_trait]
    impl BackgroundJobs for FailingRecovery {
        async fn recover_critical(&mut self) -> Result<(), String> {
            Err("database unavailable".to_owned())
        }

        async fn active_cycle(&mut self) {}
    }

    fn app_with_failing_recovery() -> axum::Router {
        let handle = spawn_background_runtime_with_jobs(
            crate::background::CoordinatorConfig {
                mode: BackgroundRuntimeMode::ActivityDriven,
                grace: Duration::from_secs(60),
                tick: Duration::from_millis(10),
                command_capacity: 8,
                wake_timeout: Duration::from_secs(1),
            },
            FailingRecovery,
        );
        build_router(AppState::new(AppConfig::default()).with_background_runtime(handle))
    }

    #[tokio::test]
    async fn health_probe_does_not_activate_background_recovery() {
        let response = app_with_failing_recovery()
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), axum::http::StatusCode::OK);
    }

    #[tokio::test]
    async fn real_request_fails_closed_when_wake_recovery_fails() {
        let response = app_with_failing_recovery()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/auth/session")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            response.status(),
            axum::http::StatusCode::SERVICE_UNAVAILABLE
        );
    }
}
