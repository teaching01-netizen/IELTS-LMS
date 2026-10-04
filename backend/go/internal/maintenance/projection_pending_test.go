package maintenance

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

type timeNear struct{ center time.Time }

func (want timeNear) Match(value driver.Value) bool {
	got, ok := value.(time.Time)
	if !ok {
		return false
	}
	delta := got.Sub(want.center)
	if delta < 0 {
		delta = -delta
	}
	return delta < time.Second
}

func TestProjectionPendingUsesIndependentCursors(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	scheduleAt := time.Date(2026, 10, 1, 1, 0, 0, 0, time.UTC)
	attemptAt := scheduleAt.Add(time.Hour)
	watermark := attemptAt.Add(time.Hour)
	raw, _ := json.Marshal(ProjectionState{Watermark: &watermark,
		ScheduleCursor:     &Cursor{UpdatedAt: scheduleAt, ID: "schedule-500"},
		AttemptCursor:      &Cursor{UpdatedAt: attemptAt, ID: "attempt-500"},
		AttemptCursorBasis: projectionAttemptCursorBasisSubmittedAt})
	mock.ExpectQuery("SELECT payload, revision FROM shared_cache_entries").
		WithArgs(ProjectionCheckpointKey).WillReturnRows(sqlmock.NewRows([]string{"payload", "revision"}).AddRow(string(raw), 2))
	mock.ExpectQuery("SELECT.*EXISTS").WithArgs(scheduleAt, scheduleAt, "schedule-500", attemptAt, attemptAt, "attempt-500").
		WillReturnRows(sqlmock.NewRows([]string{"pending"}).AddRow(true))
	pending, err := HasPendingGradingProjection(context.Background(), db)
	if err != nil || !pending {
		t.Fatalf("pending=%v err=%v", pending, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProjectionPendingLegacyAttemptCursorUsesBootstrapNotWatermark(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC()
	watermark := now.Add(24 * time.Hour)
	legacyCursor := &Cursor{UpdatedAt: watermark, ID: "legacy-updated-at-cursor"}
	raw, _ := json.Marshal(ProjectionState{Watermark: &watermark, AttemptCursor: legacyCursor})
	mock.ExpectQuery("SELECT payload, revision FROM shared_cache_entries").
		WithArgs(ProjectionCheckpointKey).
		WillReturnRows(sqlmock.NewRows([]string{"payload", "revision"}).AddRow(string(raw), 2))
	bootstrap := timeNear{center: now.Add(-ProjectionBootstrapHours * time.Hour)}
	mock.ExpectQuery("SELECT.*EXISTS").
		WithArgs(bootstrap, bootstrap, "", bootstrap, bootstrap, "").
		WillReturnRows(sqlmock.NewRows([]string{"pending"}).AddRow(false))

	pending, err := HasPendingGradingProjection(context.Background(), db)
	if err != nil || pending {
		t.Fatalf("pending=%v err=%v", pending, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProjectionPendingDoesNotHideDatabaseErrors(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()
	mock.ExpectQuery("SELECT payload, revision").WillReturnError(errors.New("database unavailable"))
	if _, err := HasPendingGradingProjection(context.Background(), db); err == nil {
		t.Fatal("unknown projection work was treated as empty")
	}
}
