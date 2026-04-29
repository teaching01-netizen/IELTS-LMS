#[path = "../support/mysql.rs"]
mod mysql;

use std::{env, net::TcpStream, time::Duration};

use ielts_backend_domain::grading::{
    GradingSessionStatus, MediaAssetStatus, OverallGradingStatus, ReleaseStatus, ReviewAction,
    SectionGradingStatus,
};

#[tokio::test]
async fn grading_enums_decode_and_encode_as_text() {
    if env::var("TEST_DATABASE_URL").is_err()
        && TcpStream::connect_timeout(
            &"127.0.0.1:4000".parse().expect("socket addr"),
            Duration::from_secs(1),
        )
        .is_err()
    {
        eprintln!("Skipping: no TEST_DATABASE_URL and no local MySQL/TiDB on 127.0.0.1:4000");
        return;
    }

    let database = mysql::TestDatabase::new(&[]).await;
    let pool = database.pool();

    // GradingSessionStatus
    for (raw, expected) in [
        ("scheduled", GradingSessionStatus::Scheduled),
        ("live", GradingSessionStatus::Live),
        ("in_progress", GradingSessionStatus::InProgress),
        ("completed", GradingSessionStatus::Completed),
        ("cancelled", GradingSessionStatus::Cancelled),
    ] {
        let decoded: GradingSessionStatus =
            sqlx::query_scalar::<_, GradingSessionStatus>(&format!("SELECT '{raw}'"))
                .fetch_one(pool)
                .await
                .expect("decode grading session status");
        assert_eq!(decoded, expected);

        let encoded: String = sqlx::query_scalar("SELECT ?")
            .bind(expected.clone())
            .fetch_one(pool)
            .await
            .expect("encode grading session status");
        assert_eq!(encoded, raw);
    }

    // SectionGradingStatus
    for (raw, expected) in [
        ("pending", SectionGradingStatus::Pending),
        ("auto_graded", SectionGradingStatus::AutoGraded),
        ("needs_review", SectionGradingStatus::NeedsReview),
        ("in_review", SectionGradingStatus::InReview),
        ("finalized", SectionGradingStatus::Finalized),
        ("reopened", SectionGradingStatus::Reopened),
    ] {
        let decoded: SectionGradingStatus =
            sqlx::query_scalar::<_, SectionGradingStatus>(&format!("SELECT '{raw}'"))
                .fetch_one(pool)
                .await
                .expect("decode section grading status");
        assert_eq!(decoded, expected);

        let encoded: String = sqlx::query_scalar("SELECT ?")
            .bind(expected.clone())
            .fetch_one(pool)
            .await
            .expect("encode section grading status");
        assert_eq!(encoded, raw);
    }

    // OverallGradingStatus
    for (raw, expected) in [
        ("not_submitted", OverallGradingStatus::NotSubmitted),
        ("submitted", OverallGradingStatus::Submitted),
        ("in_progress", OverallGradingStatus::InProgress),
        ("grading_complete", OverallGradingStatus::GradingComplete),
        ("ready_to_release", OverallGradingStatus::ReadyToRelease),
        ("released", OverallGradingStatus::Released),
        ("reopened", OverallGradingStatus::Reopened),
    ] {
        let decoded: OverallGradingStatus =
            sqlx::query_scalar::<_, OverallGradingStatus>(&format!("SELECT '{raw}'"))
                .fetch_one(pool)
                .await
                .expect("decode overall grading status");
        assert_eq!(decoded, expected);

        let encoded: String = sqlx::query_scalar("SELECT ?")
            .bind(expected.clone())
            .fetch_one(pool)
            .await
            .expect("encode overall grading status");
        assert_eq!(encoded, raw);
    }

    // ReleaseStatus
    for (raw, expected) in [
        ("draft", ReleaseStatus::Draft),
        ("grading_complete", ReleaseStatus::GradingComplete),
        ("ready_to_release", ReleaseStatus::ReadyToRelease),
        ("released", ReleaseStatus::Released),
        ("reopened", ReleaseStatus::Reopened),
    ] {
        let decoded: ReleaseStatus =
            sqlx::query_scalar::<_, ReleaseStatus>(&format!("SELECT '{raw}'"))
                .fetch_one(pool)
                .await
                .expect("decode release status");
        assert_eq!(decoded, expected);

        let encoded: String = sqlx::query_scalar("SELECT ?")
            .bind(expected.clone())
            .fetch_one(pool)
            .await
            .expect("encode release status");
        assert_eq!(encoded, raw);
    }

    // ReviewAction
    for (raw, expected) in [
        ("review_started", ReviewAction::ReviewStarted),
        ("review_assigned", ReviewAction::ReviewAssigned),
        ("draft_saved", ReviewAction::DraftSaved),
        ("comment_added", ReviewAction::CommentAdded),
        ("comment_updated", ReviewAction::CommentUpdated),
        ("rubric_updated", ReviewAction::RubricUpdated),
        ("review_finalized", ReviewAction::ReviewFinalized),
        ("review_reopened", ReviewAction::ReviewReopened),
        ("score_override", ReviewAction::ScoreOverride),
        ("feedback_updated", ReviewAction::FeedbackUpdated),
        ("release_now", ReviewAction::ReleaseNow),
        ("mark_ready_to_release", ReviewAction::MarkReadyToRelease),
    ] {
        let decoded: ReviewAction =
            sqlx::query_scalar::<_, ReviewAction>(&format!("SELECT '{raw}'"))
                .fetch_one(pool)
                .await
                .expect("decode review action");
        assert_eq!(decoded, expected);

        let encoded: String = sqlx::query_scalar("SELECT ?")
            .bind(expected.clone())
            .fetch_one(pool)
            .await
            .expect("encode review action");
        assert_eq!(encoded, raw);
    }

    // MediaAssetStatus
    for (raw, expected) in [
        ("pending", MediaAssetStatus::Pending),
        ("finalized", MediaAssetStatus::Finalized),
        ("orphaned", MediaAssetStatus::Orphaned),
        ("deleted", MediaAssetStatus::Deleted),
    ] {
        let decoded: MediaAssetStatus =
            sqlx::query_scalar::<_, MediaAssetStatus>(&format!("SELECT '{raw}'"))
                .fetch_one(pool)
                .await
                .expect("decode media asset status");
        assert_eq!(decoded, expected);

        let encoded: String = sqlx::query_scalar("SELECT ?")
            .bind(expected.clone())
            .fetch_one(pool)
            .await
            .expect("encode media asset status");
        assert_eq!(encoded, raw);
    }

    database.shutdown().await;
}
