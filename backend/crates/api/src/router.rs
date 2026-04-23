use axum::{
    middleware,
    routing::{get, patch, post},
    Router,
};

use crate::{
    frontend,
    http::request_id::request_id_middleware,
    routes::{
        auth, exams, grading, health, library, media, proctor, results, schedules, settings,
        student, ws,
    },
    state::AppState,
};

pub fn build_router(state: AppState) -> Router {
    let middleware_state = state.clone();

    Router::new()
        .route("/healthz", get(health::healthz))
        .route("/readyz", get(health::readyz))
        .route("/metrics", get(health::metrics))
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
            Router::new().route("/:version_id", get(exams::get_version)),
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
            Router::new().route(
                "/exam-defaults",
                get(settings::get_exam_defaults).put(settings::update_exam_defaults),
            ),
        )
        .nest(
            "/api/v1/grading",
            Router::new()
                .route("/sessions", get(grading::list_sessions))
                .route("/sessions/:session_id", get(grading::get_session))
                .route("/submissions/:submission_id", get(grading::get_submission))
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
            middleware_state,
            request_id_middleware,
        ))
        .with_state(state)
}
