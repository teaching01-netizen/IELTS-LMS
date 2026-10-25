package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/assessmentforms"
	"example.com/ielts-proctoring/internal/assessmentforms/definition"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"github.com/google/uuid"
)

const sectionCommonAnswers = `{"sat_admission_year":2027,"sat_seat_number":"A-007"}`

func separateForms() definition.Forms {
	f := definition.DefaultSectionSATForms()
	f.SectionEntry["reading-writing"] = definition.SectionEntry{Fields: []definition.Field{{ID: "goal", Type: definition.TypeText, Label: "Verbal goal", Required: true, MaxLength: 100}}}
	return f
}

func (f formsFixture) sectionOwner(t *testing.T) (formsCandidate, assessmentforms.Credential, codeStartCandidate) {
	t.Helper()
	c := f.prepare(t)
	token, err := f.admit(c, registration(f.versionID, sectionCommonAnswers))
	if err != nil {
		t.Fatal(err)
	}
	claims, err := crypto.VerifyAttemptToken([]byte(f.app.Config.AuthSecret), time.Now().UTC(), token)
	if err != nil {
		t.Fatal(err)
	}
	var session string
	if err := f.db.QueryRow("SELECT client_session_id FROM attempt_sessions WHERE token_id=?", claims.TokenID).Scan(&session); err != nil {
		t.Fatal(err)
	}
	if _, err := f.app.Delivery.Bootstrap(context.Background(), f.scheduleID, c.attemptID, f.scheduleID); err != nil {
		t.Fatal(err)
	}
	return c, assessmentforms.Credential{TokenID: claims.TokenID, UserID: claims.UserID, ScheduleID: claims.ScheduleID, AttemptID: claims.AttemptID, LeaseEpoch: claims.LeaseEpoch}, codeStartCandidate{attemptID: c.attemptID, session: session, token: claims.TokenID}
}

func sectionCommand(op, version, answers string) assessmentforms.SubmitSectionEntryCommand {
	return assessmentforms.SubmitSectionEntryCommand{OperationID: op, VersionID: version, Answers: json.RawMessage(answers)}
}

func TestSeparateSectionFormsGateCodeAndSealMySQL(t *testing.T) {
	f := newFormsFixture(t, separateForms())
	ctx := context.Background()
	c, cred, candidate := f.sectionOwner(t)
	state, err := f.app.Forms.SectionEntryFor(ctx, f.scheduleID, c.attemptID, "reading-writing")
	if err != nil || state.State != "required" || !state.CanSubmit {
		t.Fatalf("first Verbal gate: %+v %v", state, err)
	}
	math, err := f.app.Forms.SectionEntryFor(ctx, f.scheduleID, c.attemptID, "math")
	if err != nil || math.State != "waiting" || len(math.Fields) != 0 {
		t.Fatalf("future Math must stay hidden: %+v %v", math, err)
	}
	code := f.code(t)
	if _, err := f.start(candidate, code.Value); formReasonOf(err) != "SECTION_FORM_REQUIRED" {
		t.Fatalf("raw code start bypassed form: %v", err)
	}
	if n := f.count(t, "SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id=? AND started_at IS NOT NULL", c.attemptID); n != 0 {
		t.Fatal("refused start consumed exam time")
	}
	if n := f.count(t, "SELECT COUNT(*) FROM student_attempts WHERE id=? AND sat_start_code_accepted_at IS NOT NULL", c.attemptID); n != 0 {
		t.Fatal("refused start committed code redemption")
	}
	if _, err := f.app.Forms.SubmitSectionEntry(ctx, cred, "reading-writing", sectionCommand("bad", f.versionID, `{}`)); codeOf(err) != apperrors.CodeValidation {
		t.Fatalf("required field: %v", err)
	}
	cmd := sectionCommand("verbal-submit", f.versionID, `{"goal":"Improve reading"}`)
	ack, err := f.app.Forms.SubmitSectionEntry(ctx, cred, "reading-writing", cmd)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := f.app.Forms.SubmitSectionEntry(ctx, cred, "reading-writing", cmd)
	if err != nil || !ack.FirstSubmittedAt.Equal(replay.FirstSubmittedAt) {
		t.Fatalf("replay changed submission: %+v %v", replay, err)
	}
	if _, err := f.app.Forms.SubmitSectionEntry(ctx, cred, "reading-writing", sectionCommand("changed", f.versionID, `{"goal":"Replace answer"}`)); formReasonOf(err) != "SECTION_FORM_ALREADY_SUBMITTED" {
		t.Fatalf("sealed answer replaced: %v", err)
	}
	if n := f.count(t, "SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id=? AND started_at IS NOT NULL", c.attemptID); n != 0 {
		t.Fatal("form submission started a clock")
	}
	if _, err := f.start(candidate, code.Value); err != nil {
		t.Fatalf("accepted form must allow normal code entry: %v", err)
	}
	if n := f.count(t, "SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id=? AND started_at IS NOT NULL", c.attemptID); n != 1 {
		t.Fatal("entry did not start exactly one module")
	}
	// Same-section routing keeps its configured automatic M2 behavior and
	// must not recollect the accepted Verbal form.
	if _, err := f.db.Exec("UPDATE assessment_module_attempts SET started_at=TIMESTAMPADD(SECOND,-2000,UTC_TIMESTAMP(6)) WHERE attempt_id=? AND module_id=?", c.attemptID, f.baseID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.app.Delivery.ReconcileAttemptTimeout(ctx, f.scheduleID, c.attemptID, time.Now().UTC()); err != nil {
		t.Fatalf("route at timeout: %v", err)
	}
	next, err := f.app.Delivery.Bootstrap(ctx, f.scheduleID, c.attemptID, f.scheduleID)
	if err != nil {
		t.Fatalf("routed M2: %v", err)
	}
	if next == nil || f.count(t, "SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id=? AND state='active'", c.attemptID) != 1 {
		t.Fatal("same-section M2 did not activate")
	}
	after, err := f.app.Forms.SectionEntryFor(ctx, f.scheduleID, c.attemptID, "reading-writing")
	if err != nil || after.State != "submitted" {
		t.Fatalf("M2 recollected Verbal: %+v %v", after, err)
	}
	rows, err := f.app.Forms.ListResponses(ctx, assessmentforms.Viewer{All: true}, assessmentforms.ListFilter{ScheduleID: f.scheduleID, FormKey: "verbal_entry"})
	if err != nil || len(rows.Items) != 1 || rows.Items[0].Status != "submitted" || rows.Items[0].Mode != nil {
		t.Fatalf("Verbal response list: %+v %v", rows, err)
	}
	detail, err := f.app.Forms.ResponseDetailFor(ctx, assessmentforms.Viewer{All: true}, c.attemptID, "verbal_entry")
	if err != nil || detail.Answers["goal"] != "Improve reading" {
		t.Fatalf("Verbal response detail: %+v %v", detail, err)
	}
}

func TestSectionFormBreakRecoveryAndClosureMySQL(t *testing.T) {
	f := newFormsFixture(t, separateForms())
	ctx := context.Background()
	c, cred, _ := f.sectionOwner(t)
	var sectionID string
	if err := f.db.QueryRow("SELECT section_id FROM assessment_modules WHERE id=?", f.baseID).Scan(&sectionID); err != nil {
		t.Fatal(err)
	}
	// Selected-module-only Math sitting: its first delivered module can be M2.
	mathSection, moduleID, maID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := f.db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("INSERT INTO assessment_sections (id,exam_version_id,section_key,title,display_order,duration_seconds,break_after_seconds,instructions,tool_policy) VALUES (?,?,'math','Math',1,120,0,'{}','[]')", mathSection, f.versionID)
	exec("INSERT INTO assessment_modules (id,section_id,module_key,title,display_order,duration_seconds,target_question_count,adaptive_role,instructions,tool_policy) VALUES (?,?,'math-m2','Math module 2',1,120,0,'lower_branch','{}','[]')", moduleID, mathSection)
	exec("INSERT INTO assessment_module_attempts (id,attempt_id,module_id,state,allocated_seconds,tool_state) VALUES (?,?,?,'not_started',120,'{}')", maID, c.attemptID, moduleID)
	exec("INSERT INTO assessment_attempt_breaks (id,attempt_id,after_section_id,state,duration_seconds,starts_at,deadline_at) VALUES (?,?,?,'active',60,UTC_TIMESTAMP(6),TIMESTAMPADD(SECOND,60,UTC_TIMESTAMP(6)))", uuid.NewString(), c.attemptID, sectionID)
	st, err := f.app.Forms.SectionEntryFor(ctx, f.scheduleID, c.attemptID, "math")
	if err != nil || st.State != "waiting" || len(st.Fields) != 0 {
		t.Fatalf("break must hide Math questions: %+v %v", st, err)
	}
	if _, err := f.app.Forms.SubmitSectionEntry(ctx, cred, "math", sectionCommand("early", f.versionID, `{"sat_expected_class":"rank_2"}`)); err == nil {
		t.Fatal("early raw Math submission accepted")
	}
	exec("UPDATE assessment_attempt_breaks SET state='completed',deadline_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(6)) WHERE attempt_id=?", c.attemptID)
	exec("UPDATE exam_schedules SET status='live',sat_delivery_policy=? WHERE id=?", `{"version":"sat_recovery_v1","recoverySeconds":120,"entryRecoverySeconds":120,"lateAnswerPolicy":"frozen_arrival_window"}`, f.scheduleID)
	exec("UPDATE student_attempts SET sat_start_code_required=0 WHERE id=?", c.attemptID)
	st, err = f.app.Forms.SectionEntryFor(ctx, f.scheduleID, c.attemptID, "math")
	if err != nil || st.State != "required" || st.ModuleID != moduleID {
		t.Fatalf("selected M2 must receive Math form: %+v %v", st, err)
	}
	ack, err := f.app.Forms.SubmitSectionEntry(ctx, cred, "math", sectionCommand("math", f.versionID, `{"sat_expected_class":"rank_2"}`))
	if err != nil {
		t.Fatal(err)
	}
	var deadline time.Time
	var started, available sql.NullTime
	if err := f.db.QueryRow("SELECT b.entry_deadline_at,ma.started_at,ma.available_at FROM assessment_module_boundaries b JOIN assessment_module_attempts ma ON ma.id=b.module_attempt_id WHERE ma.id=?", maID).Scan(&deadline, &started, &available); err != nil {
		t.Fatal(err)
	}
	if started.Valid || available.Valid || deadline.Sub(ack.FirstSubmittedAt) < 119*time.Second {
		t.Fatalf("form must anchor recovery without starting working time: %v %v %v", deadline, started, available)
	}
	exec("UPDATE exam_schedules SET status='completed',eva_sim_closed_at=UTC_TIMESTAMP(6) WHERE id=?", f.scheduleID)
	// A committed operation still replays after closure; a new operation cannot write.
	if _, err := f.app.Forms.SubmitSectionEntry(ctx, cred, "math", sectionCommand("math", f.versionID, `{"sat_expected_class":"rank_2"}`)); err != nil {
		t.Fatalf("committed receipt lost on closure: %v", err)
	}
	if _, err := f.app.Forms.SubmitSectionEntry(ctx, cred, "math", sectionCommand("after-end", f.versionID, `{"sat_expected_class":"rank_2"}`)); formReasonOf(err) != "SECTION_FORM_CLOSED" {
		t.Fatalf("End did not close form writes: %v", err)
	}
}

func TestSectionFormEndFenceMySQL(t *testing.T) {
	f := newFormsFixture(t, separateForms())
	ctx := context.Background()
	_, cred, _ := f.sectionOwner(t)
	lock, err := f.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback()
	if _, err := lock.Exec("SELECT id FROM exam_schedules WHERE id=? FOR UPDATE", f.scheduleID); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := f.app.Forms.SubmitSectionEntry(ctx, cred, "reading-writing", sectionCommand("race", f.versionID, `{"goal":"Before closure"}`))
		done <- err
	}()
	select {
	case err := <-done:
		t.Fatalf("submit did not wait for room fence: %v", err)
	case <-time.After(200 * time.Millisecond):
	}
	if _, err := lock.Exec("UPDATE exam_schedules SET status='completed',eva_sim_closed_at=UTC_TIMESTAMP(6) WHERE id=?", f.scheduleID); err != nil {
		t.Fatal(err)
	}
	if err := lock.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := <-done; formReasonOf(err) != "SECTION_FORM_CLOSED" {
		t.Fatalf("write after End won: %v", err)
	}
	if n := f.count(t, "SELECT COUNT(*) FROM assessment_form_responses WHERE attempt_id=? AND form_key='verbal_entry'", cred.AttemptID); n != 0 {
		t.Fatal("closed form response committed")
	}
}

func TestSectionFormMathHandoffMySQL(t *testing.T) {
	for _, breakSeconds := range []int{0, 60} {
		t.Run((time.Duration(breakSeconds) * time.Second).String(), func(t *testing.T) {
			f := newFormsFixture(t, separateForms())
			ctx := context.Background()
			exec := func(query string, args ...any) {
				t.Helper()
				if _, err := f.db.Exec(query, args...); err != nil {
					t.Fatal(err)
				}
			}
			mathSection, mathModule := uuid.NewString(), uuid.NewString()
			exec("UPDATE assessment_sections SET break_after_seconds=? WHERE exam_version_id=? AND section_key='reading-writing'", breakSeconds, f.versionID)
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
			var state string
			var started, available, auto sql.NullTime
			checkWaiting := func() {
				t.Helper()
				if err := f.db.QueryRow("SELECT state,started_at,available_at,auto_start_at FROM assessment_module_attempts WHERE attempt_id=? AND module_id=?", c.attemptID, mathModule).Scan(&state, &started, &available, &auto); err != nil {
					t.Fatal(err)
				}
				if state != "not_started" || started.Valid || available.Valid || auto.Valid {
					t.Fatalf("Math started before explicit entry: %s %v %v %v", state, started, available, auto)
				}
			}
			checkWaiting()
			if breakSeconds > 0 {
				st, err := f.app.Forms.SectionEntryFor(ctx, f.scheduleID, c.attemptID, "math")
				if err != nil || st.State != "waiting" {
					t.Fatalf("Math exposed during break: %+v %v", st, err)
				}
				// The break starts only through its screen: arm, then confirm
				// the server-issued future start.
				var breakID, breakState string
				if err := f.db.QueryRow("SELECT id,state FROM assessment_attempt_breaks WHERE attempt_id=?", c.attemptID).Scan(&breakID, &breakState); err != nil {
					t.Fatal(err)
				}
				if breakState != "pending" {
					t.Fatalf("break started before its screen confirmed it: %s", breakState)
				}
				if _, err := f.app.Delivery.StartBreak(ctx, f.scheduleID, c.attemptID, f.scheduleID, breakID, nil, candidate.session, candidate.token); err != nil {
					t.Fatal(err)
				}
				if _, err := f.app.Delivery.EnterBreak(ctx, f.scheduleID, c.attemptID, f.scheduleID, delivery.BreakEntryRequest{BreakID: breakID, Generation: 1}, candidate.session, candidate.token); err != nil {
					t.Fatal(err)
				}
				exec("UPDATE assessment_attempt_breaks SET starts_at=TIMESTAMPADD(SECOND,-61,UTC_TIMESTAMP(6)),deadline_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(6)) WHERE attempt_id=?", c.attemptID)
				if _, err := f.app.Delivery.ReconcileAttemptTimeout(ctx, f.scheduleID, c.attemptID, time.Now().UTC()); err != nil {
					t.Fatal(err)
				}
				checkWaiting()
			}
			st, err := f.app.Forms.SectionEntryFor(ctx, f.scheduleID, c.attemptID, "math")
			if err != nil || st.State != "required" {
				t.Fatalf("Math form not available after break: %+v %v", st, err)
			}
			if _, err := f.app.Delivery.StartModule(ctx, f.scheduleID, c.attemptID, f.scheduleID, mathModule, candidate.session, candidate.token); formReasonOf(err) != "SECTION_FORM_REQUIRED" {
				t.Fatalf("raw Math start bypassed gate: %v", err)
			}
			if _, err := f.app.Forms.SubmitSectionEntry(ctx, cred, "math", sectionCommand("math", f.versionID, `{"sat_expected_class":"rank_4"}`)); err != nil {
				t.Fatal(err)
			}
			if _, err := f.app.Delivery.ReconcileAttemptTimeout(ctx, f.scheduleID, c.attemptID, time.Now().UTC()); err != nil {
				t.Fatal(err)
			}
			checkWaiting()
			if _, err := f.app.Delivery.StartModule(ctx, f.scheduleID, c.attemptID, f.scheduleID, mathModule, candidate.session, candidate.token); err != nil {
				t.Fatalf("Math entry after form: %v", err)
			}
			if n := f.count(t, "SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id=? AND module_id=? AND state='active' AND started_at IS NOT NULL AND allocated_seconds=120", c.attemptID, mathModule); n != 1 {
				t.Fatal("Math did not receive its authored individual time")
			}
		})
	}
}

func TestSectionFormObservesRoomPauseMySQL(t *testing.T) {
	f := newFormsFixture(t, separateForms())
	ctx := context.Background()
	c, cred, _ := f.sectionOwner(t)
	if _, err := f.db.Exec("INSERT INTO exam_session_runtimes (id,schedule_id,exam_id,provider_key,status,plan_snapshot,timing_model) SELECT ?,id,exam_id,'sat','paused','[]','sat_personal_v1' FROM exam_schedules WHERE id=?", uuid.NewString(), f.scheduleID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.db.Exec("UPDATE exam_schedules SET status='live' WHERE id=?", f.scheduleID); err != nil {
		t.Fatal(err)
	}
	st, err := f.app.Forms.SectionEntryFor(ctx, f.scheduleID, c.attemptID, "reading-writing")
	if err != nil || st.CanSubmit || st.CanStart || st.State != "required" {
		t.Fatalf("room pause not projected: %+v %v", st, err)
	}
	if _, err := f.app.Forms.SubmitSectionEntry(ctx, cred, "reading-writing", sectionCommand("paused", f.versionID, `{"goal":"My goal"}`)); formReasonOf(err) != "SECTION_FORM_NOT_AVAILABLE" {
		t.Fatalf("room pause allowed submission: %v", err)
	}
	if _, err := f.db.Exec("UPDATE exam_session_runtimes SET status='live' WHERE schedule_id=?", f.scheduleID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.app.Forms.SubmitSectionEntry(ctx, cred, "reading-writing", sectionCommand("resumed", f.versionID, `{"goal":"My goal"}`)); err != nil {
		t.Fatalf("resume did not restore form: %v", err)
	}
}

func TestSectionFormDisabledMathSkipsCollectionMySQL(t *testing.T) {
	forms := separateForms()
	off := false
	math := forms.SectionEntry["math"]
	math.Enabled = &off
	forms.SectionEntry["math"] = math
	f := newFormsFixture(t, forms)
	ctx := context.Background()
	if _, err := f.db.Exec("UPDATE assessment_sections SET section_key='math',title='Math' WHERE exam_version_id=?", f.versionID); err != nil {
		t.Fatal(err)
	}
	c, _, candidate := f.sectionOwner(t)
	state, err := f.app.Forms.SectionEntryFor(ctx, f.scheduleID, c.attemptID, "math")
	if err != nil || state.State != "not_applicable" || len(state.Fields) != 0 {
		t.Fatalf("disabled Math still collects: %+v %v", state, err)
	}
	if _, err := f.start(candidate, f.code(t).Value); err != nil {
		t.Fatalf("disabled Math blocked normal entry: %v", err)
	}
	if f.count(t, "SELECT COUNT(*) FROM assessment_form_responses WHERE attempt_id=? AND form_key='math_entry'", c.attemptID) != 0 {
		t.Fatal("disabled Math invented a response")
	}
	if f.count(t, "SELECT COUNT(*) FROM exam_versions WHERE id=? AND JSON_LENGTH(config_snapshot,'$.forms.sectionEntry.math.fields')=1", f.versionID) != 1 {
		t.Fatal("disabled Math lost its configured question")
	}
	rows, err := f.app.Forms.ListResponses(ctx, assessmentforms.Viewer{All: true}, assessmentforms.ListFilter{ScheduleID: f.scheduleID, FormKey: "math_entry"})
	if err != nil || len(rows.Items) != 0 {
		t.Fatalf("disabled form counted as missing: %+v %v", rows, err)
	}
}
