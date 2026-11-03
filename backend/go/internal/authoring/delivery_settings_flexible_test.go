package authoring

import (
	"context"
	"regexp"
	"strconv"
	"strings"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// FR-2 + FR-5: the Settings threshold bound follows authored N for flexible
// drafts (blueprint max stays for strict drafts), and the section-duration
// write is plan-aware (m1_only stores base-only, like init).
//
// These run without MySQL through the service: the full locked tx is
// stubbed, the section UPDATE args are asserted on the wire, and the
// post-commit Shell read is stubbed like TestOpenShellDraftShortcut.

type settingsCase struct {
	sectionKey string
	flexible   int64
	authoredN  int
	planRaw    any
	threshold  int
}

func driveDeliverySettings(t *testing.T, mock sqlmock.Sqlmock, c settingsCase, wantSectionDuration int) {
	t.Helper()
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT v.id FROM assessment_sections s")).
		WithArgs("sec-1", "exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("draft-1"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT section_key, revision FROM assessment_sections WHERE id = ? FOR UPDATE")).
		WithArgs("sec-1").
		WillReturnRows(sqlmock.NewRows([]string{"section_key", "revision"}).AddRow(c.sectionKey, 3))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules WHERE section_id")).
		WithArgs("sec-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "adaptive_role", "revision"}).
			AddRow("m-base", RoleBase, 11).
			AddRow("m-lower", RoleLowerBranch, 12).
			AddRow("m-higher", RoleHigherBranch, 13))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_routing_policies WHERE section_id")).
		WithArgs("sec-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "base_module_id", "lower_module_id", "higher_module_id", "revision"}).
			AddRow("rout-1", "m-base", "m-lower", "m-higher", 7))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT target_question_count FROM assessment_modules WHERE id = ?")).
		WithArgs("m-base").
		WillReturnRows(sqlmock.NewRows([]string{"target_question_count"}).AddRow(27))
	mock.ExpectQuery("sat_flexible_count").WithArgs("draft-1").
		WillReturnRows(sqlmock.NewRows([]string{"sat_flexible_count"}).AddRow(c.flexible))
	if c.flexible != 0 {
		mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM assessment_exam_questions WHERE module_id = ?")).
			WithArgs("m-base").
			WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(c.authoredN))
	}
	timings := []struct {
		id  string
		rev int
		dur int
	}{
		{"m-base", 11, 1920},
		{"m-lower", 12, 2100},
		{"m-higher", 13, 2100},
	}
	for _, tm := range timings {
		mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_modules SET duration_seconds")).
			WithArgs(tm.dur, tm.id, "sec-1", tm.rev).
			WillReturnResult(sqlmock.NewResult(0, 1))
	}
	// Plan-aware duration: read after the module writes, before the section write.
	mock.ExpectQuery("sat_classroom_plan").WithArgs("draft-1").
		WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(c.planRaw))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_sections SET duration_seconds")).
		WithArgs(wantSectionDuration, 300, "sec-1", 3).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_routing_policies SET policy_config")).
		WithArgs(`{"minimumCorrectForHigher":`+strconv.Itoa(c.threshold)+`}`, "rout-1", 7).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_versions SET revision = revision + 1")).
		WithArgs("draft-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	// Post-commit Shell read (empty draft projection, as in the shortcut test;
	// the read-only tx issues no SET time_zone).
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT e.provider_key, e.current_draft_version_id, v.revision")).
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key", "current_draft_version_id", "revision"}).
			AddRow("sat", "draft-1", 3))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_sections WHERE exam_version_id = ?")).
		WithArgs("draft-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "revision"}))
	mock.ExpectRollback()
}

func settingsRequest(threshold int) DeliverySettingsRequest {
	return DeliverySettingsRequest{
		ExpectedSectionRevision: 3,
		BreakAfterSeconds:       300,
		ModuleTimings: []ModuleTiming{
			{ModuleID: "m-base", DurationSeconds: 1920, ExpectedRevision: 11},
			{ModuleID: "m-lower", DurationSeconds: 2100, ExpectedRevision: 12},
			{ModuleID: "m-higher", DurationSeconds: 2100, ExpectedRevision: 13},
		},
		MinimumCorrectForHigher: threshold,
		ExpectedRoutingRevision: 7,
	}
}

func TestUpdateDeliverySettingsFlexibleBoundFollowsAuthoredN(t *testing.T) {
	// Flexible draft, 10 authored M1 questions: 11 is refused, 10 passes.
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db))

	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT v.id FROM assessment_sections s")).
		WithArgs("sec-1", "exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("draft-1"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT section_key, revision FROM assessment_sections WHERE id = ? FOR UPDATE")).
		WithArgs("sec-1").
		WillReturnRows(sqlmock.NewRows([]string{"section_key", "revision"}).AddRow("math", 3))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules WHERE section_id")).
		WithArgs("sec-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "adaptive_role", "revision"}).
			AddRow("m-base", RoleBase, 11).
			AddRow("m-lower", RoleLowerBranch, 12).
			AddRow("m-higher", RoleHigherBranch, 13))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_routing_policies WHERE section_id")).
		WithArgs("sec-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "base_module_id", "lower_module_id", "higher_module_id", "revision"}).
			AddRow("rout-1", "m-base", "m-lower", "m-higher", 7))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT target_question_count FROM assessment_modules WHERE id = ?")).
		WithArgs("m-base").
		WillReturnRows(sqlmock.NewRows([]string{"target_question_count"}).AddRow(27))
	mock.ExpectQuery("sat_flexible_count").WithArgs("draft-1").
		WillReturnRows(sqlmock.NewRows([]string{"sat_flexible_count"}).AddRow(int64(1)))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM assessment_exam_questions WHERE module_id = ?")).
		WithArgs("m-base").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(10))
	mock.ExpectRollback()

	_, err = svc.UpdateDeliverySettings(context.Background(), "exam-1", "sec-1", settingsRequest(11))
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeValidation || !strings.Contains(err.Error(), "operational question count") {
		t.Fatalf("flexible threshold 11 with N=10 must be refused, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestUpdateDeliverySettingsFlexibleBoundAcceptsAuthoredN(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db))
	driveDeliverySettings(t, mock, settingsCase{sectionKey: "math", flexible: 1, authoredN: 10, planRaw: nil, threshold: 10}, 1920+2100)
	if _, err := svc.UpdateDeliverySettings(context.Background(), "exam-1", "sec-1", settingsRequest(10)); err != nil {
		t.Fatalf("flexible threshold 10 with N=10 must pass, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestUpdateDeliverySettingsStrictBoundStillUsesBlueprintMax(t *testing.T) {
	// Strict drafts keep the blueprint-max bound: 27 passes without ever
	// counting authored questions.
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db))
	driveDeliverySettings(t, mock, settingsCase{sectionKey: "math", flexible: 0, planRaw: nil, threshold: 27}, 1920+2100)
	if _, err := svc.UpdateDeliverySettings(context.Background(), "exam-1", "sec-1", settingsRequest(27)); err != nil {
		t.Fatalf("strict threshold 27 must pass, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestUpdateDeliverySettingsM1OnlyDurationStaysBaseOnly(t *testing.T) {
	//m1_only sections store the base module alone (1920), not base + branch.
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db))
	driveDeliverySettings(t, mock, settingsCase{sectionKey: "math", flexible: 1, authoredN: 10, planRaw: `{"math":"m1_only"}`, threshold: 9}, 1920)
	if _, err := svc.UpdateDeliverySettings(context.Background(), "exam-1", "sec-1", settingsRequest(9)); err != nil {
		t.Fatalf("m1_only save must pass, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
