package delivery

import (
	"context"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// Module 2 (the adaptive branch module) has to be startable through the same
// endpoint as Module 1 — the client now opens it automatically on the Module 1
// timeout hand-off, and the whole point of reading these rows before shipping
// that is to prove the server admits the start rather than assume it.
//
// The branch module's timing stage under a section-keyed cohort model is its
// SECTION key (`reading-writing`), not a `:m2` suffix — the suffix belongs to
// cohort_stage_v2, which has no in-repo writer. These two cases pin both halves:
// the branch role passes the gate under a live section, and the same call is
// still refused when the section is not the active one.

// deliveryCohortModuleMetadata stages the module metadata read after the start
// transaction has already locked and captured the cohort runtime snapshot.
func deliveryCohortModuleMetadata(
	mock sqlmock.Sqlmock,
	moduleSectionKey, adaptiveRole string,
	authoredSeconds int,
) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT s.section_key, m.adaptive_role, m.duration_seconds FROM assessment_modules m JOIN assessment_sections s")).
		WithArgs("mod-1").
		WillReturnRows(sqlmock.NewRows([]string{"section_key", "adaptive_role", "duration_seconds"}).
			AddRow(moduleSectionKey, adaptiveRole, authoredSeconds))
}

// deliveryCohortSectionGate stages the rest of moduleTimingGateTx once the stage
// identity matched: the section clock row (status `status`) and the
// authoritative in-tx time read (SAT-006).
func deliveryCohortSectionGate(mock sqlmock.Sqlmock, status, sectionKey string, startedAt time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtime_sections rs JOIN exam_session_runtimes r")).
		WithArgs("sched-1", sectionKey).
		WillReturnRows(sqlmock.NewRows([]string{"status", "actual_start_at", "paused_at", "planned_duration_minutes", "extension_minutes", "accumulated_paused_seconds"}).
			AddRow(status, startedAt, nil, 35, 0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(time.Now().UTC()))
}

// A higher_branch module with its section live starts: the gate admits it, the
// not_started -> active CAS runs, and the module-started events publish.
func TestDeliveryStartBranchModuleUnderLiveCohortSection(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()

	deliveryStartModuleBinding(mock)
	deliveryReconcileDrained(mock)
	deliverySaveBegin(mock)
	deliveryModuleStartWorkableTx(mock, examruntime.TimingModelCohortSection, "reading-writing")
	deliveryModuleRow(mock, "not_started", now)
	deliveryCohortModuleMetadata(mock, "reading-writing", "higher_branch", 1920)
	deliveryCohortSectionGate(mock, "live", "reading-writing", now.Add(-time.Minute))
	// The CAS is the assertion: sqlmock fails the test unless this statement was
	// actually issued with the module row's id, i.e. the branch module passed the
	// gate and transitioned not_started -> active. The window it is given is the
	// room's (the section's own clock for the branch module); the exact arithmetic
	// is pinned by the cohort module-window tests and by the unit tests over the
	// pure rule.
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts SET state = 'active'")).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "ma-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET phase = 'exam'")).
		WithArgs("att-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	deliveryMaxRevision(mock, 7)
	deliveryBusPairInsert(mock, "attempt", "att-1", "sat_module_started", 7,
		"schedule_roster", "sched-1", "sat_module_started", 7)
	mock.ExpectCommit()
	deliveryBootstrapLoads(mock, now)

	out, err := svc.StartModule(context.Background(), "sched-1", "att-1", "sched-1", "mod-1", "sess-test", "tok-1")
	if err != nil {
		t.Fatalf("expected the branch module to start under a live section, got %v", err)
	}
	if out == nil || out.Attempt.ID != "att-1" || out.ScheduleID != "sched-1" {
		t.Fatalf("unexpected bootstrap payload %+v", out)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The same branch module is refused while another section is the active stage:
// the automatic Module 2 hand-off must never open a module the server would
// reject, and this is what the client's stage gate mirrors.
func TestDeliveryStartBranchModuleRefusedWhenSectionNotActive(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()

	deliveryStartModuleBinding(mock)
	deliveryReconcileDrained(mock)
	deliverySaveBegin(mock)
	deliveryModuleStartWorkableTx(mock, examruntime.TimingModelCohortSection, "math")
	deliveryModuleRow(mock, "not_started", now)
	// The module belongs to reading-writing while math is the active stage: the
	// gate refuses before it ever reads the section clock.
	deliveryCohortModuleMetadata(mock, "reading-writing", "lower_branch", 1920)
	// No clock read, no CAS, no phase update, no events: the tx rolls back with
	// the module still not_started.
	mock.ExpectRollback()

	_, err = svc.StartModule(context.Background(), "sched-1", "att-1", "sched-1", "mod-1", "sess-test", "tok-1")
	if deliveryCodeOf(err) != apperrors.CodeAssessmentConflict {
		t.Fatalf("expected CONFLICT on a branch module outside the active stage, got %v", err)
	}
	if appErr, ok := apperrors.As(err); ok {
		// The stable reason rides in Details (assessmentConflict), not the
		// student-facing message.
		if appErr.Details["reason"] != "SECTION_NOT_ACTIVE" {
			t.Fatalf("expected the SECTION_NOT_ACTIVE reason, got %v", appErr.Details["reason"])
		}
	} else {
		t.Fatalf("expected *apperrors.Error, got %T", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
