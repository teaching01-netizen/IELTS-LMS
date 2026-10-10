package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func TestSATStartCodeStaffScopeMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	now := time.Now().UTC()
	f := newCodeStartFixture(t, db, now.Add(-time.Minute), now.Add(time.Hour))
	code := f.code(t)
	org := uuid.NewString()
	otherOrg := uuid.NewString()
	if _, err := db.Exec("UPDATE exam_schedules SET organization_id = ? WHERE id = ?", org, f.scheduleID); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, role, assignment string
		foreign                bool
		want                   int
	}{
		{"admin", auth.RoleAdmin, "", false, 200},
		{"assigned-proctor", auth.RoleProctor, "proctor", false, 200},
		{"grader-assignment-is-not-proctor-assignment", auth.RoleProctor, "grader", false, 404},
		{"unassigned-proctor", auth.RoleProctor, "", false, 404},
		{"observer", auth.RoleAdminObserver, "", false, 403},
		{"grader", auth.RoleGrader, "grader", false, 403},
		{"student", auth.RoleStudent, "", false, 403},
		{"foreign-admin", auth.RoleAdmin, "", true, 404},
		{"foreign-proctor", auth.RoleProctor, "proctor", true, 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			user := uuid.NewString()
			if _, err := db.Exec("INSERT INTO users (id, email, display_name, role, state) VALUES (?, ?, 'Staff scope fixture', ?, 'active')", user, user+"@example.test", tc.role); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				_, _ = db.Exec("DELETE FROM schedule_staff_assignments WHERE user_id = ?", user)
				_, _ = db.Exec("DELETE FROM users WHERE id = ?", user)
			})
			if tc.assignment != "" {
				if _, err := db.Exec("INSERT INTO schedule_staff_assignments (id, schedule_id, actor_id, user_id, role, granted_by) VALUES (?, ?, ?, ?, ?, ?)", uuid.NewString(), f.scheduleID, user, user, tc.assignment, user); err != nil {
					t.Fatal(err)
				}
			}
			sessionOrg := org
			if tc.foreign {
				sessionOrg = otherOrg
			}
			session := &auth.Session{UserID: user, Role: tc.role, OrganizationID: &sessionOrg}
			router := chi.NewRouter()
			router.Use(func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					next.ServeHTTP(w, r.WithContext(sessionCtx(r.Context(), session)))
				})
			})
			router.Get("/sessions/{scheduleID}/start-code", proctorStartCodeRevealHandler(f.app))
			router.Post("/sessions/{scheduleID}/start-code/rotate", proctorStartCodeRotateHandler(f.app))
			for _, method := range []string{http.MethodGet, http.MethodPost} {
				path := "/sessions/" + f.scheduleID + "/start-code"
				body := bytes.NewBufferString(`{"expectedGeneration":0}`)
				if method == http.MethodPost {
					path += "/rotate"
				}
				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, httptest.NewRequest(method, path, body))
				want := tc.want
				if method == http.MethodPost && want == 200 {
					want = 400
				}
				if rec.Code != want {
					t.Fatalf("%s: status=%d want=%d body=%s", method, rec.Code, want, rec.Body.String())
				}
				if method == http.MethodGet && want == 200 {
					var view startCodeView
					if err := json.Unmarshal(rec.Body.Bytes(), &view); err != nil {
						t.Fatal(err)
					}
					if view.Code != code.Value || rec.Header().Get("Cache-Control") != "private, no-store" {
						t.Fatal("authorized reveal must return the code without permitting caching")
					}
				} else if strings.Contains(rec.Body.String(), code.Value) {
					t.Fatal("refusal leaked the code")
				}
			}
		})
	}
}
