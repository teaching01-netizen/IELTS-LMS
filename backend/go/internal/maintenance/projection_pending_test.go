package maintenance

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

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
		ScheduleCursor: &Cursor{UpdatedAt: scheduleAt, ID: "schedule-500"},
		AttemptCursor:  &Cursor{UpdatedAt: attemptAt, ID: "attempt-500"}})
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

func TestProjectionPendingDoesNotHideDatabaseErrors(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()
	mock.ExpectQuery("SELECT payload, revision").WillReturnError(errors.New("database unavailable"))
	if _, err := HasPendingGradingProjection(context.Background(), db); err == nil {
		t.Fatal("unknown projection work was treated as empty")
	}
}
