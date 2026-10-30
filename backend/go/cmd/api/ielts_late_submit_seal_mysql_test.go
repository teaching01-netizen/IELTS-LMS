package main

// IELTS_LATE_SUBMIT_SEAL: a submit that loses the race with the room's
// natural end finalizes the saved answers exactly as the auto-submit worker
// would, and the worker's seal of the same attempt replays it. Requires an
// isolated, fully migrated TEST_MYSQL_DSN.
import (
	"context"
	"sync"
	"testing"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	examruntime "example.com/ielts-proctoring/internal/runtime"
	"example.com/ielts-proctoring/internal/terminalization"
	"github.com/google/uuid"
)

// lateSealIELTS saves answers on a live room, then ends the room on time as a
// cohort-timed schedule (the model the auto-submit worker seals).
func lateSealIELTS(t *testing.T) (ieltsLoadFixture, ieltsBudgetServices, ieltsLoadCandidate, map[string]string) {
	t.Helper()
	ctx := context.Background()
	f, services := readyContinuityIELTS(t)
	c := f.candidates[0]
	save := attempts.SaveResponsesCommand{AttemptID: c.AttemptID, LeaseEpoch: 1, ControlEpoch: 1, Commands: ieltsBudgetCommands("late", f.questions["reading"], "B")}
	if _, err := services.saver.SaveResponses(ctx, c.Token, save, v2Resolver{}, v2Locker{}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.db.Exec(`UPDATE exam_session_runtimes SET timing_model = ?, status = 'completed', completion_reason = 'time_expired',
		active_section_key = NULL, current_section_key = NULL WHERE schedule_id = ?`, examruntime.TimingModelCohortSection, c.ScheduleID); err != nil {
		t.Fatal(err)
	}
	want := map[string]string{}
	for _, q := range f.questions["reading"] {
		want[q] = "B"
	}
	return f, services, c, want
}

func lateSubmitCmd(c ieltsLoadCandidate) attempts.SubmitCommand {
	return attempts.SubmitCommand{AttemptID: c.AttemptID, LeaseEpoch: 1, ExpectedControlEpoch: 1, SubmissionID: uuid.NewString(), ActorKind: "student"}
}

func countLateSealRows(t *testing.T, f ieltsLoadFixture, attemptID string) (seals, receipts int) {
	t.Helper()
	if err := f.db.QueryRow("SELECT COUNT(*) FROM attempt_terminalizations WHERE attempt_id = ?", attemptID).Scan(&seals); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRow("SELECT COUNT(*) FROM attempt_submissions_v2 WHERE attempt_id = ?", attemptID).Scan(&receipts); err != nil {
		t.Fatal(err)
	}
	return seals, receipts
}

func workerTimeExpiredSeal(ctx context.Context, terminal *terminalization.Service, f ieltsLoadFixture, c ieltsLoadCandidate) (*terminalization.SealResult, error) {
	var generation uint64
	if err := f.db.QueryRow("SELECT terminal_generation FROM student_attempts WHERE id = ?", c.AttemptID).Scan(&generation); err != nil {
		return nil, err
	}
	return terminal.Terminalize(ctx, terminalization.SealCommand{
		AttemptID: c.AttemptID, ScheduleID: c.ScheduleID,
		Outcome: terminalization.OutcomeSubmitted, Reason: terminalization.ReasonTimeExpired,
		ActorKind: terminalization.ActorSystem, FinalSubmission: []byte(`{"autoSubmission":true}`),
		RequestID: uuid.NewString(), ExpectedTerminalGeneration: &generation,
	})
}

func TestIELTSLateSubmitSealsSavedAnswersAfterRoomTimeExpiredMySQL(t *testing.T) {
	ctx := context.Background()
	f, services, c, want := lateSealIELTS(t)
	late := lateSubmitSealer{terminalSealer: services.sealer}

	// Flag off: today's refusal, and nothing is sealed.
	if _, err := services.saver.Submit(ctx, c.Token, lateSubmitCmd(c), v2Resolver{}, v2Locker{}, v2ProviderResolver{}, services.sealer); err == nil {
		t.Fatal("flag off: late submit unexpectedly succeeded")
	} else if appErr, ok := apperrors.As(err); !ok || appErr.HTTPStatus != 422 {
		t.Fatalf("flag off: want 422, got %v", err)
	}

	// New answers after the room ended are never acknowledged.
	withFinal := lateSubmitCmd(c)
	withFinal.FinalCommands = ieltsBudgetCommands("too-late", f.questions["reading"], "C")
	if _, err := services.saver.Submit(ctx, c.Token, withFinal, v2Resolver{}, v2Locker{}, v2ProviderResolver{}, late); err == nil {
		t.Fatal("late final commands unexpectedly accepted")
	}
	if seals, _ := countLateSealRows(t, f, c.AttemptID); seals != 0 {
		t.Fatalf("a refused submit sealed the attempt: %d seals", seals)
	}

	cmd := lateSubmitCmd(c)
	first, err := services.saver.Submit(ctx, c.Token, cmd, v2Resolver{}, v2Locker{}, v2ProviderResolver{}, late)
	if err != nil {
		t.Fatalf("late submit: %v", err)
	}
	if first.Replayed || first.FinalDigest == "" {
		t.Fatalf("late submit result: %+v", first)
	}
	var reason, actor string
	if err := f.db.QueryRow("SELECT reason, actor_kind FROM attempt_terminalizations WHERE attempt_id = ?", c.AttemptID).Scan(&reason, &actor); err != nil {
		t.Fatal(err)
	}
	if reason != terminalization.ReasonTimeExpired || actor != terminalization.ActorSystem {
		t.Fatalf("late seal recorded %s/%s, want the worker's time_expired/system", reason, actor)
	}
	assertIELTSSealedAnswers(t, f, c.AttemptID, want, nil)

	// A lost response retries into the stored receipt.
	replay, err := services.saver.Submit(ctx, c.Token, cmd, v2Resolver{}, v2Locker{}, v2ProviderResolver{}, late)
	if err != nil || !replay.Replayed || replay.FinalDigest != first.FinalDigest {
		t.Fatalf("retry must replay: %+v %v", replay, err)
	}
	// The worker reaching the same attempt afterwards replays, never conflicts.
	res, err := workerTimeExpiredSeal(ctx, services.sealer.materializer, f, c)
	if err != nil || res.Created {
		t.Fatalf("worker after late submit must replay: %+v %v", res, err)
	}
	if seals, receipts := countLateSealRows(t, f, c.AttemptID); seals != 1 || receipts != 1 {
		t.Fatalf("seal/receipt counts %d/%d, want 1/1", seals, receipts)
	}
}

// Whichever of the late submit and the worker takes the attempt lock first,
// the attempt is sealed exactly once and the worker never fails.
func TestIELTSLateSubmitRacesWorkerSealMySQL(t *testing.T) {
	for i := range 5 {
		ctx := context.Background()
		f, services, c, want := lateSealIELTS(t)
		late := lateSubmitSealer{terminalSealer: services.sealer}
		var wg sync.WaitGroup
		var submitErr, workerErr error
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, submitErr = services.saver.Submit(ctx, c.Token, lateSubmitCmd(c), v2Resolver{}, v2Locker{}, v2ProviderResolver{}, late)
		}()
		go func() {
			defer wg.Done()
			_, workerErr = workerTimeExpiredSeal(ctx, services.sealer.materializer, f, c)
		}()
		wg.Wait()
		if workerErr != nil {
			t.Fatalf("run %d: worker seal failed: %v", i, workerErr)
		}
		if submitErr != nil {
			// The worker won: the submit sees a closed attempt, as today.
			if appErr, ok := apperrors.As(submitErr); !ok || appErr.HTTPStatus != 422 {
				t.Fatalf("run %d: submit after worker seal: %v", i, submitErr)
			}
		}
		if seals, _ := countLateSealRows(t, f, c.AttemptID); seals != 1 {
			t.Fatalf("run %d: %d seals, want exactly 1", i, seals)
		}
		assertIELTSSealedAnswers(t, f, c.AttemptID, want, nil)
	}
}
