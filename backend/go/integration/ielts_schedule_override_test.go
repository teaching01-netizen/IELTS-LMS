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

// Overall exam answer check: "Accept for whole exam" PUTs a schedule
// answer-key override. The Go port had kept a per-submission {section,points}
// body on this route, so every UI save failed with "Invalid request body."
// The override must persist and regrade the stored sections in one step.
func TestIELTSScheduleOverrideRegradesStoredSections(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	ids := actFixtureIDs()
	ids.organizationID, ids.ownerID = "ielts-override-org", "ielts-override-owner"
	cleanupACTFixture(t, db, ids)
	t.Cleanup(func() { cleanupACTFixture(t, db, ids) })

	content := `{"reading":{"passages":[{"id":"p1","blocks":[{"id":"blk","type":"DIAGRAM_LABELING","labels":[{"id":"lbl","correctAnswer":"28 June|28th June"}]}]}]}}`
	final := `{"answers":{"blk":["28 june"]},"writingAnswers":{}}`
	mustExec := func(label, query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%s: %v", label, err)
		}
	}
	mustExec("insert exam", `
		INSERT INTO exam_entities (
			id, slug, title, provider_key, provider_exam_type, exam_type,
			status, visibility, organization_id, owner_id, schema_version, revision
		) VALUES (?, ?, 'IELTS override', 'ielts', 'Academic', 'Academic', 'published', 'organization', ?, ?, 1, 0)`,
		ids.examID, ids.examID, ids.organizationID, ids.ownerID)
	mustExec("insert version", `
		INSERT INTO exam_versions (
			id, exam_id, version_number, content_snapshot, config_snapshot, created_by, is_published, revision
		) VALUES (?, ?, 1, ?, '{}', ?, TRUE, 0)`, ids.versionID, ids.examID, content, ids.ownerID)
	mustExec("insert schedule", `
		INSERT INTO exam_schedules (
			id, exam_id, provider_key, organization_id, exam_title,
			proctor_display_name, grading_display_name, published_version_id,
			cohort_name, institution, start_time, end_time, planned_duration_minutes,
			delivery_mode, status, created_by
		) VALUES (?, ?, 'ielts', ?, 'IELTS override', 'IELTS override', 'IELTS override', ?,
			'IELTS override', 'Codex', ?, ?, 60, 'proctor_start', 'completed', ?)`,
		ids.scheduleID, ids.examID, ids.organizationID, ids.versionID,
		now.Add(-2*time.Hour), now.Add(-time.Hour), ids.ownerID)
	mustExec("insert attempt", `
		INSERT INTO student_attempts (
			id, schedule_id, student_key, organization_id, exam_id,
			published_version_id, exam_title, candidate_id, candidate_name,
			candidate_email, phase, current_module, answers, writing_answers,
			flags, violations_snapshot, integrity, recovery, revision,
			protocol_version, delivery_status, lease_epoch, control_epoch, response_revision,
			submitted_at, final_submission
		) VALUES (?, ?, ?, ?, ?, ?, 'IELTS override', 'candidate-1', 'Override Candidate',
			'candidate@example.test', 'post-exam', 'writing', '{}', '{}',
			'{}', '[]', '{}', '{}', 0, 1, 'submitted', 1, 1, 0, ?, ?)`,
		ids.attemptID, ids.scheduleID, ids.attemptID, ids.organizationID, ids.examID, ids.versionID, now, final)

	grader := grading.NewService(db, tx.NewRunner(db))
	if _, err := grader.ProjectIELTSAttempt(ctx, grading.ProjectionAttempt{
		ID: ids.attemptID, ScheduleID: ids.scheduleID, ExamID: ids.examID,
		PublishedVersionID: ids.versionID, StudentID: "candidate-1", StudentName: "Override Candidate",
		CohortName: "IELTS override", SubmittedAt: now,
		FinalSubmission: json.RawMessage(final),
		ContentSnapshot: json.RawMessage(content), ConfigSnapshot: json.RawMessage(`{}`),
	}); err != nil {
		t.Fatalf("project attempt: %v", err)
	}

	readResult := func() map[string]any {
		t.Helper()
		var raw string
		if err := db.QueryRowContext(ctx, `
			SELECT CAST(ss.auto_grading_results AS CHAR) FROM section_submissions ss
			JOIN student_submissions s ON s.id = ss.submission_id
			WHERE s.attempt_id = ? AND ss.section = 'reading'`, ids.attemptID).Scan(&raw); err != nil {
			t.Fatalf("read reading results: %v", err)
		}
		var results struct {
			QuestionResults []map[string]any `json:"questionResults"`
		}
		if err := json.Unmarshal([]byte(raw), &results); err != nil || len(results.QuestionResults) != 1 {
			t.Fatalf("decode reading results %q: %v", raw, err)
		}
		return results.QuestionResults[0]
	}

	correct := "28 June"
	accept := grading.ObjectiveOverrideRequest{
		CorrectAnswer: &correct, AcceptedAnswers: []string{"28 June", "28th June", "28 june"},
		ExcludedAnswers: []string{}, CorrectOptionIDs: []string{},
		ScoringRule: "exact_match", MaxScore: 1, Reason: "accept for whole exam",
	}
	row, report, err := grader.UpsertScheduleObjectiveOverride(ctx, ids.scheduleID, "blk:lbl", accept, ids.ownerID, "Owner")
	if err != nil {
		t.Fatalf("upsert accept override: %v", err)
	}
	if row.QuestionID != "blk:lbl" || row.UpdatedByActorName != "Owner" || report.SubmissionsMatched != 1 {
		t.Fatalf("row=%+v report=%+v", row, report)
	}
	if got := readResult(); got["hasOverride"] != true || got["correctAnswer"] != "28 June | 28th June | 28 june" {
		t.Fatalf("accepted override not applied: %#v", got)
	}

	keep := accept
	keep.AcceptedAnswers, keep.ExcludedAnswers = []string{"28 June", "28th June"}, []string{"28 june"}
	keep.Reason = "keep incorrect"
	if _, _, err := grader.UpsertScheduleObjectiveOverride(ctx, ids.scheduleID, "blk:lbl", keep, ids.ownerID, "Owner"); err != nil {
		t.Fatalf("upsert keep-incorrect override: %v", err)
	}
	if got := readResult(); got["isCorrect"] != false {
		t.Fatalf("excluded answer still correct: %#v", got)
	}

	listed, err := grader.ListScheduleObjectiveOverrides(ctx, ids.scheduleID)
	if err != nil || len(listed) != 1 {
		t.Fatalf("list overrides = %+v, %v", listed, err)
	}

	if _, err := grader.DeleteScheduleObjectiveOverride(ctx, ids.scheduleID, "blk:lbl", "undo", ids.ownerID, "Owner"); err != nil {
		t.Fatalf("delete override: %v", err)
	}
	if got := readResult(); got["hasOverride"] != false {
		t.Fatalf("override still applied after delete: %#v", got)
	}
	var events int
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM grading_schedule_override_events WHERE schedule_id = ?", ids.scheduleID).Scan(&events); err != nil || events != 6 {
		t.Fatalf("override events = %d, %v; want 6", events, err)
	}

	// "Regrade from latest draft" switches the schedule's grading source to the
	// exam's current draft and rescores the stored answers against it.
	draftID := uuid.NewString()
	mustExec("insert draft", `
		INSERT INTO exam_versions (
			id, exam_id, version_number, content_snapshot, config_snapshot, created_by, is_published, revision
		) VALUES (?, ?, 2, ?, '{}', ?, FALSE, 0)`, draftID, ids.examID,
		`{"reading":{"passages":[{"id":"p1","blocks":[{"id":"blk","type":"DIAGRAM_LABELING","labels":[{"id":"lbl","correctAnswer":"29 June"}]}]}]}}`, ids.ownerID)
	mustExec("point exam at draft", "UPDATE exam_entities SET current_draft_version_id = ? WHERE id = ?", draftID, ids.examID)
	if _, _, err := grader.RegradeScheduleObjectivesFromLatestDraft(ctx, ids.scheduleID, " ", ids.ownerID, "Owner"); err == nil {
		t.Fatal("blank regrade reason accepted")
	}
	gotDraft, report, err := grader.RegradeScheduleObjectivesFromLatestDraft(ctx, ids.scheduleID, "refresh", ids.ownerID, "Owner")
	if err != nil {
		t.Fatalf("regrade from latest draft: %v", err)
	}
	if gotDraft != draftID || report.SectionsUpdated != report.SectionsChecked {
		t.Fatalf("draft=%q report=%+v", gotDraft, report)
	}
	if got := readResult(); got["isCorrect"] != false || got["correctAnswer"] != "29 June" {
		t.Fatalf("draft key not applied: %#v", got)
	}
	source, err := grader.GradingSourceVersionID(ctx, ids.scheduleID)
	if err != nil || source == nil || *source != draftID {
		t.Fatalf("grading source = %v, %v; want %s", source, err, draftID)
	}
	var auditVersion string
	if err := db.QueryRowContext(ctx, `
		SELECT JSON_UNQUOTE(JSON_EXTRACT(ss.auto_grading_results, '$.integrity.gradingSourceVersionId'))
		FROM section_submissions ss JOIN student_submissions s ON s.id = ss.submission_id
		WHERE s.attempt_id = ? AND ss.section = 'reading'`, ids.attemptID).Scan(&auditVersion); err != nil || auditVersion != draftID {
		t.Fatalf("audit source version = %q, %v; want %s", auditVersion, err, draftID)
	}
}
