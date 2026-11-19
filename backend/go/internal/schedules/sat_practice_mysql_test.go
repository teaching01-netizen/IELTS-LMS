package schedules

import (
	"context"
	"database/sql"
	"os"
	"testing"

	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	platformdb "example.com/ielts-proctoring/internal/platform/db"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satlearning"
)

// Gated on TEST_MYSQL_DSN. Creates and removes its own schedule/version; never
// touches an existing fixture. Proves the explicit retake row shape, the
// operation receipt, the initial registration-backed ordinal, and eligibility
// against real MySQL constraints.
func TestSATPracticeRetakeMySQL(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN not set; requires disposable MySQL")
	}
	normalized, err := platformdb.NormalizeDSN(dsn)
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("mysql", normalized)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	owner := "sat-practice-" + uuid.NewString()
	examID, versionID, scheduleID, studentID := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	if _, err := db.ExecContext(ctx, `INSERT INTO exam_entities
		(id, slug, title, provider_key, provider_exam_type, exam_type, status, visibility, owner_id)
		VALUES (?, ?, 'SAT Practice retake', 'sat', 'SAT', 'Academic', 'published', 'organization', ?)`,
		examID, "sat-practice-"+examID, owner); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec("DELETE FROM sat_practice_start_receipts WHERE schedule_id = ?", scheduleID)
		_, _ = db.Exec("DELETE FROM sat_attempt_learning WHERE schedule_id = ?", scheduleID)
		_, _ = db.Exec("DELETE FROM sat_practice_students WHERE schedule_id = ?", scheduleID)
		_, _ = db.Exec("DELETE FROM student_attempts WHERE schedule_id = ?", scheduleID)
		_, _ = db.Exec("DELETE FROM sat_activity_policies WHERE schedule_id = ?", scheduleID)
		_, _ = db.Exec("DELETE FROM exam_schedules WHERE id = ?", scheduleID)
		_, _ = db.Exec("DELETE FROM exam_versions WHERE id = ?", versionID)
		_, _ = db.Exec("DELETE FROM exam_entities WHERE id = ?", examID)
	})
	if _, err := db.ExecContext(ctx, `INSERT INTO exam_versions
		(id, exam_id, version_number, content_snapshot, config_snapshot, created_by, is_published, sat_publish_scope, sat_flexible_count, sat_classroom_plan)
		VALUES (?, ?, 1, '{}', '{}', ?, TRUE, 'reading-writing', FALSE, '{"reading-writing":"m1_only"}')`,
		versionID, examID, owner); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO exam_schedules
		(id, exam_id, published_version_id, provider_key, exam_title, proctor_display_name, grading_display_name,
		 cohort_name, start_time, end_time, planned_duration_minutes, delivery_mode, status, created_by,
		 sat_timing_model, sat_session_mode, sat_route_policy, sat_start_mode)
		VALUES (?, ?, ?, 'sat', 'SAT Practice retake', 'SAT Practice', 'SAT Practice', 'Practice', UTC_TIMESTAMP(6), DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 2 HOUR), 60, 'proctor_start',
			'live', ?, 'sat_personal_v1', 'practice', 'adaptive', 'proctor')`,
		scheduleID, examID, versionID, owner); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO sat_activity_policies
		(schedule_id, policy_revision, report_visible, include_answer_key_in_pdf, study_enabled, study_required_completions, study_reveal_answers, study_untimed)
		VALUES (?, 1, TRUE, FALSE, TRUE, 1, TRUE, TRUE)`, scheduleID); err != nil {
		t.Fatal(err)
	}
	// An existing registration-backed first attempt establishes ordinal 1.
	initialID := uuid.NewString()
	if _, err := db.ExecContext(ctx, `INSERT INTO student_attempts
		(id, schedule_id, registration_id, user_id, wcode, student_key, exam_id, published_version_id, exam_title,
		 candidate_id, candidate_name, candidate_email, phase, current_module, answers, writing_answers, flags, violations_snapshot,
		 integrity, recovery, created_at, updated_at, revision, protocol_version, delivery_status, lease_epoch, control_epoch, response_revision, submitted_at, final_submission)
		VALUES (?, ?, NULL, ?, 'W-RETAKE', ?, ?, ?, 'SAT Practice retake', ?, 'Practice Student', 'practice@example.test',
		 'post-exam', 'reading', '{}', '{}', '{}', '[]', '{}', '{}', NOW(), NOW(), 0, 2, 'submitted', 1, 1, 0, UTC_TIMESTAMP(6), '{}')`,
		initialID, scheduleID, studentID, "practice:"+scheduleID+":"+studentID+":1", examID, versionID, studentID); err != nil {
		t.Fatal(err)
	}

	svc := NewService(db, tx.NewRunner(db))
	state, err := svc.PracticeLearningState(ctx, scheduleID, studentID)
	if err != nil {
		t.Fatal(err)
	}
	if state.CompletedTestAttempts != 1 || state.LastOrdinal != 1 || state.CanStart || state.CanRetakeTest {
		t.Fatalf("initial state = %+v", state)
	}
	test := PracticeStartInput{
		StudentID: studentID, StudentName: "Practice Student", StudentEmail: "practice@example.test",
		Mode: satlearning.ModeTest, Intent: "retake", ObservedOrdinal: 1, OperationKey: "test-retake",
	}
	if _, err := svc.StartPracticeAttempt(ctx, scheduleID, test); err == nil {
		t.Fatal("released results must not grant timed retakes")
	}
	if _, err := db.ExecContext(ctx, `UPDATE sat_activity_policies SET unlimited_retakes = TRUE, report_visible = FALSE WHERE schedule_id = ?`, scheduleID); err != nil {
		t.Fatal(err)
	}
	timed, err := svc.StartPracticeAttempt(ctx, scheduleID, test)
	if err != nil || timed.Ordinal != 2 || timed.AttemptID == initialID || timed.Learning.Mode != satlearning.ModeTest {
		t.Fatalf("unlimited timed retake = %+v err=%v", timed, err)
	}
	var wcode string
	if err := db.QueryRowContext(ctx, `SELECT wcode FROM student_attempts WHERE id = ?`, timed.AttemptID).Scan(&wcode); err != nil || wcode != "W-RETAKE" {
		t.Fatalf("retake WCODE = %q err=%v", wcode, err)
	}
	replay, err := svc.StartPracticeAttempt(ctx, scheduleID, test)
	if err != nil || replay.AttemptID != timed.AttemptID || replay.Disposition != "replayed" {
		t.Fatalf("replay = %+v err=%v", replay, err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE student_attempts SET submitted_at = UTC_TIMESTAMP(6), phase = 'post-exam', delivery_status = 'submitted', final_submission = '{}' WHERE id = ?`, timed.AttemptID); err != nil {
		t.Fatal(err)
	}
	_, err = svc.StartPracticeAttempt(ctx, scheduleID, PracticeStartInput{
		StudentID: studentID, Mode: satlearning.ModeStudy, Intent: "retake",
		ObservedOrdinal: 2, OperationKey: "retired-study-retake",
	})
	typed, ok := apperrors.As(err)
	if !ok || typed.Code != apperrors.CodeStudyLocked {
		t.Fatalf("legacy Study start = %v, want STUDY_LOCKED", err)
	}
}
