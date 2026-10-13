package schedules

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// Model: verification/lean/sat-result (assumption A-PIN, PDF-07). An attempt
// keeps the version it joined while delivery reads the schedule's, so once any
// candidate has joined, the version is frozen for every start mode, not only
// code start. A proctor-start session that was reset to "scheduled" used to
// rebind and show completed students another version's questions.
func TestUpdateFreezesVersionOnceCandidatesJoined(t *testing.T) {
	for _, admitted := range []bool{true, false} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		svc := NewService(db, tx.NewRunner(db))
		now := time.Now().UTC()
		cols := []string{"id", "exam_id", "provider_key", "organization_id", "exam_title", "proctor_display_name", "grading_display_name", "published_version_id", "cohort_name", "institution", "start_time", "end_time", "planned_duration_minutes", "delivery_mode", "status", "revision", "recurrence_type", "recurrence_interval", "recurrence_end_date", "buffer_before_minutes", "buffer_after_minutes", "auto_start", "auto_stop", "created_at", "created_by", "updated_at", "sat_timing_model", "sat_start_mode", "sat_session_mode", "sat_route_policy"}
		row := func(version string, rev int) *sqlmock.Rows {
			return sqlmock.NewRows(cols).AddRow("sched-1", "exam-1", "sat", nil, "T", "T", "T", version, "C", nil, now, now.Add(time.Hour), 60, "cohort", StatusScheduled, rev, "", 0, nil, nil, nil, false, false, now, "u", now, nil, "proctor", "practice", nil)
		}

		mock.ExpectBegin()
		mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
		mock.ExpectQuery("FROM exam_schedules WHERE id = \\? FOR UPDATE").WithArgs("sched-1").WillReturnRows(row("v-1", 3))
		mock.ExpectQuery(regexp.QuoteMeta("SELECT exam_id FROM exam_versions WHERE id = ?")).WithArgs("v-2").
			WillReturnRows(sqlmock.NewRows([]string{"exam_id"}).AddRow("exam-1"))
		mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM student_attempts WHERE schedule_id = ?)")).WithArgs("sched-1").
			WillReturnRows(sqlmock.NewRows([]string{"admitted"}).AddRow(admitted))
		if admitted {
			mock.ExpectRollback()
		} else {
			mock.ExpectExec("UPDATE exam_schedules SET published_version_id").WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectQuery("FROM exam_schedules WHERE id").WithArgs("sched-1").WillReturnRows(row("v-2", 4))
			mock.ExpectCommit()
		}

		version := "v-2"
		got, err := svc.Update(context.Background(), "sched-1", UpdateRequest{PublishedVersionID: &version, Revision: 3})
		if admitted {
			var appErr *apperrors.Error
			if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeConflict || appErr.Details["reason"] != "START_CODE_RELEASE_FROZEN" {
				t.Fatalf("admitted: want a release-frozen conflict, got %v", err)
			}
		} else if err != nil || got.PublishedVersionID != "v-2" {
			t.Fatalf("no candidates: version change must apply, got %+v, %v", got, err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("admitted=%v: %v", admitted, err)
		}
		db.Close()
	}
}

// R-4: status only moves forward, so a session students sat can never be
// reset to "scheduled" (which reopened the version rebind and delete paths).
func TestUpdateAcceptsOnlyForwardStatus(t *testing.T) {
	cases := []struct {
		from, to string
		ok       bool
	}{
		{StatusLive, StatusScheduled, false},
		{StatusCompleted, StatusScheduled, false},
		{StatusCompleted, StatusLive, false},
		{StatusCancelled, StatusScheduled, false},
		{StatusScheduled, "paused", false},
		{StatusScheduled, StatusCancelled, true},
		{StatusLive, StatusCompleted, true},
		{StatusLive, StatusLive, true},
	}
	for _, tc := range cases {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		svc := NewService(db, tx.NewRunner(db))
		now := time.Now().UTC()
		cols := []string{"id", "exam_id", "provider_key", "organization_id", "exam_title", "proctor_display_name", "grading_display_name", "published_version_id", "cohort_name", "institution", "start_time", "end_time", "planned_duration_minutes", "delivery_mode", "status", "revision", "recurrence_type", "recurrence_interval", "recurrence_end_date", "buffer_before_minutes", "buffer_after_minutes", "auto_start", "auto_stop", "created_at", "created_by", "updated_at", "sat_timing_model", "sat_start_mode", "sat_session_mode", "sat_route_policy"}
		row := func(status string, rev int) *sqlmock.Rows {
			return sqlmock.NewRows(cols).AddRow("sched-1", "exam-1", "sat", nil, "T", "T", "T", "v-1", "C", nil, now, now.Add(time.Hour), 60, "cohort", status, rev, "", 0, nil, nil, nil, false, false, now, "u", now, nil, "proctor", "practice", nil)
		}
		mock.ExpectBegin()
		mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
		mock.ExpectQuery("FROM exam_schedules WHERE id = \\? FOR UPDATE").WithArgs("sched-1").WillReturnRows(row(tc.from, 3))
		if tc.ok {
			mock.ExpectExec("UPDATE exam_schedules SET published_version_id").WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectQuery("FROM exam_schedules WHERE id").WithArgs("sched-1").WillReturnRows(row(tc.to, 4))
			mock.ExpectCommit()
		} else {
			mock.ExpectRollback()
		}
		to := tc.to
		_, err = svc.Update(context.Background(), "sched-1", UpdateRequest{Status: &to, Revision: 3})
		var appErr *apperrors.Error
		if tc.ok && err != nil {
			t.Fatalf("%s -> %s must apply: %v", tc.from, tc.to, err)
		}
		if !tc.ok && (!errors.As(err, &appErr) || appErr.Code != apperrors.CodeValidation) {
			t.Fatalf("%s -> %s must be refused as a validation error, got %v", tc.from, tc.to, err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("%s -> %s: %v", tc.from, tc.to, err)
		}
		db.Close()
	}
}

// R-4: deleting a session someone joined is a clean conflict, never a cascade
// that drops their attempts or a raw foreign-key error.
func TestDeleteRefusesSessionWithCandidates(t *testing.T) {
	for _, joined := range []bool{true, false} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		svc := NewService(db, tx.NewRunner(db))
		mock.ExpectBegin()
		mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
		mock.ExpectQuery(regexp.QuoteMeta("SELECT status FROM exam_schedules WHERE id = ? FOR UPDATE")).WithArgs("sched-1").
			WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow(StatusScheduled))
		mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM student_attempts WHERE schedule_id = ?)")).WithArgs("sched-1").
			WillReturnRows(sqlmock.NewRows([]string{"joined"}).AddRow(joined))
		if joined {
			mock.ExpectRollback()
		} else {
			mock.ExpectExec(regexp.QuoteMeta("DELETE FROM exam_schedules WHERE id = ?")).WithArgs("sched-1").WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectCommit()
		}
		err = svc.Delete(context.Background(), "sched-1")
		var appErr *apperrors.Error
		if joined && (!errors.As(err, &appErr) || appErr.Code != apperrors.CodeConflict) {
			t.Fatalf("joined: want a conflict, got %v", err)
		}
		if !joined && err != nil {
			t.Fatalf("empty session must delete: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("joined=%v: %v", joined, err)
		}
		db.Close()
	}
}
