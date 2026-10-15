package main

import (
	"context"
	"sync"
	"testing"

	"example.com/ielts-proctoring/internal/exams"
	"github.com/google/uuid"
)

// This runs against InnoDB when TEST_MYSQL_DSN is set. The shared operation
// key must linearize concurrent duplicate creates to one committed exam.
func TestSATExamCreateIdempotencyRaceMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	provider := exams.ProviderSAT
	req := exams.CreateRequest{
		OperationKey: uuid.NewString(),
		Slug:         h.actor + "-create-retry",
		Title:        "SAT create retry race",
		ExamType:     exams.ExamTypeAcademic,
		Visibility:   exams.VisibilityPrivate,
		OwnerID:      h.actor,
		ProviderKey:  &provider,
	}
	t.Cleanup(func() {
		var examID string
		if err := h.db.QueryRow("SELECT id FROM exam_entities WHERE slug = ?", req.Slug).Scan(&examID); err == nil {
			if err := h.exams.Delete(context.Background(), examID); err != nil {
				t.Errorf("delete idempotent create: %v", err)
			}
		}
		if _, err := h.db.Exec("DELETE FROM authoring_operation_keys WHERE actor_id = ? AND scope = 'exam-create' AND operation_key = ?", h.actor, req.OperationKey); err != nil {
			t.Errorf("delete idempotent create receipt: %v", err)
		}
	})
	const racers = 8
	start := make(chan struct{})
	ready := make(chan struct{}, racers)
	type result struct {
		id  string
		err error
	}
	results := make(chan result, racers)
	var wg sync.WaitGroup
	for range racers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ready <- struct{}{}
			<-start
			exam, err := h.exams.Create(context.Background(), req)
			results <- result{id: exam.ID, err: err}
		}()
	}
	for range racers {
		<-ready
	}
	close(start)
	wg.Wait()
	close(results)

	winnerID := ""
	for outcome := range results {
		if outcome.err != nil {
			t.Fatalf("concurrent retry failed: %v", outcome.err)
		}
		if winnerID == "" {
			winnerID = outcome.id
		}
		if outcome.id != winnerID {
			t.Fatalf("same operation returned different exam ids: %q and %q", winnerID, outcome.id)
		}
	}
	if winnerID == "" {
		t.Fatal("no create result returned an exam id")
	}
	var examRows, createEvents, operationRows, completedRows int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM exam_entities WHERE id = ?", winnerID).Scan(&examRows); err != nil {
		t.Fatal(err)
	}
	if err := h.db.QueryRow("SELECT COUNT(*) FROM exam_events WHERE exam_id = ? AND action = 'created'", winnerID).Scan(&createEvents); err != nil {
		t.Fatal(err)
	}
	if err := h.db.QueryRow("SELECT COUNT(*) FROM authoring_operation_keys WHERE actor_id = ? AND scope = 'exam-create' AND operation_key = ?", h.actor, req.OperationKey).Scan(&operationRows); err != nil {
		t.Fatal(err)
	}
	if err := h.db.QueryRow("SELECT COUNT(*) FROM authoring_operation_keys WHERE actor_id = ? AND scope = 'exam-create' AND operation_key = ? AND result_json IS NOT NULL", h.actor, req.OperationKey).Scan(&completedRows); err != nil {
		t.Fatal(err)
	}
	if examRows != 1 || createEvents != 1 || operationRows != 1 || completedRows != 1 {
		t.Fatalf("persisted create outcome: exams=%d events=%d operation keys=%d completed keys=%d, want 1 each", examRows, createEvents, operationRows, completedRows)
	}
}
