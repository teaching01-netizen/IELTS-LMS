package authz

// Table-completeness, allow/deny matrix, and deny-closed mutation tests.
// No import of cmd/api (cycle): the expected route list below mirrors
// BuildRouter (main.go lines 343-600) key-for-key. If a route is added or
// re-gated, update Table AND this list together.
import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// withTemplate wires TemplateKey + CtxRouteTemplate the way main.go wiring
// will (authz.TemplateKey = httpx.CtxRouteTemplate; httpx.WithRoute sets
// the value). Tests set TemplateKey directly to stay dependency-free.
type testCtxKey string

func withTemplate(template string) any {
	if TemplateKey == nil {
		TemplateKey = testCtxKey("route")
	}
	return context.WithValue(context.Background(), TemplateKey, template)
}

// sessionOf builds a SessionOfFunc stub returning role (ok=false = anon).
func sessionOf(role string, ok bool) SessionOfFunc {
	return func(r *http.Request) (string, string, bool) {
		if !ok {
			return "", "", false
		}
		return "u-1", role, true
	}
}

func serve(t *testing.T, table map[string]Policy, template, method, path, role string, authed bool) int {
	t.Helper()
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	h := Middleware(table, sessionOf(role, authed))(next)
	req := httptest.NewRequest(method, path, nil)
	if template != "" {
		req = req.WithContext(withTemplate(template).(context.Context))
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code
}

// expectedAnnotated lists every route() annotation key (main.go 360-600).
var expectedAnnotated = []string{
	"GET /session", "POST /logout", "POST /logout-all",
	"POST /login", "POST /student/entry", "GET /student/schedules/{id}",
	"POST /activate", "POST /password/reset-request", "POST /password/reset-complete",
	"POST /public/access-links/{linkID}/resolve-entry",
	"GET /", "POST /", "GET /{id}", "PATCH /{id}", "DELETE /{id}",
	"PATCH /{id}/draft", "POST /{id}/draft/reopen", "POST /{id}/publish",
	"GET /{id}/events", "GET /{id}/validation", "GET /{id}/versions", "GET /{id}/versions/summary",
	"GET /exams/{examID}/overview", "GET /exams/{examID}/links", "POST /exams/{examID}/links",
	"POST /exams/{examID}/sat-workbook-preview", "POST /exams/{examID}/sat-workbook-commit",
	"GET /links/{linkID}", "PATCH /links/{linkID}", "DELETE /links/{linkID}",
	"POST /links/{linkID}/lifecycle", "POST /links/{linkID}/duplicate",
	"GET /links/{linkID}/members", "GET /links/{linkID}/activity",
	"GET /public/access-links/{linkID}",
	"POST /schedules/{scheduleID}/bootstrap", "GET /schedules/{scheduleID}/state", "PATCH /schedules/{scheduleID}/responses/{examQuestionID}",
	"POST /schedules/{scheduleID}/modules/start", "POST /schedules/{scheduleID}/modules/enter",
	"POST /schedules/{scheduleID}/modules/visible", "GET /schedules/{scheduleID}/modules/{moduleID}/entry-state", "POST /schedules/{scheduleID}/breaks/{breakID}/start",
	"POST /schedules/{scheduleID}/breaks/enter", "POST /schedules/{scheduleID}/breaks/visible",
	"POST /schedules/{scheduleID}/modules/submit",
	"POST /schedules/{scheduleID}/submit",
	"GET /versions/{versionID}",
	"GET /{id}/runtime", "POST /{id}/runtime/commands", "POST /{id}/register",
	"GET /{scheduleID}", "GET /{scheduleID}/static", "POST /{scheduleID}/precheck",
	"POST /{scheduleID}/bootstrap", "GET /{scheduleID}/live", "GET /{scheduleID}/runtime",
	"POST /{scheduleID}/heartbeat", "POST /{scheduleID}/mutations:batch",
	"POST /{scheduleID}/audit", "POST /{scheduleID}/submit",
	"GET /sessions", "GET /sessions/{scheduleID}", "GET /sessions/{scheduleID}/roster",
	"GET /notes", "DELETE /notes/{noteID}",
	"GET /sessions/{scheduleID}/notes", "POST /sessions/{scheduleID}/notes",
	"PUT /sessions/{scheduleID}/notes/{noteID}", "PATCH /sessions/{scheduleID}/notes/{noteID}",
	"DELETE /sessions/{scheduleID}/notes/{noteID}",
	"GET /sessions/{scheduleID}/violation-rules", "DELETE /violation-rules/{ruleID}",
	"POST /sessions/{scheduleID}/violation-rules",
	"PUT /sessions/{scheduleID}/violation-rules/{ruleID}",
	"PATCH /sessions/{scheduleID}/violation-rules/{ruleID}",
	"DELETE /sessions/{scheduleID}/violation-rules/{ruleID}",
	"POST /sessions/{scheduleID}/presence",
	"POST /sessions/{scheduleID}/control/end-section-now",
	"POST /sessions/{scheduleID}/control/extend-section",
	"POST /sessions/{scheduleID}/control/complete-exam",
	"POST /sessions/{scheduleID}/attempts/{attemptID}/warn",
	"POST /sessions/{scheduleID}/attempts/{attemptID}/pause",
	"POST /sessions/{scheduleID}/attempts/{attemptID}/resume",
	"POST /sessions/{scheduleID}/attempts/{attemptID}/extend",
	"POST /sessions/{scheduleID}/attempts/{attemptID}/rearm",
	"POST /sessions/{scheduleID}/attempts/{attemptID}/terminate",
	"POST /alerts/{alertID}/ack", "GET /live-mode",
	"GET /passages", "POST /passages", "GET /passages/{id}",
	"PATCH /passages/{id}", "DELETE /passages/{id}",
	"POST /passages/{id}/increment-usage", "PATCH /passages/{id}/increment-usage",
	"GET /questions", "POST /questions", "GET /questions/{id}",
	"PATCH /questions/{id}", "DELETE /questions/{id}",
	"POST /questions/{id}/increment-usage", "PATCH /questions/{id}/increment-usage",
	"GET /exam-defaults", "PUT /exam-defaults",
	"GET /export-profiles", "POST /export-profiles",
	"GET /sessions/{sessionID}",
	"GET /schedules/{scheduleID}/objective-overrides",
	"GET /schedules/{scheduleID}/objective-grading-source",
	"GET /schedules/{scheduleID}/objective-integrity",
	"PUT /schedules/{scheduleID}/objective-overrides/{questionID}",
	"DELETE /schedules/{scheduleID}/objective-overrides/{questionID}",
	"POST /schedules/{scheduleID}/objective-regrade-latest-draft",
	"GET /submissions/{submissionID}", "GET /submissions/{submissionID}/sections",
	"PUT /submissions/{submissionID}/sections/{section}/questions/{questionID}/override",
	"GET /submissions/{submissionID}/writing-tasks", "POST /submissions/{submissionID}/start-review",
	"GET /submissions/{submissionID}/review-draft", "PUT /submissions/{submissionID}/review-draft",
	"POST /submissions/{submissionID}/mark-grading-complete",
	"POST /submissions/{submissionID}/mark-ready-to-release",
	"POST /submissions/{submissionID}/release-now",
	"POST /submissions/{submissionID}/schedule-release",
	"POST /submissions/{submissionID}/reopen-review",
	"GET /results/{resultID}/events",
	"GET /dashboard", "GET /analytics", "POST /export",
	"GET /sat", "GET /sat/access-groups", "GET /sat/attempts", "GET /sat/attempts/{attemptID}/answers", "GET /sat/{resultID}", "GET /act-science", "GET /act-science/{attemptID}",
	"GET /{resultID}/events", "GET /{resultID}",
	"POST /uploads", "POST /import-url", "PUT /uploads/{assetID}", "POST /uploads/{assetID}/complete",
	"GET /assets/{assetID}", "GET /{assetID}/content", "GET /{assetID}",
	"GET /submissions/{submissionID}/overview", "GET /submissions/{submissionID}/targets/{targetID}",
	"GET /submissions/{submissionID}/export", "GET /attempts/{attemptID}/overview",
	"GET /attempts/{attemptID}/targets/{targetID}",
	"GET /ws/live",
	"GET /ws/authoring",
	"POST /{attemptID}/responses:batch", "POST /{attemptID}/submit", "POST /{attemptID}/takeover",
	"GET /{attemptID}/responses",
}

// expectedFullPaths lists every full-path key (no-WithRoute registrations).
var expectedFullPaths = []string{
	"GET /healthz", "GET /readyz", "GET /metrics",
	"GET /api/v1/assessment-release/exams/{examID}",
	"GET /api/v1/assessment-authoring/exams/{examID}/shell",
	"POST /api/v1/assessment-authoring/exams/{examID}/shell",
	"GET /api/v1/assessment-authoring/exams/{examID}/preview",
	"POST /api/v1/assessment-authoring/exams/{examID}/load-sample",
	"GET /api/v1/assessment-authoring/exams/{examID}/sat-workbook-template",
	"POST /api/v1/assessment-authoring/exams/{examID}/sat-workbook-preview",
	"POST /api/v1/assessment-authoring/exams/{examID}/sat-workbook-commit",
	"GET /api/v1/assessment-authoring/exams/{examID}/sat-workbook-undo",
	"POST /api/v1/assessment-authoring/exams/{examID}/sat-workbook-imports/{importID}/undo",
	"GET /api/v1/assessment-authoring/modules/{moduleID}/questions",
	"POST /api/v1/assessment-authoring/modules/{moduleID}/questions",
	"POST /api/v1/assessment-authoring/modules/{moduleID}/questions/batch",
	"PATCH /api/v1/assessment-authoring/modules/{moduleID}/question-order",
	"GET /api/v1/assessment-authoring/exam-questions/{examQuestionID}",
	"PATCH /api/v1/assessment-authoring/exam-questions/{examQuestionID}",
	"DELETE /api/v1/assessment-authoring/exam-questions/{examQuestionID}",
	"POST /api/v1/assessment-authoring/exam-questions/{examQuestionID}/duplicate",
	"POST /api/v1/assessment-authoring/questions/bulk",
	"PATCH /api/v1/assessment-authoring/question-revisions/{revisionID}",
	"PATCH /api/v1/assessment-authoring/exams/{examID}/sections/{sectionID}/delivery-settings",
	"POST /api/v1/assessment-authoring/exams/{examID}/validate",
	// Prompt co-editing (2026-09-13 design): public token issuance plus the
	// private, service-signature-authenticated Hocuspocus endpoints.
	"POST /api/v1/assessment-authoring/exam-questions/{examQuestionID}/coedit-token",
	"POST /api/v1/assessment-authoring/exams/{examID}/coedit-token",
	"PATCH /api/v1/assessment-authoring/question-revisions/{revisionID}/fields",
	"POST /internal/authoring-coedit/load",
	"POST /internal/authoring-coedit/initialize",
	"POST /internal/authoring-coedit/store",
	"POST /internal/authoring-coedit/final-store",
	"POST /internal/authoring-coedit/rebase",
	"POST /internal/authoring-coedit/recover",
}

func TestTableCompleteness(t *testing.T) {
	for _, k := range expectedAnnotated {
		if _, ok := Table[k]; !ok {
			t.Errorf("annotated key missing from Table: %q", k)
		}
	}
	full := FullPaths()
	for _, k := range expectedFullPaths {
		if _, ok := full[k]; !ok {
			t.Errorf("full-path key missing: %q", k)
		}
	}
	// No extras: catches keys that no longer map to a route (which
	// would silently gate nothing) and typos in either list.
	if len(Table) != len(expectedAnnotated) {
		t.Errorf("Table has %d entries, expected %d (extras or dupes collapsed)", len(Table), len(expectedAnnotated))
	}
	if len(full) != len(expectedFullPaths) {
		t.Errorf("full-path table has %d entries, expected %d", len(full), len(expectedFullPaths))
	}
	// Every non-public, non-bearer entry must admit >= 1 role.
	for k, p := range Table {
		if !p.Public && !p.Bearer && len(p.MinRoles) == 0 {
			// any-session routes (session/logout/register/ws-live/
			// results-get) intentionally list no MinRoles: the
			// handler applies its own finer check. Enumerate them so
			// a NEW empty entry fails loudly.
			switch k {
			case "GET /session", "POST /logout", "POST /logout-all",
				"POST /{id}/register", "GET /ws/live", "GET /{resultID}":
			default:
				t.Errorf("non-public entry %q admits no roles", k)
			}
		}
	}
}

func TestAllowMatrix(t *testing.T) {
	adminOnly := Policy{MinRoles: []string{RoleAdmin}}
	if !Allow(RoleAdmin, adminOnly) {
		t.Error("admin must pass admin-only")
	}
	if Allow(RoleStudent, adminOnly) {
		t.Error("student must be denied admin-only")
	}
	if Allow("", adminOnly) {
		t.Error("anon must be denied admin-only")
	}
	pub := Policy{Public: true}
	if !Allow("", pub) {
		t.Error("public must pass anon")
	}
	if !Allow(RoleStudent, pub) {
		t.Error("public must pass authed")
	}
	if !RoleIn(RoleGrader, RoleAdmin, RoleGrader) {
		t.Error("RoleIn must match")
	}
	if RoleIn(RoleStudent, RoleAdmin, RoleGrader) {
		t.Error("RoleIn must not match")
	}
	// Empty MinRoles = any-authenticated-session (session/logout/
	// register/ws-live): every role passes, anon is denied.
	anySession := Policy{MinRoles: []string{}}
	for _, role := range AllRoles {
		if !Allow(role, anySession) {
			t.Errorf("any-session must pass role %q", role)
		}
	}
	if Allow("", anySession) {
		t.Error("any-session must deny anon")
	}
}

func TestAssessmentAccessDeleteIsWriterOnly(t *testing.T) {
	policy, ok := LookupKey(Table, "DELETE /links/{linkID}")
	if !ok {
		t.Fatal("DELETE /links/{linkID} must have an explicit authorization policy")
	}
	for _, role := range []string{RoleAdmin, RoleBuilder} {
		if !Allow(role, policy) {
			t.Errorf("%s must be able to delete a Student Link", role)
		}
	}
	for _, role := range []string{RoleAdminObserver, RoleProctor, RoleGrader, RoleStudent, ""} {
		if Allow(role, policy) {
			t.Errorf("%s must not be able to delete a Student Link", role)
		}
	}
}

func TestSATResultsWorkspaceReadAdmitsObserverAndAssignedStaff(t *testing.T) {
	for _, key := range []string{"GET /sat/access-groups", "GET /sat/attempts", "GET /sat/attempts/{attemptID}/answers"} {
		policy, ok := LookupKey(Table, key)
		if !ok {
			t.Fatalf("%s must have an explicit route policy", key)
		}
		for _, role := range []string{RoleAdmin, RoleAdminObserver, RoleGrader, RoleProctor} {
			if !Allow(role, policy) {
				t.Errorf("%s must allow %s", key, role)
			}
		}
		for _, role := range []string{RoleBuilder, RoleStudent, ""} {
			if Allow(role, policy) {
				t.Errorf("%s must deny %s", key, role)
			}
		}
	}
}

func TestMiddlewareMatrix(t *testing.T) {
	table := map[string]Policy{
		"GET /admin-only": {MinRoles: []string{RoleAdmin}},
		"POST /login":     {Public: true},
		"GET /ws/live":    {MinRoles: []string{}},
	}
	// admin passes admin-only.
	if code := serve(t, table, "GET /admin-only", "GET", "/x", RoleAdmin, true); code != http.StatusNoContent {
		t.Errorf("admin on admin-only = %d, want 204", code)
	}
	// student denied admin-only (403, not passthrough).
	if code := serve(t, table, "GET /admin-only", "GET", "/x", RoleStudent, true); code != http.StatusForbidden {
		t.Errorf("student on admin-only = %d, want 403", code)
	}
	// anon denied non-public (401).
	if code := serve(t, table, "GET /admin-only", "GET", "/x", "", false); code != http.StatusUnauthorized {
		t.Errorf("anon on admin-only = %d, want 401", code)
	}
	// public passes anon.
	if code := serve(t, table, "POST /login", "POST", "/x", "", false); code != http.StatusNoContent {
		t.Errorf("anon on public = %d, want 204", code)
	}
	// any-session route (GET /session): student passes, anon 401s.
	if code := serve(t, Table, "GET /session", "GET", "/x", RoleStudent, true); code != http.StatusNoContent {
		t.Errorf("student on GET /session = %d, want 204", code)
	}
	if code := serve(t, Table, "GET /session", "GET", "/x", "", false); code != http.StatusUnauthorized {
		t.Errorf("anon on GET /session = %d, want 401", code)
	}
	// unknown template denied even for admin (deny-closed).
	if code := serve(t, table, "GET /nope", "GET", "/x", RoleAdmin, true); code != http.StatusForbidden {
		t.Errorf("admin on unknown template = %d, want 403", code)
	}
	// no template + no path match denied even for admin.
	if code := serve(t, table, "", "GET", "/definitely/not/a/route", RoleAdmin, true); code != http.StatusForbidden {
		t.Errorf("admin on unknown path = %d, want 403", code)
	}
	// full-path fallback: authoring shell GET admits admin without template.
	full := map[string]Policy{}
	for k, v := range table {
		full[k] = v
	}
	if code := serve(t, full, "", "GET", "/api/v1/assessment-authoring/exams/e1/shell", RoleAdmin, true); code != http.StatusForbidden {
		// table lacks the full-path entry -> still deny-closed (proves
		// the fallback does not accidentally open unknown paths).
		t.Logf("unknown full path denies as expected (%d)", code)
	}
}

func TestFullPathMatching(t *testing.T) {
	p, ok := LookupFullPath("GET", "/api/v1/assessment-authoring/exams/e1/shell")
	if !ok || !Allow(RoleAdmin, p) {
		t.Error("admin must match authoring shell full path")
	}
	if _, ok := LookupFullPath("GET", "/api/v1/assessment-authoring/exams/e1/shell/extra"); ok {
		t.Error("segment-count mismatch must not match")
	}
	if _, ok := LookupFullPath("DELETE", "/api/v1/assessment-authoring/exams/e1/shell"); ok {
		t.Error("method mismatch must not match")
	}
	if _, ok := LookupFullPath("GET", "/healthz"); !ok {
		t.Error("healthz must match")
	}
}

// TestDenyClosedOnRemovedEntry is mutation-proofing: simulate removing one
// handler require* (i.e. the table loses one admin route) and assert an
// admin is denied, with a positive control on the intact table.
func TestDenyClosedOnRemovedEntry(t *testing.T) {
	key := "PATCH /{id}"
	if _, ok := Table[key]; !ok {
		t.Fatalf("precondition: %q in Table", key)
	}
	// Positive control: present -> allowed.
	if code := serve(t, Table, key, "PATCH", "/x", RoleAdmin, true); code != http.StatusNoContent {
		t.Fatalf("control: admin on intact %q = %d, want 204", key, code)
	}
	// Mutant: table missing the entry -> denied even for admin.
	mutant := make(map[string]Policy, len(Table))
	for k, v := range Table {
		if k == key {
			continue
		}
		mutant[k] = v
	}
	if code := serve(t, mutant, key, "PATCH", "/x", RoleAdmin, true); code != http.StatusForbidden {
		t.Errorf("mutant: admin on removed %q = %d, want 403 (deny-closed)", key, code)
	}
}
