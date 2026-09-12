package main

// Real-DB concurrency proof for SAT authoring mutations (plan Slice 4).
// sqlmock pins the SQL contract; only InnoDB row locks prove the races.
// Gated on TEST_MYSQL_DSN with a unique actor + exam per run and cleanup,
// mirroring contracts_mysql_test.go.
import (
	"context"
	"database/sql"
	"os"
	"sync"
	"testing"

	"example.com/ielts-proctoring/internal/authoring"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

type concurrencyHarness struct {
	db      *sql.DB
	authors *authoring.Service
	exams   *exams.Service
	actor   string
	examID  string
}

func newConcurrencyHarness(t *testing.T) *concurrencyHarness {
	t.Helper()
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN not set; requires isolated MySQL")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	runner := tx.NewRunner(db)
	examService := exams.NewService(db, runner)
	authors := authoring.NewService(db, runner)
	actor := "race-" + uuid.NewString()
	provider := "sat"
	exam, err := examService.Create(context.Background(), exams.CreateRequest{Slug: actor, Title: "Concurrency proof", ExamType: "Academic", Visibility: "private", ProviderKey: &provider, OwnerID: actor})
	if err != nil {
		t.Fatal(err)
	}
	h := &concurrencyHarness{db: db, authors: authors, exams: examService, actor: actor, examID: exam.ID}
	t.Cleanup(func() {
		if _, err := db.Exec("DELETE FROM exam_schedules WHERE exam_id = ?", exam.ID); err != nil {
			t.Error(err)
		}
		if err := examService.Delete(context.Background(), exam.ID); err != nil {
			t.Error(err)
		}
		if _, err := db.Exec("DELETE FROM assessment_questions WHERE created_by = ?", actor); err != nil {
			t.Error(err)
		}
	})
	return h
}

func (h *concurrencyHarness) firstModule(t *testing.T) (string, int) {
	t.Helper()
	shell, err := h.authors.Shell(context.Background(), h.examID)
	if err != nil {
		t.Fatal(err)
	}
	module := shell.Sections[0].Modules[0]
	return module.ID, module.TargetQuestionCount
}

func isRaceRejection(err error) bool {
	if err == nil {
		return false
	}
	e, ok := apperrors.As(err)
	if !ok {
		return false
	}
	switch e.Code {
	case apperrors.CodeConflict, apperrors.CodeVersionCollision, apperrors.CodeControlEpochStale, apperrors.CodeAssessmentConflict, apperrors.CodeValidation:
		return true
	}
	return false
}

// Final-slot race: fill the module to target-1, then race R creates at the
// last slot. Exactly one wins; every loser is rejected; the module never
// exceeds target_question_count.
func TestAuthoringFinalSlotRaceMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	ctx := context.Background()
	moduleID, target := h.firstModule(t)
	if target < 2 {
		t.Fatalf("need target >= 2 for a final-slot race, got %d", target)
	}
	for i := 0; i < target-1; i++ {
		if _, err := h.authors.CreateQuestion(ctx, moduleID, h.actor, authoring.QuestionDraft{}); err != nil {
			t.Fatalf("prefill %d: %v", i, err)
		}
	}
	const racers = 4
	var wg sync.WaitGroup
	outcomes := make(chan error, racers)
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := h.authors.CreateQuestion(ctx, moduleID, h.actor, authoring.QuestionDraft{})
			outcomes <- err
		}()
	}
	wg.Wait()
	close(outcomes)
	wins, losses := 0, 0
	for err := range outcomes {
		if err == nil {
			wins++
		} else if isRaceRejection(err) {
			losses++
		} else {
			t.Fatalf("unexpected race error: %v", err)
		}
	}
	if wins != 1 || losses != racers-1 {
		t.Fatalf("final-slot race: %d wins %d losses, want 1 win %d losses", wins, losses, racers-1)
	}
	var count int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM assessment_exam_questions WHERE module_id = ?", moduleID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != target {
		t.Fatalf("module holds %d questions, want exactly target %d", count, target)
	}
}

// Bulk rollback: a bulk patch whose fencing fails on one id must change
// nothing -- no partial pretest flips survive.
func TestAuthoringBulkRollbackMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	ctx := context.Background()
	moduleID, _ := h.firstModule(t)
	first, err := h.authors.CreateQuestion(ctx, moduleID, h.actor, authoring.QuestionDraft{})
	if err != nil {
		t.Fatal(err)
	}
	second, err := h.authors.CreateQuestion(ctx, moduleID, h.actor, authoring.QuestionDraft{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = h.authors.BulkQuestions(ctx,
		[]string{first.ExamQuestionID, second.ExamQuestionID},
		authoring.BulkAction{Type: "set_pretest", PretestValue: true},
		h.actor,
		map[string]int{first.ExamQuestionID: first.Question.Revision, second.ExamQuestionID: second.Question.Revision + 1000},
	)
	if !isRaceRejection(err) {
		t.Fatalf("stale bulk must conflict, got: %v", err)
	}
	for _, id := range []string{first.ExamQuestionID, second.ExamQuestionID} {
		got, err := h.authors.GetQuestion(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if got.IsPretest {
			t.Fatalf("bulk rollback leaked a pretest flip on %s", id)
		}
	}
}

// Publish-vs-edit interleave: an edit racing a fenced publish either lands
// fully before the publish (publish sees it) or conflicts after it -- the
// publish fence revision must never silently skip a committed edit.
func TestAuthoringPublishVsEditMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	ctx := context.Background()
	moduleID, _ := h.firstModule(t)
	created, err := h.authors.CreateQuestion(ctx, moduleID, h.actor, authoring.QuestionDraft{})
	if err != nil {
		t.Fatal(err)
	}
	shell, err := h.authors.Shell(ctx, h.examID)
	if err != nil {
		t.Fatal(err)
	}
	draftID := shell.VersionID
	draftRev := shell.VersionRevision
	type editResult struct {
		rev int
		err error
	}
	editCh := make(chan editResult, 1)
	go func() {
		out, err := h.authors.SaveRevision(ctx, created.ExamQuestionID, created.Question.ID, created.Question.Revision, authoring.QuestionDraft{
			QuestionType: created.Question.QuestionType,
			Stimulus:     created.Question.Stimulus,
			Prompt:       created.Question.Prompt,
			Answer:       created.Question.Answer,
			Rationale:    created.Question.Rationale,
			Metadata:     created.Question.Metadata,
		}, h.actor)
		if err != nil {
			editCh <- editResult{err: err}
			return
		}
		editCh <- editResult{rev: out.Revision}
	}()
	_, pubErr := h.exams.Publish(ctx, h.examID, h.actor, exams.PublishRequest{Revision: 0, ExpectedDraftVersionID: &draftID, ExpectedDraftRevision: &draftRev})
	edit := <-editCh
	if edit.err != nil {
		t.Fatalf("racing edit failed: %v", edit.err)
	}
	if pubErr == nil {
		after, err := h.authors.Shell(ctx, h.examID)
		if err != nil {
			t.Fatal(err)
		}
		if after.VersionRevision <= draftRev {
			t.Fatalf("post-publish draft revision %d did not advance past fence %d", after.VersionRevision, draftRev)
		}
	} else if !isRaceRejection(pubErr) {
		t.Fatalf("publish lost the race with a non-fence error: %v", pubErr)
	}
}

// Idempotent replay on real InnoDB: same key + same payload returns the
// original outcome without a second row; same key + different payload is a
// conflict, never a second mutation.
func TestAuthoringIdempotentReplayMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	ctx := context.Background()
	moduleID, _ := h.firstModule(t)
	key := "replay-" + uuid.NewString()
	first, err := h.authors.CreateQuestion(ctx, moduleID, h.actor, authoring.QuestionDraft{}, authoring.WithOperationKey(key))
	if err != nil {
		t.Fatal(err)
	}
	again, err := h.authors.CreateQuestion(ctx, moduleID, h.actor, authoring.QuestionDraft{}, authoring.WithOperationKey(key))
	if err != nil {
		t.Fatalf("identical retry must replay, got: %v", err)
	}
	if again.ExamQuestionID != first.ExamQuestionID {
		t.Fatalf("replay minted a second question: %s vs %s", again.ExamQuestionID, first.ExamQuestionID)
	}
	if _, err := h.authors.CreateQuestion(ctx, moduleID, h.actor, authoring.QuestionDraft{QuestionType: "spr"}, authoring.WithOperationKey(key)); !isRaceRejection(err) {
		t.Fatalf("key reuse with different payload must conflict, got: %v", err)
	}
}
