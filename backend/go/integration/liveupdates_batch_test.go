package integration

import (
	"context"
	"testing"

	"example.com/ielts-proctoring/internal/liveupdates"
	"github.com/google/uuid"
)

func TestSATModuleUpdatePairCommitsAndPollsAcrossInstancesMySQL(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	origin := "sat-batch-" + uuid.NewString()
	reader := liveupdates.NewBus(db, "sat-reader-"+uuid.NewString())
	attemptID, scheduleID := uuid.NewString(), uuid.NewString()
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, "DELETE FROM live_update_events WHERE origin_instance_id = ?", origin)
	})

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := liveupdates.AppendPairInTx(ctx, tx, origin,
		liveupdates.Event{Kind: liveupdates.KindAttempt, ID: attemptID, Revision: 7, Name: "module_started"},
		liveupdates.Event{Kind: liveupdates.KindScheduleRoster, ID: scheduleID, Revision: 7, Name: "module_started"},
	); err != nil {
		_ = tx.Rollback()
		t.Fatalf("append related module events: %v", err)
	}
	var visibleBeforeCommit int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM live_update_events WHERE origin_instance_id = ?", origin).Scan(&visibleBeforeCommit); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if visibleBeforeCommit != 0 {
		_ = tx.Rollback()
		t.Fatalf("uncommitted event rows visible to peer instance: %d", visibleBeforeCommit)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	var firstSequence int64
	if err := db.QueryRowContext(ctx,
		"SELECT MIN(sequence_id) FROM live_update_events WHERE origin_instance_id = ?", origin).Scan(&firstSequence); err != nil {
		t.Fatal(err)
	}
	if firstSequence <= 0 {
		t.Fatalf("committed event sequence = %d, want positive", firstSequence)
	}
	events, err := reader.PollNew(ctx, firstSequence-1, liveupdates.PollLimit)
	if err != nil {
		t.Fatalf("poll committed events from peer instance: %v", err)
	}
	var got []liveupdates.Event
	for _, event := range events {
		if event.Origin == origin {
			got = append(got, event)
		}
	}
	if len(got) != 2 {
		t.Fatalf("peer received %d related events, want 2", len(got))
	}
	if got[0].SequenceID >= got[1].SequenceID || got[0].Kind != liveupdates.KindAttempt || got[0].ID != attemptID ||
		got[1].Kind != liveupdates.KindScheduleRoster || got[1].ID != scheduleID ||
		got[0].Revision != 7 || got[1].Revision != 7 || got[0].Name != "module_started" || got[1].Name != "module_started" {
		t.Fatalf("peer event pair changed ordering or payload: %+v", got)
	}
}
