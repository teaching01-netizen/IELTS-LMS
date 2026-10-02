package main

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/background"
	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/config"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gorilla/websocket"
)

func TestLiveForwarderResumesAtSavedCursor(t *testing.T) {
	pool, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	app := &App{DB: pool, Config: config.Config{LiveUpdatePollIntervalMs: 20},
		LiveBus: liveupdates.NewBus(pool, "api-origin"), LiveHub: liveupdates.NewHub()}
	defer app.stopLiveForwarder()
	sub := app.LiveHub.Subscribe(liveupdates.RoleAdmin, nil, nil, nil)
	defer app.LiveHub.Unsubscribe(sub)
	mock.ExpectQuery("SELECT MAX\\(sequence_id\\)").WillReturnRows(sqlmock.NewRows([]string{"max"}).AddRow(10))
	for _, cursor := range []int64{10, 11} {
		mock.ExpectQuery("SELECT sequence_id, origin_instance_id").
			WithArgs(cursor, "api-origin", liveupdates.PollLimit).
			WillReturnRows(sqlmock.NewRows([]string{"seq", "origin", "kind", "id", "rev", "name", "payload", "created_at"}).
				AddRow(cursor+1, "worker-origin", liveupdates.KindScheduleRuntime, "schedule", 1, "runtime", nil, time.Now()))
		startLiveBusForwarder(app)
		startLiveBusForwarder(app) // A duplicate start joins the existing loop.
		select {
		case event := <-sub.Channel():
			if event.SequenceID != cursor+1 {
				t.Fatalf("sequence = %d, want %d", event.SequenceID, cursor+1)
			}
		case <-time.After(time.Second):
			t.Fatal("forwarder did not deliver the next event")
		}
		app.stopLiveForwarder()
		app.LiveForwardMu.Lock()
		saved, initialized, stopped := app.LiveForwardCursor, app.LiveForwardInitialized, app.stopLiveForward == nil
		app.LiveForwardMu.Unlock()
		if saved != cursor+1 || !initialized || !stopped {
			t.Fatalf("pause did not preserve the cursor: %d, initialized=%v, stopped=%v", saved, initialized, stopped)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func waitBackground(t *testing.T, lifecycle *background.Lifecycle, state string) {
	t.Helper()
	until := time.Now().Add(3 * time.Second)
	for time.Now().Before(until) {
		if lifecycle.State() == state {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("state = %s, want %s", lifecycle.State(), state)
}

func TestActivityPrecedesAuthenticationAndProbesBypassAuth(t *testing.T) {
	pool, _, _ := sqlmock.New()
	defer pool.Close()
	var resumes, lookups atomic.Int32
	l := background.NewLifecycle(context.Background(), 20*time.Millisecond, background.LifecycleHooks{Resume: func(context.Context) error { resumes.Add(1); return nil }})
	defer l.Close()
	app := &App{DB: pool, Config: config.Config{SessionCookieName: "session"}, Background: l, SessionResolver: func(_ context.Context, _ *sql.DB, _ *auth.SessionCache, _ config.Config, _ string, _ time.Time) (*auth.Session, error) {
		if l.State() != "active" {
			t.Error("authentication reached DB before activation")
		}
		lookups.Add(1)
		return nil, nil
	}}
	h := activityMiddleware(app)(authMiddleware(app)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) })))
	waitBackground(t, l, "idle")
	for _, path := range []string{"/healthz", "/metrics", "/assets/main.js", "/login", "/readyz", "/internal/authoring-coedit/load"} {
		r := httptest.NewRequest("GET", path, nil)
		r.AddCookie(&http.Cookie{Name: app.Config.EffectiveSessionCookieName(), Value: "token"})
		h.ServeHTTP(httptest.NewRecorder(), r)
	}
	if resumes.Load() != 1 || lookups.Load() != 0 {
		t.Fatal("non-application traffic woke jobs or authenticated")
	}
	r := httptest.NewRequest("GET", "/api/v1/auth/session", nil)
	r.AddCookie(&http.Cookie{Name: app.Config.EffectiveSessionCookieName(), Value: "token"})
	h.ServeHTTP(httptest.NewRecorder(), r)
	if resumes.Load() != 2 || lookups.Load() != 1 {
		t.Fatal("application request did not activate once")
	}
}

func TestCoeditProxyReservationLastsUntilSocketCloses(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}))
	defer upstream.Close()
	l := background.NewLifecycle(context.Background(), 20*time.Millisecond, background.LifecycleHooks{})
	defer l.Close()
	app := &App{Background: l, Config: config.Config{AuthoringCoeditServiceURL: upstream.URL}}
	proxy := httptest.NewServer(activityMiddleware(app)(coeditWebSocketProxy(app)))
	defer proxy.Close()
	waitBackground(t, l, "idle")
	conn, _, err := websocket.DefaultDialer.Dial("ws"+proxy.URL[4:]+coeditPublicProxyPath, nil)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(60 * time.Millisecond)
	if l.State() != "active" {
		t.Fatal("proxy released socket reservation early")
	}
	conn.Close()
	waitBackground(t, l, "idle")
}
