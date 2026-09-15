package proctor

// EndSectionNow goes through the same sectionAdvance effects as the automatic
// reconciler. The most important consequence: a proctor-ended section's open
// modules are handed to the delivery reconciler through the outbox instead of
// sitting active until the maintenance sweep (the proctor path used to skip
// the handover entirely).

import (
	"context"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/outbox"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func expectEndNowGuardQueries(mock sqlmock.Sqlmock, waiting bool) {
	expectEndNowGuardQueriesWithOpenModules(mock, waiting, 0)
}

// expectEndNowGuardQueriesWithOpenModules is expectEndNowGuardQueries plus the
// §5.1 pre-flight count of the finished section's still-open modules, which
// only runs inside the between-sections window.
func expectEndNowGuardQueriesWithOpenModules(mock sqlmock.Sqlmock, waiting bool, openModules int64) {
	// providerKeyOfSchedule then ieltsAuthenticMode.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT e.provider_key")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key"}).AddRow("act"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT v.config_snapshot")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"config_snapshot"}).AddRow([]byte(`{"general":{}}`)))
	// lockScheduleScope: runtime row + section rows FOR UPDATE (no schedule
	// sweep).
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("rt-1"))
	mock.ExpectQuery(sectionsLock).
		WithArgs("rt-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("sec-1").AddRow("sec-2"))
	// EndSectionNow's locked runtime row (no overrun column — see the shared
	// `commandRuntimeLock` in reconcile_sections_test.go).
	mock.ExpectQuery(commandRuntimeLock).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "active_section_key", "waiting", "revision"}).
			AddRow("rt-1", "live", "reading-writing", waiting, 7))
	// EndSectionNow's locked sections.
	mock.ExpectQuery(sectionsLock).
		WithArgs("rt-1").
		WillReturnRows(sqlmock.NewRows([]string{"section_key", "section_order", "planned_duration_minutes", "extension_minutes", "status"}).
			AddRow("reading-writing", 1, 64, 0, func() string {
				if waiting {
					return "completed"
				}
				return "live"
			}()).
			AddRow("math", 2, 35, 0, "locked"))
	if waiting {
		mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(DISTINCT ma.attempt_id)")).
			WithArgs("sched-1", "reading-writing").
			WillReturnRows(sqlmock.NewRows([]string{"open"}).AddRow(openModules))
	}
}

// A proctor ending a live cohort section completes it, starts the successor,
// writes the control event, and — the fix this pins — hands the finished
// section's open module attempts to delivery instead of leaving them active
// until the maintenance sweep.
func TestEndSectionNowLiveSectionEnqueuesModuleHandover(t *testing.T) {
	svc, mock, outbx := newMockService(t)

	mock.ExpectBegin()
	mock.ExpectExec(setTimeZone).WillReturnResult(sqlmock.NewResult(0, 0))
	expectEndNowGuardQueries(mock, false)
	// Shared advance: complete the row, audit, hand over the open modules.
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtime_sections")).
		WithArgs(sqlmock.AnyArg(), "proctor_end", "rt-1", "reading-writing").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO session_audit_logs")).
		WithArgs(sqlmock.AnyArg(), "sched-1", "admin-1", "SECTION_END", nil, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	// The handover precedes the runtime bump, so it names the current value.
	expectRuntimeRevisionRead(mock, 7)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT ma.attempt_id")).
		WithArgs("sched-1", "reading-writing").
		WillReturnRows(sqlmock.NewRows([]string{"attempt_id"}).AddRow("att-1"))
	// Successor starts now; runtime row clears the waiting window.
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtime_sections")).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "rt-1", "math").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtimes")).
		WithArgs("math", "math", int64(35*60), "rt-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectRuntimeRevisionRead(mock, 8)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts sa")).
		WithArgs("rt-1", "math", "sched-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO session_audit_logs")).
		WithArgs(sqlmock.AnyArg(), "sched-1", "admin-1", "SECTION_START", nil, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO cohort_control_events")).
		WithArgs(sqlmock.AnyArg(), "sched-1", "rt-1", "sched-1", "admin-1", "end_section_now", "reading-writing", nil, nil).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	actor := Actor{ID: "admin-1", Role: RoleAdmin, CSRFVerified: true}
	if err := svc.EndSectionNow(context.Background(), actor, "sched-1", AttemptCommand{}); err != nil {
		t.Fatalf("EndSectionNow: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	if !contains(outbx.families, outbox.FamilySectionAttemptsReconcile) {
		t.Fatalf("a proctor-ended section must hand its open modules to delivery, got %v", outbx.families)
	}
	if !contains(outbx.families, outbox.FamilyRuntimeChanged) {
		t.Fatalf("the advance must wake the runtime, got %v", outbx.families)
	}
}

// Short-cutting the break is refused while the finished section still has open
// modules: their adaptive routing decision has not been made, so opening the
// successor now would race it (plan §5.1's precondition).
func TestEndSectionNowRefusesWhileModulesAreStillFinalizing(t *testing.T) {
	svc, mock, _ := newMockService(t)

	mock.ExpectBegin()
	mock.ExpectExec(setTimeZone).WillReturnResult(sqlmock.NewResult(0, 0))
	expectEndNowGuardQueriesWithOpenModules(mock, true, 1)
	mock.ExpectRollback()

	actor := Actor{ID: "admin-1", Role: RoleAdmin, CSRFVerified: true}
	err := svc.EndSectionNow(context.Background(), actor, "sched-1", AttemptCommand{})
	if err == nil {
		t.Fatal("expected a conflict while a module from the finished section is still open")
	}
	e, ok := apperrors.As(err)
	if !ok || e.Code != apperrors.CodeConflict {
		t.Fatalf("want a 409 conflict, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Ending a section inside the between-sections window (SAT break) must not
// rewrite the already-completed section's recorded end (the gap arithmetic
// depends on it) and must not double-hand over its modules — only the advance
// remains.
func TestEndSectionNowBetweenSectionsAdvancesWithoutRewriting(t *testing.T) {
	svc, mock, outbx := newMockService(t)

	mock.ExpectBegin()
	mock.ExpectExec(setTimeZone).WillReturnResult(sqlmock.NewResult(0, 0))
	expectEndNowGuardQueries(mock, true)
	// SECTION_END audit only — no row UPDATE, no handover query.
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO session_audit_logs")).
		WithArgs(sqlmock.AnyArg(), "sched-1", "admin-1", "SECTION_END", nil, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtime_sections")).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "rt-1", "math").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtimes")).
		WithArgs("math", "math", int64(35*60), "rt-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	// The mocked row value is deliberately not the revision this command
	// predicted (7+1): the wakeup must name what the row actually holds, so a
	// concurrent bump cannot desynchronize the worker's view of the runtime.
	expectRuntimeRevisionRead(mock, 42)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts sa")).
		WithArgs("rt-1", "math", "sched-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO session_audit_logs")).
		WithArgs(sqlmock.AnyArg(), "sched-1", "admin-1", "SECTION_START", nil, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO cohort_control_events")).
		WithArgs(sqlmock.AnyArg(), "sched-1", "rt-1", "sched-1", "admin-1", "end_section_now", "reading-writing", nil, nil).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	actor := Actor{ID: "admin-1", Role: RoleAdmin, CSRFVerified: true}
	if err := svc.EndSectionNow(context.Background(), actor, "sched-1", AttemptCommand{}); err != nil {
		t.Fatalf("EndSectionNow: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	if revision, ok := outbx.revisionFor(outbox.FamilyRuntimeChanged); !ok || revision != 42 {
		t.Fatalf("the wakeup must carry the revision read from the row, got %d (present: %v)", revision, ok)
	}
	for _, family := range outbx.families {
		if family == outbox.FamilySectionAttemptsReconcile {
			t.Fatal("the between-sections window must not double-hand over modules")
		}
	}
	if !contains(outbx.families, outbox.FamilyRuntimeChanged) {
		t.Fatalf("the advance must wake the runtime, got %v", outbx.families)
	}
}
