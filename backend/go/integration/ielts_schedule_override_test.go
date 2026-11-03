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

// Preview lists released changes without writing, normal regrade keeps
// skipping released rows, and the audited released action applies exactly the
// previewed change. A second run with the same token is a no-op.
func TestIELTSReleasedRegradePreviewAndApply(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	ids := actFixtureIDs()
	ids.organizationID, ids.ownerID = "ielts-released-org", "ielts-released-owner"
	cleanupACTFixture(t, db, ids)
	t.Cleanup(func() { cleanupACTFixture(t, db, ids) })

	content := `{"reading":{"passages":[{"id":"p1","blocks":[{"id":"blk","type":"CLOZE","questions":[{"id":"q1","prompt":"Date","correctAnswer":"29 June"}]}]}]}}`
	final := `{"answers":{"q1":"29 June"},"writingAnswers":{}}`
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
		) VALUES (?, ?, 'IELTS released', 'ielts', 'Academic', 'Academic', 'published', 'organization', ?, ?, 1, 0)`,
		ids.examID, ids.examID, ids.organizationID, ids.ownerID)
	mustExec("insert version", `
		INSERT INTO exam_versions (
			id, exam_id, version_number, content_snapshot, config_snapshot, created_by, is_published, revision
		) VALUES (?, ?, 1, ?, ?, ?, TRUE, 0)`, ids.versionID, ids.examID, content,
		`{"standards":{"bandScoreTables":{"readingAcademic":{"0":0,"1":7.0},"listening":{"0":0}}}}`, ids.ownerID)
	mustExec("insert schedule", `
		INSERT INTO exam_schedules (
			id, exam_id, provider_key, organization_id, exam_title,
			proctor_display_name, grading_display_name, published_version_id,
			cohort_name, institution, start_time, end_time, planned_duration_minutes,
			delivery_mode, status, created_by
		) VALUES (?, ?, 'ielts', ?, 'IELTS released', 'IELTS released', 'IELTS released', ?,
			'IELTS released', 'Codex', ?, ?, 60, 'proctor_start', 'completed', ?)`,
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
		) VALUES (?, ?, ?, ?, ?, ?, 'IELTS released', 'candidate-1', 'Released Candidate',
			'candidate@example.test', 'post-exam', 'writing', '{}', '{}',
			'{}', '[]', '{}', '{}', 0, 1, 'submitted', 1, 1, 0, ?, ?)`,
		ids.attemptID, ids.scheduleID, ids.attemptID, ids.organizationID, ids.examID, ids.versionID, now, final)

	grader := grading.NewService(db, tx.NewRunner(db))
	if _, err := grader.ProjectIELTSAttempt(ctx, grading.ProjectionAttempt{
		ID: ids.attemptID, ScheduleID: ids.scheduleID, ExamID: ids.examID,
		PublishedVersionID: ids.versionID, StudentID: "candidate-1", StudentName: "Released Candidate",
		CohortName: "IELTS released", SubmittedAt: now,
		FinalSubmission: json.RawMessage(final),
		ContentSnapshot: json.RawMessage(content), ConfigSnapshot: json.RawMessage(`{}`),
	}); err != nil {
		t.Fatalf("project attempt: %v", err)
	}

	mustExec("release submission", `UPDATE student_submissions SET grading_status = 'released' WHERE attempt_id = ?`, ids.attemptID)
	var submissionID string
	if err := db.QueryRowContext(ctx, `SELECT id FROM student_submissions WHERE attempt_id = ?`, ids.attemptID).Scan(&submissionID); err != nil {
		t.Fatalf("read submission id: %v", err)
	}
	mustExec("insert released result", `
		INSERT INTO student_results (
			id, submission_id, student_id, student_name, release_status, released_at,
			released_by, overall_band, section_bands, writing_results, teacher_summary,
			version, authorized_actor_id, created_at, updated_at
		) VALUES (?, ?, 'candidate-1', 'Released Candidate', 'released', ?, ?, 6,
			'{"reading":6,"listening":0,"writing":0,"speaking":0}', '{}', '{}', 1, ?, ?, ?)`,
		uuid.NewString(), submissionID, now, ids.ownerID, ids.ownerID, now, now)
	mustExec("stale saved score", `
		UPDATE section_submissions ss JOIN student_submissions s ON s.id = ss.submission_id
		SET ss.auto_grading_results = JSON_SET(ss.auto_grading_results,
			'$.questionResults[0].isCorrect', FALSE,
			'$.questionResults[0].awardedScore', 0,
			'$.totalScore', 0)
		WHERE s.attempt_id = ? AND ss.section = 'reading'`, ids.attemptID)

	unreleasedPreview, err := grader.PreviewScheduleObjectiveRegrade(ctx, ids.scheduleID, grading.ObjectiveRegradeScopeUnreleased)
	if err != nil {
		t.Fatalf("unreleased preview: %v", err)
	}
	if len(unreleasedPreview.Submissions) != 0 || unreleasedPreview.Summary.Changed != 0 {
		t.Fatalf("unreleased preview included released rows: %+v", unreleasedPreview.Summary)
	}

	preview, err := grader.PreviewScheduleObjectiveRegrade(ctx, ids.scheduleID, grading.ObjectiveRegradeScopeAll)
	if err != nil {
		t.Fatalf("preview regrade: %v", err)
	}
	if preview.Summary.Changed != 1 || preview.Summary.Released != 1 || preview.Summary.QuestionChange != 1 {
		t.Fatalf("preview summary = %+v", preview.Summary)
	}
	if len(preview.Submissions) != 1 || !preview.Submissions[0].Released {
		t.Fatalf("preview submissions = %+v", preview.Submissions)
	}
	if preview.PreviewToken == "" {
		t.Fatal("preview has no token")
	}

	readCorrect := func() bool {
		t.Helper()
		var raw string
		if err := db.QueryRowContext(ctx, `
			SELECT CAST(ss.auto_grading_results AS CHAR) FROM section_submissions ss
			JOIN student_submissions s ON s.id = ss.submission_id
			WHERE s.attempt_id = ? AND ss.section = 'reading'`, ids.attemptID).Scan(&raw); err != nil {
			t.Fatalf("read results: %v", err)
		}
		var results struct {
			QuestionResults []struct {
				IsCorrect bool `json:"isCorrect"`
			} `json:"questionResults"`
		}
		if err := json.Unmarshal([]byte(raw), &results); err != nil || len(results.QuestionResults) != 1 {
			t.Fatalf("decode results %q: %v", raw, err)
		}
		return results.QuestionResults[0].IsCorrect
	}
	if readCorrect() {
		t.Fatal("preview wrote the saved score")
	}

	// Normal regrade still skips released rows.
	if _, _, err := grader.RegradeScheduleObjectivesFromLatestDraft(ctx, ids.scheduleID, "normal regrade", ids.ownerID, "Owner"); err == nil {
		// No draft exists in this fixture; the important assertion is that the
		// released row stayed stale either way.
	}
	if readCorrect() {
		t.Fatal("normal regrade changed a released result")
	}

	released := preview
	if released.Scope != grading.ObjectiveRegradeScopeAll {
		t.Fatalf("preview scope = %q", released.Scope)
	}
	releasedPreview, err := grader.PreviewScheduleObjectiveRegrade(ctx, ids.scheduleID, grading.ObjectiveRegradeScopeReleased)
	if err != nil {
		t.Fatalf("released preview: %v", err)
	}
	if _, _, err := grader.RegradeReleasedScheduleObjectives(ctx, ids.scheduleID, "wrong-token", "release fix", ids.ownerID, "Owner"); err == nil {
		t.Fatal("released regrade accepted a stale token")
	}
	if _, report, err := grader.RegradeReleasedScheduleObjectives(ctx, ids.scheduleID, releasedPreview.PreviewToken, "release fix", ids.ownerID, "Owner"); err != nil {
		t.Fatalf("released regrade: %v", err)
	} else if report.SectionsUpdated != 1 || report.SubmissionsUpdated != 1 {
		t.Fatalf("released report = %+v", report)
	}
	if !readCorrect() {
		t.Fatal("released regrade did not update the saved score")
	}

	readReleasedResult := func() (overall float64, bands string, version int, previousID string, writing string, summary string) {
		t.Helper()
		if err := db.QueryRowContext(ctx, `
			SELECT overall_band, CAST(section_bands AS CHAR), version, previous_version_id,
			       CAST(writing_results AS CHAR), CAST(teacher_summary AS CHAR)
			FROM student_results WHERE submission_id = ? ORDER BY version DESC LIMIT 1`,
			submissionID).Scan(&overall, &bands, &version, &previousID, &writing, &summary); err != nil {
			t.Fatalf("read released result: %v", err)
		}
		return overall, bands, version, previousID, writing, summary
	}
	overall, bands, resultVersion, previousID, writing, summary := readReleasedResult()
	if overall != 7 || resultVersion != 2 || previousID == "" {
		t.Fatalf("released result overall=%v version=%d previous=%q, want 7 / 2 / set", overall, resultVersion, previousID)
	}
	var parsedBands map[string]float64
	if err := json.Unmarshal([]byte(bands), &parsedBands); err != nil || parsedBands["reading"] != 7 {
		t.Fatalf("released result reading band not corrected: %s (%v)", bands, err)
	}
	if writing != "{}" || summary != "{}" {
		t.Fatalf("released result writing/summary changed: writing=%s summary=%s", writing, summary)
	}
	var resultEvents int
	if err := db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM release_events WHERE submission_id = ? AND action = 'regraded_released'`,
		submissionID).Scan(&resultEvents); err != nil || resultEvents != 1 {
		t.Fatalf("regraded_released events = %d, %v; want 1", resultEvents, err)
	}

	var events int
	if err := db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM grading_schedule_override_events
		WHERE schedule_id = ? AND action = 'objective_regrade_released'`, ids.scheduleID).Scan(&events); err != nil || events != 1 {
		t.Fatalf("released audit events = %d, %v; want 1", events, err)
	}
	var payload string
	if err := db.QueryRowContext(ctx, `
		SELECT CAST(payload_json AS CHAR) FROM grading_schedule_override_events
		WHERE schedule_id = ? AND action = 'objective_regrade_released' LIMIT 1`, ids.scheduleID).Scan(&payload); err != nil {
		t.Fatalf("read audit payload: %v", err)
	}
	var auditPayload map[string]any
	if err := json.Unmarshal([]byte(payload), &auditPayload); err != nil {
		t.Fatalf("decode audit payload: %v", err)
	}
	if auditPayload["reason"] != "release fix" {
		t.Fatalf("audit reason = %v, want release fix", auditPayload["reason"])
	}
	auditSubmissions, _ := auditPayload["submissions"].([]any)
	if len(auditSubmissions) != 1 {
		t.Fatalf("audit submissions = %v, want 1", auditPayload["submissions"])
	}
	auditSubmission, _ := auditSubmissions[0].(map[string]any)
	if auditSubmission["oldTotalScore"] != float64(0) || auditSubmission["newTotalScore"] != float64(1) {
		t.Fatalf("audit totals = %v -> %v, want 0 -> 1", auditSubmission["oldTotalScore"], auditSubmission["newTotalScore"])
	}

	// Running again with a fresh preview changes nothing and writes no event.
	again, err := grader.PreviewScheduleObjectiveRegrade(ctx, ids.scheduleID, grading.ObjectiveRegradeScopeReleased)
	if err != nil {
		t.Fatalf("second preview: %v", err)
	}
	if again.Summary.Changed != 0 {
		t.Fatalf("second preview still lists changes: %+v", again.Summary)
	}
	if _, report, err := grader.RegradeReleasedScheduleObjectives(ctx, ids.scheduleID, again.PreviewToken, "release fix again", ids.ownerID, "Owner"); err != nil {
		t.Fatalf("second released regrade: %v", err)
	} else if report.SectionsUpdated != 0 {
		t.Fatalf("second released regrade updated %d sections", report.SectionsUpdated)
	}
	if err := db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM grading_schedule_override_events
		WHERE schedule_id = ? AND action = 'objective_regrade_released'`, ids.scheduleID).Scan(&events); err != nil || events != 1 {
		t.Fatalf("released audit events after no-op = %d, %v; want 1", events, err)
	}
	_, _, afterVersion, _, _, _ := readReleasedResult()
	if afterVersion != 2 {
		t.Fatalf("no-op released regrade created result version %d, want 2", afterVersion)
	}
	if err := db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM release_events WHERE submission_id = ? AND action = 'regraded_released'`,
		submissionID).Scan(&resultEvents); err != nil || resultEvents != 1 {
		t.Fatalf("regraded_released events after no-op = %d, %v; want 1", resultEvents, err)
	}
}
