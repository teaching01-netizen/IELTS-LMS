package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/runtime"
)

// pollTestApp builds an App whose poll view is pre-seeded (zero SQL on
// PollView) and whose session authorizes sched-1 via one registrations row.
func pollTestApp(rev int64, status string) (*App, sqlmock.Sqlmock) {
	db, mock, err := sqlmock.New()
	if err != nil {
		panic(err)
	}
	cache := runtime.NewSnapshotCache(time.Minute)
	active := "rw"
	if _, err := cache.Get(context.Background(), "sched-1", time.Now().UTC(), func() (runtime.Snapshot, error) {
		return runtime.Snapshot{Status: status, ActiveSectionKey: &active, Revision: rev, TimingModel: "legacy_section_v1", SectionLive: true, SectionStarted: true, LoadedAt: time.Now().UTC()}, nil
	}); err != nil {
		panic(err)
	}
	app := &App{
		Config:  config.Load(),
		DB:      db,
		Runtime: runtime.NewService(tx.NewRunner(db), nil).SetSnapshotCache(cache),
	}
	return app, mock
}

func pollAuthed(req *http.Request, mock sqlmock.Sqlmock) *http.Request {
	mock.ExpectQuery("FROM schedule_registrations").
		WillReturnRows(sqlmock.NewRows([]string{"schedule_id"}).AddRow("sched-1"))
	return req.WithContext(context.WithValue(req.Context(), sessionCtxKey, &auth.Session{UserID: "u1", Role: auth.RoleStudent}))
}

// C3: sinceRevision == current -> 304 with empty body (bandwidth-free).
func TestRuntimePollNotModified(t *testing.T) {
	app, mock := pollTestApp(9, "live")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/student/sessions/sched-1/runtime?sinceRevision=9", nil)
	rec := httptest.NewRecorder()
	runtimePollHandler(app)(rec, reqWithSchedule(pollAuthed(req, mock), "sched-1"))
	res := rec.Result()
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotModified {
		t.Fatalf("equal revision must 304, got %d", res.StatusCode)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// C3: stale cursor -> 200 delta {revision,status,activeSection,pollAfterSecs}.
func TestRuntimePollDelta(t *testing.T) {
	app, mock := pollTestApp(10, "paused")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/student/sessions/sched-1/runtime?sinceRevision=9", nil)
	rec := httptest.NewRecorder()
	runtimePollHandler(app)(rec, reqWithSchedule(pollAuthed(req, mock), "sched-1"))
	res := rec.Result()
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("stale revision must 200, got %d", res.StatusCode)
	}
	body := rec.Body.String()
	for _, want := range []string{`"revision":10`, `"status":"paused"`, `"pollAfterSecs"`} {
		if !containsStr(body, want) {
			t.Fatalf("delta must contain %s, got %s", want, body)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// C3: negative sinceRevision -> 400 (same parity as the WS
// lastSeenRuntimeRevision query param validation).
func TestRuntimePollBadCursor(t *testing.T) {
	app, mock := pollTestApp(10, "live")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/student/sessions/sched-1/runtime?sinceRevision=-1", nil)
	rec := httptest.NewRecorder()
	runtimePollHandler(app)(rec, reqWithSchedule(pollAuthed(req, mock), "sched-1"))
	if rec.Result().StatusCode != http.StatusBadRequest {
		t.Fatalf("negative cursor must 400, got %d", rec.Result().StatusCode)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func reqWithSchedule(r *http.Request, scheduleID string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("scheduleID", scheduleID)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

func containsStr(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}

// A transfer changes the writer even when the shared room revision is steady.
func TestRuntimePollWriterFenceBeforeNotModified(t *testing.T) {
	for _, tc := range []struct {
		name, policy, owner string
		want                int
	}{
		{"original writer", "sat_single_writer_v1", "browser-old", http.StatusNotModified},
		{"transferred writer", "sat_single_writer_v1", "browser-new", http.StatusConflict},
		{"recovery held", "sat_single_writer_v1", "", http.StatusConflict},
		{"legacy multi device", "", "browser-new", http.StatusNotModified},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app, mock := pollTestApp(9, "live")
			defer app.DB.Close()
			req := httptest.NewRequest(http.MethodGet, "/api/v1/student/sessions/sched-1/runtime?sinceRevision=9&candidateId=W123&clientSessionId=browser-old", nil)
			req.Header.Set("If-None-Match", runtimePollETag("sched-1", 9))
			req = pollAuthed(req, mock)
			mock.ExpectQuery("SELECT id, COALESCE\\(user_id").WithArgs("sched-1", "W123", "W123", "W123").WillReturnRows(sqlmock.NewRows([]string{"id", "user_id"}).AddRow("att-1", "u1"))
			mock.ExpectQuery("SELECT 1 FROM schedule_registrations").WithArgs("sched-1", "u1", "u1").WillReturnRows(sqlmock.NewRows([]string{"1"}).AddRow(1))
			mock.ExpectQuery("SELECT CASE WHEN recovery_control").WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"writer_policy", "active_client_session_id"}).AddRow(tc.policy, tc.owner))
			rec := httptest.NewRecorder()
			runtimePollHandler(app)(rec, reqWithSchedule(req, "sched-1"))
			if rec.Code != tc.want {
				t.Fatalf("want %d, got %d: %s", tc.want, rec.Code, rec.Body.String())
			}
			if tc.want == http.StatusConflict && !containsStr(rec.Body.String(), "SESSION_ALREADY_ACTIVE") {
				t.Fatalf("missing ownership signal: %s", rec.Body.String())
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
