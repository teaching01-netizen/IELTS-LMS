package satrooms

import (
	"context"
	"regexp"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/accesslinks"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func expectScopeExam(mock sqlmock.Sqlmock, scope string, lock bool) {
	query := "SELECT provider_key, exam_type, current_draft_version_id, current_published_version_id, revision, sat_section_scope FROM exam_entities WHERE id = ?"
	if lock {
		query += " FOR UPDATE"
	}
	mock.ExpectQuery(regexp.QuoteMeta(query)).WithArgs("exam").WillReturnRows(sqlmock.NewRows([]string{"provider_key", "exam_type", "current_draft_version_id", "current_published_version_id", "revision", "sat_section_scope"}).AddRow("sat", "Academic", nil, nil, 0, scope))
}

func assertScopeUnavailable(t *testing.T, err error, label string) {
	t.Helper()
	typed, ok := apperrors.As(err)
	if !ok || typed.Code != apperrors.CodeExamScopeUnavailable || !strings.Contains(typed.Message, label) {
		t.Fatalf("want scope unavailable naming %q, got %v", label, err)
	}
}

func TestNeedsSealRejectsSectionsOutsideExamScope(t *testing.T) {
	for _, tc := range []struct {
		name, scope, label string
		sections           []string
	}{
		{"math from RW", "reading-writing", "Reading & Writing", []string{"math"}},
		{"both from RW", "reading-writing", "Reading & Writing", nil},
		{"RW from math", "math", "Math", []string{"reading-writing"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			expectScopeExam(mock, tc.scope, false)
			_, err = NewService(db, nil, nil, nil).NeedsSeal(context.Background(), "exam", tc.sections)
			assertScopeUnavailable(t, err, tc.label)
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCreateRoomRechecksExamScopeUnderLock(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("SELECT request_hash, exam_id").WillReturnRows(sqlmock.NewRows([]string{"request_hash", "exam_id", "access_link_id", "version_id", "version_number", "release_created", "exam_revision", "response_snapshot"}))
	expectScopeExam(mock, "full", false)
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT IGNORE INTO sat_room_operations").WillReturnResult(sqlmock.NewResult(0, 1))
	expectScopeExam(mock, "reading-writing", true)
	mock.ExpectRollback()
	revision, draft := 0, ""
	_, err = NewService(db, tx.NewRunner(db), nil, nil).CreateRoom(context.Background(), "staff", "exam", Request{
		OperationKey: "key", ExpectedExamRevision: &revision, ExpectedDraftVersionID: &draft,
		Room: accesslinks.CreateRequest{Name: "Math", AudienceType: accesslinks.AudienceAnyone, AccessMode: accesslinks.ModeStudentCode, AvailabilityType: accesslinks.AvailabilityAnytime, EnabledSections: []string{"math"}},
	})
	assertScopeUnavailable(t, err, "Reading & Writing")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestNeedsSealAcceptsExamScope(t *testing.T) {
	for _, tc := range []struct {
		scope    string
		sections []string
	}{
		{"full", nil}, {"full", []string{"math"}}, {"reading-writing", []string{"reading-writing"}}, {"math", []string{"math"}},
	} {
		t.Run(tc.scope, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			expectScopeExam(mock, tc.scope, false)
			seal, err := NewService(db, nil, nil, nil).NeedsSeal(context.Background(), "exam", tc.sections)
			if err != nil || seal {
				t.Fatalf("no draft should need no seal: %v, %v", seal, err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
