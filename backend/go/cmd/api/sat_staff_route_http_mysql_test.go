package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/schedules"
)

// NT-3 (TC-18, R-15): staff Module 2 routing over HTTP. Anonymous callers get
// 401, students 403, staff outside the schedule 404; nothing is committed by a
// refused caller. An assigned proctor commits.
func TestSATStaffRouteHTTPAuthorizationMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()
	schedule, attempt, _, _, _ := seedStaleETagExam(t, db)
	if _, err := db.ExecContext(ctx, "UPDATE exam_schedules SET sat_session_mode = 'classroom', sat_route_policy = 'staff_selects' WHERE id = ?", schedule); err != nil {
		t.Fatal(err)
	}
	runner := tx.NewRunner(db)
	svc := delivery.NewService(db, runner)
	if _, err := svc.ReconcileAttemptTimeout(ctx, schedule, attempt, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	app := &App{DB: db, Delivery: svc, Schedules: schedules.NewService(db, runner)}
	router := chi.NewRouter()
	router.Post("/sessions/{scheduleID}/attempts/{attemptID}/route", proctorAssignRouteHandler(app))

	assigned := uuid.NewString()
	if _, err := db.Exec("INSERT INTO schedule_staff_assignments (id, schedule_id, actor_id, user_id, role, granted_by) VALUES (?, ?, ?, ?, 'proctor', ?)", uuid.NewString(), schedule, assigned, assigned, assigned); err != nil {
		t.Fatal(err)
	}
	org, otherOrg := "stale-etag-org", "other-org-"+uuid.NewString()
	post := func(sess *auth.Session) int {
		body, _ := json.Marshal(map[string]string{"sectionKey": "reading-writing", "route": "higher"})
		req := httptest.NewRequest(http.MethodPost, "/sessions/"+schedule+"/attempts/"+attempt+"/route", bytes.NewReader(body))
		if sess != nil {
			req = req.WithContext(context.WithValue(req.Context(), sessionCtxKey, sess))
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec.Code
	}
	decisions := func() int {
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM assessment_route_decisions WHERE attempt_id = ?", attempt).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	for _, c := range []struct {
		name string
		sess *auth.Session
		want int
	}{
		{"anonymous", nil, http.StatusUnauthorized},
		{"student", &auth.Session{UserID: uuid.NewString(), Role: auth.RoleStudent, OrganizationID: &org}, http.StatusForbidden},
		{"unassigned proctor", &auth.Session{UserID: uuid.NewString(), Role: auth.RoleProctor, OrganizationID: &org}, http.StatusNotFound},
		{"admin of another organization", &auth.Session{UserID: uuid.NewString(), Role: auth.RoleAdmin, OrganizationID: &otherOrg}, http.StatusNotFound},
	} {
		if got := post(c.sess); got != c.want {
			t.Fatalf("%s: status %d, want %d", c.name, got, c.want)
		}
		if n := decisions(); n != 0 {
			t.Fatalf("%s: refused caller committed %d decisions", c.name, n)
		}
	}
	awaiting := func() bool {
		b, err := svc.Bootstrap(ctx, schedule, attempt, schedule)
		if err != nil {
			t.Fatal(err)
		}
		return b.AwaitingStaffRoute
	}
	if !awaiting() {
		t.Fatal("parked attempt must read as awaiting staff")
	}
	if got := post(&auth.Session{UserID: assigned, Role: auth.RoleProctor, OrganizationID: &org}); got != http.StatusOK {
		t.Fatalf("assigned proctor: status %d, want 200", got)
	}
	if n := decisions(); n != 1 {
		t.Fatalf("assigned proctor committed %d decisions, want 1", n)
	}
	// NT-8 (S8): this service has no hub, so the post-commit event is lost; a
	// plain re-read still converges on the routed state.
	if awaiting() {
		t.Fatal("re-read after a lost hub event still reports awaiting")
	}
}
