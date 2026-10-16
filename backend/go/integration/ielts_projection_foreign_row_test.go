package integration

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/grading"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

// Production (15 Oct): the grading worker failed every 5 s with
// "Error 1452 ... section_submissions_ibfk_1" and never advanced its cursor,
// so no later IELTS submission reached grading. Trigger: a student_submissions
// row already existed for the attempt under another provider_key. The
// projection looked the row up with provider_key = 'ielts', missed it,
// upserted a fresh UUID (which collided on the UNIQUE attempt_id and updated
// the old row instead), then inserted sections under the UUID that was never
// stored.
func TestIELTSProjectionAdoptsExistingSubmissionRowOfAnotherProvider(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	ids := actFixtureIDs()
	ids.organizationID, ids.ownerID = "ielts-projection-org", "ielts-projection-owner"
	cleanupACTFixture(t, db, ids)
	t.Cleanup(func() { cleanupACTFixture(t, db, ids) })

	if _, err := db.ExecContext(ctx, `
		INSERT INTO exam_entities (
			id, slug, title, provider_key, provider_exam_type, exam_type,
			status, visibility, organization_id, owner_id, schema_version, revision
		) VALUES (?, ?, 'IELTS projection', 'ielts', 'Academic', 'Academic', 'published', 'organization', ?, ?, 1, 0)`,
		ids.examID, ids.examID, ids.organizationID, ids.ownerID); err != nil {
		t.Fatalf("insert exam: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO exam_versions (
			id, exam_id, version_number, content_snapshot, config_snapshot, created_by, is_published, revision
		) VALUES (?, ?, 1, '{}', '{}', ?, TRUE, 0)`, ids.versionID, ids.examID, ids.ownerID); err != nil {
		t.Fatalf("insert version: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO exam_schedules (
			id, exam_id, provider_key, organization_id, exam_title,
			proctor_display_name, grading_display_name, published_version_id,
			cohort_name, institution, start_time, end_time, planned_duration_minutes,
			delivery_mode, status, created_by
		) VALUES (?, ?, 'ielts', ?, 'IELTS projection', 'IELTS projection', 'IELTS projection', ?,
			'IELTS projection', 'Codex', ?, ?, 60, 'proctor_start', 'completed', ?)`,
		ids.scheduleID, ids.examID, ids.organizationID, ids.versionID,
		now.Add(-2*time.Hour), now.Add(-time.Hour), ids.ownerID); err != nil {
		t.Fatalf("insert schedule: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO student_attempts (
			id, schedule_id, student_key, organization_id, exam_id,
			published_version_id, exam_title, candidate_id, candidate_name,
			candidate_email, phase, current_module, answers, writing_answers,
			flags, violations_snapshot, integrity, recovery, revision,
			protocol_version, delivery_status, lease_epoch, control_epoch, response_revision,
			submitted_at, final_submission
		) VALUES (?, ?, ?, ?, ?, ?, 'IELTS projection', 'candidate-1', 'Projection Candidate',
			'candidate@example.test', 'post-exam', 'writing', '{}', '{}',
			'{}', '[]', '{}', '{}', 0, 1, 'submitted', 1, 1, 0, ?, '{"answers":{},"writingAnswers":{}}')`,
		ids.attemptID, ids.scheduleID, ids.attemptID, ids.organizationID, ids.examID, ids.versionID, now); err != nil {
		t.Fatalf("insert attempt: %v", err)
	}
	existingID := uuid.NewString()
	if _, err := db.ExecContext(ctx, `
		INSERT INTO student_submissions (
			id, attempt_id, schedule_id, exam_id, published_version_id, provider_key,
			student_id, student_name, cohort_name, submitted_at, grading_status, section_statuses,
			created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, 'sat', 'candidate-1', 'Projection Candidate', 'IELTS projection', ?,
			'submitted', '{}', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
		existingID, ids.attemptID, ids.scheduleID, ids.examID, ids.versionID, now); err != nil {
		t.Fatalf("insert stale submission row: %v", err)
	}

	grader := grading.NewService(db, tx.NewRunner(db))
	report, err := grader.ProjectIELTSAttempt(ctx, grading.ProjectionAttempt{
		ID: ids.attemptID, ScheduleID: ids.scheduleID, ExamID: ids.examID,
		PublishedVersionID: ids.versionID, StudentID: "candidate-1", StudentName: "Projection Candidate",
		CohortName: "IELTS projection", SubmittedAt: now,
		FinalSubmission: json.RawMessage(`{"answers":{},"writingAnswers":{}}`),
		ContentSnapshot: json.RawMessage(`{}`), ConfigSnapshot: json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatalf("project attempt with a pre-existing submission row: %v", err)
	}
	if report.SectionsSynced != 4 {
		t.Fatalf("sections synced = %d, want 4", report.SectionsSynced)
	}

	var rows int
	var submissionID, provider string
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*), MIN(id), MIN(provider_key) FROM student_submissions WHERE attempt_id = ?",
		ids.attemptID).Scan(&rows, &submissionID, &provider); err != nil {
		t.Fatalf("read submission: %v", err)
	}
	if rows != 1 || submissionID != existingID || provider != "ielts" {
		t.Fatalf("submission rows=%d id=%s provider=%s, want 1 row %s relabelled ielts", rows, submissionID, provider, existingID)
	}
	var sections int
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM section_submissions WHERE submission_id = ?", existingID).Scan(&sections); err != nil {
		t.Fatalf("count sections: %v", err)
	}
	if sections != 4 {
		t.Fatalf("sections under existing submission = %d, want 4", sections)
	}
}
