package exams

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

func expectCreateTxStart(mock sqlmock.Sqlmock) {
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone = '+00:00'")).WillReturnResult(sqlmock.NewResult(0, 0))
}

func expectExamResponse(mock sqlmock.Sqlmock, exam Exam) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_entities WHERE id = ?")).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "slug", "title", "provider_key", "provider_exam_type", "exam_type", "status", "visibility",
			"organization_id", "owner_id", "current_draft_version_id", "current_published_version_id", "schema_version",
			"revision", "created_at", "updated_at", "current_published_scope", "current_published_version_number", "sat_score_report_enabled", "sat_section_scope", "sat_custom_modules",
		}).AddRow(
			exam.ID, exam.Slug, exam.Title, exam.ProviderKey, exam.ProviderExamType, exam.ExamType, exam.Status, exam.Visibility,
			exam.OrganizationID, exam.OwnerID, exam.CurrentDraftVersionID, exam.CurrentPublishedVersion, exam.SchemaVersion,
			exam.Revision, exam.CreatedAt, exam.UpdatedAt, exam.CurrentPublishedScope, exam.CurrentPublishedVersionNumber, exam.SatScoreReportEnabled, exam.SatSectionScope, exam.SatCustomModules,
		))
}

func TestCreateReplaysCommittedExamForSameOperationKey(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	req := CreateRequest{
		OperationKey: "create-key",
		Slug:         "sat-practice",
		Title:        "SAT Practice",
		ExamType:     ExamTypeAcademic,
		Visibility:   VisibilityPrivate,
		OwnerID:      "staff-1",
	}
	fingerprint, err := createRequestFingerprint(req)
	if err != nil {
		t.Fatal(err)
	}
	createdAt := time.Date(2026, time.October, 15, 1, 2, 3, 0, time.UTC)
	exam := Exam{
		ID: "exam-original", Slug: req.Slug, Title: req.Title, ProviderKey: ProviderIELTS,
		ExamType: req.ExamType, Status: StatusDraft, Visibility: req.Visibility, OwnerID: req.OwnerID,
		SchemaVersion: 1, CreatedAt: createdAt, UpdatedAt: createdAt,
	}
	storedResult, err := json.Marshal(exam)
	if err != nil {
		t.Fatal(err)
	}

	// First request commits the exam and its ledger result together.
	expectCreateTxStart(mock)
	mock.ExpectExec("INSERT IGNORE INTO authoring_operation_keys").
		WithArgs(req.OwnerID, "exam-create", req.OperationKey, fingerprint).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO exam_entities").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO exam_versions").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE exam_entities SET current_draft_version_id").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO exam_events").WillReturnResult(sqlmock.NewResult(1, 1))
	expectExamResponse(mock, exam)
	mock.ExpectExec("UPDATE authoring_operation_keys SET result_json").
		WithArgs(sqlmock.AnyArg(), req.OwnerID, "exam-create", req.OperationKey).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	service := NewService(db, tx.NewRunner(db))
	first, err := service.Create(context.Background(), req)
	if err != nil {
		t.Fatalf("first create: %v", err)
	}
	if first.ID != exam.ID {
		t.Fatalf("first create id = %q, want %q", first.ID, exam.ID)
	}

	// A lost ACK followed by the same request reads the committed result and
	// performs no entity, version, or event insert.
	expectCreateTxStart(mock)
	mock.ExpectExec("INSERT IGNORE INTO authoring_operation_keys").
		WithArgs(req.OwnerID, "exam-create", req.OperationKey, fingerprint).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT request_hash, result_json FROM authoring_operation_keys").
		WithArgs(req.OwnerID, "exam-create", req.OperationKey).
		WillReturnRows(sqlmock.NewRows([]string{"request_hash", "result_json"}).AddRow(fingerprint, storedResult))
	mock.ExpectCommit()

	second, err := service.Create(context.Background(), req)
	if err != nil {
		t.Fatalf("create replay: %v", err)
	}
	if second.ID != first.ID || second.Slug != first.Slug {
		t.Fatalf("replay returned a different exam: first=%+v second=%+v", first, second)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateRejectsOperationKeyReuseForDifferentPayload(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	req := CreateRequest{
		OperationKey: "create-key",
		Slug:         "changed-slug",
		Title:        "Changed title",
		ExamType:     ExamTypeAcademic,
		Visibility:   VisibilityPrivate,
		OwnerID:      "staff-1",
	}
	oldFingerprint := strings.Repeat("a", 64)
	expectCreateTxStart(mock)
	mock.ExpectExec("INSERT IGNORE INTO authoring_operation_keys").
		WithArgs(req.OwnerID, "exam-create", req.OperationKey, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT request_hash, result_json FROM authoring_operation_keys").
		WithArgs(req.OwnerID, "exam-create", req.OperationKey).
		WillReturnRows(sqlmock.NewRows([]string{"request_hash", "result_json"}).AddRow(oldFingerprint, []byte(`{"id":"other-exam"}`)))
	mock.ExpectRollback()

	_, err = NewService(db, tx.NewRunner(db)).Create(context.Background(), req)
	if err == nil || !strings.Contains(err.Error(), "different content") {
		t.Fatalf("expected a different-payload key conflict, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateRejectsMalformedStoredReplayResult(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	req := CreateRequest{
		OperationKey: "create-key",
		Slug:         "sat-practice",
		Title:        "SAT Practice",
		ExamType:     ExamTypeAcademic,
		Visibility:   VisibilityPrivate,
		OwnerID:      "staff-1",
	}
	fingerprint, err := createRequestFingerprint(req)
	if err != nil {
		t.Fatal(err)
	}
	expectCreateTxStart(mock)
	mock.ExpectExec("INSERT IGNORE INTO authoring_operation_keys").
		WithArgs(req.OwnerID, "exam-create", req.OperationKey, fingerprint).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT request_hash, result_json FROM authoring_operation_keys").
		WithArgs(req.OwnerID, "exam-create", req.OperationKey).
		WillReturnRows(sqlmock.NewRows([]string{"request_hash", "result_json"}).AddRow(fingerprint, []byte(`null`)))
	mock.ExpectRollback()

	_, err = NewService(db, tx.NewRunner(db)).Create(context.Background(), req)
	if err == nil || !strings.Contains(err.Error(), "no exam id") {
		t.Fatalf("expected malformed replay to fail closed, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestValidateCreateRejectsOversizedOperationKey(t *testing.T) {
	err := validateCreate(CreateRequest{
		OperationKey: strings.Repeat("k", 129),
		Slug:         "slug",
		Title:        "title",
		ExamType:     ExamTypeAcademic,
		Visibility:   VisibilityPrivate,
		OwnerID:      "staff-1",
	})
	if err == nil || !strings.Contains(err.Error(), "operationKey") {
		t.Fatalf("expected oversized operation key to fail validation, got %v", err)
	}
}
