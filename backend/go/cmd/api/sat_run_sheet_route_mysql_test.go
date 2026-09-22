package main

// Real-route verification for the staff run sheet's data source.
//
// The browser panel reads GET /api/v1/proctor/sessions/{scheduleID} through the
// real chi router, middleware stack and handler. This test drives that route
// against MySQL for a SAT session whose runtime snapshot still holds the
// pre-repair 96-minute Reading & Writing clock, and asserts the response
// carries: the room's real clock (sections[].plannedDurationMinutes = 96), the
// authoritative deadline the student counts to with live time left on it, no
// announced break mid-section, and the authored plan (examPlan = 64 with its
// modules) for comparison.
//
// The raw response body is written to SAT_VERIFY_DUMP
// (/tmp/sat-session-detail.json by default) so the browser-side projection can
// be checked against the exact bytes the room receives.
//
// Gated on TEST_MYSQL_DSN, mirroring the other real-MySQL suites in this
// package; fixtures are best-effort cleaned up.

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/authoring"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/config"
	platformdb "example.com/ielts-proctoring/internal/platform/db"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/proctor"
	"example.com/ielts-proctoring/internal/schedules"
	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

type runSheetRoutePayload struct {
	Runtime struct {
		Status                         string `json:"status"`
		WaitingForNextSection          bool   `json:"waitingForNextSection"`
		NextSectionStartAt             *time.Time
		CurrentSectionDeadlineAt       *time.Time `json:"currentSectionDeadlineAt"`
		CurrentSectionRemainingSeconds int        `json:"currentSectionRemainingSeconds"`
		Sections                       []struct {
			SectionKey             string `json:"sectionKey"`
			Label                  string `json:"label"`
			PlannedDurationMinutes int    `json:"plannedDurationMinutes"`
			GapAfterMinutes        int    `json:"gapAfterMinutes"`
			Status                 string `json:"status"`
			ActualStartAt          *time.Time
		} `json:"sections"`
		ExamPlan []struct {
			SectionKey      string `json:"sectionKey"`
			Label           string `json:"label"`
			DurationMinutes int    `json:"durationMinutes"`
			GapAfterMinutes int    `json:"gapAfterMinutes"`
			Modules         []struct {
				ModuleKey    string `json:"moduleKey"`
				Title        string `json:"title"`
				AdaptiveRole string `json:"adaptiveRole"`
			} `json:"modules"`
		} `json:"examPlan"`
	} `json:"runtime"`
}

// satVerifyDSN opens the fixture pool with the application's own session
// discipline (platformdb.NormalizeDSN). The runtime clock columns are MySQL
// TIMESTAMP: a fixture pool left on the host's SYSTEM zone and the app's
// UTC-pinned read path render the same row hours apart (observed 07:59:23Z vs
// 14:59:23Z on one row at one instant), which makes backdated fixtures flaky
// rather than revealing anything about the service.
func satVerifyDSN(t *testing.T) string {
	t.Helper()
	raw := os.Getenv("TEST_MYSQL_DSN")
	if raw == "" {
		t.Skip("TEST_MYSQL_DSN not set; requires isolated MySQL")
	}
	dsn, err := platformdb.NormalizeDSN(raw)
	if err != nil {
		t.Fatalf("normalize TEST_MYSQL_DSN: %v", err)
	}
	return dsn
}

func TestSATSessionDetailRouteCarriesTheRuntimeClock(t *testing.T) {
	dsn := satVerifyDSN(t)
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	ctx := context.Background()
	runner := tx.NewRunner(db)

	// --- real fixture: exam -> SAT blueprint -> publish -> schedule -> start ---
	actor := "route-verify-" + uuid.NewString()
	provider := "sat"
	examService := exams.NewService(db, runner)
	exam, err := examService.Create(ctx, exams.CreateRequest{
		Slug: actor, Title: "SAT run sheet route verification", ExamType: "Academic",
		Visibility: "private", ProviderKey: &provider, OwnerID: actor,
	})
	if err != nil {
		t.Fatalf("create exam: %v", err)
	}
	t.Cleanup(func() {
		if err := examService.Delete(context.Background(), exam.ID); err != nil {
			t.Logf("cleanup exam: %v", err)
		}
	})
	authors := authoring.NewService(db, runner)
	shell, err := authors.Shell(ctx, exam.ID)
	if err != nil {
		t.Fatalf("authoring shell: %v", err)
	}
	if _, err := authors.CreateQuestion(ctx, shell.Sections[0].Modules[0].ID, actor, authoring.QuestionDraft{}); err != nil {
		t.Fatalf("create question: %v", err)
	}
	current, err := authors.Shell(ctx, exam.ID)
	if err != nil {
		t.Fatalf("authoring shell (reopened): %v", err)
	}
	published, err := examService.Publish(ctx, exam.ID, actor, exams.PublishRequest{
		Revision:               exam.Revision,
		ExpectedDraftVersionID: &current.VersionID,
		ExpectedDraftRevision:  &current.VersionRevision,
	})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}

	schedulesService := schedules.NewService(db, runner)
	// The fixture clock is placed so the live route read lands mid-section on
	// the inflated clock: started 70 minutes ago, the 96-minute snapshot still
	// has ~26 minutes left, while the authored 64-minute clock (plus its 30 s
	// closing grace) ran out 5.5 minutes ago. Drift between this line and the
	// route read only moves that remaining value by milliseconds.
	anchor := time.Now().UTC().Truncate(time.Second).Add(-70 * time.Minute)
	sch, err := schedulesService.Create(ctx, schedules.CreateRequest{
		ExamID: exam.ID, PublishedVersionID: published.ID,
		CohortName: "route verify", StartTime: anchor, EndTime: anchor.Add(4 * time.Hour), CreatedBy: actor,
	})
	if err != nil {
		t.Fatalf("create schedule: %v", err)
	}
	t.Cleanup(func() {
		for _, stmt := range []string{
			"DELETE FROM session_audit_logs WHERE schedule_id = ?",
			"DELETE FROM cohort_control_events WHERE schedule_id = ?",
			"DELETE FROM student_attempts WHERE schedule_id = ?",
			"DELETE FROM schedule_registrations WHERE schedule_id = ?",
			"DELETE FROM exam_session_runtime_sections WHERE runtime_id IN (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)",
			"DELETE FROM exam_session_runtimes WHERE schedule_id = ?",
			"DELETE FROM exam_schedules WHERE id = ?",
		} {
			if _, err := db.Exec(stmt, sch.ID); err != nil {
				t.Logf("cleanup %.50q: %v", stmt, err)
			}
		}
	})
	if _, err := schedulesService.ApplyRuntimeCommand(ctx, sch.ID, schedules.RuntimeCommand{
		Action: schedules.CommandStart, ActorID: actor,
	}); err != nil {
		t.Fatalf("start schedule: %v", err)
	}
	// Re-create the production snapshot: the session was started while the
	// authored row still summed Module 1 + both branches (0065 repaired the
	// authored row; a run that started before it keeps what it started with).
	if _, err := db.ExecContext(ctx,
		"UPDATE exam_session_runtimes SET actual_start_at = ?, updated_at = ? WHERE schedule_id = ?",
		anchor, anchor, sch.ID); err != nil {
		t.Fatalf("backdate runtime: %v", err)
	}
	// Only the started section carries a start instant — a locked row never does,
	// so the fixture must not invent one for Math either.
	backdated, err := db.ExecContext(ctx, `
		UPDATE exam_session_runtime_sections rs
		JOIN exam_session_runtimes r ON r.id = rs.runtime_id
		SET rs.actual_start_at = ?, rs.available_at = ?
		WHERE r.schedule_id = ? AND rs.status = 'live'`, anchor, anchor, sch.ID)
	if err != nil {
		t.Fatalf("backdate section: %v", err)
	}
	if n, err := backdated.RowsAffected(); err != nil {
		t.Fatalf("backdate section rows: %v", err)
	} else if n != 1 {
		t.Fatalf("backdate must move exactly the live section, moved %d", n)
	}
	if _, err := db.ExecContext(ctx, `
		UPDATE exam_session_runtime_sections rs
		JOIN exam_session_runtimes r ON r.id = rs.runtime_id
		SET rs.planned_duration_minutes = 96
		WHERE r.schedule_id = ? AND rs.section_key = 'reading-writing'`, sch.ID); err != nil {
		t.Fatalf("inflate section snapshot: %v", err)
	}
	// Fixture precondition: the raw row really holds the instant the test
	// claims. If this drifts, every later assertion is about a different run.
	var rawStart time.Time
	if err := db.QueryRowContext(ctx, `
		SELECT rs.actual_start_at FROM exam_session_runtime_sections rs
		JOIN exam_session_runtimes r ON r.id = rs.runtime_id
		WHERE r.schedule_id = ? AND rs.status = 'live'`, sch.ID).Scan(&rawStart); err != nil {
		t.Fatalf("read back backdated start: %v", err)
	}
	t.Logf("fixture: anchor=%s raw row start=%s (equal=%v)", anchor.Format(time.RFC3339), rawStart.UTC().Format(time.RFC3339), rawStart.UTC().Equal(anchor))

	// Two real reconciler sweeps, both no-ops for this room: one just after the
	// authored 64-minute boundary + 30 s closing grace (the instant the
	// candidates' clock ran out), one 5.5 minutes later. The snapshot says 96,
	// so section 1 stays live and no break opens — the reported symptom,
	// reproduced at the route's data source.
	reconciler := proctor.NewService(runner, db, nil, nil, nil)
	for _, asOf := range []time.Time{anchor.Add(64*time.Minute + 30*time.Second), anchor.Add(70 * time.Minute)} {
		if _, err := reconciler.ReconcileExpiredSections(ctx, asOf, 20, "route-verify"); err != nil {
			t.Fatalf("reconcile at +%s: %v", asOf.Sub(anchor), err)
		}
	}

	// --- the real route ---
	app := BuildApp(config.Load(), db)
	router := BuildRouter(app)
	path := fmt.Sprintf("/api/v1/proctor/sessions/%s", sch.ID)
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req = req.WithContext(sessionCtx(req.Context(), &auth.Session{UserID: actor, Role: auth.RoleAdmin}))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s: status %d, body %s", path, rec.Code, rec.Body.String())
	}

	body := rec.Body.Bytes()
	var payload runSheetRoutePayload
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("decode detail payload: %v", err)
	}
	rt := payload.Runtime
	if len(rt.Sections) != 2 {
		t.Fatalf("expected the two SAT sections, got %d", len(rt.Sections))
	}
	section := rt.Sections[0]
	t.Logf("route payload: status=%s active-section=%s waiting=%v next=%v deadline=%v remaining=%ds",
		rt.Status, section.SectionKey, rt.WaitingForNextSection, rt.NextSectionStartAt,
		rt.CurrentSectionDeadlineAt, rt.CurrentSectionRemainingSeconds)
	for _, s := range rt.Sections {
		t.Logf("  runtime section: %-15s planned=%3d gap=%2dm status=%s start=%v",
			s.SectionKey, s.PlannedDurationMinutes, s.GapAfterMinutes, s.Status, s.ActualStartAt)
	}
	for _, p := range rt.ExamPlan {
		t.Logf("  examPlan section: %-15s length=%3d gap=%2dm modules=%d",
			p.SectionKey, p.DurationMinutes, p.GapAfterMinutes, len(p.Modules))
	}

	if section.PlannedDurationMinutes != 96 {
		t.Errorf("the route must carry the room's clock (96), got %d", section.PlannedDurationMinutes)
	}
	if section.GapAfterMinutes != 10 {
		t.Errorf("the route must carry the snapshotted break (10), got %d", section.GapAfterMinutes)
	}
	if section.Status != "live" || rt.WaitingForNextSection {
		t.Errorf("mid-section the room must be live with no break: status=%s waiting=%v", section.Status, rt.WaitingForNextSection)
	}
	if rt.NextSectionStartAt != nil {
		t.Errorf("no next-section start may be announced mid-section, got %v", rt.NextSectionStartAt)
	}
	if rt.CurrentSectionDeadlineAt == nil || !rt.CurrentSectionDeadlineAt.UTC().Equal(anchor.Add(96*time.Minute)) {
		t.Errorf("the published deadline must be the runtime's 96-minute boundary, got %v", rt.CurrentSectionDeadlineAt)
	}
	// The read is at real now, ~70 minutes into the run: the inflated clock must
	// still show live Reading & Writing time (96m - 70m ≈ 26m), not the stale
	// 64-minute value written at Start and not zero.
	if rt.CurrentSectionRemainingSeconds <= 0 || rt.CurrentSectionRemainingSeconds > 26*60 {
		t.Errorf("a mid-section read must report 0 < remaining <= 26m on the 96-minute clock, got %ds", rt.CurrentSectionRemainingSeconds)
	}
	if len(rt.ExamPlan) != 2 || rt.ExamPlan[0].DurationMinutes != 64 || len(rt.ExamPlan[0].Modules) != 3 {
		t.Errorf("the authored plan must ride along for comparison (64 + 3 modules), got %+v", rt.ExamPlan)
	}

	pathOut := os.Getenv("SAT_VERIFY_DUMP")
	if pathOut == "" {
		pathOut = "/tmp/sat-session-detail.json"
	}
	if err := os.WriteFile(pathOut, body, 0o644); err != nil {
		t.Fatalf("write payload: %v", err)
	}
	t.Logf("wrote %d bytes of route payload to %s", len(body), pathOut)
}
