package delivery

import (
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// C1 RED: sample sink writes exactly 1 async debug row per 1000 hub events
// (deterministic counter, post-commit, never in-tx).
func TestLiveSinkSamplesOneInThousand(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	bus := liveupdates.NewBus(db, "origin-1")
	svc := NewService(db, tx.NewRunner(db)).SetLive("origin-1", liveupdates.NewHub()).SetLiveSink(bus, config.LiveBusSinkSample)
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO live_update_events")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	events := make([]liveupdates.Event, 1000)
	for i := range events {
		events[i] = liveupdates.Event{Kind: liveupdates.KindAttempt, ID: "att-1", Revision: int64(i), Name: "module_started"}
	}
	for _, e := range events {
		svc.publishHubEvents([]liveupdates.Event{e})
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// C1 RED: sink off writes zero rows across 2000 events.
func TestLiveSinkOffWritesNothing(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db)).SetLive("origin-1", liveupdates.NewHub())
	for i := 0; i < 2000; i++ {
		svc.publishHubEvents([]liveupdates.Event{{Kind: liveupdates.KindAttempt, ID: "att-1"}})
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
