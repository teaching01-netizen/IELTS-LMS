package exams

import (
	"context"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// RED: list ordering must never sort rows that carry the snapshot payloads.
// The ordering key is resolved on its own (the (exam_id, version_number) index
// answers it) and the payload rows are read unordered afterwards, then emitted
// in the resolved order. A single ordered statement over the payload columns
// fails with "Error 1038: Out of sort memory" once an exam accumulates a long
// version history with large snapshots.
func TestListVersionsOrdersKeysBeforeReadingPayloads(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := NewService(db, tx.NewRunner(db))

	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM exam_versions WHERE exam_id = ? ORDER BY version_number DESC, created_at DESC")).
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("ver-2").AddRow("ver-1"))
	// Payload rows arrive unordered; the service must restore the key order.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id, exam_id, version_number, parent_version_id, CAST(content_snapshot AS CHAR)")).
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "exam_id", "version_number", "parent_version_id",
			"content_snapshot", "config_snapshot", "validation_snapshot",
			"created_by", "publish_notes", "sat_publish_scope", "is_draft", "is_published",
			"revision", "created_at",
		}).
			AddRow("ver-1", "exam-1", 1, nil, `{"title":"one"}`, "{}", nil, "owner-1", nil, nil, false, true, 3, time.Now()).
			AddRow("ver-2", "exam-1", 2, nil, `{"title":"two"}`, "{}", nil, "owner-1", nil, nil, true, false, 0, time.Now()))

	out, err := s.ListVersions(context.Background(), "exam-1")
	if err != nil {
		t.Fatalf("ListVersions: %v", err)
	}
	if len(out) != 2 || out[0].ID != "ver-2" || out[1].ID != "ver-1" {
		t.Fatalf("want newest-first [ver-2 ver-1], got %+v", out)
	}
	if string(out[0].Content) != `{"title":"two"}` {
		t.Fatalf("payload not preserved for ver-2: %s", out[0].Content)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// An exam without versions stays an empty list (no payload query is issued).
func TestListVersionsEmptyExam(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := NewService(db, tx.NewRunner(db))

	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM exam_versions WHERE exam_id = ?")).
		WithArgs("exam-none").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	out, err := s.ListVersions(context.Background(), "exam-none")
	if err != nil {
		t.Fatalf("ListVersions: %v", err)
	}
	if out != nil {
		t.Fatalf("want nil versions, got %+v", out)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
