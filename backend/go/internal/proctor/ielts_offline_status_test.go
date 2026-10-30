package proctor

import (
	"context"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// The roster reports only the newest verified package section per device and
// the unreviewed evidence count, from two page-bounded lookups. Presence is
// diagnostic: sessions without either read as zero values.
func TestAttachIELTSOfflineRosterStatesHydratesNewestPreparationAndEvidence(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Date(2026, 10, 30, 3, 5, 0, 0, time.UTC)
	mock.ExpectQuery("SELECT attempt_id, section_key, ready_at FROM ielts_section_readiness").
		WithArgs("rt-1", "att-1", "att-2").
		WillReturnRows(sqlmock.NewRows([]string{"attempt_id", "section_key", "ready_at"}).
			AddRow("att-1", "reading", now).
			AddRow("att-1", "listening", now.Add(-time.Hour)))
	mock.ExpectQuery("SELECT attempt_id, COUNT\\(\\*\\) FROM attempt_draft_evidence").
		WithArgs("att-1", "att-2").
		WillReturnRows(sqlmock.NewRows([]string{"attempt_id", "pending"}).AddRow("att-2", 2))

	sessions := []StudentSessionSummary{{AttemptID: "att-1"}, {AttemptID: "att-2"}}
	runtime := SessionRuntime{ID: "rt-1", TimingModel: examruntime.TimingModelIELTSSharedSchedule}
	if err := attachIELTSOfflineRosterStates(context.Background(), db, runtime, sessions); err != nil {
		t.Fatal(err)
	}
	if sessions[0].IELTSOfflinePreparedSection == nil || *sessions[0].IELTSOfflinePreparedSection != "reading" {
		t.Fatalf("newest prepared section = %+v", sessions[0].IELTSOfflinePreparedSection)
	}
	if sessions[0].IELTSOfflinePreparedAt == nil || !sessions[0].IELTSOfflinePreparedAt.Equal(now) {
		t.Fatalf("prepared at = %+v", sessions[0].IELTSOfflinePreparedAt)
	}
	if sessions[1].IELTSOfflinePreparedSection != nil || sessions[1].IELTSOfflinePreparedAt != nil {
		t.Fatalf("unprepared session must stay empty: %+v", sessions[1])
	}
	if sessions[1].DraftEvidencePending != 2 || sessions[0].DraftEvidencePending != 0 {
		t.Fatalf("evidence counts = %d/%d", sessions[0].DraftEvidencePending, sessions[1].DraftEvidencePending)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Other timing models never pay for the visibility queries.
func TestAttachIELTSOfflineRosterStatesSkipsOtherModels(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	sessions := []StudentSessionSummary{{AttemptID: "att-1"}}
	runtime := SessionRuntime{ID: "rt-1", TimingModel: examruntime.TimingModelIELTSPersonal}
	if err := attachIELTSOfflineRosterStates(context.Background(), db, runtime, sessions); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
