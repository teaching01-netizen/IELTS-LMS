package main

import (
	"context"
	"net/http/httptest"
	"testing"

	"example.com/ielts-proctoring/internal/auth"
	"github.com/go-chi/chi/v5"
)

func TestRecoverySessionRouteScope(t *testing.T) {
	sess := &auth.Session{Role: auth.RoleStudent, Proof: auth.SessionProof{Source: auth.SessionSourceRecovery, RecoveryAttemptID: "attempt-a", RecoveryScheduleID: "schedule-a"}}
	for _, tc := range []struct {
		name, method, path, schedule, attempt string
		allowed                               bool
	}{
		{"self", "GET", "/api/v1/auth/session", "", "", true},
		{"logout", "POST", "/api/v1/auth/logout", "", "", true},
		{"account sessions", "POST", "/api/v1/auth/logout-all", "", "", false},
		{"entry", "POST", "/api/v1/auth/student/entry", "", "", false},
		{"same sitting", "GET", "/api/v1/student/sessions/schedule-a/live", "schedule-a", "", true},
		{"delivery bootstrap", "POST", "/api/v1/assessment-delivery/schedules/schedule-a/bootstrap", "schedule-a", "", true},
		{"foreign delivery bootstrap", "POST", "/api/v1/assessment-delivery/schedules/schedule-b/bootstrap", "schedule-b", "", false},
		{"other sitting", "GET", "/api/v1/student/sessions/schedule-b/live", "schedule-b", "", false},
		{"same attempt", "POST", "/api/v2/student/attempts/attempt-a/responses:batch", "", "attempt-a", true},
		{"v2 alias", "POST", "/v2/student/attempts/attempt-a/responses:batch", "", "attempt-a", true},
		{"other alias attempt", "GET", "/v2/student/attempts/attempt-b/responses", "", "attempt-b", false},
		{"other attempt", "POST", "/api/v2/student/attempts/attempt-b/responses:batch", "", "attempt-b", false},
		{"staff", "GET", "/api/v1/proctor/sessions/schedule-a", "schedule-a", "", false},
		{"unbound media", "GET", "/api/v1/media/asset-a/content", "", "", false},
		{"proof refresh", "POST", "/api/v1/student/device-recovery/grant-a/ready", "", "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			rc := chi.NewRouteContext()
			rc.URLParams.Add("scheduleID", tc.schedule)
			rc.URLParams.Add("attemptID", tc.attempt)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rc))
			if got := recoverySessionRouteAllowed(req, sess); got != tc.allowed {
				t.Fatalf("allowed=%v want %v", got, tc.allowed)
			}
		})
	}
}

func TestOrdinarySessionIsNotRestrictedByRecoveryScope(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/v1/proctor/sessions", nil)
	if !recoverySessionRouteAllowed(req, &auth.Session{Role: auth.RoleAdmin}) {
		t.Fatal("ordinary session was restricted")
	}
}
