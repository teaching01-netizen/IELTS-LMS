package attempts

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func recoveryControlFixture() examdomain.RecoveryControl {
	return examdomain.RecoveryControl{
		Version:           examdomain.RecoveryControlVersion,
		ID:                "control-1",
		Phase:             examdomain.RecoveryPhaseHeld,
		ActiveGrantID:     "grant-1",
		OriginalSessionID: "sess-original",
		Target:            examdomain.RecoveryTarget{SectionKey: "reading-writing", ModuleAttemptID: "ma-1", ModuleID: "m-1"},
	}
}

func TestReadRecoveryAuthority(t *testing.T) {
	raw, err := json.Marshal(recoveryControlFixture())
	if err != nil {
		t.Fatal(err)
	}
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery("FROM student_attempts WHERE id").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"recovery_control", "active_client_session_id", "lease_epoch", "control_epoch", "terminal_generation", "writer_policy"}).
			AddRow(string(raw), nil, 7, 4, 1, nil))

	authority, err := ReadRecoveryAuthority(context.Background(), db, "att-1")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if authority.Control == nil || authority.Control.Phase != examdomain.RecoveryPhaseHeld {
		t.Fatalf("control = %+v", authority.Control)
	}
	if !authority.Held() || authority.Working() {
		t.Fatal("held projection is wrong")
	}
	if authority.LeaseEpoch != 7 || authority.ControlEpoch != 4 || authority.TerminalGeneration != 1 {
		t.Fatalf("authority = %+v", authority)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestReadRecoveryAuthorityMalformedControlFailsClosed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery("FROM student_attempts WHERE id").
		WillReturnRows(sqlmock.NewRows([]string{"recovery_control", "active_client_session_id", "lease_epoch", "control_epoch", "terminal_generation", "writer_policy"}).
			AddRow(`{"version":"staff_recovery_v1"}`, nil, 7, 4, 1, nil))

	if _, err := ReadRecoveryAuthority(context.Background(), db, "att-1"); !errors.Is(err, examdomain.ErrRecoveryControlMalformed) {
		t.Fatalf("err = %v, want malformed control", err)
	}
}

func TestFenceForRecoveryInTx(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	runner := tx.NewRunner(db)

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("UPDATE student_attempts").
		WithArgs(sqlmock.AnyArg(), "att-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT lease_epoch, control_epoch FROM student_attempts").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"lease_epoch", "control_epoch"}).AddRow(8, 5))
	mock.ExpectExec("UPDATE attempt_sessions").
		WithArgs("att-1").
		WillReturnResult(sqlmock.NewResult(0, 3))
	mock.ExpectExec("UPDATE attempt_device_transfers").
		WithArgs("att-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	var lease, control uint64
	err = runner.WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		var ferr error
		lease, control, ferr = FenceForRecoveryInTx(ctx, q, "att-1", recoveryControlFixture())
		return ferr
	})
	if err != nil {
		t.Fatalf("fence: %v", err)
	}
	if lease != 8 || control != 5 {
		t.Fatalf("epochs = %d/%d, want 8/5", lease, control)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestActivateRecoveryInTx(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	runner := tx.NewRunner(db)

	control := recoveryControlFixture()
	control.Phase = examdomain.RecoveryPhaseWorking
	control.FocusRunGeneration = 2
	deadline := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	control.FocusDeadlineAt = &deadline
	control.Suspended = []examdomain.SuspendedRecoveryStage{{
		Target: examdomain.RecoveryTarget{SectionKey: "math"}, State: "active", RemainingSeconds: 120,
	}}

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("UPDATE student_attempts").
		WithArgs(sqlmock.AnyArg(), "client-new", "att-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT lease_epoch, control_epoch FROM student_attempts").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"lease_epoch", "control_epoch"}).AddRow(9, 6))
	mock.ExpectExec("UPDATE attempt_sessions").
		WithArgs("att-1").
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectCommit()

	var lease, controlEpoch uint64
	err = runner.WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		var aerr error
		lease, controlEpoch, aerr = ActivateRecoveryInTx(ctx, q, "att-1", "client-new", control)
		return aerr
	})
	if err != nil {
		t.Fatalf("activate: %v", err)
	}
	if lease != 9 || controlEpoch != 6 {
		t.Fatalf("epochs = %d/%d, want 9/6", lease, controlEpoch)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestActivateRecoveryInTxRefusesNonWorkingControl(t *testing.T) {
	control := recoveryControlFixture()
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, _, err = ActivateRecoveryInTx(context.Background(), db, "att-1", "client-new", control)
	if !errors.Is(err, ErrRecoveryControlState) {
		t.Fatalf("err = %v, want ErrRecoveryControlState", err)
	}
}

func TestFenceForRecoveryInTxRefusesWorkingControl(t *testing.T) {
	control := recoveryControlFixture()
	control.Phase = examdomain.RecoveryPhaseWorking
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, _, err = FenceForRecoveryInTx(context.Background(), db, "att-1", control)
	if !errors.Is(err, ErrRecoveryControlState) {
		t.Fatalf("err = %v, want ErrRecoveryControlState", err)
	}
}

func TestAuthorizeRecoveryFocus(t *testing.T) {
	control := recoveryControlFixture()
	control.Phase = examdomain.RecoveryPhaseWorking
	control.FocusRunGeneration = 3
	matching := control.Target

	tests := []struct {
		name      string
		control   *examdomain.RecoveryControl
		sessionID string
		target    examdomain.RecoveryTarget
		run       uint64
		want      error
	}{
		{"matching focus", &control, "sess-target", matching, 3, nil},
		{"no control", nil, "sess-target", matching, 3, ErrNoRecoveryControl},
		{"held refuses", &examdomain.RecoveryControl{Phase: examdomain.RecoveryPhaseHeld}, "sess-target", matching, 3, ErrRecoveryHeld},
		{"returning refuses", &examdomain.RecoveryControl{Phase: examdomain.RecoveryPhaseReturning}, "sess-target", matching, 3, ErrRecoveryHeld},
		{"missing session", &control, "  ", matching, 3, ErrRecoveryFocus},
		{"other stage", &control, "sess-target", examdomain.RecoveryTarget{SectionKey: "math", ModuleAttemptID: "ma-2", ModuleID: "m-2"}, 3, ErrRecoveryFocus},
		{"stale run", &control, "sess-target", matching, 2, ErrRecoveryRunStale},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := AuthorizeRecoveryFocus(tc.control, tc.sessionID, tc.target, tc.run); !errors.Is(got, tc.want) && !(got == nil && tc.want == nil) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestRecoveryControlFromRow(t *testing.T) {
	raw, err := json.Marshal(recoveryControlFixture())
	if err != nil {
		t.Fatal(err)
	}
	control, err := RecoveryControlFromRow(raw)
	if err != nil || control == nil || control.ID != "control-1" {
		t.Fatalf("control = %+v, err = %v", control, err)
	}
	if control, err := RecoveryControlFromRow(nil); err != nil || control != nil {
		t.Fatalf("absent row control = %+v, err = %v", control, err)
	}
}
