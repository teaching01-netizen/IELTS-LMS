package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
)

// The V1 session/static projection and the SAT delivery reads are separate
// HTTP surfaces. Exercise their raw bodies with the same routed candidate, so
// stimulus, prompt or option content cannot leak through a second projection.
func TestStudentRawContentRoutesFenceUnassignedBranch(t *testing.T) {
	for _, scenario := range []string{"higher", "lower", "higher_client_start", "lower_client_start"} {
		route := strings.Split(scenario, "_")[0]
		clientStart := strings.HasSuffix(scenario, "client_start")
		t.Run(scenario, func(t *testing.T) {
			db := staleETagTestDB(t)
			cfg := config.Load()
			cfg.AuthSecret = "test-secret-with-at-least-32-characters!!"
			app := BuildApp(cfg, db)
			scheduleID, attemptID, _, lowID, highID := seedStaleETagExam(t, db)
			userID := uuid.NewString()
			ctx := context.Background()
			if clientStart {
				if _, err := db.ExecContext(ctx, "UPDATE exam_session_runtimes SET timing_model = 'sat_personal_v1', sat_handoff_mode = 'client_start' WHERE schedule_id = ?", scheduleID); err != nil {
					t.Fatal(err)
				}
				if _, err := db.ExecContext(ctx, "UPDATE exam_schedules SET sat_timing_model = 'sat_personal_v1' WHERE id = ?", scheduleID); err != nil {
					t.Fatal(err)
				}
			}

			canaries := map[string][]string{}
			for label, moduleID := range map[string]string{"lower": lowID, "higher": highID} {
				parts := []string{
					"SAT_STIMULUS_" + moduleID,
					"SAT_PROMPT_" + moduleID,
					"SAT_OPTION_" + moduleID,
				}
				canaries[label] = append([]string{moduleID}, parts...)
				stimulus := fmt.Sprintf(`{"version":1,"nodes":[{"type":"paragraph","text":%q}]}`, parts[0])
				prompt := fmt.Sprintf(`{"version":1,"nodes":[{"type":"paragraph","text":%q}]}`, parts[1])
				answer := fmt.Sprintf(`{"kind":"single_choice","correctOptionId":"B","options":[{"id":"A","content":%q}]}`, parts[2])
				if _, err := db.ExecContext(ctx, `UPDATE assessment_question_revisions qr
					JOIN assessment_exam_questions eq ON eq.question_revision_id = qr.id
					SET qr.stimulus = ?, qr.prompt = ?, qr.answer_definition = ?
					WHERE eq.module_id = ? AND eq.display_order = 0`, stimulus, prompt, answer, moduleID); err != nil {
					t.Fatal(err)
				}
			}
			content := map[string]any{"sections": []any{map[string]any{"modules": []any{
				branchSnapshot(lowID, "lower_branch", canaries["lower"]),
				branchSnapshot(highID, "higher_branch", canaries["higher"]),
			}}}}
			encoded, err := json.Marshal(content)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `UPDATE exam_versions SET content_snapshot = ? WHERE id = (SELECT published_version_id FROM exam_schedules WHERE id = ?)`, encoded, scheduleID); err != nil {
				t.Fatal(err)
			}
			if route == "lower" {
				if _, err := db.ExecContext(ctx, `UPDATE attempt_responses_v2 SET response = '{"answer":"C","markedForReview":false,"eliminatedOptions":[],"annotations":[]}' WHERE attempt_id = ?`, attemptID); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := db.ExecContext(ctx, `UPDATE student_attempts SET user_id = ? WHERE id = ?`, userID, attemptID); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO users (id, email, display_name, role, state) VALUES (?, ?, 'Canary Candidate', 'student', 'active')`, userID, "canary-"+userID+"@example.test"); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = ?`, userID) })
			registrationID := uuid.NewString()
			if _, err := db.ExecContext(ctx, `INSERT INTO schedule_registrations
				(id, schedule_id, student_key, student_id, student_name, student_email, access_state, user_id, wcode)
				VALUES (?, ?, ?, ?, 'Canary Candidate', 'canary@example.test', 'checked_in', ?, ?)`,
				registrationID, scheduleID, attemptID, userID, userID, "CANARY"+route[:2]); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if _, err := db.ExecContext(context.Background(), `DELETE FROM schedule_registrations WHERE id = ?`, registrationID); err != nil {
					t.Errorf("cleanup registration: %v", err)
				}
			})

			lease := uint64(1)
			token, _, err := auth.IssueAttemptToken(ctx, db, cfg, userID, scheduleID, attemptID, "sess-canary", nil, &lease, time.Now().UTC())
			if err != nil {
				t.Fatal(err)
			}

			router := chi.NewRouter()
			router.Use(chimw.Compress(5, "application/json"))
			router.Post("/api/v1/assessment-delivery/schedules/{scheduleID}/modules/start", deliveryStartModuleHandler(app))
			router.Get("/api/v1/student/sessions/{scheduleID}", v1SessionHandler(app))
			router.Get("/api/v1/student/sessions/{scheduleID}/static", v1StaticHandler(app))
			router.Get("/api/v1/student/sessions/{scheduleID}/live", v1LiveHandler(app))
			router.Post("/api/v1/assessment-delivery/schedules/{scheduleID}/bootstrap", deliveryBootstrapHandler(app))
			router.Get("/api/v1/assessment-delivery/schedules/{scheduleID}/state", deliveryStateHandler(app))
			router.Get("/api/v1/assessment-delivery/schedules/{scheduleID}/modules/{moduleID}/entry-state", deliveryModuleEntryStateHandler(app))

			assigned, unassigned := "higher", "lower"
			assignedID, unassignedID := highID, lowID
			if route == "lower" {
				assigned, unassigned = "lower", "higher"
				assignedID, unassignedID = lowID, highID
			}
			call := func(method, path string, bearer bool) *httptest.ResponseRecorder {
				t.Helper()
				req := httptest.NewRequest(method, path, bytes.NewReader(nil))
				if bearer {
					req.Header.Set("Authorization", "Bearer "+token)
				} else {
					req = req.WithContext(sessionCtx(req.Context(), &auth.Session{UserID: userID, Role: auth.RoleStudent}))
				}
				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, req)
				return rec
			}
			bootstrap := call(http.MethodPost, "/api/v1/assessment-delivery/schedules/"+scheduleID+"/bootstrap", true)
			if bootstrap.Code != http.StatusOK {
				t.Fatalf("delivery bootstrap = %d: %s", bootstrap.Code, bootstrap.Body.String())
			}
			if !strings.Contains(bootstrap.Body.String(), assignedID) {
				t.Fatalf("fixture did not route %s: %s", assigned, bootstrap.Body.String())
			}
			forbidden := call(http.MethodGet, "/api/v1/assessment-delivery/schedules/"+scheduleID+"/modules/"+unassignedID+"/entry-state", true)
			if forbidden.Code != http.StatusNotFound {
				t.Fatalf("unassigned entry state = %d, want 404: %s", forbidden.Code, forbidden.Body.String())
			}
			for _, endpoint := range []struct {
				method, path string
				bearer       bool
			}{
				{http.MethodPost, "/api/v1/assessment-delivery/schedules/" + scheduleID + "/bootstrap", true},
				{http.MethodGet, "/api/v1/assessment-delivery/schedules/" + scheduleID + "/state", true},
				{http.MethodGet, "/api/v1/assessment-delivery/schedules/" + scheduleID + "/modules/" + assignedID + "/entry-state", true},
				// Cookie reads present the owning browser's writer session:
				// under the SAT single-writer policy a non-owner browser is
				// refused protected content (SESSION_ALREADY_ACTIVE).
				{http.MethodGet, "/api/v1/student/sessions/" + scheduleID + "?clientSessionId=sess-canary", false},
				{http.MethodGet, "/api/v1/student/sessions/" + scheduleID + "/static?clientSessionId=sess-canary", false},
				{http.MethodGet, "/api/v1/student/sessions/" + scheduleID + "/live?clientSessionId=sess-canary", false},
			} {
				rec := call(endpoint.method, endpoint.path, endpoint.bearer)
				if rec.Code != http.StatusOK {
					t.Fatalf("%s %s = %d: %s", endpoint.method, endpoint.path, rec.Code, rec.Body.String())
				}
				body := rec.Body.String()
				// The owner's credential refresh rotates its token (same as
				// the browser); keep using the freshly issued bearer.
				var refreshed struct {
					AttemptCredential *struct {
						AttemptToken string `json:"attemptToken"`
					} `json:"attemptCredential"`
				}
				if json.Unmarshal(rec.Body.Bytes(), &refreshed) == nil && refreshed.AttemptCredential != nil && refreshed.AttemptCredential.AttemptToken != "" {
					token = refreshed.AttemptCredential.AttemptToken
				}
				if clientStart {
					for _, canary := range canaries[assigned][1:] {
						if strings.Contains(body, canary) {
							t.Fatalf("unstarted branch leaked on %s: %s", endpoint.path, canary)
						}
					}
				}

				for _, canary := range canaries[unassigned] {
					if strings.Contains(body, canary) {
						t.Fatalf("%s %s exposed unassigned %s canary %q", endpoint.method, endpoint.path, unassigned, canary)
					}
				}
				if !clientStart && (strings.Contains(endpoint.path, "/static?") || strings.HasSuffix(endpoint.path, scheduleID+"?clientSessionId=sess-canary") || strings.HasSuffix(endpoint.path, "/bootstrap")) {
					for _, canary := range canaries[assigned] {
						if !strings.Contains(body, canary) {
							t.Fatalf("%s %s lost assigned %s canary %q", endpoint.method, endpoint.path, assigned, canary)
						}
					}
				}
			}
			if clientStart {
				req := httptest.NewRequest(http.MethodPost, "/api/v1/assessment-delivery/schedules/"+scheduleID+"/modules/start", strings.NewReader(fmt.Sprintf(`{"moduleId":%q,"needContent":true}`, assignedID)))
				req.Header.Set("Authorization", "Bearer "+token)
				req.Header.Set("Accept-Encoding", "gzip")
				req.Header.Set("Content-Type", "application/json")
				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, req)
				if rec.Code != http.StatusOK || rec.Header().Get("Content-Encoding") != "gzip" {
					t.Fatalf("start gzip = %d %s", rec.Code, rec.Body.String())
				}
				compressedSize := rec.Body.Len()
				reader, err := gzip.NewReader(rec.Body)
				if err != nil {
					t.Fatal(err)
				}
				raw, err := io.ReadAll(reader)
				reader.Close()
				if err != nil {
					t.Fatal(err)
				}
				for _, canary := range canaries[assigned] {
					if !strings.Contains(string(raw), canary) {
						t.Fatalf("start lost content %s", canary)
					}
				}
				for _, canary := range canaries[unassigned] {
					if strings.Contains(string(raw), canary) {
						t.Fatalf("start leaked content %s", canary)
					}
				}
				if compressedSize >= len(raw) {
					t.Fatalf("gzip did not reduce content: %d >= %d", compressedSize, len(raw))
				}
				t.Logf("StartModule content: %d bytes gzip / %d bytes JSON", compressedSize, len(raw))
			}

		})
	}
}

func branchSnapshot(moduleID, role string, canaries []string) map[string]any {
	return map[string]any{
		"id": moduleID, "adaptiveRole": role,
		"questions": []any{map[string]any{
			"stimulus": canaries[1], "prompt": canaries[2],
			"answer": map[string]any{"kind": "single_choice", "options": []any{map[string]any{"id": "A", "content": canaries[3]}}},
		}},
	}
}
