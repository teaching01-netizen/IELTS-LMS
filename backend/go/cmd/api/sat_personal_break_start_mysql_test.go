package main

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
	"github.com/google/uuid"
)

// The attempt-owned scheduled break starts only when its screen confirms a
// server-issued future start, so a slow Verbal → break transition never
// consumes the authored break; Math becomes eligible at the break's actual
// deadline (docs/sat_break.md).
func TestSATPersonalBreakStartsOnConfirmationMySQL(t *testing.T) {
	for _, tc := range []struct {
		name         string
		breakSeconds int
		recovery     bool
	}{
		{name: "automatic", breakSeconds: 60},
		{name: "recovery-policy", breakSeconds: 60, recovery: true},
		{name: "zero-duration", breakSeconds: 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			forms := separateForms()
			off := false
			math := forms.SectionEntry["math"]
			math.Enabled = &off
			forms.SectionEntry["math"] = math
			f := newFormsFixture(t, forms)
			ctx := context.Background()
			exec := func(query string, args ...any) {
				t.Helper()
				if _, err := f.db.Exec(query, args...); err != nil {
					t.Fatal(err)
				}
			}
			mathSection, mathModule := uuid.NewString(), uuid.NewString()
			exec("UPDATE assessment_sections SET break_after_seconds=? WHERE exam_version_id=? AND section_key='reading-writing'", tc.breakSeconds, f.versionID)
			exec("INSERT INTO assessment_sections (id,exam_version_id,section_key,title,display_order,duration_seconds,break_after_seconds,instructions,tool_policy) VALUES (?,?,'math','Math',1,120,0,'{\"version\":1,\"nodes\":[]}','[]')", mathSection, f.versionID)
			exec("INSERT INTO assessment_modules (id,section_id,module_key,title,display_order,duration_seconds,target_question_count,adaptive_role,instructions,tool_policy) VALUES (?,?,'math-m1','Math module 1',0,120,0,'base','{\"version\":1,\"nodes\":[]}','[]')", mathModule, mathSection)
			c, cred, candidate := f.sectionOwner(t)
			if _, err := f.app.Forms.SubmitSectionEntry(ctx, cred, "reading-writing", sectionCommand("verbal", f.versionID, `{"goal":"Read carefully"}`)); err != nil {
				t.Fatal(err)
			}
			if _, err := f.start(candidate, f.code(t).Value); err != nil {
				t.Fatal(err)
			}
			for i := 0; i < 2; i++ {
				exec("UPDATE assessment_module_attempts SET started_at=TIMESTAMPADD(SECOND,-2000,UTC_TIMESTAMP(6)) WHERE attempt_id=? AND state='active'", c.attemptID)
				if _, err := f.app.Delivery.ReconcileAttemptTimeout(ctx, f.scheduleID, c.attemptID, time.Now().UTC()); err != nil {
					t.Fatal(err)
				}
			}
			mathRow := func() (state string, available sql.NullTime) {
				t.Helper()
				if err := f.db.QueryRow("SELECT state,available_at FROM assessment_module_attempts WHERE attempt_id=? AND module_id=?", c.attemptID, mathModule).Scan(&state, &available); err != nil {
					t.Fatal(err)
				}
				return state, available
			}
			if tc.breakSeconds == 0 {
				if n := f.count(t, "SELECT COUNT(*) FROM assessment_attempt_breaks WHERE attempt_id=?", c.attemptID); n != 0 {
					t.Fatalf("zero-duration break recorded %d rows", n)
				}
				if state, _ := mathRow(); state != "active" {
					t.Fatalf("zero-duration break did not hand off to Math: %s", state)
				}
				return
			}

			// Verbal finished: the break is pending and Math is withheld with
			// no eligibility instant yet.
			var breakID, breakState string
			if err := f.db.QueryRow("SELECT id,state FROM assessment_attempt_breaks WHERE attempt_id=?", c.attemptID).Scan(&breakID, &breakState); err != nil {
				t.Fatal(err)
			}
			if state, available := mathRow(); breakState != "pending" || state != "not_started" || available.Valid {
				t.Fatalf("break=%s math=%s available=%v; want pending break and withheld Math", breakState, state, available)
			}
			if _, err := f.app.Delivery.StartModule(ctx, f.scheduleID, c.attemptID, f.scheduleID, mathModule, candidate.session, candidate.token); formReasonOf(err) != "PERSONAL_BREAK_PENDING" {
				t.Fatalf("Math entry during a preparing break: %v", err)
			}

			// A replacement lead outside 3–12 seconds is refused before any write.
			tooShort := 2
			if _, err := f.app.Delivery.StartBreak(ctx, f.scheduleID, c.attemptID, f.scheduleID, breakID, &delivery.BreakStartRequest{LeadSeconds: &tooShort}, candidate.session, candidate.token); !isAppCode(err, apperrors.CodeValidation) {
				t.Fatalf("lead 2s accepted: %v", err)
			}
			if n := f.count(t, "SELECT entry_generation FROM assessment_attempt_breaks WHERE id=?", breakID); n != 0 {
				t.Fatalf("refused lead armed the break: generation %d", n)
			}
			lead := 5
			if _, err := f.app.Delivery.StartBreak(ctx, f.scheduleID, c.attemptID, f.scheduleID, breakID, &delivery.BreakStartRequest{LeadSeconds: &lead}, candidate.session, candidate.token); err != nil {
				t.Fatal(err)
			}
			var leadMicros int64
			if err := f.db.QueryRow("SELECT TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(6), entry_starts_at) FROM assessment_attempt_breaks WHERE id=?", breakID).Scan(&leadMicros); err != nil {
				t.Fatal(err)
			}
			if leadMicros < 4_000_000 || leadMicros > 5_000_000 {
				t.Fatalf("offer lead %dus, want about 5s", leadMicros)
			}
			// A duplicate arm while the offer is still in the future keeps it.
			if _, err := f.app.Delivery.StartBreak(ctx, f.scheduleID, c.attemptID, f.scheduleID, breakID, nil, candidate.session, candidate.token); err != nil {
				t.Fatal(err)
			}
			if n := f.count(t, "SELECT entry_generation FROM assessment_attempt_breaks WHERE id=?", breakID); n != 1 {
				t.Fatalf("duplicate arm replaced the offer: generation %d", n)
			}

			enter := func() {
				t.Helper()
				if _, err := f.app.Delivery.EnterBreak(ctx, f.scheduleID, c.attemptID, f.scheduleID, delivery.BreakEntryRequest{BreakID: breakID, Generation: 1}, candidate.session, candidate.token); err != nil {
					t.Fatal(err)
				}
			}
			window := func() (startsAt, deadline time.Time) {
				t.Helper()
				if err := f.db.QueryRow("SELECT starts_at,deadline_at FROM assessment_attempt_breaks WHERE id=? AND state='active'", breakID).Scan(&startsAt, &deadline); err != nil {
					t.Fatal(err)
				}
				return startsAt, deadline
			}
			enter()
			startsAt, deadline := window()
			if got := deadline.Sub(startsAt); got != time.Duration(tc.breakSeconds)*time.Second {
				t.Fatalf("confirmed window %v, want the full %ds", got, tc.breakSeconds)
			}
			// A replayed confirmation (lost response) keeps the same deadline.
			enter()
			if s2, d2 := window(); !s2.Equal(startsAt) || !d2.Equal(deadline) {
				t.Fatalf("replayed confirmation moved the break: %v→%v %v→%v", startsAt, s2, deadline, d2)
			}

			// A pause before the confirmed start moves the start and deadline
			// together, so the full break still follows the same lead.
			runner := tx.NewRunner(f.db)
			sync := func(status string) {
				t.Helper()
				exec("UPDATE student_attempts SET proctor_status=? WHERE id=?", status, c.attemptID)
				if err := runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
					return examruntime.SyncSATPauseInTx(ctx, q, f.scheduleID, c.attemptID)
				}); err != nil {
					t.Fatal(err)
				}
			}
			sync("paused")
			exec("UPDATE assessment_attempt_breaks SET paused_at=TIMESTAMPADD(SECOND,-100,paused_at) WHERE id=?", breakID)
			sync("active")
			s3, d3 := window()
			if shift := s3.Sub(startsAt); shift < 100*time.Second || shift > 102*time.Second {
				t.Fatalf("pre-start pause shifted the start by %v, want about 100s", shift)
			}
			if got := d3.Sub(s3); got != time.Duration(tc.breakSeconds)*time.Second {
				t.Fatalf("pre-start pause changed the break length to %v", got)
			}

			if tc.recovery {
				exec("UPDATE exam_schedules SET sat_delivery_policy=? WHERE id=?", `{"version":"sat_recovery_v1","recoverySeconds":120,"entryRecoverySeconds":120,"lateAnswerPolicy":"frozen_arrival_window"}`, f.scheduleID)
				exec("INSERT INTO assessment_module_boundaries (module_attempt_id,attempt_id,phase,policy_version) SELECT id,attempt_id,'preparing','sat_recovery_v1' FROM assessment_module_attempts WHERE attempt_id=? AND module_id=? ON DUPLICATE KEY UPDATE module_attempt_id=module_attempt_id", c.attemptID, mathModule)
			}
			// The confirmed break runs out: completion makes Math eligible from
			// that actual deadline in the same transaction.
			exec("UPDATE assessment_attempt_breaks SET starts_at=TIMESTAMPADD(SECOND,-61,UTC_TIMESTAMP(6)),deadline_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(6)) WHERE id=?", breakID)
			_, finalDeadline := window()
			if _, err := f.app.Delivery.ReconcileAttemptTimeout(ctx, f.scheduleID, c.attemptID, time.Now().UTC()); err != nil {
				t.Fatal(err)
			}
			if err := f.db.QueryRow("SELECT state FROM assessment_attempt_breaks WHERE id=?", breakID).Scan(&breakState); err != nil || breakState != "completed" {
				t.Fatalf("expired break not completed: %s %v", breakState, err)
			}
			state, available := mathRow()
			if !available.Valid || !available.Time.Equal(finalDeadline) {
				t.Fatalf("Math available_at=%v, want the break deadline %v", available, finalDeadline)
			}
			if tc.recovery {
				if state != "not_started" {
					t.Fatalf("recovery policy auto-started Math: %s", state)
				}
				var entryDeadline sql.NullTime
				if err := f.db.QueryRow("SELECT b.entry_deadline_at FROM assessment_module_boundaries b JOIN assessment_module_attempts ma ON ma.id=b.module_attempt_id WHERE ma.attempt_id=? AND ma.module_id=?", c.attemptID, mathModule).Scan(&entryDeadline); err != nil {
					t.Fatal(err)
				}
				if !entryDeadline.Valid || !entryDeadline.Time.Equal(finalDeadline.Add(120*time.Second)) {
					t.Fatalf("entry allowance %v, want break deadline + 120s", entryDeadline)
				}
				return
			}
			if state != "active" {
				t.Fatalf("Math did not open automatically after the break: %s", state)
			}
		})
	}
}

func isAppCode(err error, code apperrors.Code) bool {
	appErr, ok := apperrors.As(err)
	return ok && appErr.Code == code
}
