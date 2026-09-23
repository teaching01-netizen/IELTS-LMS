package integration

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

// TestSATResponseDurabilityV2BootstrapAndLegacyCompatibility is the real-DB
// acceptance seam for the answer aggregate. It deliberately exercises the
// delivery service rather than duplicating the projection query in the test:
// MySQL JSON storage, foreign keys, V2/legacy merge ordering, and bootstrap
// serialization must agree at the same boundary the student uses.
//
// The V2 mutation replay ledger is seeded and replayed at the SQL boundary in
// this phase. The attempts service's signed-token replay contract remains
// covered by its focused unit/concurrency suite; Phase 2 can add the full
// authenticated write path here without changing this fixture.
func TestSATResponseDurabilityV2BootstrapAndLegacyCompatibility(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	fixture := newSATResponseFixture()
	cleanupSATResponseFixture(t, db, fixture)
	t.Cleanup(func() { cleanupSATResponseFixture(t, db, fixture) })

	seedSATResponseFixture(t, db, fixture)

	service := delivery.NewService(db, tx.NewRunner(db))
	bootstrap, err := service.Bootstrap(ctx, fixture.scheduleID, fixture.attemptID, fixture.scheduleID)
	if err != nil {
		t.Fatalf("bootstrap SAT response fixture: %v", err)
	}

	if len(bootstrap.Attempt.Responses) != 2 {
		t.Fatalf("expected V2 + legacy responses, got %d: %+v", len(bootstrap.Attempt.Responses), bootstrap.Attempt.Responses)
	}
	byQuestion := make(map[string]delivery.ResponseSnapshot, len(bootstrap.Attempt.Responses))
	for _, response := range bootstrap.Attempt.Responses {
		byQuestion[response.ExamQuestionID] = response
	}

	v2 := byQuestion[fixture.v2ExamQuestionID]
	if string(v2.Response) != `"A"` || !v2.MarkedForReview || v2.ModuleAttemptID != fixture.moduleAttemptID || v2.Revision != 7 {
		t.Fatalf("V2 answer projection = %+v", v2)
	}
	assertJSONEqual(t, `["B"]`, v2.EliminatedOptions)
	assertJSONEqual(t, `{"version":2,"legacyQuestionNote":"integration note","annotations":[]}`, v2.Annotations)

	legacy := byQuestion[fixture.legacyExamQuestionID]
	if string(legacy.Response) != `"B"` || legacy.MarkedForReview || legacy.ModuleAttemptID != fixture.moduleAttemptID {
		t.Fatalf("legacy compatibility projection = %+v", legacy)
	}
	assertJSONEqual(t, `[]`, legacy.EliminatedOptions)
	assertJSONEqual(t, `{}`, legacy.Annotations)

	seedMutationLedgerRow(t, db, fixture)
	if _, err := db.ExecContext(ctx, `
		INSERT INTO attempt_mutations_v2 (
			id, attempt_id, client_write_id, lease_epoch, control_epoch,
			question_id, client_version, request_hash, response_hash, outcome,
			server_revision, canonical_response
		) VALUES (?, ?, ?, 1, 1, ?, 1, ?, ?, 'applied', 7, ?)
		ON DUPLICATE KEY UPDATE id = id`,
		fixture.mutationID, fixture.attemptID, fixture.clientWriteID, fixture.v2QuestionID,
		fixture.requestHash, fixture.responseHash, fixture.canonicalResponse); err != nil {
		t.Fatalf("replay V2 mutation: %v", err)
	}
	var mutationCount int
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM attempt_mutations_v2 WHERE attempt_id = ? AND client_write_id = ?",
		fixture.attemptID, fixture.clientWriteID).Scan(&mutationCount); err != nil {
		t.Fatalf("count replayed V2 mutation: %v", err)
	}
	if mutationCount != 1 {
		t.Fatalf("replayed mutation count = %d, want 1", mutationCount)
	}
}

type satResponseFixture struct {
	examID               string
	versionID            string
	scheduleID           string
	attemptID            string
	sectionID            string
	moduleID             string
	moduleAttemptID      string
	v2QuestionID         string
	v2ExamQuestionID     string
	legacyQuestionID     string
	legacyExamQuestionID string
	questionRevisionIDs  []string
	organizationID       string
	ownerID              string
	mutationID           string
	clientWriteID        string
	requestHash          string
	responseHash         string
	canonicalResponse    string
}

func newSATResponseFixture() satResponseFixture {
	return satResponseFixture{
		examID:               uuid.NewString(),
		versionID:            uuid.NewString(),
		scheduleID:           uuid.NewString(),
		attemptID:            uuid.NewString(),
		sectionID:            uuid.NewString(),
		moduleID:             uuid.NewString(),
		moduleAttemptID:      uuid.NewString(),
		v2QuestionID:         uuid.NewString(),
		v2ExamQuestionID:     uuid.NewString(),
		legacyQuestionID:     uuid.NewString(),
		legacyExamQuestionID: uuid.NewString(),
		questionRevisionIDs:  []string{uuid.NewString(), uuid.NewString()},
		organizationID:       "sat-durability-integration-org",
		ownerID:              "sat-durability-integration-owner",
		mutationID:           "sat-durability-mutation-" + uuid.NewString(),
		clientWriteID:        "sat-durability-write-" + uuid.NewString(),
		requestHash:          "sat-durability-request-hash",
		responseHash:         "sat-durability-response-hash",
		canonicalResponse:    `{"answer":"A","markedForReview":true,"eliminatedOptions":["B"],"annotations":[{"id":"sat-annotations","kind":"sat_annotations","version":2,"legacyQuestionNote":"integration note","annotations":[]}]}`,
	}
}

func seedSATResponseFixture(t *testing.T, db *sql.DB, fixture satResponseFixture) {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("seed SAT response fixture: %v", err)
		}
	}

	exec(`INSERT INTO exam_entities (
		id, slug, title, provider_key, provider_exam_type, exam_type,
		status, visibility, organization_id, owner_id, schema_version, revision
	) VALUES (?, ?, 'SAT durability integration', 'sat', 'SAT', 'Academic',
		'published', 'organization', ?, ?, 1, 0)`,
		fixture.examID, fixture.examID, fixture.organizationID, fixture.ownerID)
	exec(`INSERT INTO exam_versions (
		id, exam_id, version_number, content_snapshot, config_snapshot,
		created_by, is_published, revision
	) VALUES (?, ?, 1, '{}', '{}', ?, TRUE, 1)`,
		fixture.versionID, fixture.examID, fixture.ownerID)
	exec(`UPDATE exam_entities SET current_published_version_id = ? WHERE id = ?`, fixture.versionID, fixture.examID)
	exec(`INSERT INTO exam_schedules (
		id, exam_id, provider_key, organization_id, exam_title, proctor_display_name,
		grading_display_name, published_version_id,
		cohort_name, institution, start_time, end_time, planned_duration_minutes,
		delivery_mode, status, created_by
	) VALUES (?, ?, 'sat', ?, 'SAT durability integration', 'SAT durability integration',
		'SAT durability integration', ?, 'integration', 'Codex', ?, ?, 60,
		'proctor_start', 'live', ?)`,
		fixture.scheduleID, fixture.examID, fixture.organizationID, fixture.versionID,
		now.Add(-time.Minute), now.Add(time.Hour), fixture.ownerID)
	exec(`INSERT INTO student_attempts (
		id, schedule_id, student_key, organization_id, exam_id,
		published_version_id, exam_title, candidate_id, candidate_name,
		candidate_email, phase, current_module, answers, writing_answers,
		flags, violations_snapshot, integrity, recovery, revision,
		protocol_version, delivery_status, lease_epoch, control_epoch, response_revision
	) VALUES (?, ?, ?, ?, ?, ?, 'SAT durability integration', 'candidate-1', 'Integration Candidate',
		'candidate@example.test', 'exam', 'reading', '{}', '{}', '{}', '[]', '{}', '{}', 0,
		2, 'running', 1, 1, 7)`,
		fixture.attemptID, fixture.scheduleID, fixture.attemptID, fixture.organizationID,
		fixture.examID, fixture.versionID)

	exec(`INSERT INTO assessment_sections (
		id, exam_version_id, section_key, title, display_order, duration_seconds,
		break_after_seconds, instructions, tool_policy
	) VALUES (?, ?, 'reading-writing', 'Reading and Writing', 0, 3600, 0, '{"version":1,"nodes":[]}', '[]')`,
		fixture.sectionID, fixture.versionID)
	exec(`INSERT INTO assessment_modules (
		id, section_id, module_key, title, display_order, duration_seconds,
		target_question_count, adaptive_role, instructions, tool_policy
	) VALUES (?, ?, 'rw-m1', 'Reading and Writing Module 1', 0, 3600, 2, 'base',
		'{"version":1,"nodes":[]}', '[]')`, fixture.moduleID, fixture.sectionID)

	for index, questionID := range []string{fixture.v2QuestionID, fixture.legacyQuestionID} {
		revisionID := fixture.questionRevisionIDs[index]
		exec(`INSERT INTO assessment_questions (id, provider_key, created_by) VALUES (?, 'sat', ?)`, questionID, fixture.ownerID)
		exec(`INSERT INTO assessment_question_revisions (
			id, question_id, semantic_revision, state, question_type, stimulus,
			prompt, answer_definition, rationale, metadata, accessibility, created_by
		) VALUES (?, ?, 1, 'sealed', 'single_choice', '{"version":1,"nodes":[]}',
			'{"version":1,"nodes":[]}', '{"kind":"single_choice","correctOptionId":"A"}',
			'{}', '{}', '{}', ?)`, revisionID, questionID, fixture.ownerID)
	}
	exec(`INSERT INTO assessment_exam_questions (
		id, module_id, question_id, question_revision_id, display_order, is_pretest
	) VALUES (?, ?, ?, ?, 0, FALSE), (?, ?, ?, ?, 1, FALSE)`,
		fixture.v2ExamQuestionID, fixture.moduleID, fixture.v2QuestionID, fixture.questionRevisionIDs[0],
		fixture.legacyExamQuestionID, fixture.moduleID, fixture.legacyQuestionID, fixture.questionRevisionIDs[1])
	exec(`INSERT INTO assessment_module_attempts (
		id, attempt_id, module_id, state, allocated_seconds, started_at, tool_state, revision
	) VALUES (?, ?, ?, 'active', 3600, ?, '{}', 1)`,
		fixture.moduleAttemptID, fixture.attemptID, fixture.moduleID, now)

	exec(`INSERT INTO assessment_question_responses (
		id, module_attempt_id, exam_question_id, response, marked_for_review,
		eliminated_options, annotations, revision
	) VALUES (?, ?, ?, '"B"', FALSE, '[]', '{}', 1)`,
		uuid.NewString(), fixture.moduleAttemptID, fixture.legacyExamQuestionID)
	exec(`INSERT INTO attempt_responses_v2 (
		attempt_id, question_id, module_id, lease_epoch, control_epoch,
		client_version, client_write_id, request_hash, response, response_hash,
		server_revision
	) VALUES (?, ?, ?, 1, 1, 1, ?, ?, ?, ?, 7)`,
		fixture.attemptID, fixture.v2ExamQuestionID, fixture.moduleID,
		fixture.clientWriteID, fixture.requestHash, fixture.canonicalResponse, fixture.responseHash)
}

func seedMutationLedgerRow(t *testing.T, db *sql.DB, fixture satResponseFixture) {
	t.Helper()
	if _, err := db.Exec(`
		INSERT INTO attempt_mutations_v2 (
			id, attempt_id, client_write_id, lease_epoch, control_epoch,
			question_id, client_version, request_hash, response_hash, outcome,
			server_revision, canonical_response
		) VALUES (?, ?, ?, 1, 1, ?, 1, ?, ?, 'applied', 7, ?)`,
		fixture.mutationID, fixture.attemptID, fixture.clientWriteID, fixture.v2QuestionID,
		fixture.requestHash, fixture.responseHash, fixture.canonicalResponse); err != nil {
		t.Fatalf("seed V2 mutation ledger: %v", err)
	}
}

func cleanupSATResponseFixture(t *testing.T, db *sql.DB, fixture satResponseFixture) {
	t.Helper()
	ctx := context.Background()
	statements := []struct {
		query string
		args  []any
	}{
		{"DELETE FROM attempt_submissions_v2 WHERE attempt_id = ?", []any{fixture.attemptID}},
		{"DELETE FROM attempt_mutations_v2 WHERE attempt_id = ?", []any{fixture.attemptID}},
		{"DELETE FROM attempt_responses_v2 WHERE attempt_id = ?", []any{fixture.attemptID}},
		{"DELETE FROM assessment_question_responses WHERE module_attempt_id = ?", []any{fixture.moduleAttemptID}},
		{"DELETE FROM assessment_module_attempts WHERE id = ?", []any{fixture.moduleAttemptID}},
		{"DELETE FROM assessment_exam_questions WHERE module_id = ?", []any{fixture.moduleID}},
		{"DELETE FROM assessment_question_revisions WHERE question_id IN (?, ?)", []any{fixture.v2QuestionID, fixture.legacyQuestionID}},
		{"DELETE FROM assessment_questions WHERE id IN (?, ?)", []any{fixture.v2QuestionID, fixture.legacyQuestionID}},
		{"DELETE FROM assessment_modules WHERE id = ?", []any{fixture.moduleID}},
		{"DELETE FROM assessment_sections WHERE id = ?", []any{fixture.sectionID}},
		{"DELETE FROM student_attempts WHERE id = ?", []any{fixture.attemptID}},
		{"DELETE FROM exam_schedules WHERE id = ?", []any{fixture.scheduleID}},
		{"DELETE FROM exam_versions WHERE id = ?", []any{fixture.versionID}},
		{"DELETE FROM exam_entities WHERE id = ?", []any{fixture.examID}},
	}
	for _, statement := range statements {
		if _, err := db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Logf("cleanup SAT response fixture (%s): %v", statement.query, err)
		}
	}
}

func assertJSONEqual(t *testing.T, want string, got json.RawMessage) {
	t.Helper()
	var wantValue, gotValue any
	if err := json.Unmarshal([]byte(want), &wantValue); err != nil {
		t.Fatalf("decode expected JSON %q: %v", want, err)
	}
	if err := json.Unmarshal(got, &gotValue); err != nil {
		t.Fatalf("decode actual JSON %q: %v", string(got), err)
	}
	if !jsonValuesEqual(wantValue, gotValue) {
		t.Fatalf("JSON mismatch: want %s, got %s", want, string(got))
	}
}

func jsonValuesEqual(want, got any) bool {
	wantJSON, _ := json.Marshal(want)
	gotJSON, _ := json.Marshal(got)
	return string(wantJSON) == string(gotJSON)
}
