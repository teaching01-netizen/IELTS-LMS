package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/schedules"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func TestSATStaffSetsExactTimeThroughHTTPMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	schedule, attempt, base, _, _ := seedStaleETagExam(t, db)
	if _, err := db.Exec("UPDATE exam_session_runtimes SET timing_model='sat_personal_v1' WHERE schedule_id=?", schedule); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE assessment_module_attempts SET started_at=UTC_TIMESTAMP(6) WHERE attempt_id=?", attempt); err != nil {
		t.Fatal(err)
	}
	svc := delivery.NewService(db, tx.NewRunner(db))
	app := &App{DB: db, Delivery: svc, Schedules: schedules.NewService(db, tx.NewRunner(db))}
	router := chi.NewRouter()
	router.Post("/sessions/{scheduleID}/sat-control", proctorSATControlHandler(app))
	org := "stale-etag-org"
	body, _ := json.Marshal(map[string]any{"operationId": "set-time-1", "attemptIds": []string{attempt}, "action": "set_time", "remainingSeconds": 1200})
	req := httptest.NewRequest(http.MethodPost, "/sessions/"+schedule+"/sat-control", bytes.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), sessionCtxKey, &auth.Session{UserID: "staff", Role: auth.RoleAdmin, OrganizationID: &org}))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("set time: %d %s", rec.Code, rec.Body.String())
	}
	b, err := svc.Bootstrap(context.Background(), schedule, attempt, schedule)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range b.Attempt.ModuleAttempts {
		if m.ModuleID == base {
			if m.RemainingSeconds == nil || *m.RemainingSeconds < 1198 || *m.RemainingSeconds > 1200 {
				t.Fatalf("want 20:00, got %+v", m)
			}
			return
		}
	}
	t.Fatal("student cannot read current module")
}

func TestSATStaffMovesAndReopensModulesWithoutLosingAnswersMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	schedule, attempt, base, low, high := seedStaleETagExam(t, db)
	if _, err := db.Exec("UPDATE exam_session_runtimes SET timing_model='sat_personal_v1' WHERE schedule_id=?", schedule); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE exam_schedules SET sat_delivery_policy=CAST(? AS JSON) WHERE id=?`, `{"version":"sat_recovery_v1","recoverySeconds":120,"entryRecoverySeconds":120,"lateAnswerPolicy":"frozen_arrival_window"}`, schedule); err != nil {
		t.Fatal(err)
	}

	svc := delivery.NewService(db, tx.NewRunner(db))
	app := &App{DB: db, Delivery: svc, Schedules: schedules.NewService(db, tx.NewRunner(db))}
	router := chi.NewRouter()
	router.Post("/sessions/{scheduleID}/sat-control", proctorSATControlHandler(app))
	org := "stale-etag-org"
	move := func(op, dest, route string) *delivery.Bootstrap {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"operationId": op, "attemptIds": []string{attempt}, "action": "move", "remainingSeconds": 900, "sectionKey": "reading-writing", "destination": dest, "route": route})
		req := httptest.NewRequest("POST", "/sessions/"+schedule+"/sat-control", bytes.NewReader(body))
		req = req.WithContext(context.WithValue(req.Context(), sessionCtxKey, &auth.Session{UserID: "staff", Role: auth.RoleAdmin, OrganizationID: &org}))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		var result delivery.SATStaffControlResult
		if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &result) != nil || len(result.Outcomes) != 1 || !result.Outcomes[0].Applied {
			t.Fatalf("move: %d %s", rec.Code, rec.Body.String())
		}
		b, err := svc.Bootstrap(context.Background(), schedule, attempt, schedule)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	active := func(b *delivery.Bootstrap) string {
		t.Helper()
		for _, m := range b.Attempt.ModuleAttempts {
			if m.State == "active" {
				if m.RemainingSeconds == nil || *m.RemainingSeconds < 898 || *m.RemainingSeconds > 900 {
					t.Fatalf("wrong destination time: %+v", m)
				}
				return m.ModuleID
			}
		}
		t.Fatal("no active module")
		return ""
	}
	if got := active(move("move-auto", "module_2", "automatic")); got != high {
		t.Fatalf("automatic got %s, want higher", got)
	}
	b := move("move-back", "module_1", "")
	if got := active(b); got != base {
		t.Fatalf("backward move got %s", got)
	}
	if len(b.Attempt.Responses) != 3 {
		t.Fatalf("lost saved answers: %+v", b.Attempt.Responses)
	}
	b = move("move-easy", "module_2", "lower")
	if got := active(b); got != low {
		t.Fatalf("forced easier got %s", got)
	}
	for _, m := range b.Attempt.ModuleAttempts {
		if m.ModuleID == high {
			t.Fatal("superseded harder branch still administered")
		}
	}
}

func TestSATStaffControlsBreakAndPausedClockMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	schedule, attempt, _, _, _ := seedStaleETagExam(t, db)
	if _, err := db.Exec("UPDATE exam_session_runtimes SET timing_model='sat_personal_v1' WHERE schedule_id=?", schedule); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE assessment_sections SET break_after_seconds=600 WHERE id=(SELECT section_id FROM assessment_modules WHERE id=(SELECT module_id FROM assessment_module_attempts WHERE attempt_id=? LIMIT 1))", attempt); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE student_attempts SET proctor_status='paused' WHERE id=?", attempt); err != nil {
		t.Fatal(err)
	}
	svc := delivery.NewService(db, tx.NewRunner(db))
	seconds := 180
	result, err := svc.ApplySATStaffControl(context.Background(), "staff", schedule, delivery.SATStaffControlRequest{OperationID: "break-move", AttemptIDs: []string{attempt}, Action: "move", SectionKey: "reading-writing", Destination: "break", RemainingSeconds: &seconds})
	if err != nil || !result.Outcomes[0].Applied {
		t.Fatalf("break move: %+v %v", result, err)
	}
	seconds = 420
	result, err = svc.ApplySATStaffControl(context.Background(), "staff", schedule, delivery.SATStaffControlRequest{OperationID: "break-edit", AttemptIDs: []string{attempt}, Action: "set_time", RemainingSeconds: &seconds})
	if err != nil || !result.Outcomes[0].Applied {
		t.Fatalf("break edit: %+v %v", result, err)
	}
	b, err := svc.Bootstrap(context.Background(), schedule, attempt, schedule)
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Attempt.PersonalBreaks) != 1 || b.Attempt.PersonalBreaks[0].RemainingSeconds != 420 || b.Attempt.PersonalBreaks[0].PausedAt == nil {
		t.Fatalf("paused break lost exact time: %+v", b.Attempt.PersonalBreaks)
	}
}

func TestSATStaffControlOwnsClockInSharedRoomMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	schedule, attempt, base, _, _ := seedStaleETagExam(t, db)
	if _, err := db.Exec("UPDATE exam_session_runtimes SET timing_model='cohort_section_v3' WHERE schedule_id=?", schedule); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE assessment_module_attempts SET started_at=UTC_TIMESTAMP(6) WHERE attempt_id=?", attempt); err != nil {
		t.Fatal(err)
	}
	svc := delivery.NewService(db, tx.NewRunner(db))
	seconds := 600
	result, err := svc.ApplySATStaffControl(context.Background(), "staff", schedule, delivery.SATStaffControlRequest{OperationID: "cohort-edit", AttemptIDs: []string{attempt}, Action: "set_time", RemainingSeconds: &seconds})
	if err != nil || !result.Outcomes[0].Applied {
		t.Fatalf("edit shared room: %+v %v", result, err)
	}
	b, err := svc.Bootstrap(context.Background(), schedule, attempt, schedule)
	if err != nil {
		t.Fatal(err)
	}
	if b.Timing.TimingModel != "sat_personal_v1" {
		t.Fatalf("room clock still overrides edited student clock: %s", b.Timing.TimingModel)
	}
	if b.StaffControl == nil || b.StaffControl.Action != "set_time" {
		t.Fatal("student cannot distinguish new staff state from stale state")
	}
	for _, m := range b.Attempt.ModuleAttempts {
		if m.ModuleID == base && m.State != "active" {
			t.Fatal("room cursor closed the staff-controlled module")
		}
	}
}

func TestSATStaffMoveSilentlySyncsOnlyOriginalAnswersMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	schedule, attempt, base, _, high := seedStaleETagExam(t, db)
	if _, err := db.Exec("UPDATE exam_session_runtimes SET timing_model='sat_personal_v1' WHERE schedule_id=?", schedule); err != nil {
		t.Fatal(err)
	}
	session, token := seedHandoffWriter(t, db, schedule, attempt)
	svc := delivery.NewService(db, tx.NewRunner(db))
	seconds := 600
	result, err := svc.ApplySATStaffControl(context.Background(), "staff", schedule, delivery.SATStaffControlRequest{OperationID: "offline-move", AttemptIDs: []string{attempt}, Action: "move", Destination: "module_2", SectionKey: "reading-writing", Route: "higher", RemainingSeconds: &seconds})
	if err != nil || !result.Outcomes[0].Applied {
		t.Fatalf("move: %+v %v", result, err)
	}
	before, err := svc.Bootstrap(context.Background(), schedule, attempt, schedule)
	if err != nil {
		t.Fatal(err)
	}
	questionID := before.Attempt.Responses[0].ExamQuestionID
	lease, version, epoch := int64(1), int64(2), uint64(1)
	ack, err := svc.RecordLateEvidence(context.Background(), schedule, attempt, schedule, delivery.LateEvidenceRequest{StaffMove: true, ModuleID: base, Answers: []delivery.LateEvidenceAnswer{{QuestionID: questionID, WriteID: "offline-answer", Response: json.RawMessage(`{"answer":"A","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`), OriginLeaseEpoch: &lease, ClientVersion: &version, OriginControlEpoch: &epoch}}}, session, token)
	if err != nil || ack.Recorded != 1 {
		t.Fatalf("background sync: %+v %v", ack, err)
	}
	// A later arrival from the interrupted run must not overwrite the newer
	// canonical answer, even if its local version is larger.
	version = 100
	delayed := delivery.LateEvidenceRequest{StaffMove: true, ModuleID: base, Answers: []delivery.LateEvidenceAnswer{{QuestionID: questionID, WriteID: "later-old-answer", Response: json.RawMessage(`{"answer":"C","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`), OriginLeaseEpoch: &lease, ClientVersion: &version, OriginControlEpoch: &epoch}}}
	if _, err := svc.RecordLateEvidence(context.Background(), schedule, attempt, schedule, delayed, session, token); err != nil {
		t.Fatal(err)
	}
	after, err := svc.Bootstrap(context.Background(), schedule, attempt, schedule)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, r := range after.Attempt.Responses {
		if r.ExamQuestionID == questionID {
			found = bytes.Contains(r.Response, []byte(`"A"`))
		}
	}
	if !found {
		t.Fatalf("old-module answer was not synced: %+v", after.Attempt.Responses)
	}
	for _, m := range after.Attempt.ModuleAttempts {
		if m.State == "active" && m.ModuleID != high {
			t.Fatal("background answer changed destination")
		}
	}
	if after.StaffControl.Revision != before.StaffControl.Revision {
		t.Fatal("background sync changed staff control")
	}
	if _, err := db.Exec("UPDATE student_attempts SET phase='post-exam',delivery_status='submitted' WHERE id=?", attempt); err != nil {
		t.Fatal(err)
	}
	delayed.Answers[0].WriteID = "after-submit"
	ack, err = svc.RecordLateEvidence(context.Background(), schedule, attempt, schedule, delayed, session, token)
	if err != nil || ack.Recorded != 0 {
		t.Fatalf("submitted attempt accepted sync: %+v %v", ack, err)
	}

}

func TestSATStaffRevisitedModuleContinuesNormallyMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	schedule, attempt, base, _, high := seedStaleETagExam(t, db)
	if _, err := db.Exec("UPDATE exam_session_runtimes SET timing_model='sat_personal_v1' WHERE schedule_id=?", schedule); err != nil {
		t.Fatal(err)
	}
	svc := delivery.NewService(db, tx.NewRunner(db))
	seconds := 600
	for _, req := range []delivery.SATStaffControlRequest{
		{OperationID: "advance-first", AttemptIDs: []string{attempt}, Action: "move", Destination: "module_2", SectionKey: "reading-writing", Route: "higher", RemainingSeconds: &seconds},
		{OperationID: "revisit-first", AttemptIDs: []string{attempt}, Action: "move", Destination: "module_1", SectionKey: "reading-writing", RemainingSeconds: &seconds},
	} {
		out, err := svc.ApplySATStaffControl(context.Background(), "staff", schedule, req)
		if err != nil || !out.Outcomes[0].Applied {
			t.Fatalf("move %+v: %+v %v", req, out, err)
		}
	}
	// Fixture clock advances past the revisit's ordinary save grace.
	if _, err := db.Exec("UPDATE assessment_module_attempts SET started_at=TIMESTAMPADD(SECOND,-900,UTC_TIMESTAMP(6)) WHERE attempt_id=? AND module_id=?", attempt, base); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReconcileAttemptTimeout(context.Background(), schedule, attempt, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	b, err := svc.Bootstrap(context.Background(), schedule, attempt, schedule)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range b.Attempt.ModuleAttempts {
		if m.ModuleID == high && m.State == "active" {
			return
		}
	}
	t.Fatalf("revisited Module 1 did not continue into the selected Module 2: %+v", b.Attempt.ModuleAttempts)
}

func TestSATStaffRoomControlIsScopedAndReportsEachAttemptMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	schedule, attempt, _, _, _ := seedStaleETagExam(t, db)
	_, outsider, _, _, _ := seedStaleETagExam(t, db)
	if _, err := db.Exec("UPDATE assessment_module_attempts SET started_at=UTC_TIMESTAMP(6) WHERE attempt_id=?", attempt); err != nil {
		t.Fatal(err)
	}
	svc := delivery.NewService(db, tx.NewRunner(db))
	app := &App{DB: db, Delivery: svc, Schedules: schedules.NewService(db, tx.NewRunner(db))}
	router := chi.NewRouter()
	router.Post("/sessions/{scheduleID}/sat-control", proctorSATControlHandler(app))
	org := "stale-etag-org"
	assigned := uuid.NewString()
	if _, err := db.Exec("INSERT INTO schedule_staff_assignments(id,schedule_id,actor_id,user_id,role,granted_by) VALUES(?,?,?,?,'proctor',?)", uuid.NewString(), schedule, assigned, assigned, assigned); err != nil {
		t.Fatal(err)
	}
	post := func(role, actor string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]any{"operationId": "group-time", "attemptIds": []string{outsider, attempt}, "action": "set_time", "remainingSeconds": 1200})
		req := httptest.NewRequest("POST", "/sessions/"+schedule+"/sat-control", bytes.NewReader(body))
		req = req.WithContext(context.WithValue(req.Context(), sessionCtxKey, &auth.Session{UserID: actor, Role: role, OrganizationID: &org}))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	if got := post(auth.RoleStudent, uuid.NewString()).Code; got != http.StatusForbidden {
		t.Fatalf("student got %d", got)
	}
	if got := post(auth.RoleProctor, uuid.NewString()).Code; got != http.StatusNotFound {
		t.Fatalf("unassigned proctor got %d", got)
	}
	for range 2 {
		rec := post(auth.RoleProctor, assigned)
		var out delivery.SATStaffControlResult
		if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &out) != nil || len(out.Outcomes) != 2 || out.Outcomes[0].Applied || !out.Outcomes[1].Applied {
			t.Fatalf("room result: %d %s", rec.Code, rec.Body.String())
		}
	}
	b, err := svc.Bootstrap(context.Background(), schedule, attempt, schedule)
	if err != nil {
		t.Fatal(err)
	}
	if b.StaffControl == nil || b.StaffControl.Revision != 2 {
		t.Fatalf("replay applied again: %+v", b.StaffControl)
	}
}

func TestSATStaffMovesAcrossSectionsAndOutOfBreakMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	schedule, attempt, base, low, high := seedStaleETagExam(t, db)
	ctx := context.Background()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("UPDATE exam_session_runtimes SET timing_model='sat_personal_v1' WHERE schedule_id=?", schedule)
	section, mathBase, mathLow, mathHigh := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	exec(`INSERT INTO assessment_sections(id,exam_version_id,section_key,title,display_order,duration_seconds,break_after_seconds,instructions,tool_policy) SELECT ?,exam_version_id,'math','Math',1,duration_seconds,0,instructions,tool_policy FROM assessment_sections WHERE id=(SELECT section_id FROM assessment_modules WHERE id=?)`, section, base)
	exec(`UPDATE assessment_sections SET break_after_seconds=600 WHERE id=(SELECT section_id FROM assessment_modules WHERE id=?)`, base)
	for _, pair := range [][2]string{{base, mathBase}, {low, mathLow}, {high, mathHigh}} {
		exec(`INSERT INTO assessment_modules(id,section_id,module_key,title,display_order,duration_seconds,target_question_count,adaptive_role,instructions,tool_policy) SELECT ?,?,module_key,title,display_order,duration_seconds,target_question_count,adaptive_role,instructions,tool_policy FROM assessment_modules WHERE id=?`, pair[1], section, pair[0])
		exec(`INSERT INTO assessment_exam_questions(id,module_id,question_id,question_revision_id,display_order,is_pretest) SELECT UUID(),?,question_id,question_revision_id,display_order,is_pretest FROM assessment_exam_questions WHERE module_id=?`, pair[1], pair[0])
	}
	exec(`INSERT INTO assessment_routing_policies(id,section_id,base_module_id,lower_module_id,higher_module_id,policy_key,policy_config,revision) VALUES(?,?,?,?,?,'threshold','{"minimumCorrectForHigher":2}',1)`, uuid.NewString(), section, mathBase, mathLow, mathHigh)
	t.Cleanup(func() {
		exec("DELETE FROM assessment_staff_move_sources WHERE attempt_id=?", attempt)
		exec("DELETE FROM assessment_module_attempts WHERE attempt_id=? AND module_id IN (?,?,?)", attempt, mathBase, mathLow, mathHigh)
		exec("DELETE FROM assessment_exam_questions WHERE module_id IN (?,?,?)", mathBase, mathLow, mathHigh)
		exec("DELETE FROM assessment_routing_policies WHERE section_id=?", section)
		exec("DELETE FROM assessment_modules WHERE section_id=?", section)
		exec("DELETE FROM assessment_sections WHERE id=?", section)
	})
	svc := delivery.NewService(db, tx.NewRunner(db))
	seconds := 600
	control := func(op, action, key, dest string) *delivery.Bootstrap {
		t.Helper()
		out, err := svc.ApplySATStaffControl(ctx, "staff", schedule, delivery.SATStaffControlRequest{OperationID: op, AttemptIDs: []string{attempt}, Action: action, SectionKey: key, Destination: dest, RemainingSeconds: &seconds})
		if err != nil || !out.Outcomes[0].Applied {
			t.Fatalf("%s: %+v %v", op, out, err)
		}
		b, err := svc.Bootstrap(ctx, schedule, attempt, schedule)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	assertMath := func(b *delivery.Bootstrap) {
		t.Helper()
		for _, m := range b.Attempt.ModuleAttempts {
			if m.ModuleID == mathBase && m.State == "active" {
				return
			}
		}
		t.Fatalf("expected Math Module 1 to run: %+v", b.Attempt.ModuleAttempts)
	}
	assertMath(control("cross-to-math", "move", "math", "module_1"))
	b := control("return-to-break", "move", "reading-writing", "break")
	if len(b.Attempt.PersonalBreaks) != 1 || b.Attempt.PersonalBreaks[0].State != "active" {
		t.Fatalf("break not active: %+v", b.Attempt.PersonalBreaks)
	}
	seconds = 0
	assertMath(control("end-break", "set_time", "", ""))
}
