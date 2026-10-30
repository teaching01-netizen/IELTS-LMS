package schedules

import (
	"context"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

func withIELTSFlags(t *testing.T, personal, shared bool) {
	t.Helper()
	oldPersonal, oldShared := ieltsPersonalTimingEnabled, ieltsSharedScheduleEnabled
	ieltsPersonalTimingEnabled = func() bool { return personal }
	ieltsSharedScheduleEnabled = func() bool { return shared }
	t.Cleanup(func() { ieltsPersonalTimingEnabled, ieltsSharedScheduleEnabled = oldPersonal, oldShared })
}

func persistIELTSChoice(t *testing.T, providerKey string, expectModel string) error {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	if expectModel != "" {
		mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_schedules SET ielts_timing_model = ? WHERE id = ?")).
			WithArgs(expectModel, "sched-1").WillReturnResult(sqlmock.NewResult(0, 1))
		mock.ExpectCommit()
	} else {
		mock.ExpectRollback()
	}
	err = tx.NewRunner(db).WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		return PersistIeltsTimingChoice(ctx, q, "sched-1", providerKey)
	})
	if expectModel != "" {
		if mErr := mock.ExpectationsWereMet(); mErr != nil {
			t.Fatal(mErr)
		}
	}
	return err
}

func TestPersistIeltsTimingChoiceSelectsSharedSchedule(t *testing.T) {
	withIELTSFlags(t, false, true)
	if err := persistIELTSChoice(t, "ielts", examruntime.TimingModelIELTSSharedSchedule); err != nil {
		t.Fatal(err)
	}
}

func TestPersistIeltsTimingChoiceRejectsConflictingFlags(t *testing.T) {
	withIELTSFlags(t, true, true)
	err := persistIELTSChoice(t, "ielts", "")
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Details["reason"] != "IELTS_TIMING_FLAGS_CONFLICT" {
		t.Fatalf("conflicting flags must fail closed, got %v", err)
	}
}

func TestResolveTimingModelKeepsSharedScheduleIELTSOnly(t *testing.T) {
	if got := examruntime.ResolveTimingModel("ielts", examruntime.TimingModelIELTSSharedSchedule); got != examruntime.TimingModelIELTSSharedSchedule {
		t.Fatalf("ielts resolved %s", got)
	}
	for _, provider := range []string{"sat", "act"} {
		if got := examruntime.ResolveTimingModel(provider, examruntime.TimingModelIELTSSharedSchedule); got == examruntime.TimingModelIELTSSharedSchedule {
			t.Fatalf("%s accepted the IELTS shared model", provider)
		}
	}
}
