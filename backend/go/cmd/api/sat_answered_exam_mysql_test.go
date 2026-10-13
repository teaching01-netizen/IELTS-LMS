package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/results"
)

// PDF-01..09 (docs/sat-result.md §4–5): the answered-exam projection is the
// attempt's pinned version narrowed to started modules, keyless, served to the
// bearer's own attempt while its report is open and to in-scope staff, only
// once the attempt is terminal, and bounded under a burst of downloads.
func TestSATAnsweredExamMySQL(t *testing.T) {
	f := newSATV2CompletionFixture(t)
	ctx := context.Background()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := f.db.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	var versionID, examID, baseID, lowID string
	if err := f.db.QueryRowContext(ctx, "SELECT published_version_id, exam_id FROM student_attempts WHERE id = ?", f.attemptID).Scan(&versionID, &examID); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRowContext(ctx, `SELECT MAX(CASE WHEN m.adaptive_role = 'base' THEN m.id END), MAX(CASE WHEN m.adaptive_role = 'lower_branch' THEN m.id END)
		FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE s.exam_version_id = ?`, versionID).Scan(&baseID, &lowID); err != nil {
		t.Fatal(err)
	}

	cfg := config.Load()
	cfg.AuthSecret = submitTestSecret
	svc := delivery.NewService(f.db, tx.NewRunner(f.db))
	app := &App{Config: cfg, DB: f.db, Delivery: svc, Results: results.NewService(f.db)}
	router := chi.NewRouter()
	router.Get("/assessment-delivery/schedules/{scheduleID}/answered-exam", deliveryAnsweredExamHandler(app))
	router.Get("/results/sat/attempts/{attemptID}/answered-exam", resultsSATAnsweredExamHandler(app))

	org, otherOrg := "stale-etag-org", "other-org-"+uuid.NewString()
	assigned := uuid.NewString()
	exec("INSERT INTO schedule_staff_assignments (id, schedule_id, actor_id, user_id, role, granted_by) VALUES (?, ?, ?, ?, 'proctor', ?)", uuid.NewString(), f.scheduleID, assigned, assigned, assigned)
	proctor := &auth.Session{UserID: assigned, Role: auth.RoleProctor, OrganizationID: &org}

	student := func(scheduleID string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/assessment-delivery/schedules/"+scheduleID+"/answered-exam", nil)
		req.Header.Set("Authorization", "Bearer "+f.bearer)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	staff := func(sess *auth.Session) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/results/sat/attempts/"+f.attemptID+"/answered-exam", nil)
		if sess != nil {
			req = req.WithContext(context.WithValue(req.Context(), sessionCtxKey, sess))
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	expect := func(name string, rec *httptest.ResponseRecorder, want int) {
		t.Helper()
		if rec.Code != want {
			t.Fatalf("%s: status %d, want %d: %s", name, rec.Code, want, rec.Body.String())
		}
	}

	// Standard Practice sitting: no report, so no answered exam for the student.
	expect("practice sitting", student(f.scheduleID), http.StatusForbidden)
	exec("UPDATE exam_schedules SET sat_session_mode = 'classroom' WHERE id = ?", f.scheduleID)
	exec("UPDATE exam_entities SET sat_score_report_enabled = TRUE WHERE id = ?", examID)

	// Not terminal yet: refused for everyone.
	expect("student before seal", student(f.scheduleID), http.StatusConflict)
	expect("proctor before seal", staff(proctor), http.StatusConflict)

	if err := f.submit(ctx); err != nil {
		t.Fatal(err)
	}
	// An unchosen branch row that was never started (the submit gate refuses
	// one before the seal) was not administered and must stay off the paper.
	exec("INSERT INTO assessment_module_attempts (id, attempt_id, module_id, state, allocated_seconds, tool_state, revision) VALUES (?, ?, ?, 'not_started', 3600, '{}', 1)", uuid.NewString(), f.attemptID, lowID)

	// Authorization: the attempt comes from the bearer; staff need the results scope.
	expect("schedule mismatch", student(uuid.NewString()), http.StatusForbidden)
	expect("anonymous staff route", staff(nil), http.StatusUnauthorized)
	expect("student session on staff route", staff(&auth.Session{UserID: uuid.NewString(), Role: auth.RoleStudent, OrganizationID: &org}), http.StatusForbidden)
	expect("unassigned proctor", staff(&auth.Session{UserID: uuid.NewString(), Role: auth.RoleProctor, OrganizationID: &org}), http.StatusNotFound)
	expect("grader of another organization", staff(&auth.Session{UserID: assigned, Role: auth.RoleGrader, OrganizationID: &otherOrg}), http.StatusNotFound)

	// PDF-07: a later publish never changes the paper an attempt is printed from.
	newVersion := uuid.NewString()
	exec("INSERT INTO exam_versions (id, exam_id, version_number, content_snapshot, config_snapshot, created_by, is_published, revision) VALUES (?, ?, 2, '{}', '{}', 'later', TRUE, 1)", newVersion, examID)
	exec("UPDATE exam_entities SET current_published_version_id = ? WHERE id = ?", newVersion, examID)
	exec("UPDATE exam_schedules SET published_version_id = ? WHERE id = ?", newVersion, f.scheduleID)
	t.Cleanup(func() { // the fixture's cleanup deletes the version the schedule names
		_, _ = f.db.ExecContext(context.Background(), "UPDATE exam_schedules SET published_version_id = ? WHERE id = ?", versionID, f.scheduleID)
	})

	own := student(f.scheduleID)
	expect("own attempt", own, http.StatusOK)
	if got := own.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q", got)
	}
	body := own.Body.String()
	var paper struct {
		AttemptID, VersionID string
		Sections             []struct {
			Modules []struct {
				ID        string
				Questions []struct{ ExamQuestionID string }
			}
		}
		Attempt struct {
			ModuleAttempts []struct{ ModuleID string }
			Responses      []struct {
				ModuleID string
				Response json.RawMessage
			}
		}
	}
	if err := json.Unmarshal([]byte(body), &paper); err != nil {
		t.Fatal(err)
	}
	if paper.AttemptID != f.attemptID || paper.VersionID != versionID {
		t.Fatalf("paper must be the attempt's pinned version %s, got %s", versionID, paper.VersionID)
	}
	modules := map[string]int{}
	for _, s := range paper.Sections {
		for _, m := range s.Modules {
			modules[m.ID] = len(m.Questions)
		}
	}
	if len(modules) != 2 || modules[baseID] != 3 || modules[f.highModuleID] != 3 {
		t.Fatalf("paper must hold exactly the started base and higher modules: %v", modules)
	}
	if strings.Contains(body, lowID) {
		t.Fatal("an unstarted module leaked into the paper")
	}
	if len(paper.Attempt.ModuleAttempts) != 2 {
		t.Fatalf("module attempts = %d, want the 2 administered", len(paper.Attempt.ModuleAttempts))
	}
	if len(paper.Attempt.Responses) != 3 || !strings.Contains(string(paper.Attempt.Responses[0].Response), `"B"`) {
		t.Fatalf("accepted responses = %+v", paper.Attempt.Responses)
	}
	for _, secret := range []string{"correctOptionId", "answerDefinition", "rationale", "answer_definition"} {
		if strings.Contains(body, secret) {
			t.Fatalf("answered exam carries %q", secret)
		}
	}
	staffPaper := staff(proctor)
	expect("assigned proctor", staffPaper, http.StatusOK)
	if staffPaper.Body.String() != body {
		t.Fatal("staff and student papers differ for one attempt")
	}

	// Report switched off later: the student loses it, staff keep it.
	exec("UPDATE exam_entities SET sat_score_report_enabled = FALSE WHERE id = ?", examID)
	expect("report closed", student(f.scheduleID), http.StatusForbidden)
	expect("staff with report closed", staff(proctor), http.StatusOK)

	// PDF-09: a burst far above the build bound gets the same paper or a 429
	// with Retry-After — never a 5xx or a different paper.
	const burst = 64
	start := make(chan struct{})
	codes := make(chan *httptest.ResponseRecorder, burst)
	var wg sync.WaitGroup
	for i := 0; i < burst; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			codes <- staff(proctor)
		}()
	}
	close(start)
	wg.Wait()
	close(codes)
	ok, limited := 0, 0
	for rec := range codes {
		switch rec.Code {
		case http.StatusOK:
			ok++
			if rec.Body.String() != body {
				t.Fatal("burst returned a different paper")
			}
		case http.StatusTooManyRequests:
			limited++
			if rec.Header().Get("Retry-After") == "" {
				t.Fatal("429 without Retry-After")
			}
		default:
			t.Fatalf("burst status %d: %s", rec.Code, rec.Body.String())
		}
	}
	if ok == 0 {
		t.Fatalf("burst served nothing: ok=%d limited=%d", ok, limited)
	}
	t.Logf("burst of %d: %d served, %d limited", burst, ok, limited)
}

// PDF-09: the 429 envelope a full build bound renders.
func TestAnsweredExamBusyIs429(t *testing.T) {
	rec := httptest.NewRecorder()
	writeAnsweredExam(rec, httptest.NewRequest(http.MethodGet, "/", nil), nil, delivery.ErrAnsweredExamBusy)
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("busy = %d Retry-After=%q", rec.Code, rec.Header().Get("Retry-After"))
	}
	rec = httptest.NewRecorder()
	writeAnsweredExam(rec, httptest.NewRequest(http.MethodGet, "/", nil), nil, errors.New("boom"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("unexpected error = %d", rec.Code)
	}
}
