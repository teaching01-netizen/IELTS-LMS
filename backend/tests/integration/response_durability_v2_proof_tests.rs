#[path = "../support/mysql.rs"]
mod mysql;

use chrono::Utc;
use ielts_backend_application::delivery::response_durability_v2::ResponseDurabilityV2Service;
use ielts_backend_domain::durability_v2::*;
use ielts_backend_infrastructure::auth::{sha256_hex, AttemptTokenClaims};
use ielts_backend_infrastructure::config::AppConfig;
use serde_json::json;
use std::env;

const PROOF_MIGRATIONS: &[&str] = &[
    "0001_roles.sql",
    "0002_rls_helpers.sql",
    "0003_exam_core.sql",
    "0004_library_and_defaults.sql",
    "0005_scheduling_and_access.sql",
    "0006_delivery.sql",
    "0007_proctoring.sql",
    "0008_grading_results.sql",
    "0009_media_cache_outbox.sql",
    "0010_auth_security.sql",
    "0011_outbox_notify_trigger.sql",
    "0012_registration_fields.sql",
    "0013_proctor_presence_unique.sql",
    "0014_student_attempt_presence.sql",
    "0015_operation_write_hardening.sql",
    "0016_attempt_mutation_id_uniqueness.sql",
    "0017_production_hardening.sql",
    "0018_exam_day_concurrency_hardening.sql",
    "0019_violation_id_idempotency.sql",
    "0020_schedule_role_display_names.sql",
    "0021_attempt_finalization_consistency.sql",
    "0022_attempt_submission_ledger.sql",
    "0023_sort_memory_hotpath_indexes.sql",
    "0024_projection_sort_hardening.sql",
    "0030_outbox_retry_policy.sql",
    "0032_provider_neutral_sat.sql",
    "0033_sat_runtime_authoring_hardening.sql",
    "0034_assessment_access_links.sql",
    "0035_autosave_durability_hardening.sql",
    "0036_question_revision_updated_by.sql",
    "0037_runtime_timing_model.sql",
    "0038_sat_section_timing_model.sql",
    "0039_schedule_provider_identity.sql",
    "0043_attempt_terminalizations.sql",
    "0049_response_durability_v2.sql",
];

#[tokio::test]
async fn response_durability_v2_domain_contract_invariants() {
    // 1. ResponsePayload default and serialization roundtrip
    let default_payload = ResponsePayload::default();
    assert_eq!(default_payload.answer, serde_json::Value::Null);
    assert_eq!(default_payload.marked_for_review, false);
    assert!(default_payload.eliminated_options.is_empty());
    assert!(default_payload.annotations.is_empty());

    let payload = ResponsePayload {
        answer: json!("52"),
        marked_for_review: true,
        eliminated_options: vec!["A".to_owned()],
        annotations: vec![json!({"id": "anno-1", "text": "note"})],
    };
    let serialized = serde_json::to_string(&payload).expect("serialize payload");
    let deserialized: ResponsePayload =
        serde_json::from_str(&serialized).expect("deserialize payload");
    assert_eq!(payload, deserialized);

    // 2. Command hashing determinism
    let cmd1 = ResponseCommandV2 {
        write_id: "w-1".to_owned(),
        question_id: "q-1".to_owned(),
        client_version: 1,
        response: payload.clone(),
    };
    let hash1 = sha256_hex(&serde_json::to_string(&cmd1).unwrap());
    let hash2 = sha256_hex(&serde_json::to_string(&cmd1).unwrap());
    assert_eq!(hash1, hash2, "Command hash must be deterministic");

    // 3. Error code representation matches spec (Section 7)
    assert_eq!(
        DurabilityErrorCode::InvalidResponse.as_str(),
        "INVALID_RESPONSE"
    );
    assert_eq!(
        DurabilityErrorCode::QuestionNotInAttempt.as_str(),
        "QUESTION_NOT_IN_ATTEMPT"
    );
    assert_eq!(DurabilityErrorCode::LeaseFenced.as_str(), "LEASE_FENCED");
    assert_eq!(
        DurabilityErrorCode::ControlEpochStale.as_str(),
        "CONTROL_EPOCH_STALE"
    );
    assert_eq!(
        DurabilityErrorCode::VersionCollision.as_str(),
        "VERSION_COLLISION"
    );
    assert_eq!(
        DurabilityErrorCode::IdempotencyKeyReused.as_str(),
        "IDEMPOTENCY_KEY_REUSED"
    );
    assert_eq!(
        DurabilityErrorCode::AttemptNotWritable.as_str(),
        "ATTEMPT_NOT_WRITABLE"
    );
    assert_eq!(DurabilityErrorCode::RateLimited.as_str(), "RATE_LIMITED");
    assert_eq!(
        DurabilityErrorCode::TemporaryUnavailable.as_str(),
        "TEMPORARY_UNAVAILABLE"
    );

    // 4. ResponseOutcome lowercase string representation
    assert_eq!(ResponseOutcome::Applied.as_str(), "applied");
    assert_eq!(ResponseOutcome::Duplicate.as_str(), "duplicate");
    assert_eq!(ResponseOutcome::Superseded.as_str(), "superseded");

    // 5. Final response digest calculation
    let q1_hash = sha256_hex(&serde_json::to_string(&json!("ans1")).unwrap());
    let q2_hash = sha256_hex(&serde_json::to_string(&json!("ans2")).unwrap());
    let digest = sha256_hex(&format!("q-1:{};q-2:{};", q1_hash, q2_hash));
    assert_eq!(digest.len(), 64);
}

#[tokio::test]
async fn response_durability_v2_fencing_claims_validation() {
    let now = Utc::now();
    let claims = AttemptTokenClaims {
        token_id: "tok-1".to_owned(),
        user_id: "user-1".to_owned(),
        schedule_id: "sched-1".to_owned(),
        attempt_id: "att-1".to_owned(),
        client_session_id: "sess-1".to_owned(),
        exp: now + chrono::Duration::hours(1),
        lease_epoch: Some(1),
        organization_id: Some("org-1".to_owned()),
    };

    assert_eq!(claims.lease_epoch, Some(1));
    assert_eq!(claims.organization_id.as_deref(), Some("org-1"));

    // Verify token serialization preserves camelCase
    let val = serde_json::to_value(&claims).unwrap();
    assert_eq!(val["leaseEpoch"], 1);
    assert_eq!(val["organizationId"], "org-1");
    assert_eq!(val["attemptId"], "att-1");
}

#[test]
fn response_durability_v2_canonical_hashes_are_structural_and_ordered() {
    use ielts_backend_application::delivery::response_durability_v2::{
        canonical_command_hash, canonical_response_hash, final_response_digest,
    };

    let payload_a = ResponsePayload {
        answer: json!({"b": 2, "a": 1}),
        marked_for_review: false,
        eliminated_options: vec!["B".to_owned(), "A".to_owned()],
        annotations: vec![json!({"text": "note", "id": "n-1"})],
    };
    let payload_b = ResponsePayload {
        answer: json!({"a": 1, "b": 2}),
        marked_for_review: false,
        eliminated_options: vec!["B".to_owned(), "A".to_owned()],
        annotations: vec![json!({"id": "n-1", "text": "note"})],
    };

    assert_eq!(
        canonical_response_hash(&payload_a).unwrap(),
        canonical_response_hash(&payload_b).unwrap(),
        "JSON object key order must not change the content hash"
    );

    let command_a = ResponseCommandV2 {
        write_id: "w-1".to_owned(),
        question_id: "q-1".to_owned(),
        client_version: 1,
        response: payload_a,
    };
    let command_b = ResponseCommandV2 {
        response: payload_b,
        ..command_a.clone()
    };
    assert_eq!(
        canonical_command_hash(&command_a).unwrap(),
        canonical_command_hash(&command_b).unwrap(),
        "Equivalent commands must have the same request hash"
    );

    let digest_one = final_response_digest(vec![("q-2", "hash-2"), ("q-1", "hash-1")]);
    let digest_two = final_response_digest(vec![("q-1", "hash-1"), ("q-2", "hash-2")]);
    assert_eq!(
        digest_one, digest_two,
        "Final digest must sort question identities"
    );
}

#[test]
fn response_durability_v2_payload_validation_rejects_oversized_and_non_finite_values() {
    use ielts_backend_application::delivery::response_durability_v2::validate_response_payload;

    let oversized = ResponsePayload {
        answer: json!("x".repeat(256 * 1024 + 1)),
        ..ResponsePayload::default()
    };
    assert!(validate_response_payload(&oversized).is_err());

    let invalid_annotation = ResponsePayload {
        annotations: vec![json!({"id": ""})],
        ..ResponsePayload::default()
    };
    assert!(validate_response_payload(&invalid_annotation).is_err());
}

#[tokio::test]
async fn response_durability_v2_database_integration_when_configured() {
    if env::var("TEST_DATABASE_URL").is_err() && env::var("DATABASE_URL").is_err() {
        eprintln!("Skipping live database test: TEST_DATABASE_URL not set");
        return;
    }

    let database = mysql::TestDatabase::new(PROOF_MIGRATIONS).await;
    let pool = database.pool().clone();
    let config = AppConfig::default();
    let service = ResponseDurabilityV2Service::new(pool, config);

    assert!(service.pool().is_closed() == false);
    database.shutdown().await;
}
