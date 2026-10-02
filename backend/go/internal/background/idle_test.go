package background

import (
	"context"
	"errors"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/sat"
	"example.com/ielts-proctoring/internal/student"
	"github.com/DATA-DOG/go-sqlmock"
)

func TestPendingWorkUsesDurableState(t *testing.T) {
	for _, reason := range []string{"live_or_paused_exam", "unfinished_attempt", "outbox", "sat_provisional_completion", ""} {
		t.Run(reason, func(t *testing.T) {
			pool, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer pool.Close()
			w := &Runner{db: pool, sat: sat.NewService(pool, nil, nil, nil)}
			checks := []struct{ reason, pattern string }{
				{"live_or_paused_exam", "SELECT EXISTS.*exam_session_runtimes WHERE status IN"},
				{"unfinished_attempt", "SELECT EXISTS.*student_attempts a JOIN exam_session_runtimes"},
				// No due-at/lease predicate: future retries still require a live worker.
				{"outbox", "SELECT EXISTS\\(SELECT 1 FROM outbox_events WHERE published_at IS NULL AND failed_at IS NULL\\)"},
				{"sat_provisional_completion", "SELECT EXISTS.*assessment_module_attempts"},
			}
			for _, check := range checks {
				mock.ExpectQuery(check.pattern).WillReturnRows(sqlmock.NewRows([]string{"pending"}).AddRow(check.reason == reason))
				if check.reason == reason {
					break
				}
			}
			got, err := w.PendingReason(context.Background())
			if err != nil || got != reason {
				t.Fatalf("pending = %q, %v; want %q", got, err, reason)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestEligibilityErrorsRefuseIdle(t *testing.T) {
	pool, mock, _ := sqlmock.New()
	defer pool.Close()
	mock.ExpectQuery("SELECT EXISTS").WillReturnError(errors.New("unavailable"))
	if _, err := (&Runner{db: pool}).PendingReason(context.Background()); err == nil {
		t.Fatal("unknown state allowed sleep")
	}
}

func TestDrainPresenceFailureRetainsActualAPIMap(t *testing.T) {
	pool, mock, _ := sqlmock.New()
	defer pool.Close()
	service := student.NewService(nil, nil).SetPresence(student.NewPresenceMap(time.Minute))
	service.PresenceMap().RememberMutation("attempt", "mutation")
	service.PresenceMap().Touch("attempt", "schedule", "client", "disconnect", time.Now().UTC())
	w := (&Runner{cfg: config.Config{PresenceMode: config.PresenceMemory}, student: student.NewService(pool, nil)}).WithPresence(service.PresenceMap())
	mock.ExpectExec("INSERT INTO student_heartbeat_events").WillReturnError(errors.New("unavailable"))
	if err := w.FlushPresence(context.Background()); err == nil {
		t.Fatal("flush failure hidden")
	}
	if len(service.PresenceMap().DrainDirty()) != 1 {
		t.Fatal("failed batch lost")
	}
}
