package exams

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satconvert"
)

const validCreateConverter = `{"converterVersion":"v1","scoreType":"estimated_sat","calibrationSource":"staff_approved","sections":{"math":{"full_lower":"m"}},"tables":{"m":{"operationalQuestions":1,"scores":{"0":200,"1":210}}}}`

func TestSATExamConfigValidatesPlanAndConverter(t *testing.T) {
	valid := SATExamConfig{
		ClassroomPlan:  map[string]string{"math": "m2_hard"},
		ScoreConverter: json.RawMessage(validCreateConverter),
	}
	if err := valid.Validate(); err != nil {
		t.Fatalf("valid plan and converter must pass: %v", err)
	}

	invalidPlan := valid
	invalidPlan.ClassroomPlan = map[string]string{"math": "adaptive"}
	if err := invalidPlan.Validate(); err == nil || !strings.Contains(err.Error(), "unknown SAT classroom shape") {
		t.Fatalf("invalid plan should retain parser sentence, got %v", err)
	}

	invalidConverter := valid
	invalidConverter.ScoreConverter = json.RawMessage(`{"scoreType":"estimated_sat"}`)
	if err := invalidConverter.Validate(); err == nil || !strings.Contains(err.Error(), "converterVersion") {
		t.Fatalf("invalid converter should retain parser sentence, got %v", err)
	}
}

func TestCreateRejectsInvalidSATConfigBeforeTransaction(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	provider := ProviderSAT
	service := NewService(db, tx.NewRunner(db))
	for _, test := range []struct {
		name   string
		config *SATExamConfig
		want   string
	}{
		{
			name:   "invalid plan",
			config: &SATExamConfig{ClassroomPlan: map[string]string{"math": "bogus"}},
			want:   "unknown SAT classroom shape",
		},
		{
			name:   "invalid converter",
			config: &SATExamConfig{ScoreConverter: json.RawMessage(`{"scoreType":"estimated_sat"}`)},
			want:   "converterVersion",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := service.Create(context.Background(), CreateRequest{
				Slug: "bad-sat", Title: "Bad SAT", ExamType: ExamTypeAcademic,
				Visibility: VisibilityPrivate, OwnerID: "staff", ProviderKey: &provider,
				SATConfig: test.config,
			})
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("invalid SAT config should reject create, got %v", err)
			}
		})
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("invalid configuration opened a transaction or wrote rows: %v", err)
	}
}

func TestInitializeSATDraftStoresPlanAndConverterInTransaction(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	q, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COALESCE(MAX(version_number), 0) + 1 FROM exam_versions WHERE exam_id = ?")).
		WithArgs("exam-1").WillReturnRows(sqlmock.NewRows([]string{"version_number"}).AddRow(1))
	mock.ExpectExec("INSERT INTO exam_versions").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_versions SET sat_classroom_plan = ? WHERE id = ?")).
		WithArgs(`{"math":"m2_hard"}`, sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(0, 1))
	for _, section := range satInitialBlueprint {
		mock.ExpectExec("INSERT INTO assessment_sections").WillReturnResult(sqlmock.NewResult(1, 1))
		for range section.modules {
			mock.ExpectExec("INSERT INTO assessment_modules").WillReturnResult(sqlmock.NewResult(1, 1))
		}
		mock.ExpectExec("INSERT INTO assessment_routing_policies").WillReturnResult(sqlmock.NewResult(1, 1))
	}
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_scoring_policies (id, exam_version_id, policy_key, policy_config) VALUES (?, ?, ?, ?)")).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), satconvert.ScoreType, validCreateConverter).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE exam_entities SET current_draft_version_id = ").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	converter := json.RawMessage(validCreateConverter)
	config := &SATExamConfig{
		ClassroomPlan:  map[string]string{"math": "m2_hard"},
		ScoreConverter: converter,
	}
	versionID, err := initializeSATDraftTx(context.Background(), q, "exam-1", "staff", config)
	if err != nil {
		_ = q.Rollback()
		t.Fatalf("initialize draft: %v", err)
	}
	if versionID == "" {
		t.Fatal("expected a draft version id")
	}
	if err := q.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("transaction did not persist the plan and converter: %v", err)
	}
}
