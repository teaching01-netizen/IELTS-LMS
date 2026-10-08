package integration

import (
	"context"
	"database/sql"
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/proctor"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

func (f *adaptiveExam) usePersonalClock(t *testing.T) {
	t.Helper()
	if _, err := f.db.Exec("UPDATE exam_session_runtimes SET timing_model = 'sat_personal_v1' WHERE schedule_id = ?", f.scheduleID); err != nil {
		t.Fatalf("personal timing: %v", err)
	}
}

func (f *adaptiveExam) modulePaused(t *testing.T, attemptID, moduleID string) (paused bool, accumulated int64, extension int64) {
	t.Helper()
	var at sql.NullTime
	if err := f.db.QueryRow("SELECT paused_at, accumulated_paused_seconds, extension_seconds FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?", attemptID, moduleID).
		Scan(&at, &accumulated, &extension); err != nil {
		t.Fatalf("read module clock: %v", err)
	}
	return at.Valid, accumulated, extension
}

func (f *adaptiveExam) syncPause(t *testing.T, attemptID string) {
	t.Helper()
	err := tx.NewRunner(f.db).WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		return examruntime.SyncSATPauseInTx(ctx, q, f.scheduleID, attemptID)
	})
	if err != nil {
		t.Fatalf("sync pause: %v", err)
	}
}

// F3: effective pause is the union of room and individual pause. Resuming
// one scope while the other is still paused must leave the module frozen.
func TestSATEffectivePauseIsUnionOfRoomAndIndividual(t *testing.T) {
	f := newAdaptiveExam(t)
	f.usePersonalClock(t)
	attemptID := f.seedStudent(f.rw, 0, false)
	svc, actor := f.proctorSvc(), f.proctorActor()
	ctx := context.Background()

	if err := svc.Pause(ctx, actor, f.scheduleID, attemptID, proctor.AttemptCommand{}); err != nil {
		t.Fatalf("individual pause: %v", err)
	}
	if paused, _, _ := f.modulePaused(t, attemptID, f.rw.baseID); !paused {
		t.Fatal("individual pause must freeze the module clock")
	}

	// Room pause on top of the individual pause, then room resume: the
	// individual pause still holds, so nothing may be credited.
	f.db.Exec("UPDATE exam_session_runtimes SET status = 'paused' WHERE schedule_id = ?", f.scheduleID)
	f.syncPause(t, attemptID)
	f.db.Exec("UPDATE exam_session_runtimes SET status = 'live' WHERE schedule_id = ?", f.scheduleID)
	f.syncPause(t, attemptID)
	if paused, acc, _ := f.modulePaused(t, attemptID, f.rw.baseID); !paused || acc != 0 {
		t.Fatalf("room resume must not release an individual pause (paused=%v accumulated=%d)", paused, acc)
	}

	// Individual resume while the room is paused keeps the freeze too.
	f.db.Exec("UPDATE exam_session_runtimes SET status = 'paused' WHERE schedule_id = ?", f.scheduleID)
	f.syncPause(t, attemptID)
	if err := svc.Resume(ctx, actor, f.scheduleID, attemptID, proctor.AttemptCommand{}); err != nil {
		t.Fatalf("individual resume: %v", err)
	}
	if paused, acc, _ := f.modulePaused(t, attemptID, f.rw.baseID); !paused || acc != 0 {
		t.Fatalf("individual resume must not release a room pause (paused=%v accumulated=%d)", paused, acc)
	}

	// Both released: frozen interval is accumulated exactly once; repeated
	// syncs are no-ops.
	f.db.Exec("UPDATE exam_session_runtimes SET status = 'live' WHERE schedule_id = ?", f.scheduleID)
	f.syncPause(t, attemptID)
	paused, acc, _ := f.modulePaused(t, attemptID, f.rw.baseID)
	if paused {
		t.Fatal("module must run once neither scope is paused")
	}
	f.syncPause(t, attemptID)
	if _, again, _ := f.modulePaused(t, attemptID, f.rw.baseID); again != acc {
		t.Fatalf("repeated sync changed accumulated pause %d -> %d", acc, again)
	}
}

// F5: a retried grant (same operation) adds time once; the same operation
// with different minutes conflicts; a new operation is a deliberate new grant.
func TestSATAttemptExtensionReplaySafe(t *testing.T) {
	f := newAdaptiveExam(t)
	f.usePersonalClock(t)
	attemptID := f.seedStudent(f.rw, 0, false)
	svc, actor := f.proctorSvc(), f.proctorActor()
	ctx := context.Background()
	cmd := proctor.AttemptCommand{OperationID: "op-grant-1", ModuleID: f.rw.baseID}

	for i := 0; i < 2; i++ {
		if err := svc.ExtendAttempt(ctx, actor, f.scheduleID, attemptID, 5, cmd); err != nil {
			t.Fatalf("grant attempt %d: %v", i, err)
		}
	}
	if _, _, ext := f.modulePaused(t, attemptID, f.rw.baseID); ext != 300 {
		t.Fatalf("replayed grant must add 300s once, got %d", ext)
	}

	err := svc.ExtendAttempt(ctx, actor, f.scheduleID, attemptID, 7, cmd)
	if ae, ok := apperrors.As(err); !ok || ae.HTTPStatus != 409 {
		t.Fatalf("same operation with different minutes must conflict, got %v", err)
	}
	if _, _, ext := f.modulePaused(t, attemptID, f.rw.baseID); ext != 300 {
		t.Fatalf("conflicting replay changed the clock: %d", ext)
	}

	cmd.OperationID = "op-grant-2"
	if err := svc.ExtendAttempt(ctx, actor, f.scheduleID, attemptID, 5, cmd); err != nil {
		t.Fatalf("deliberate second grant: %v", err)
	}
	if _, _, ext := f.modulePaused(t, attemptID, f.rw.baseID); ext != 600 {
		t.Fatalf("a new operation must add again, got %d", ext)
	}
}
