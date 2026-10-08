package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
	"example.com/ielts-proctoring/internal/proctor"
)

func seedHandoffWriter(t *testing.T, db *sql.DB, schedule, attempt string) (string, string) {
	t.Helper()
	user, session, token := uuid.NewString(), uuid.NewString(), uuid.NewString()
	if _, err := db.Exec("INSERT INTO users (id, email, display_name, role, state) VALUES (?, ?, 'Handoff candidate', 'student', 'active')", user, user+"@example.test"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec("DELETE FROM users WHERE id = ?", user) })
	if _, err := db.Exec("INSERT INTO attempt_sessions (id, user_id, schedule_id, attempt_id, client_session_id, token_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)", uuid.NewString(), user, schedule, attempt, session, token, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	return session, token
}

func TestSATClientStartHandoffMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()
	schedule, attempt, base, _, high := seedStaleETagExam(t, db)
	session, token := seedHandoffWriter(t, db, schedule, attempt)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("UPDATE exam_session_runtimes SET timing_model = 'sat_personal_v1', sat_handoff_mode = 'client_start' WHERE schedule_id = ?", schedule)
	exec("UPDATE exam_schedules SET sat_timing_model = 'sat_personal_v1' WHERE id = ?", schedule)
	var moduleAttempt string
	if err := db.QueryRowContext(ctx, "SELECT id FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?", attempt, base).Scan(&moduleAttempt); err != nil {
		t.Fatal(err)
	}
	svc := delivery.NewService(db, tx.NewRunner(db))
	req := delivery.ModuleCloseRequest{ModuleID: base, ModuleAttemptID: moduleAttempt, CloseID: "close-mysql"}
	// An early close cannot freeze or route the module.
	exec("UPDATE assessment_module_attempts SET started_at = UTC_TIMESTAMP(6) WHERE id = ?", moduleAttempt)
	_, err := svc.CloseModule(ctx, schedule, attempt, schedule, req, session, token)
	if e, ok := apperrors.As(err); !ok || e.Details["reason"] != "MODULE_NOT_EXPIRED" {
		t.Fatalf("early close: %v", err)
	}
	// A final write delayed beyond the old three-second grace is admitted by
	// the personal runtime policy, and must be confirmed before routing.
	exec("UPDATE assessment_module_attempts SET started_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 3605 SECOND) WHERE id = ?", moduleAttempt)
	var question string
	if err := db.QueryRowContext(ctx, "SELECT question_id FROM attempt_responses_v2 WHERE attempt_id = ? LIMIT 1", attempt).Scan(&question); err != nil {
		t.Fatal(err)
	}
	finalWriteID := uuid.NewString()
	req.Answers = []delivery.ModuleCloseAnswer{{QuestionID: question, WriteID: finalWriteID, ClientVersion: 4}}
	_, err = svc.CloseModule(ctx, schedule, attempt, schedule, req, session, token)
	if e, ok := apperrors.As(err); !ok || e.Details["reason"] != "CLOSE_WRITES_PENDING" {
		t.Fatalf("missing final write: %v", err)
	}
	var user string
	if err := db.QueryRow("SELECT user_id FROM attempt_sessions WHERE token_id = ?", token).Scan(&user); err != nil {
		t.Fatal(err)
	}
	exec("UPDATE student_attempts SET user_id = ?, active_client_session_id = ? WHERE id = ?", user, session, attempt)
	bearer, err := crypto.SignAttemptToken([]byte(submitTestSecret), crypto.AttemptClaims{
		TokenID: token, UserID: user, ScheduleID: schedule, AttemptID: attempt, ClientSessionID: session, Exp: time.Now().Add(time.Hour).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	writeService := attempts.NewService(tx.NewRunner(db), clock.System{}, []byte(submitTestSecret)).SetRowFirst(true)
	result, err := writeService.SaveResponses(ctx, bearer, attempts.SaveResponsesCommand{
		AttemptID: attempt, LeaseEpoch: 1, ControlEpoch: 1,
		Commands: []attempts.ResponseCommand{{QuestionID: question, WriteID: finalWriteID, ClientVersion: 4, Response: attempts.ResponsePayload{Answer: "B"}}},
	}, v2Resolver{}, v2Locker{})
	if err != nil || len(result.Acks) != 1 || result.Acks[0].Outcome != "applied" {
		t.Fatalf("final write after old grace must be admitted: %+v %v", result, err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ack, err := svc.CloseModule(ctx, schedule, attempt, schedule, req, session, token)
			if err == nil && (ack.NextModuleID == nil || *ack.NextModuleID != high) {
				err = sql.ErrNoRows
			}
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("racing close: %v", err)
		}
	}
	var decisions, branches, late int
	var basis string
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*), MAX(route_basis), MAX(late_answer_count) FROM assessment_route_decisions WHERE attempt_id = ?", attempt).Scan(&decisions, &basis, &late); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id = ? AND module_id <> ?", attempt, base).Scan(&branches); err != nil {
		t.Fatal(err)
	}
	if decisions != 1 || branches != 1 || basis != "client_confirmed" || late < 1 {
		t.Fatalf("decisions=%d branches=%d basis=%s late=%d", decisions, branches, basis, late)
	}
	// Before the backstop the selected branch stays clock-free, including reads.
	_, err = svc.ReconcileAttemptTimeout(ctx, schedule, attempt, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	bootstrap, err := svc.Bootstrap(ctx, schedule, attempt, schedule)
	if err != nil {
		t.Fatal(err)
	}
	for _, section := range bootstrap.Sections {
		for _, module := range section.Modules {
			if module.ID == high && (len(module.Questions) != 0 || !module.ContentWithheld) {
				t.Fatal("unstarted branch content leaked")
			}
		}
	}
	var state string
	var started sql.NullTime
	if err := db.QueryRowContext(ctx, "SELECT state, started_at FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?", attempt, high).Scan(&state, &started); err != nil {
		t.Fatal(err)
	}
	if state != "not_started" || started.Valid {
		t.Fatalf("premature clock: %s %v", state, started)
	}
	// Due backstop races the browser: both resume one committed started_at.
	exec("UPDATE assessment_module_attempts SET auto_start_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND) WHERE attempt_id = ? AND module_id = ?", attempt, high)
	errs = make(chan error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, err := svc.ReconcileAttemptTimeout(ctx, schedule, attempt, time.Now().UTC())
		errs <- err
	}()
	go func() {
		defer wg.Done()
		ack, err := svc.StartModuleOfferAck(ctx, schedule, attempt, schedule, high, nil, nil, true, session, token)
		if err == nil && (ack.SelectedSection == nil || len(ack.SelectedSection.Modules[0].Questions) != 3) {
			err = sql.ErrNoRows
		}
		errs <- err
	}()
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("start race: %v", err)
		}
	}
	if err := db.QueryRowContext(ctx, "SELECT state, started_at FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?", attempt, high).Scan(&state, &started); err != nil {
		t.Fatal(err)
	}
	if state != "active" || !started.Valid {
		t.Fatal("backstop/client did not start M2")
	}
	ack, err := svc.StartModuleOfferAck(ctx, schedule, attempt, schedule, high, nil, nil, false, session, token)
	if err != nil {
		t.Fatal(err)
	}
	if ack.StartedAt == nil || !ack.StartedAt.Equal(started.Time) {
		t.Fatal("duplicate start changed the clock")
	}
}

func TestSATLateEvidenceMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()
	schedule, attempt, base, low, _ := seedStaleETagExam(t, db)
	session, token := seedHandoffWriter(t, db, schedule, attempt)
	if _, err := db.ExecContext(ctx, "UPDATE attempt_responses_v2 SET response = ? WHERE attempt_id = ?", `{"answer":"A","markedForReview":false,"annotations":[],"eliminatedOptions":[]}`, attempt); err != nil {
		t.Fatal(err)
	}
	svc := delivery.NewService(db, tx.NewRunner(db))
	if _, err := svc.ReconcileAttemptTimeout(ctx, schedule, attempt, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	rows, err := db.QueryContext(ctx, "SELECT question_id FROM attempt_responses_v2 WHERE attempt_id = ?", attempt)
	if err != nil {
		t.Fatal(err)
	}
	req := delivery.LateEvidenceRequest{ModuleID: base}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		req.Answers = append(req.Answers, delivery.LateEvidenceAnswer{QuestionID: id, WriteID: "evidence-" + id, Response: json.RawMessage(`{"answer":"B","markedForReview":false,"annotations":[],"eliminatedOptions":[]}`)})
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	ack, err := svc.RecordLateEvidence(ctx, schedule, attempt, schedule, req, session, token)
	if err != nil {
		t.Fatal(err)
	}
	if ack.Recorded != 3 {
		t.Fatalf("recorded=%d", ack.Recorded)
	}
	ack, err = svc.RecordLateEvidence(ctx, schedule, attempt, schedule, req, session, token)
	if err != nil || ack.Recorded != 0 {
		t.Fatalf("duplicate evidence: %+v %v", ack, err)
	}
	var count, alerts int
	var selected string
	reviewer := proctor.Actor{ID:"evidence-reviewer", Role:proctor.RoleAdmin, CSRFVerified:true}
	reviewService := proctor.NewService(tx.NewRunner(db), db, nil, nil, nil)
	page, err := reviewService.ListLateEvidence(ctx, reviewer, schedule, attempt, "", 100)
	if err != nil { t.Fatal(err) }
	for _, row := range page.Rows { if row.WouldChangeRoute { count++ } }
	if err := db.QueryRowContext(ctx, "SELECT selected_module_id FROM assessment_route_decisions WHERE attempt_id = ?", attempt).Scan(&selected); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM session_audit_logs WHERE schedule_id = ? AND action_type = 'SAT_LATE_ANSWER_ROUTE_RISK'", schedule).Scan(&alerts); err != nil {
		t.Fatal(err)
	}
	if count != 3 || alerts != 1 || selected != low {
		t.Fatalf("flagged=%d alerts=%d selected=%s", count, alerts, selected)
	}
	// A later write for the same question is independent immutable evidence.
	// The historical write's missing origin remains unknown, not restamped.
	lease, version := int64(1), int64(2)
	later := delivery.LateEvidenceRequest{ModuleID:base, Answers:[]delivery.LateEvidenceAnswer{{
		QuestionID:req.Answers[0].QuestionID, WriteID:"later-evidence",
		Response:json.RawMessage(`{"answer":"A","markedForReview":false,"annotations":[],"eliminatedOptions":[]}`),
		OriginLeaseEpoch:&lease, ClientVersion:&version,
	}}}
	ack, err = svc.RecordLateEvidence(ctx, schedule, attempt, schedule, later, session, token)
	if err != nil || ack.Recorded != 1 { t.Fatalf("later evidence: %+v %v", ack, err) }
	later.Answers[0].ClientVersion = new(int64)
	*later.Answers[0].ClientVersion = 3
	if _, err = svc.RecordLateEvidence(ctx, schedule, attempt, schedule, later, session, token); err == nil {
		t.Fatal("changed metadata reused an immutable evidence write id")
	}
	first, err := reviewService.ListLateEvidence(ctx, reviewer, schedule, attempt, "", 2)
	if err != nil || len(first.Rows) != 2 || !first.HasMore { t.Fatalf("first page: %+v %v", first, err) }
	second, err := reviewService.ListLateEvidence(ctx, reviewer, schedule, attempt, first.NextCursor, 2)
	if err != nil || len(second.Rows) != 2 || second.HasMore { t.Fatalf("second page: %+v %v", second, err) }
	if first.Rows[0].OriginLeaseEpoch != nil || first.Rows[0].ClientVersion != nil {
		t.Fatal("historical evidence provenance was invented")
	}
	last := second.Rows[1]
	if last.WriteID != "later-evidence" || last.ClientVersion == nil || *last.ClientVersion != 2 || !last.ProvenanceConflict {
		t.Fatalf("later immutable write not retained for review: %+v", last)
	}
	if _, err := reviewService.ListLateEvidence(ctx, proctor.Actor{ID:"student", Role:"student"}, schedule, attempt, "", 2); err == nil {
		t.Fatal("student read protected late evidence")
	}
	if _, err := reviewService.ListLateEvidence(ctx, proctor.Actor{ID:uuid.NewString(), Role:proctor.RoleProctor}, schedule, attempt, "", 2); err == nil {
		t.Fatal("unassigned proctor read late evidence")
	}
	review := proctor.LateEvidenceReviewRequest{OperationID:"review-once", EvidenceIDs:[]string{first.Rows[0].ID}, Outcome:"investigated", Note:"Device record inspected; official result unchanged."}
	for range 2 {
		if err:=reviewService.ReviewLateEvidence(ctx, reviewer, schedule, attempt, review);err!=nil {t.Fatal(err)}
	}
	review.Note="Different intent"
	if err:=reviewService.ReviewLateEvidence(ctx, reviewer, schedule, attempt, review);err==nil {t.Fatal("review operation id accepted changed intent")}
	var reviews int
	if err:=db.QueryRow("SELECT COUNT(*) FROM assessment_late_evidence_reviews WHERE attempt_id = ?",attempt).Scan(&reviews);err!=nil {t.Fatal(err)}
	if reviews != 1 {t.Fatalf("replayed review duplicated history: %d",reviews)}
	page, err = reviewService.ListLateEvidence(ctx, reviewer, schedule, attempt, "", 100)
	if err != nil || page.Rows[0].ReviewOutcome == nil || *page.Rows[0].ReviewOutcome != "investigated" {t.Fatalf("review outcome not visible: %+v %v", page, err)}
	if err:=db.QueryRow("SELECT selected_module_id FROM assessment_route_decisions WHERE attempt_id = ?",attempt).Scan(&selected);err!=nil {t.Fatal(err)}
	if selected!=low {t.Fatal("evidence review changed official routing")}
	// Late evidence does not mutate the canonical answer or route.
	var canonicalCorrect int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM attempt_responses_v2 WHERE attempt_id = ? AND JSON_UNQUOTE(JSON_EXTRACT(response, '$.answer')) = 'B'", attempt).Scan(&canonicalCorrect); err != nil {
		t.Fatal(err)
	}
	if canonicalCorrect != 0 {
		t.Fatal("evidence mutated canonical responses")
	}
}
