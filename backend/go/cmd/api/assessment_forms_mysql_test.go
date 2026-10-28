package main

// Real-MySQL proof for SAT configurable forms and Eva SIM
// (docs/plans/SAT-configurable-forms-and-eva-sim.md TC-05/06/07/08/12/13/14/
// 15/17/18/29). Gated on TEST_MYSQL_DSN (isolated, migrated through 0101).

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/assessmentforms"
	"example.com/ielts-proctoring/internal/assessmentforms/definition"
	"example.com/ielts-proctoring/internal/authoring"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/proctor"
	examruntime "example.com/ielts-proctoring/internal/runtime"
	"example.com/ielts-proctoring/internal/satpublish"
)

type formsFixture struct {
	codeStartFixture
	versionID string
}

func newFormsFixture(t *testing.T, forms definition.Forms) formsFixture {
	t.Helper()
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN not set; requires isolated MySQL")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	now := time.Now().UTC()
	base := newCodeStartFixture(t, db, now.Add(-time.Minute), now.Add(3*time.Hour))
	f := formsFixture{codeStartFixture: base}
	if err := db.QueryRow("SELECT published_version_id FROM exam_schedules WHERE id = ?", base.scheduleID).Scan(&f.versionID); err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(map[string]any{"providerKey": "sat", definition.SnapshotKey: forms})
	if _, err := db.Exec("UPDATE exam_versions SET config_snapshot = ? WHERE id = ?", string(encoded), f.versionID); err != nil {
		t.Fatal(err)
	}
	return f
}

type formsCandidate struct{ user, attemptID string }

// prepare creates the preparatory registration + attempt rows only; no
// attempt session (not admitted).
func (f formsFixture) prepare(t *testing.T) formsCandidate {
	t.Helper()
	user, regID, key := uuid.NewString(), uuid.NewString(), "key-"+uuid.NewString()[:8]
	if _, err := f.db.Exec("INSERT INTO users (id, email, display_name, role, state) VALUES (?, ?, 'Forms candidate', 'student', 'active')", user, user+"@example.test"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.db.Exec("INSERT INTO schedule_registrations (id, schedule_id, student_key, student_id, student_name, access_state, wcode, user_id) VALUES (?, ?, ?, ?, 'Forms candidate', 'checked_in', ?, ?)",
		regID, f.scheduleID, key, key, "W"+key, user); err != nil {
		t.Fatal(err)
	}
	ref, err := f.app.Schedules.CreateScheduleAttempt(context.Background(), f.scheduleID, regID, key, key, "Forms candidate", user+"@example.test", uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	return formsCandidate{user: user, attemptID: ref.AttemptID}
}

func (f formsFixture) admit(c formsCandidate, sub *assessmentforms.RegistrationSubmission) (string, error) {
	adm, err := admitStudentSession(context.Background(), f.app, c.user, f.scheduleID, c.attemptID, uuid.NewString(), sub)
	return adm.Token, err
}

func (f formsFixture) count(t *testing.T, query string, args ...any) int {
	t.Helper()
	var n int
	if err := f.db.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func formReasonOf(err error) string {
	var ae *apperrors.Error
	if errors.As(err, &ae) && ae.Details != nil {
		r, _ := ae.Details["reason"].(string)
		return r
	}
	return ""
}

func codeOf(err error) apperrors.Code {
	var ae *apperrors.Error
	if errors.As(err, &ae) {
		return ae.Code
	}
	return ""
}

func registration(versionID, answers string) *assessmentforms.RegistrationSubmission {
	return &assessmentforms.RegistrationSubmission{VersionID: versionID, Answers: json.RawMessage(answers)}
}

const validRegistration = `{"sat_admission_year":2027,"sat_seat_number":"A-007","sat_expected_class":"rank_2"}`

func TestRegistrationGatesFirstCredentialMySQL(t *testing.T) {
	f := newFormsFixture(t, definition.DefaultSATForms())
	c := f.prepare(t)
	noRows := func(label string) {
		t.Helper()
		if n := f.count(t, "SELECT COUNT(*) FROM attempt_sessions WHERE attempt_id = ?", c.attemptID); n != 0 {
			t.Fatalf("%s: %d credentials issued without registration", label, n)
		}
		if n := f.count(t, "SELECT COUNT(*) FROM assessment_form_responses WHERE attempt_id = ?", c.attemptID); n != 0 {
			t.Fatalf("%s: %d responses committed", label, n)
		}
	}
	// Preprovisioned attempt + no answers (legacy client / raw register path).
	if _, err := f.admit(c, nil); formReasonOf(err) != assessmentforms.ReasonRegistrationRequired {
		t.Fatalf("missing registration must be refused, got %v", err)
	}
	noRows("missing")
	if _, err := f.admit(c, registration(uuid.NewString(), validRegistration)); formReasonOf(err) != assessmentforms.ReasonFormVersionChanged {
		t.Fatalf("stale version must be 409 FORM_VERSION_CHANGED, got %v", err)
	}
	noRows("stale version")
	for _, bad := range []string{
		`{"sat_admission_year":2027,"sat_seat_number":"A-007"}`,
		`{"sat_admission_year":70,"sat_seat_number":"A-007","sat_expected_class":"rank_2"}`,
		`{"sat_admission_year":2027,"sat_seat_number":"A-007","sat_expected_class":"rank_9"}`,
		`{"sat_admission_year":2027,"sat_seat_number":"A-007","sat_expected_class":"rank_2","other":1}`,
	} {
		if _, err := f.admit(c, registration(f.versionID, bad)); codeOf(err) != apperrors.CodeValidation {
			t.Fatalf("invalid answers %s must be 422, got %v", bad, err)
		}
	}
	noRows("invalid")
	token, err := f.admit(c, registration(f.versionID, validRegistration))
	if err != nil || token == "" {
		t.Fatalf("valid registration must admit with a credential: token=%q err=%v", token, err)
	}
	var stored string
	if err := f.db.QueryRow("SELECT CAST(answers AS CHAR) FROM assessment_form_responses WHERE attempt_id = ? AND form_key = 'registration'", c.attemptID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	var answers map[string]any
	_ = json.Unmarshal([]byte(stored), &answers)
	if answers["sat_seat_number"] != "A-007" || answers["sat_expected_class"] != "rank_2" {
		t.Fatalf("stored registration = %s", stored)
	}
	// Resume after admission with a stale screen's different answers: the
	// sealed response is unchanged and the owner is admitted.
	// (A competing session may be single-writer blocked; it is not refused
	// for registration reasons.)
	if _, err := f.admit(c, registration(f.versionID, `{"sat_admission_year":2030,"sat_seat_number":"Z","sat_expected_class":"rank_1"}`)); err != nil {
		t.Fatalf("admitted owner must resume: %v", err)
	}
	var after string
	_ = f.db.QueryRow("SELECT CAST(answers AS CHAR) FROM assessment_form_responses WHERE attempt_id = ? AND form_key = 'registration'", c.attemptID).Scan(&after)
	if after != stored {
		t.Fatalf("resume replaced the sealed registration: %s -> %s", stored, after)
	}
	// Duplicate seat values never block another student.
	other := f.prepare(t)
	if _, err := f.admit(other, registration(f.versionID, validRegistration)); err != nil {
		t.Fatalf("duplicate seat must be admitted: %v", err)
	}
}

func TestLegacyVersionAdmitsWithoutRegistrationMySQL(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN not set; requires isolated MySQL")
	}
	f := newFormsFixture(t, definition.DefaultSATForms())
	if _, err := f.db.Exec("UPDATE exam_versions SET config_snapshot = '{}' WHERE id = ?", f.versionID); err != nil {
		t.Fatal(err)
	}
	c := f.prepare(t)
	if token, err := f.admit(c, nil); err != nil || token == "" {
		t.Fatalf("legacy version must admit unchanged: %v", err)
	}
}

func nativeEvaForms() definition.Forms {
	forms := definition.DefaultSATForms()
	forms.EvaSim = definition.EvaSim{Enabled: true, Mode: definition.ModeNative, Fields: []definition.Field{
		{ID: "eva_mood", Type: definition.TypeSingleChoice, Label: "How did it go?", Required: true, Scope: definition.ScopeMath, Options: []definition.Option{{ID: "good", Label: "Good"}, {ID: "bad", Label: "Bad"}}},
		{ID: "eva_note", Type: definition.TypeText, Label: "Notes", Scope: definition.ScopeMath, MaxLength: 200},
	}}
	return forms
}

func (f formsFixture) completedOwner(t *testing.T) (formsCandidate, assessmentforms.Credential) {
	t.Helper()
	c := f.prepare(t)
	token, err := f.admit(c, registration(f.versionID, validRegistration))
	if err != nil {
		t.Fatal(err)
	}
	claims, err := crypto.VerifyAttemptToken([]byte(f.app.Config.AuthSecret), time.Now().UTC(), token)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.db.Exec("UPDATE student_attempts SET delivery_status = 'submitted', phase = 'post-exam', submitted_at = UTC_TIMESTAMP(6), final_submission = '{}' WHERE id = ?", c.attemptID); err != nil {
		t.Fatal(err)
	}
	return c, assessmentforms.Credential{TokenID: claims.TokenID, UserID: claims.UserID, ScheduleID: claims.ScheduleID, AttemptID: claims.AttemptID, LeaseEpoch: claims.LeaseEpoch}
}

func submit(op string, rev int64, versionID, answers string) assessmentforms.SubmitEvaCommand {
	return assessmentforms.SubmitEvaCommand{OperationID: op, ExpectedRevision: rev, VersionID: versionID, Answers: json.RawMessage(answers)}
}

func TestNativeEvaSubmitEditReplayAndExplicitCloseMySQL(t *testing.T) {
	f := newFormsFixture(t, nativeEvaForms())
	ctx := context.Background()
	forms := f.app.Forms
	// Not yet completed: Eva is not applicable and writes are refused.
	pending := f.prepare(t)
	if token, err := f.admit(pending, registration(f.versionID, validRegistration)); err != nil || token == "" {
		t.Fatal(err)
	}
	if st, err := forms.EvaStateFor(ctx, f.scheduleID, pending.attemptID); err != nil || st.Eligibility != "not_applicable" {
		t.Fatalf("incomplete attempt must not be eligible: %+v %v", st, err)
	}

	c, cred := f.completedOwner(t)
	st, err := forms.EvaStateFor(ctx, f.scheduleID, c.attemptID)
	if err != nil {
		t.Fatal(err)
	}
	if st.Eligibility != "eligible" || *st.Mode != "native" || st.Response != "not_submitted" || st.CanReturnToComplete || !st.CanSubmit {
		t.Fatalf("open unsubmitted native state wrong: %+v", st)
	}
	if _, err := forms.SubmitEva(ctx, cred, submit("op-invalid", 0, f.versionID, `{"eva_note":"x"}`)); codeOf(err) != apperrors.CodeValidation {
		t.Fatalf("missing required answer must be 422, got %v", err)
	}
	first, err := forms.SubmitEva(ctx, cred, submit("op-1", 0, f.versionID, `{"eva_mood":"good"}`))
	if err != nil || first.Revision != 1 {
		t.Fatalf("first submit: %+v %v", first, err)
	}
	replay, err := forms.SubmitEva(ctx, cred, submit("op-1", 0, f.versionID, `{"eva_mood":"good"}`))
	if err != nil || replay.Revision != 1 || !replay.UpdatedAt.Equal(first.UpdatedAt) {
		t.Fatalf("replay must return the original receipt: %+v %v", replay, err)
	}
	if _, err := forms.SubmitEva(ctx, cred, submit("op-1", 0, f.versionID, `{"eva_mood":"bad"}`)); codeOf(err) != apperrors.CodeWriteIDConflict {
		t.Fatalf("reused operation id with new payload must conflict, got %v", err)
	}
	if _, err := forms.SubmitEva(ctx, cred, submit("op-stale", 0, f.versionID, `{"eva_mood":"bad"}`)); formReasonOf(err) != assessmentforms.ReasonFormResponseChanged {
		t.Fatalf("stale revision must be FORM_RESPONSE_CHANGED, got %v", err)
	}
	edit, err := forms.SubmitEva(ctx, cred, submit("op-2", 1, f.versionID, `{"eva_mood":"bad","eva_note":"retake"}`))
	if err != nil || edit.Revision != 2 {
		t.Fatalf("edit: %+v %v", edit, err)
	}

	// Automatic completion (generic CompleteInTx) must leave Eva open.
	runtimeID := uuid.NewString()
	if _, err := f.db.Exec("INSERT INTO exam_session_runtimes (id, schedule_id, exam_id, provider_key, status, plan_snapshot) SELECT ?, id, exam_id, 'sat', 'live', '[]' FROM exam_schedules WHERE id = ?", runtimeID, f.scheduleID); err != nil {
		t.Fatal(err)
	}
	if err := tx.NewRunner(f.db).WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		return examruntime.CompleteInTx(ctx, q, f.scheduleID, runtimeID, "auto_complete")
	}); err != nil {
		t.Fatalf("automatic completion: %v", err)
	}
	if n := f.count(t, "SELECT COUNT(*) FROM exam_schedules WHERE id = ? AND eva_sim_closed_at IS NOT NULL", f.scheduleID); n != 0 {
		t.Fatal("automatic completion must not close Eva SIM")
	}
	if _, err := forms.SubmitEva(ctx, cred, submit("op-3", 2, f.versionID, `{"eva_mood":"good"}`)); err != nil {
		t.Fatalf("Eva must stay writable after automatic completion: %v", err)
	}

	// Explicit End Exam on an already-completed runtime closes Eva.
	actor := proctor.Actor{ID: "admin-" + uuid.NewString()[:8], Role: proctor.RoleAdmin, CSRFVerified: true}
	if err := f.app.Proctor.CompleteExam(ctx, actor, f.scheduleID, proctor.CompleteExamCommand{OperationID: "end-1"}); err != nil {
		t.Fatalf("End Exam after auto-complete: %v", err)
	}
	var closedAt time.Time
	if err := f.db.QueryRow("SELECT eva_sim_closed_at FROM exam_schedules WHERE id = ?", f.scheduleID).Scan(&closedAt); err != nil {
		t.Fatalf("End Exam must set closure: %v", err)
	}
	if err := f.app.Proctor.CompleteExam(ctx, actor, f.scheduleID, proctor.CompleteExamCommand{OperationID: "end-2"}); err != nil {
		t.Fatal(err)
	}
	var closedAgain time.Time
	_ = f.db.QueryRow("SELECT eva_sim_closed_at FROM exam_schedules WHERE id = ?", f.scheduleID).Scan(&closedAgain)
	if !closedAgain.Equal(closedAt) {
		t.Fatalf("closure must be monotonic: %v -> %v", closedAt, closedAgain)
	}
	if _, err := forms.SubmitEva(ctx, cred, submit("op-4", 3, f.versionID, `{"eva_mood":"bad"}`)); formReasonOf(err) != assessmentforms.ReasonEvaClosed {
		t.Fatalf("write after End Exam must be EVA_SIM_CLOSED, got %v", err)
	}
	if again, err := forms.SubmitEva(ctx, cred, submit("op-2", 1, f.versionID, `{"eva_mood":"bad","eva_note":"retake"}`)); err != nil || again.Revision != 2 {
		t.Fatalf("committed operation must replay after closure: %+v %v", again, err)
	}
	st, err = forms.EvaStateFor(ctx, f.scheduleID, c.attemptID)
	if err != nil || st.Collection != "closed" || st.CanSubmit || !st.CanReturnToComplete || st.Response != "submitted" || *st.Revision != 3 {
		t.Fatalf("closed state wrong: %+v %v", st, err)
	}
	// Revoked credential cannot write (even before closure checks).
	if _, err := f.db.Exec("UPDATE attempt_sessions SET revoked_at = UTC_TIMESTAMP() WHERE token_id = ?", cred.TokenID); err != nil {
		t.Fatal(err)
	}
	if _, err := forms.SubmitEva(ctx, cred, submit("op-5", 3, f.versionID, `{"eva_mood":"bad"}`)); codeOf(err) != apperrors.CodeAttemptTokenInvalid {
		t.Fatalf("revoked credential must be refused, got %v", err)
	}
	// Staff list: admin sees the submitted native row with its revision.
	page, err := forms.ListResponses(ctx, assessmentforms.Viewer{All: true}, assessmentforms.ListFilter{ScheduleID: f.scheduleID, FormKey: "eva_sim"})
	if err != nil {
		t.Fatal(err)
	}
	statuses := map[string]string{}
	for _, row := range page.Items {
		statuses[row.AttemptID] = row.Status
	}
	if statuses[c.attemptID] != "submitted" || statuses[pending.attemptID] != "pending_completion" {
		t.Fatalf("list statuses wrong: %v", statuses)
	}
	if _, err := forms.ListResponses(ctx, assessmentforms.Viewer{ProctorUserID: "unassigned-" + uuid.NewString()}, assessmentforms.ListFilter{ScheduleID: f.scheduleID, FormKey: "eva_sim"}); err != nil {
		t.Fatal(err)
	} else if p, _ := forms.ListResponses(ctx, assessmentforms.Viewer{ProctorUserID: "unassigned"}, assessmentforms.ListFilter{ScheduleID: f.scheduleID}); len(p.Items) != 0 {
		t.Fatal("unassigned proctor must see no rows")
	}
	detail, err := forms.ResponseDetailFor(ctx, assessmentforms.Viewer{All: true}, c.attemptID, "eva_sim")
	if err != nil || detail.Answers["eva_mood"] != "good" || len(detail.Fields) != 2 {
		t.Fatalf("detail: %+v %v", detail, err)
	}
}

func TestEmbedEvaIsNotTrackedAndClosesAppAccessMySQL(t *testing.T) {
	forms := definition.DefaultSATForms()
	forms.EvaSim = definition.EvaSim{Enabled: true, Mode: definition.ModeEmbed, URL: "https://forms.example.org/f/abc?embedded=true"}
	f := newFormsFixture(t, forms)
	ctx := context.Background()
	c, cred := f.completedOwner(t)
	st, err := f.app.Forms.EvaStateFor(ctx, f.scheduleID, c.attemptID)
	if err != nil || st.Response != "not_tracked" || st.EmbedURL == nil || !*st.CanOpen || !st.CanReturnToComplete || st.Revision != nil || st.EmbedHost != "forms.example.org" {
		t.Fatalf("open embed state wrong: %+v %v", st, err)
	}
	if _, err := f.app.Forms.SubmitEva(ctx, cred, submit("op-embed", 0, f.versionID, `{}`)); formReasonOf(err) != assessmentforms.ReasonEvaModeMismatch {
		t.Fatalf("native PUT against embed must be EVA_MODE_MISMATCH, got %v", err)
	}
	if n := f.count(t, "SELECT COUNT(*) FROM assessment_form_responses WHERE attempt_id = ? AND form_key = 'eva_sim'", c.attemptID); n != 0 {
		t.Fatal("embed mode must never create a response row")
	}
	if n := f.count(t, "SELECT COUNT(*) FROM assessment_lifecycle_receipts WHERE attempt_id = ? AND operation_kind = 'eva_sim_submit'", c.attemptID); n != 0 {
		t.Fatal("embed mode must never create a receipt")
	}
	if _, err := f.db.Exec("INSERT INTO exam_session_runtimes (id, schedule_id, exam_id, provider_key, status, plan_snapshot) SELECT ?, id, exam_id, 'sat', 'completed', '[]' FROM exam_schedules WHERE id = ?", uuid.NewString(), f.scheduleID); err != nil {
		t.Fatal(err)
	}
	actor := proctor.Actor{ID: "admin-embed", Role: proctor.RoleAdmin, CSRFVerified: true}
	if err := f.app.Proctor.CompleteExam(ctx, actor, f.scheduleID, proctor.CompleteExamCommand{OperationID: "end-embed"}); err != nil {
		t.Fatal(err)
	}
	st, err = f.app.Forms.EvaStateFor(ctx, f.scheduleID, c.attemptID)
	if err != nil || st.Collection != "closed" || st.EmbedURL != nil || st.ExternalOpenURL != nil || *st.CanOpen {
		t.Fatalf("closed embed must withhold URLs: %+v %v", st, err)
	}
	page, err := f.app.Forms.ListResponses(ctx, assessmentforms.Viewer{All: true}, assessmentforms.ListFilter{ScheduleID: f.scheduleID, FormKey: "eva_sim"})
	if err != nil || len(page.Items) != 1 || page.Items[0].Status != "not_tracked" {
		t.Fatalf("embed rows must be not_tracked: %+v %v", page.Items, err)
	}
	reg, err := f.app.Forms.ListResponses(ctx, assessmentforms.Viewer{All: true}, assessmentforms.ListFilter{ScheduleID: f.scheduleID, FormKey: "registration"})
	if err != nil || len(reg.Items) != 1 || reg.Items[0].Status != "submitted" {
		t.Fatalf("native registration remains visible for embed exams: %+v %v", reg.Items, err)
	}
	state, err := f.app.Forms.ScheduleState(ctx, f.scheduleID)
	if err != nil || state.Collection != "closed" || *state.Mode != "embed" {
		t.Fatalf("room state: %+v %v", state, err)
	}
}

// TC-15/16: the room fence orders native Eva writes against End Exam. A
// submit waits behind an exclusive schedule lock and then observes closure;
// End Exam waits behind an in-flight submit's shared fence.
func TestEvaSubmitSerializesWithEndExamMySQL(t *testing.T) {
	f := newFormsFixture(t, nativeEvaForms())
	ctx := context.Background()
	_, cred := f.completedOwner(t)

	lock, err := f.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := lock.ExecContext(ctx, "SELECT id FROM exam_schedules WHERE id = ? FOR UPDATE", f.scheduleID); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := f.app.Forms.SubmitEva(ctx, cred, submit("op-race", 0, f.versionID, `{"eva_mood":"good"}`))
		done <- err
	}()
	select {
	case err := <-done:
		t.Fatalf("submit must wait for the exclusive End Exam fence, returned %v", err)
	case <-time.After(400 * time.Millisecond):
	}
	if _, err := lock.ExecContext(ctx, "UPDATE exam_schedules SET eva_sim_closed_at = UTC_TIMESTAMP(6), eva_sim_closed_by = 'barrier' WHERE id = ?", f.scheduleID); err != nil {
		t.Fatal(err)
	}
	if err := lock.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := <-done; formReasonOf(err) != assessmentforms.ReasonEvaClosed {
		t.Fatalf("submit ordered after closure must be EVA_SIM_CLOSED, got %v", err)
	}

	// Reverse order on a fresh room: a shared fence held by a student write
	// makes End Exam wait; the write commits first.
	g := newFormsFixture(t, nativeEvaForms())
	if _, err := g.db.Exec("INSERT INTO exam_session_runtimes (id, schedule_id, exam_id, provider_key, status, plan_snapshot) SELECT ?, id, exam_id, 'sat', 'completed', '[]' FROM exam_schedules WHERE id = ?", uuid.NewString(), g.scheduleID); err != nil {
		t.Fatal(err)
	}
	share, err := g.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := share.ExecContext(ctx, "SELECT id FROM exam_schedules WHERE id = ? FOR SHARE", g.scheduleID); err != nil {
		t.Fatal(err)
	}
	ended := make(chan error, 1)
	go func() {
		ended <- g.app.Proctor.CompleteExam(ctx, proctor.Actor{ID: "admin-race", Role: proctor.RoleAdmin, CSRFVerified: true}, g.scheduleID, proctor.CompleteExamCommand{OperationID: "end-race"})
	}()
	select {
	case err := <-ended:
		t.Fatalf("End Exam must wait for the shared fence, returned %v", err)
	case <-time.After(400 * time.Millisecond):
	}
	if err := share.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := <-ended; err != nil {
		t.Fatal(err)
	}
	if n := g.count(t, "SELECT COUNT(*) FROM exam_schedules WHERE id = ? AND eva_sim_closed_at IS NOT NULL", g.scheduleID); n != 1 {
		t.Fatal("End Exam must close after the shared fence is released")
	}
}

// TC-01/02/27: new SAT drafts seed the standard fields; saves are fenced by
// the draft revision; unsafe URLs are refused; an older whole-config save
// that omits forms preserves them; readiness blocks an incomplete Eva.
func TestAuthoringFormsDraftLifecycleMySQL(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN not set; requires isolated MySQL")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	runner := tx.NewRunner(db)
	examService := exams.NewService(db, runner)
	authors := authoring.NewService(db, runner)
	actor := "forms-author-" + uuid.NewString()
	provider := "sat"
	exam, err := examService.Create(ctx, exams.CreateRequest{Slug: actor, Title: "Forms authoring proof", ExamType: "Academic", Visibility: "private", ProviderKey: &provider, OwnerID: actor})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = examService.Delete(ctx, exam.ID) })

	got, err := authors.GetForms(ctx, exam.ID)
	if err != nil {
		t.Fatal(err)
	}
	// A new draft is unconfigured; Standard offers the default SAT fields for
	// the explicit "Add standard SAT fields" action.
	if !got.Editable || got.Forms != nil || len(got.Standard.Registration.Fields) != 2 || got.Standard.SchemaVersion != 2 || len(got.Standard.SectionFields("math")) != 1 || got.Standard.EvaSim.Enabled {
		t.Fatalf("new SAT draft must be unconfigured with standard registration offered and Eva disabled: %+v", got)
	}
	save := func(rev int, forms definition.Forms) (authoring.ExamForms, error) {
		raw, _ := json.Marshal(forms)
		return authors.SaveForms(ctx, exam.ID, authoring.SaveFormsRequest{ExpectedVersionID: got.VersionID, ExpectedRevision: rev, Forms: raw, AppHosts: []string{"app.example.com"}})
	}
	edited := got.Standard
	edited.Registration.Fields[1].Label = "Seat"
	if _, err := save(got.VersionRevision+5, edited); formReasonOf(err) != "FORM_DRAFT_CHANGED" {
		t.Fatalf("stale revision must be FORM_DRAFT_CHANGED, got %v", err)
	}
	unsafe := edited
	unsafe.EvaSim = definition.EvaSim{Enabled: true, Mode: definition.ModeEmbed, URL: "https://app.example.com/self"}
	if _, err := save(got.VersionRevision, unsafe); codeOf(err) != apperrors.CodeValidation {
		t.Fatalf("own-host URL must be refused, got %v", err)
	}
	unsafe.EvaSim.URL = "http://forms.example.org/x"
	if _, err := save(got.VersionRevision, unsafe); codeOf(err) != apperrors.CodeValidation {
		t.Fatalf("http URL must be refused, got %v", err)
	}
	blank := edited
	blank.EvaSim = definition.EvaSim{Enabled: true, Mode: definition.ModeEmbed}
	saved, err := save(got.VersionRevision, blank)
	if err != nil {
		t.Fatalf("blank enabled embed is a saveable draft: %v", err)
	}
	if saved.VersionRevision != got.VersionRevision+1 || len(saved.Issues) != 1 || saved.Forms.Registration.Fields[1].Label != "Seat" {
		t.Fatalf("save result wrong: %+v", saved)
	}
	// Readiness (shared by preflight and the seal transaction) blocks it.
	issues, err := satpublish.ValidateDraftForScope(ctx, db, got.VersionID, satpublish.ScopeFull)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, issue := range issues {
		found = found || issue.Code == "sat.forms.incomplete"
	}
	if !found {
		t.Fatalf("enabled embed without URL must block release: %+v", issues)
	}
	// Older whole-config SaveDraft omits forms: they survive.
	var content string
	if err := db.QueryRow("SELECT CAST(content_snapshot AS CHAR) FROM exam_versions WHERE id = ?", got.VersionID).Scan(&content); err != nil {
		t.Fatal(err)
	}
	if _, err := examService.SaveDraft(ctx, exam.ID, actor, exams.SaveDraftRequest{Content: json.RawMessage(content), Config: json.RawMessage(`{"providerKey":"sat","delivery":{"launchMode":"proctor_start"}}`), Revision: saved.VersionRevision}); err != nil {
		t.Fatal(err)
	}
	after, err := authors.GetForms(ctx, exam.ID)
	if err != nil || after.Forms == nil || after.Forms.Registration.Fields[1].Label != "Seat" || after.Forms.EvaSim.Mode != definition.ModeEmbed {
		t.Fatalf("SaveDraft without forms must preserve them: %+v %v", after, err)
	}
}
