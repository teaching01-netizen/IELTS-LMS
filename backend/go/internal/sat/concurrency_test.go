package sat

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func satCodeOf(err error) apperrors.Code {
	if e, ok := apperrors.As(err); ok {
		return e.Code
	}
	return ""
}

func satService(db *sql.DB) *Service {
	svc := NewService(db, tx.NewRunner(db), clock.System{}, nil)
	svc.completionSealer = fakeCompletionSealer{}
	return svc
}

type fakeCompletionSealer struct{}

func (fakeCompletionSealer) SealCompletion(_ context.Context, _ tx.Tx, attempt attemptCore, req CompleteRequest, _ time.Time) (*AssessmentResult, bool, error) {
	return &AssessmentResult{
		ID: "res-pending", SubmissionID: req.SubmissionID, AttemptID: attempt.ID,
		ProviderKey: "sat", OutcomeStatus: "pending", ReleaseStatus: "pending",
		ScorePayload: map[string]any{"providerKey": "sat", "outcomeStatus": "pending"},
	}, true, nil
}

func satBegin(mock sqlmock.Sqlmock) {
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
}

func satAttemptRow(delivery, phase, proctor string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "schedule_id", "organization_id", "exam_id", "published_version_id",
		"proctor_status", "delivery_status", "phase", "answer_revision",
	}).AddRow("att-1", "sched-1", nil, "exam-sat", "pv-sat", proctor, delivery, phase, int64(3))
}

func satDBTime(mock sqlmock.Sqlmock) {
	now := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(
		sqlmock.NewRows([]string{"ts"}).AddRow(now))
}

func satNoReceipt(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
}

func satUnscopedRun(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT l.enabled_sections FROM assessment_access_links")).
		WillReturnError(sql.ErrNoRows)
}

func satTopologyRows(rows ...[2]string) *sqlmock.Rows {
	out := sqlmock.NewRows([]string{"section_key", "state"})
	for _, row := range rows {
		out.AddRow(row[0], row[1])
	}
	return out
}

func satCompleteTopologyRows() *sqlmock.Rows {
	return satTopologyRows(
		[2]string{"reading-writing", "submitted"},
		[2]string{"reading-writing", "submitted"},
		[2]string{"math", "submitted"},
		[2]string{"math", "submitted"},
	)
}

func expectCompleteAssessmentPrefix(mock sqlmock.Sqlmock, delivery, phase, proctor string, rows *sqlmock.Rows) {
	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WillReturnRows(satAttemptRow(delivery, phase, proctor))
	satNoReceipt(mock)
	satUnscopedRun(mock)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COALESCE(s.section_key, ''), ma.state")).
		WillReturnRows(rows)
}

func TestSATCompletionRequiresTerminalModulesAndReturnsUnscoredCompletion(t *testing.T) {
	for _, tc := range []struct {
		name     string
		rows     *sqlmock.Rows
		wantCode apperrors.Code
	}{
		{name: "complete topology", rows: satCompleteTopologyRows()},
		{name: "unfinished module", wantCode: apperrors.CodeConflict, rows: satTopologyRows(
			[2]string{"reading-writing", "submitted"},
			[2]string{"reading-writing", "active"},
			[2]string{"math", "submitted"},
		)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			svc := satService(db)
			expectCompleteAssessmentPrefix(mock, "running", "exam", "active", tc.rows)
			if tc.wantCode == "" {
				mock.ExpectCommit()
				result, err := svc.CompleteAssessment(context.Background(), CompleteRequest{
					AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-1", ActorKind: "student",
				})
				if err != nil {
					t.Fatalf("completion should not depend on a scoring policy: %v", err)
				}
				if result == nil || result.OutcomeStatus != "pending" || result.TotalScore != nil || len(result.Sections) != 0 {
					t.Fatalf("SAT completion must be unscored, got %+v", result)
				}
			} else {
				mock.ExpectRollback()
				_, err := svc.CompleteAssessment(context.Background(), CompleteRequest{
					AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-1", ActorKind: "student",
				})
				if satCodeOf(err) != tc.wantCode {
					t.Fatalf("unfinished topology must return %s, got %v", tc.wantCode, err)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSATCompletionRemainsBlockedAfterTermination(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satService(db)
	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(satAttemptRow("submitted", "post-exam", "active"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).WillReturnRows(
		sqlmock.NewRows([]string{"outcome"}).AddRow("terminated"))
	mock.ExpectRollback()
	_, err = svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-1", ActorKind: "student"})
	if satCodeOf(err) != apperrors.CodeAttemptProctorBlocked {
		t.Fatalf("expected ATTEMPT_PROCTOR_BLOCKED, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
