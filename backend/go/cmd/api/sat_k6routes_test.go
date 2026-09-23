package main

// SAT exam-day route pin: k6/sat-exam-day.js is exam-day code — a rename
// that 404s the SAT walk must fail the build, not the rehearsal. Pins the
// SAT delivery matrix (bootstrap / responses / modules/start / submit) plus
// the V2 response batch/submit and the SAT result-detail read used by the
// answer comparator, against the real chi router.
import (
	"net/http"
	"net/http/httptest"
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
)

func TestK6SATExamDayRoutesExist(t *testing.T) {
	cfg := config.Load()
	h := BuildRouter(BuildApp(cfg, nil))
	cases := []struct {
		name   string
		method string
		target string
	}{
		{"sat-entry", http.MethodPost, "/api/v1/auth/student/entry"},
		{"sat-v1-bootstrap", http.MethodPost, "/api/v1/student/sessions/sched-1/bootstrap"},
		{"sat-delivery-bootstrap", http.MethodPost, "/api/v1/assessment-delivery/schedules/sched-1/bootstrap"},
		{"sat-save-response", "PATCH", "/api/v1/assessment-delivery/schedules/sched-1/responses/q-1"},
		{"sat-start-module", http.MethodPost, "/api/v1/assessment-delivery/schedules/sched-1/modules/start"},
		{"sat-submit-module", http.MethodPost, "/api/v1/assessment-delivery/schedules/sched-1/modules/submit"},
		{"sat-submit-assessment", http.MethodPost, "/api/v1/assessment-delivery/schedules/sched-1/submit"},
		{"sat-v2-batch", http.MethodPost, "/api/v2/student/attempts/att-1/responses:batch"},
		{"sat-v2-submit", http.MethodPost, "/api/v2/student/attempts/att-1/submit"},
		{"sat-v2-snapshot", http.MethodGet, "/api/v2/student/attempts/att-1/responses"},
		{"sat-result-list", http.MethodGet, "/api/v1/results/sat"},
		{"sat-proctor-roster", http.MethodGet, "/api/v1/proctor/sessions/sched-1"},
		{"sat-runtime-commands", http.MethodPost, "/api/v1/schedules/sched-1/runtime/commands"},
	}
	for _, c := range cases {
		req := httptest.NewRequest(c.method, c.target, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == http.StatusNotFound {
			t.Fatalf("sat-exam-day path drifted (404): %s %s %s", c.name, c.method, c.target)
		}
	}
}
