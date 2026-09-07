package exams

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func reopenBegin(mock sqlmock.Sqlmock) {
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
}

// RED: clone-database IELTS exams can lose their draft pointer (NULL/NULL rows
// from failed clone writes, or published rows whose draft was sealed). Loading
// such an exam surfaces "Configuration load failed / Draft version not found".
// ReopenDraft must heal by inserting a fresh draft seeded from the latest
// surviving version (or an empty skeleton when none exists), CAS the draft
// pointer, and record a version_created event.
func TestReopenDraftHealsOrphanDraftExam(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := NewService(db, tx.NewRunner(db))

	reopenBegin(mock)
	// Lock + read exam row: orphan draft pointer, draft status.
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_entities WHERE id = ? FOR UPDATE")).
		WithArgs("exam-orphan").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "slug", "title", "provider_key", "provider_exam_type",
			"exam_type", "status", "visibility", "organization_id", "owner_id",
			"current_draft_version_id", "current_published_version_id",
			"schema_version", "revision", "created_at", "updated_at",
		}).AddRow(
			"exam-orphan", "orphan", "Orphan Exam", "ielts", nil,
			"Academic", "draft", "organization", nil, "owner-1",
			nil, nil,
			1, 0, time.Now(), time.Now(),
		))
	// No surviving versions.
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_versions WHERE exam_id = ?")).
		WithArgs("exam-orphan").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "version_number", "content_snapshot", "config_snapshot",
			"created_by", "is_draft", "is_published", "revision",
		}))
	mock.ExpectQuery(regexp.QuoteMeta("COALESCE(MAX(version_number), 0)")).
		WithArgs("exam-orphan").
		WillReturnRows(sqlmock.NewRows([]string{"n"}).AddRow(1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO exam_versions")).
		WithArgs(sqlmock.AnyArg(), "exam-orphan", 1, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "actor-1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_entities SET current_draft_version_id")).
		WithArgs(sqlmock.AnyArg(), "exam-orphan").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO exam_events")).
		WithArgs(sqlmock.AnyArg(), "exam-orphan", sqlmock.AnyArg(), "actor-1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_versions WHERE id = ?")).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "exam_id", "version_number", "parent_version_id",
			"content_snapshot", "config_snapshot", "validation_snapshot",
			"created_by", "publish_notes", "is_draft", "is_published",
			"revision", "created_at",
		}).AddRow(
			"ver-new", "exam-orphan", 1, nil,
			"{}", "{}", nil,
			"actor-1", nil, true, false,
			0, time.Now(),
		))
	mock.ExpectCommit()

	v, err := s.ReopenDraft(context.Background(), "exam-orphan", "actor-1")
	if err != nil {
		t.Fatalf("ReopenDraft orphan must heal: %v", err)
	}
	if v.ExamID != "exam-orphan" || !v.IsDraft || v.IsPublished {
		t.Fatalf("unexpected healed version: %+v", v)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// RED: published exam whose draft pointer was sealed (NULL) must reopen an
// editable draft cloned from the published snapshot, keeping the published
// version immutable.
func TestReopenDraftClonesPublishedSnapshot(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := NewService(db, tx.NewRunner(db))

	content := json.RawMessage(`{"title":"Sealed Exam","type":"Academic"}`)
	config := json.RawMessage(`{"general":{"title":"Sealed Exam"}}`)

	reopenBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_entities WHERE id = ? FOR UPDATE")).
		WithArgs("exam-sealed").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "slug", "title", "provider_key", "provider_exam_type",
			"exam_type", "status", "visibility", "organization_id", "owner_id",
			"current_draft_version_id", "current_published_version_id",
			"schema_version", "revision", "created_at", "updated_at",
		}).AddRow(
			"exam-sealed", "sealed", "Sealed Exam", "ielts", nil,
			"Academic", "published", "organization", nil, "owner-1",
			nil, "ver-pub",
			1, 7, time.Now(), time.Now(),
		))
	// Latest surviving version is the published seal; reuse its snapshots.
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_versions WHERE exam_id = ?")).
		WithArgs("exam-sealed").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "version_number", "content_snapshot", "config_snapshot",
			"created_by", "is_draft", "is_published", "revision",
		}).AddRow("ver-pub", 3, string(content), string(config), "owner-1", false, true, 2))
	mock.ExpectQuery(regexp.QuoteMeta("COALESCE(MAX(version_number), 0)")).
		WithArgs("exam-sealed").
		WillReturnRows(sqlmock.NewRows([]string{"n"}).AddRow(4))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO exam_versions")).
		WithArgs(sqlmock.AnyArg(), "exam-sealed", 4, "ver-pub", string(content), string(config), "actor-1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_entities SET current_draft_version_id")).
		WithArgs(sqlmock.AnyArg(), "exam-sealed").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO exam_events")).
		WithArgs(sqlmock.AnyArg(), "exam-sealed", sqlmock.AnyArg(), "actor-1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_versions WHERE id = ?")).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "exam_id", "version_number", "parent_version_id",
			"content_snapshot", "config_snapshot", "validation_snapshot",
			"created_by", "publish_notes", "is_draft", "is_published",
			"revision", "created_at",
		}).AddRow(
			"ver-new", "exam-sealed", 4, "ver-pub",
			string(content), string(config), nil,
			"actor-1", nil, true, false,
			0, time.Now(),
		))
	mock.ExpectCommit()

	v, err := s.ReopenDraft(context.Background(), "exam-sealed", "actor-1")
	if err != nil {
		t.Fatalf("ReopenDraft sealed must clone published: %v", err)
	}
	if v.VersionNumber != 4 || (v.ParentVersion == nil || *v.ParentVersion != "ver-pub") {
		t.Fatalf("unexpected cloned version: %+v", v)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// RED: a healthy exam with a live draft pointer must NOT create versions; the
// existing draft is returned so Retry/concurrent callers converge.
func TestReopenDraftReturnsExistingDraft(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := NewService(db, tx.NewRunner(db))

	reopenBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_entities WHERE id = ? FOR UPDATE")).
		WithArgs("exam-live").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "slug", "title", "provider_key", "provider_exam_type",
			"exam_type", "status", "visibility", "organization_id", "owner_id",
			"current_draft_version_id", "current_published_version_id",
			"schema_version", "revision", "created_at", "updated_at",
		}).AddRow(
			"exam-live", "live", "Live Exam", "ielts", nil,
			"Academic", "draft", "organization", nil, "owner-1",
			"ver-live", nil,
			1, 1, time.Now(), time.Now(),
		))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_versions WHERE id = ?")).
		WithArgs("ver-live").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "exam_id", "version_number", "parent_version_id",
			"content_snapshot", "config_snapshot", "validation_snapshot",
			"created_by", "publish_notes", "is_draft", "is_published",
			"revision", "created_at",
		}).AddRow(
			"ver-live", "exam-live", 2, nil,
			"{}", "{}", nil,
			"owner-1", nil, true, false,
			5, time.Now(),
		))
	mock.ExpectCommit()

	v, err := s.ReopenDraft(context.Background(), "exam-live", "actor-1")
	if err != nil {
		t.Fatalf("ReopenDraft live draft must shortcut: %v", err)
	}
	if v.ID != "ver-live" {
		t.Fatalf("expected existing draft ver-live, got %+v", v)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// RED: unknown exam must stay NOT_FOUND, not heal.
func TestReopenDraftMissingExamNotFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := NewService(db, tx.NewRunner(db))

	reopenBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_entities WHERE id = ? FOR UPDATE")).
		WithArgs("exam-missing").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	if _, err := s.ReopenDraft(context.Background(), "exam-missing", "actor-1"); codeOf2(err) != apperrors.CodeNotFound {
		t.Fatalf("expected NOT_FOUND, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func codeOf2(err error) apperrors.Code {
	if e, ok := apperrors.As(err); ok {
		return e.Code
	}
	return ""
}
