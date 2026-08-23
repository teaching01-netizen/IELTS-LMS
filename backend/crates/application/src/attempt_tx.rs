//! Shared attempt transaction helpers.
//!
//! Owned jointly by delivery, scheduling, and proctoring: auto-submit/finalize
//! must run inside the caller's transaction with identical semantics. Living
//! here keeps those modules free of mutual dependencies (no cycles).

use chrono::Utc;
use ielts_backend_domain::attempt::{AttemptPhase, StudentAttempt};
use serde_json::{json, Map, Value};
use sqlx::{MySqlConnection, MySqlPool};
use uuid::Uuid;

pub(crate) fn merge_recovery(existing: Value, patch: Value) -> Value {
    let mut base = ensure_object(existing);
    if let Some(patch_map) = patch.as_object() {
        for (key, value) in patch_map {
            base.insert(key.clone(), value.clone());
        }
    }
    Value::Object(base)
}

pub(crate) fn ensure_object(value: Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

pub(crate) async fn auto_submit_schedule_attempts_in_tx(
    connection: &mut MySqlConnection,
    schedule_id: Uuid,
    completion_reason: &str,
) -> Result<(), sqlx::Error> {
    let pending_attempts = sqlx::query_as::<_, StudentAttempt>(
        "SELECT * FROM student_attempts WHERE schedule_id = ? AND submitted_at IS NULL FOR UPDATE",
    )
    .bind(schedule_id.to_string())
    .fetch_all(&mut *connection)
    .await?;

    if pending_attempts.is_empty() {
        return Ok(());
    }

    let now = Utc::now();
    for attempt in pending_attempts {
        let submission_id = format!("submission-{}", Uuid::new_v4().simple());
        let final_submission = json!({
            "submissionId": submission_id,
            "submittedAt": now,
            "answers": attempt.answers,
            "writingAnswers": attempt.writing_answers,
            "flags": attempt.flags,
            "completionReason": completion_reason,
            "autoSubmission": true,
            "proctorStatus": attempt.proctor_status.as_str(),
            "submissionPolicy": "forced_auto_submit"
        });
        let recovery = merge_recovery(
            attempt.recovery.clone().into(),
            json!({
                "lastPersistedAt": now,
                "pendingMutationCount": 0,
                "syncState": "saved"
            }),
        );

        sqlx::query(
            r#"
            UPDATE student_attempts
            SET
                phase = ?,
                recovery = ?,
                final_submission = ?,
                submitted_at = ?,
                updated_at = NOW(),
                revision = revision + 1
            WHERE id = ?
            "#,
        )
        .bind(AttemptPhase::PostExam)
        .bind(recovery)
        .bind(&final_submission)
        .bind(now)
        .bind(&attempt.id)
        .execute(&mut *connection)
        .await?;
    }

    Ok(())
}

pub(crate) async fn force_finalize_attempt_if_pending(
    pool: &MySqlPool,
    schedule_id: Uuid,
    attempt_id: Uuid,
    completion_reason: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    let pending_attempt = sqlx::query_as::<_, StudentAttempt>(
        "SELECT * FROM student_attempts WHERE id = ? AND schedule_id = ? AND submitted_at IS NULL FOR UPDATE",
    )
    .bind(attempt_id.to_string())
    .bind(schedule_id.to_string())
    .fetch_optional(tx.as_mut())
    .await?;

    let Some(attempt) = pending_attempt else {
        tx.commit().await?;
        return Ok(());
    };

    let now = Utc::now();
    let submission_id = format!("submission-{}", Uuid::new_v4().simple());
    let final_submission = json!({
        "submissionId": submission_id,
        "submittedAt": now,
        "answers": attempt.answers,
        "writingAnswers": attempt.writing_answers,
        "flags": attempt.flags,
        "completionReason": completion_reason,
        "autoSubmission": true,
        "proctorStatus": attempt.proctor_status.as_str(),
        "submissionPolicy": "forced_auto_submit"
    });
    let recovery = merge_recovery(
        attempt.recovery.clone().into(),
        json!({
            "lastPersistedAt": now,
            "pendingMutationCount": 0,
            "syncState": "saved"
        }),
    );

    sqlx::query(
        r#"
        UPDATE student_attempts
        SET
            phase = ?,
            recovery = ?,
            final_submission = ?,
            submitted_at = ?,
            updated_at = NOW(),
            revision = revision + 1
        WHERE id = ?
        "#,
    )
    .bind(AttemptPhase::PostExam)
    .bind(recovery)
    .bind(&final_submission)
    .bind(now)
    .bind(attempt_id.to_string())
    .execute(tx.as_mut())
    .await?;

    tx.commit().await?;
    Ok(())
}
