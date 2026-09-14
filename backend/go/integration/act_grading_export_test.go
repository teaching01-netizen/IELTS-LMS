package integration

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/act"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/grading"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/results"
	"example.com/ielts-proctoring/internal/terminalization"
	"github.com/google/uuid"
)

// TestACTTerminalizationProjectionOverrideExport exercises the real MySQL
// chain behind the ACT results surface. It is intentionally gated by the same
// TEST_MYSQL_DSN used by the integration harness; the unit suite cannot prove
// JSON projection, foreign-key, and transaction behavior together.
func TestACTTerminalizationProjectionOverrideExport(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	ids := actFixtureIDs()
	cleanupACTFixture(t, db, ids)
	t.Cleanup(func() { cleanupACTFixture(t, db, ids) })

	content := actScienceContent(ids.questionID)
	config := map[string]any{"weights": []any{1}}
	contentJSON := mustJSONBytes(content)
	configJSON := mustJSONBytes(config)
	if _, err := db.ExecContext(ctx, `
		INSERT INTO exam_entities (
			id, slug, title, provider_key, provider_exam_type, exam_type,
			status, visibility, organization_id, owner_id, schema_version, revision
		) VALUES (?, ?, ?, 'act', 'ACT', 'ACT', 'published', 'organization', ?, ?, 1, 0)`,
		ids.examID, ids.examID, "ACT integration flow", ids.organizationID, ids.ownerID); err != nil {
		t.Fatalf("insert exam: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO exam_versions (
			id, exam_id, version_number, content_snapshot, config_snapshot,
			created_by, is_published, revision
		) VALUES (?, ?, 1, ?, ?, ?, TRUE, 0)`,
		ids.versionID, ids.examID, contentJSON, configJSON, ids.ownerID); err != nil {
		t.Fatalf("insert ACT version: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		UPDATE exam_entities
		SET current_published_version_id = ?
		WHERE id = ?`, ids.versionID, ids.examID); err != nil {
		t.Fatalf("point exam at published version: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO exam_schedules (
			id, exam_id, organization_id, exam_title, published_version_id,
			cohort_name, institution, start_time, end_time, planned_duration_minutes,
			delivery_mode, status, created_by
		) VALUES (?, ?, ?, ?, ?, 'ACT integration', 'Codex', ?, ?, 40,
			'proctor_start', 'scheduled', ?)`,
		ids.scheduleID, ids.examID, ids.organizationID, "ACT integration flow", ids.versionID,
		now.Add(-time.Minute), now.Add(time.Hour), ids.ownerID); err != nil {
		t.Fatalf("insert schedule: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO student_attempts (
			id, schedule_id, student_key, organization_id, exam_id,
			published_version_id, exam_title, candidate_id, candidate_name,
			candidate_email, phase, current_module, answers, writing_answers,
			flags, violations_snapshot, integrity, recovery, revision,
			protocol_version, delivery_status, lease_epoch, control_epoch, response_revision
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'exam', 'science', ?, '{}',
			'{}', '[]', '{}', '{"clientSessionId":"integration"}', 0,
			1, 'running', 1, 1, 0)`,
		ids.attemptID, ids.scheduleID, ids.attemptID, ids.organizationID, ids.examID,
		ids.versionID, "ACT integration flow", "candidate-1", "Integration Candidate",
		"candidate@example.test", `{"${ids.questionID}":"A"}`); err != nil {
		t.Fatalf("insert ACT attempt: %v", err)
	}

	runner := tx.NewRunner(db)
	actService := act.NewService(db, runner)
	terminal := terminalization.NewService(runner, nil, nil).SetAttemptScorer(actService)
	sealed, err := terminal.Terminalize(ctx, terminalization.SealCommand{
		AttemptID: ids.attemptID, ScheduleID: ids.scheduleID,
		Outcome: terminalization.OutcomeSubmitted, Reason: terminalization.ReasonStudentSubmit,
		ActorKind: terminalization.ActorStudent, RequestID: uuid.NewString(),
		FinalSubmission: json.RawMessage(`{}`),
	})
	if err != nil || sealed == nil || !sealed.Created {
		t.Fatalf("terminalize ACT attempt: created=%v err=%v", sealed != nil && sealed.Created, err)
	}

	var submissionID, providerKey, sectionKey, sectionStatus string
	if err := db.QueryRowContext(ctx, `
		SELECT sub.id, sub.provider_key, section.section, section.grading_status
		FROM student_submissions sub
		JOIN section_submissions section ON section.submission_id = sub.id
		WHERE sub.attempt_id = ?`, ids.attemptID).Scan(&submissionID, &providerKey, &sectionKey, &sectionStatus); err != nil {
		t.Fatalf("read canonical ACT projection: %v", err)
	}
	if providerKey != "act" || sectionKey != "science" || sectionStatus != grading.SectionAutoGraded {
		t.Fatalf("canonical projection = provider=%q section=%q status=%q", providerKey, sectionKey, sectionStatus)
	}

	admin := auth.NewActorContext(ids.ownerID, auth.RoleAdmin)
	detail, err := actService.GetScienceDetail(ctx, admin, ids.attemptID)
	if err != nil {
		t.Fatalf("read ACT detail: %v", err)
	}
	if detail.TotalScore != 1 || detail.Percentage != 100 || detail.Integrity != "verified" {
		t.Fatalf("initial ACT detail = %+v", detail)
	}

	grader := grading.NewService(db, runner)
	if err := grader.OverrideObjectiveQuestion(ctx, submissionID, "science", ids.questionID, 0, ids.ownerID, "Integration Admin"); err != nil {
		t.Fatalf("override ACT question: %v", err)
	}
	detail, err = actService.GetScienceDetail(ctx, admin, ids.attemptID)
	if err != nil {
		t.Fatalf("read overridden ACT detail: %v", err)
	}
	if detail.TotalScore != 0 || detail.Percentage != 0 || detail.Release != "pending" {
		t.Fatalf("overridden ACT detail = %+v", detail)
	}

	exported, err := results.NewService(db).ExportVisible(ctx, admin)
	if err != nil {
		t.Fatalf("export ACT result: %v", err)
	}
	var found *results.DashboardResult
	for index := range exported {
		if exported[index].AttemptID == ids.attemptID {
			found = &exported[index]
			break
		}
	}
	if found == nil || found.ProviderKey != "act" || found.TotalScore == nil || *found.TotalScore != 0 || found.Percentage == nil || *found.Percentage != 0 || found.ReleaseStatus != "pending" {
		t.Fatalf("exported ACT row = %+v", found)
	}
}

type actFixtureIDSet struct {
	examID         string
	versionID      string
	scheduleID     string
	attemptID      string
	questionID     string
	organizationID string
	ownerID        string
}

func actFixtureIDs() actFixtureIDSet {
	return actFixtureIDSet{
		examID: uuid.NewString(), versionID: uuid.NewString(), scheduleID: uuid.NewString(),
		attemptID: uuid.NewString(), questionID: "act-integration-q1",
		organizationID: "act-integration-org", ownerID: "act-integration-owner",
	}
}

func cleanupACTFixture(t *testing.T, db *sql.DB, ids actFixtureIDSet) {
	t.Helper()
	_, _ = db.Exec("DELETE FROM outbox_events WHERE aggregate_id = ?", ids.attemptID)
	_, _ = db.Exec("DELETE FROM exam_events WHERE exam_id = ?", ids.examID)
	_, _ = db.Exec("UPDATE exam_versions SET parent_version_id = NULL WHERE exam_id = ?", ids.examID)
	_, _ = db.Exec("DELETE FROM exam_entities WHERE id = ?", ids.examID)
}

func actScienceContent(questionID string) map[string]any {
	return map[string]any{
		"science": map[string]any{
			"stimuli": []any{map[string]any{
				"id": "act-integration-stimulus",
				"blocks": []any{map[string]any{
					"questions": []any{map[string]any{
						"id": questionID,
						"options": []any{
							map[string]any{"id": "A", "text": "A", "isCorrect": true},
							map[string]any{"id": "B", "text": "B", "isCorrect": false},
						},
					}},
				}},
			}},
		},
	}
}

func mustJSONBytes(value any) []byte {
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return encoded
}
