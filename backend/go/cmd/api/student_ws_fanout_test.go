package main

// Student live-socket fan-out integration (exam-runtime correctness work).
//
// The student channel was re-enabled behind STUDENT_WS=allow, so its two
// boundaries need a real end-to-end pin rather than a unit test of the filter:
//
//  1. DELIVERY: a student socket receives its own schedule's runtime frames and
//     its own attempt's frames, and nothing else.
//  2. ADMISSION: a student cannot subscribe to a schedule they are not
//     registered for, nor to another student's attempt (denied BEFORE the
//     upgrade, so no unauthorized socket ever exists).
//
// These tests drive a real gorilla socket through liveWebSocketHandler over
// httptest: the upgrade, the handshake frame, the hub subscription, and the
// write pump all run for real. DB-free by construction — admission is the
// memory gate, the hub is real, and the only SQL is the registration/attempt
// authorization lookup (sqlmock).
//
// A gorilla read timeout is PERMANENT for that connection, so "nothing else
// arrived" is asserted once per socket: the test publishes the whole batch and
// then drains until quiet, which is also why the connected frame is read before
// anything is published (the upgrade completes before the handler subscribes).

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/config"
)

// studentLiveApp wires an App whose live path needs no database: memory
// admission, real hub, sqlmock DB so the gate passes and the authorization
// lookup has a handle.
func studentLiveApp(t *testing.T) (*App, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	cfg := config.Load()
	cfg.WSAdmission = config.WSAdmissionMemory
	return &App{
		Config:    cfg,
		DB:        db,
		LiveHub:   liveupdates.NewHub(),
		Admission: liveupdates.NewAdmission(liveupdates.AdmissionCaps{Total: 16, PerUser: 4, PerSchedule: 16}),
	}, mock
}

// studentLiveServer hosts liveWebSocketHandler with a per-request session taken
// from test headers, so one server can host several students.
func studentLiveServer(app *App) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := r.Header.Get("X-Test-User")
		r = r.WithContext(sessionCtx(r.Context(), &auth.Session{UserID: user, Role: auth.RoleStudent}))
		liveWebSocketHandler(app)(w, r)
	}))
}

func studentLiveURL(srv *httptest.Server, scheduleID, attemptID string) string {
	ws := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/ws/live"
	query := url.Values{}
	if scheduleID != "" {
		query.Set("scheduleId", scheduleID)
	}
	if attemptID != "" {
		query.Set("attemptId", attemptID)
	}
	return ws + "?" + query.Encode()
}

// dialStudentLive returns the socket (nil when refused) plus the HTTP status
// seen on a refused handshake.
func dialStudentLive(t *testing.T, srv *httptest.Server, user, scheduleID, attemptID string) (*websocket.Conn, int) {
	t.Helper()
	header := http.Header{}
	header.Set("X-Test-User", user)
	conn, resp, err := websocket.DefaultDialer.Dial(studentLiveURL(srv, scheduleID, attemptID), header)
	if err != nil {
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}
		return nil, status
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn, http.StatusSwitchingProtocols
}

func readLiveFrame(t *testing.T, conn *websocket.Conn, timeout time.Duration) map[string]any {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(timeout))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read live frame: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("live frame is not JSON: %v (%s)", err, data)
	}
	return out
}

// collectLiveFrames drains every frame until the socket goes quiet. The quiet
// window is the isolation assertion: an unfiltered hub would have delivered
// something here, and anything that was going to arrive is already queued
// (Publish is a synchronous in-process channel send).
func collectLiveFrames(t *testing.T, conn *websocket.Conn, quiet time.Duration) []map[string]any {
	t.Helper()
	frames := []map[string]any{}
	for {
		_ = conn.SetReadDeadline(time.Now().Add(quiet))
		_, data, err := conn.ReadMessage()
		if err != nil {
			return frames
		}
		var out map[string]any
		if err := json.Unmarshal(data, &out); err != nil {
			t.Fatalf("live frame is not JSON: %v (%s)", err, data)
		}
		frames = append(frames, out)
	}
}

func liveEventShape(frame map[string]any) string {
	kind, _ := frame["kind"].(string)
	id, _ := frame["id"].(string)
	name, _ := frame["event"].(string)
	return kind + ":" + id + ":" + name
}

func registrationRows(scheduleIDs ...string) *sqlmock.Rows {
	rows := sqlmock.NewRows([]string{"schedule_id"})
	for _, id := range scheduleIDs {
		rows.AddRow(id)
	}
	return rows
}

// TestStudentWSIntegrationFanOutIsScopedToOwnScheduleAndAttempt is the Phase 12
// pin: a student socket carries its own schedule's runtime frames and its own
// attempt's frames, and nothing from a sibling schedule, another attempt, or a
// staff-only topic.
func TestStudentWSIntegrationFanOutIsScopedToOwnScheduleAndAttempt(t *testing.T) {
	app, mock := studentLiveApp(t)
	mock.ExpectQuery("FROM schedule_registrations").WithArgs("u-1", "u-1").
		WillReturnRows(registrationRows("sched-1"))
	mock.ExpectQuery("FROM student_attempts WHERE id").WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"schedule_id", "user_id"}).AddRow("sched-1", "u-1"))

	srv := studentLiveServer(app)
	defer srv.Close()

	conn, status := dialStudentLive(t, srv, "u-1", "sched-1", "att-1")
	if conn == nil {
		t.Fatalf("a registered student must be admitted, got status %d", status)
	}

	// Read the handshake first: it is written AFTER the hub subscription, so
	// receiving it proves the subscription exists before anything is published.
	connected := readLiveFrame(t, conn, 2*time.Second)
	if connected["type"] != "connected" || connected["scheduleId"] != "sched-1" || connected["attemptId"] != "att-1" {
		t.Fatalf("handshake must echo the authorized binding, got %v", connected)
	}

	// Own schedule's runtime transition: the frame that opens the exam.
	app.LiveHub.Publish(liveupdates.Event{SequenceID: 1, Kind: liveupdates.KindScheduleRuntime,
		ID: "sched-1", Revision: 4, Name: "start_runtime"})
	// Sibling schedule: same kind, different topic.
	app.LiveHub.Publish(liveupdates.Event{SequenceID: 2, Kind: liveupdates.KindScheduleRuntime,
		ID: "sched-2", Revision: 9, Name: "start_runtime"})
	// Own attempt.
	app.LiveHub.Publish(liveupdates.Event{SequenceID: 3, Kind: liveupdates.KindAttempt,
		ID: "att-1", Revision: 2, Name: "answer_updated"})
	// Another student's attempt.
	app.LiveHub.Publish(liveupdates.Event{SequenceID: 4, Kind: liveupdates.KindAttempt,
		ID: "att-2", Revision: 5, Name: "answer_updated"})
	// Staff-only topic on this student's own schedule.
	app.LiveHub.Publish(liveupdates.Event{SequenceID: 5, Kind: liveupdates.KindScheduleRoster,
		ID: "sched-1", Revision: 6, Name: "roster_changed"})

	frames := collectLiveFrames(t, conn, 400*time.Millisecond)
	if len(frames) != 2 {
		t.Fatalf("only the student's own runtime + attempt frames may arrive, got %d: %v", len(frames), frames)
	}
	if got := liveEventShape(frames[0]); got != "schedule_runtime:sched-1:start_runtime" {
		t.Fatalf("first frame must be the own-schedule transition, got %s", got)
	}
	if revision, _ := frames[0]["revision"].(float64); int64(revision) != 4 {
		t.Fatalf("runtime frame must carry the committed revision, got %v", frames[0]["revision"])
	}
	if got := liveEventShape(frames[1]); got != "attempt:att-1:answer_updated" {
		t.Fatalf("second frame must be the own-attempt update, got %s", got)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestStudentWSIntegrationDeniesForeignScheduleAndAttemptBeforeUpgrade pins the
// authorization boundary the fan-out test cannot: a student may not open a
// socket for a schedule they are not registered for, nor bind it to another
// student's attempt. Both are refused before the upgrade, so no unauthorized
// socket exists even briefly.
func TestStudentWSIntegrationDeniesForeignScheduleAndAttemptBeforeUpgrade(t *testing.T) {
	app, mock := studentLiveApp(t)
	// One registration lookup per dial; u-1 is registered for sched-1 only.
	mock.ExpectQuery("FROM schedule_registrations").WithArgs("u-1", "u-1").
		WillReturnRows(registrationRows("sched-1"))
	mock.ExpectQuery("FROM schedule_registrations").WithArgs("u-1", "u-1").
		WillReturnRows(registrationRows("sched-1"))
	// att-9 exists but belongs to another student.
	mock.ExpectQuery("FROM student_attempts WHERE id").WithArgs("att-9").
		WillReturnRows(sqlmock.NewRows([]string{"schedule_id", "user_id"}).AddRow("sched-1", "u-2"))

	srv := studentLiveServer(app)
	defer srv.Close()

	// Foreign schedule, no attempt binding: the schedule check alone must deny.
	if conn, status := dialStudentLive(t, srv, "u-1", "sched-2", ""); conn != nil || status != http.StatusNotFound {
		t.Fatalf("a foreign schedule must be denied before upgrade (want 404), got conn=%v status=%d", conn != nil, status)
	}
	if conn, status := dialStudentLive(t, srv, "u-1", "sched-1", "att-9"); conn != nil || status != http.StatusNotFound {
		t.Fatalf("another student's attempt must be denied before upgrade (want 404), got conn=%v status=%d", conn != nil, status)
	}
	if got := app.Admission.Active(); got != 0 {
		t.Fatalf("a denied handshake must hold no lease, active=%d", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestStudentWSIntegrationRetiredFlagStill410s pins the rollback: with
// STUDENT_WS=gone the socket is refused with 410 before any authorization SQL
// runs, which is what the client's bounded connect budget exists to absorb.
func TestStudentWSIntegrationRetiredFlagStill410s(t *testing.T) {
	app, mock := studentLiveApp(t)
	app.Config.StudentWS = config.StudentWSGone

	srv := studentLiveServer(app)
	defer srv.Close()

	if conn, status := dialStudentLive(t, srv, "u-1", "sched-1", "att-1"); conn != nil || status != http.StatusGone {
		t.Fatalf("STUDENT_WS=gone must 410 the student socket, got conn=%v status=%d", conn != nil, status)
	}
	// Fail-closed: the retired posture must not even attempt authorization.
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
