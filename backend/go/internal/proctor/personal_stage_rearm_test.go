package proctor

// The proctor half of the SAT entry remedy.
//
// The automatic arm path refuses a fresh offer once admission has closed and
// once a stage's retry budget is spent, and both refusals tell the candidate to
// "ask the proctor to re-arm" (ADMISSION_CLOSED / ENTRY_RETRY_EXHAUSTED). Until
// this command existed that instruction had no implementation anywhere: the
// module attempt's entry_generation only ever incremented, so a candidate who
// missed every offer in a room that was still live stayed stranded for the rest
// of the session.
//
// These drive the real service over the real statements, so they pin the whole
// contract: the stage is reset (offer cleared, generation 0, a grant stamped),
// the grant is audited and published to the room, and a stage the candidate
// already entered — or one with an accepted response — is refused, because a
// grant must never hand out authored time twice.

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// personalRearmPrologue stages the authorization + scope + terminal-guard
// sequence every per-attempt proctor command runs before it touches a stage.
// Admins skip the assignment lookup, so no live-assignment read is staged.
func personalRearmPrologue(mock sqlmock.Sqlmock, timingModel string) {
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone = '+00:00'")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("att-1"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id, active_section_key FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "active_section_key"}).AddRow("rt-1", nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT submitted_at, COALESCE(proctor_status,'active'), COALESCE(delivery_status,'running') FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"submitted_at", "proctor_status", "delivery_status"}).AddRow(nil, "active", "running"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT e.provider_key FROM exam_schedules s JOIN exam_entities e ON e.id = s.exam_id WHERE s.id = ?")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key"}).AddRow("sat"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT timing_model FROM exam_session_runtimes WHERE schedule_id = ?")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"timing_model"}).AddRow(timingModel))
}

func TestReArmAttemptStageResetsAnUnenteredModuleOffer(t *testing.T) {
	svc, mock, outbx := newMockService(t)
	admin := Actor{ID: "admin-1", Role: RoleAdmin, CSRFVerified: true}

	personalRearmPrologue(mock, "sat_personal_v1")
	// The stage: unentered, unsent, missable. The reset clears the offer and the
	// generation and stamps the grant in one statement, so the arm path cannot
	// observe a half-reset stage.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT state, module_id, entry_entered_at FROM assessment_module_attempts WHERE id = ? AND attempt_id = ? FOR UPDATE")).
		WithArgs("ma-1", "att-1").
		WillReturnRows(sqlmock.NewRows([]string{"state", "module_id", "entry_entered_at"}).AddRow("not_started", "mod-1", nil))
	mock.ExpectQuery("SELECT EXISTS\\(SELECT 1 FROM assessment_question_responses WHERE module_attempt_id = \\?\\)").
		WithArgs("ma-1", "att-1", "mod-1").
		WillReturnRows(sqlmock.NewRows([]string{"has_response"}).AddRow(false))
	// Matched as a whole: a reset that dropped the grant (or left the old offer
	// and generation in place) must fail here rather than silently re-arm the
	// same bound the candidate is stuck behind.
	mock.ExpectExec("(?s)UPDATE assessment_module_attempts.*"+
		"entry_starts_at = NULL, entry_confirmed_at = NULL, entry_entered_at = NULL,.*"+
		"entry_generation = 0, entry_proctor_rearm_at = UTC_TIMESTAMP\\(6\\).*"+
		"WHERE id = \\? AND attempt_id = \\? AND state IN \\('not_started', 'active'\\) AND entry_entered_at IS NULL").
		WithArgs("ma-1", "att-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, target_student_id, payload, created_at)")).
		WithArgs(sqlmock.AnyArg(), "sched-1", "admin-1", "STAGE_REARMED", "att-1", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	reason := "device could not paint the offer"
	if err := svc.ReArmAttemptStage(context.Background(), admin, "sched-1", "att-1", "ma-1", "", AttemptCommand{Reason: &reason}); err != nil {
		t.Fatalf("re-arm module: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	// The room learns: a roster_changed + attempt_changed pair rides the same
	// transaction as the reset, so a proctor panel cannot keep showing the old
	// state, and the payload names the stage that was granted.
	if len(outbx.families) != 2 || outbx.families[0] != "roster_changed" || outbx.families[1] != "attempt_changed" {
		t.Fatalf("re-arm must publish exactly the roster pair, got %v", outbx.families)
	}
	// The pair differs only in its event: the caller's event on the roster
	// broadcast, and the attempt_changed the student panel keys on.
	if !strings.Contains(outbx.payloads[0], `"event":"rearm_stage"`) || !strings.Contains(outbx.payloads[1], `"event":"attempt_changed"`) {
		t.Fatalf("the pair must announce the re-arm and the attempt change, got %v", outbx.payloads)
	}
	for i := range outbx.payloads {
		if !strings.Contains(outbx.payloads[i], `"attemptId":"att-1"`) {
			t.Fatalf("payload %d must name the attempt, got %s", i, outbx.payloads[i])
		}
	}
	if !strings.Contains(outbx.payloads[0], `"stageId":"ma-1"`) || !strings.Contains(outbx.payloads[0], `"stage":"module"`) {
		t.Fatalf("the grant must name the stage it re-armed, got %s", outbx.payloads[0])
	}
}

func TestReArmAttemptStageResetsAnUnenteredBreak(t *testing.T) {
	svc, mock, _ := newMockService(t)
	admin := Actor{ID: "admin-1", Role: RoleAdmin, CSRFVerified: true}

	personalRearmPrologue(mock, "sat_personal_v1")
	// An armed break whose offer the candidate never confirmed: the reset sends
	// it back to pending with no offer, no clock and a fresh budget.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT state, entry_entered_at FROM assessment_attempt_breaks WHERE id = ? AND attempt_id = ? FOR UPDATE")).
		WithArgs("br-1", "att-1").
		WillReturnRows(sqlmock.NewRows([]string{"state", "entry_entered_at"}).AddRow("armed", nil))
	mock.ExpectExec("(?s)UPDATE assessment_attempt_breaks.*"+
		"SET state = 'pending', starts_at = NULL, deadline_at = NULL, entered_at = NULL, paused_at = NULL,.*"+
		"entry_generation = 0, entry_proctor_rearm_at = UTC_TIMESTAMP\\(6\\).*"+
		"WHERE id = \\? AND attempt_id = \\? AND state <> 'completed' AND entry_entered_at IS NULL").
		WithArgs("br-1", "att-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, target_student_id, payload, created_at)")).
		WithArgs(sqlmock.AnyArg(), "sched-1", "admin-1", "STAGE_REARMED", "att-1", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	if err := svc.ReArmAttemptStage(context.Background(), admin, "sched-1", "att-1", "", "br-1", AttemptCommand{}); err != nil {
		t.Fatalf("re-arm break: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestReArmAttemptStageRefusesAStageTheCandidateAlreadyEntered(t *testing.T) {
	svc, mock, _ := newMockService(t)
	admin := Actor{ID: "admin-1", Role: RoleAdmin, CSRFVerified: true}

	personalRearmPrologue(mock, "sat_personal_v1")
	entered := time.Now().UTC().Add(-time.Minute)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT state, module_id, entry_entered_at FROM assessment_module_attempts WHERE id = ? AND attempt_id = ? FOR UPDATE")).
		WithArgs("ma-1", "att-1").
		WillReturnRows(sqlmock.NewRows([]string{"state", "module_id", "entry_entered_at"}).AddRow("active", "mod-1", entered))
	// No UPDATE is staged: sqlmock fails on any unexpected statement, so a reset
	// that leaked past the entered guard would surface as an error, not a
	// silently re-armed clock.
	mock.ExpectRollback()

	err := svc.ReArmAttemptStage(context.Background(), admin, "sched-1", "att-1", "ma-1", "", AttemptCommand{})
	if err == nil {
		t.Fatal("a stage the candidate has already entered must not be re-armed")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestReArmAttemptStageRefusesAStageWithAnAcceptedResponse(t *testing.T) {
	svc, mock, _ := newMockService(t)
	admin := Actor{ID: "admin-1", Role: RoleAdmin, CSRFVerified: true}

	personalRearmPrologue(mock, "sat_personal_v1")
	mock.ExpectQuery(regexp.QuoteMeta("SELECT state, module_id, entry_entered_at FROM assessment_module_attempts WHERE id = ? AND attempt_id = ? FOR UPDATE")).
		WithArgs("ma-1", "att-1").
		WillReturnRows(sqlmock.NewRows([]string{"state", "module_id", "entry_entered_at"}).AddRow("not_started", "mod-1", nil))
	mock.ExpectQuery("SELECT EXISTS\\(SELECT 1 FROM assessment_question_responses WHERE module_attempt_id = \\?\\)").
		WithArgs("ma-1", "att-1", "mod-1").
		WillReturnRows(sqlmock.NewRows([]string{"has_response"}).AddRow(true))
	mock.ExpectRollback()

	err := svc.ReArmAttemptStage(context.Background(), admin, "sched-1", "att-1", "ma-1", "", AttemptCommand{})
	if err == nil {
		t.Fatal("a stage with an accepted response must never have its timer reset")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A shared-clock SAT session has no per-candidate offer to re-arm — the stage
// the proctor actually needs to move there is the section.
func TestReArmAttemptStageRefusesSharedClockSessions(t *testing.T) {
	svc, mock, _ := newMockService(t)
	admin := Actor{ID: "admin-1", Role: RoleAdmin, CSRFVerified: true}

	personalRearmPrologue(mock, "cohort_section_v3")
	mock.ExpectRollback()

	err := svc.ReArmAttemptStage(context.Background(), admin, "sched-1", "att-1", "ma-1", "", AttemptCommand{})
	if err == nil {
		t.Fatal("a cohort-timed SAT session must refuse a per-stage re-arm")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestReArmAttemptStageRequiresExactlyOneStage(t *testing.T) {
	svc, mock, _ := newMockService(t)
	admin := Actor{ID: "admin-1", Role: RoleAdmin, CSRFVerified: true}

	for _, target := range [][2]string{{"", ""}, {"ma-1", "br-1"}} {
		if err := svc.ReArmAttemptStage(context.Background(), admin, "sched-1", "att-1", target[0], target[1], AttemptCommand{}); err == nil {
			t.Fatalf("re-arm with module=%q break=%q must be refused before any write", target[0], target[1])
		}
	}
	// Nothing opened a transaction: the request is invalid, not unauthorized.
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
