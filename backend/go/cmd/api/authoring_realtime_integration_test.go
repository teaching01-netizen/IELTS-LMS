package main

// Phase 03 WS integration suite (plan §8). These tests drive a REAL gorilla
// socket against the handler over httptest, so the upgrade lifecycle, the
// handshake, bounded replay, hub fan-out, and topic isolation are exercised
// end to end rather than through direct function calls.
//
// RED/GREEN: each assertion below pins behavior that is absent (RED) until the
// authoring realtime handler is wired (GREEN). The suite is DB-free by
// construction: the exam ACL loader is injected, admission is the memory gate,
// and the only SQL that ever runs is the replay path (sqlmock).

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/authoringrealtime"
	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/config"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// defaultBarrierCursor is the stub watermark used by tests that do not care
// about the exact replay/live split. It sits above every published test event,
// so a fresh subscribe (which has no replay) still forwards everything.
const defaultBarrierCursor = 1000

// staticBarrier is a deterministic BarrierSource: the handshake never touches
// the DB for the watermark in these tests.
type staticBarrier struct {
	seq int64
	err error
}

func (s staticBarrier) LatestSequence(context.Context) (int64, error) { return s.seq, s.err }

// fakeExamLoader is a DB-free ExamLoader: a map of exam views plus optional
// per-exam errors. Missing exams return the not-found family, exactly like the
// production adapter.
type fakeExamLoader struct {
	views map[string]authoringrealtime.ExamView
	errs  map[string]error
}

func (f fakeExamLoader) LoadExamForActor(_ context.Context, _, _, examID string) (authoringrealtime.ExamView, error) {
	if err, ok := f.errs[examID]; ok {
		return authoringrealtime.ExamView{}, err
	}
	view, ok := f.views[examID]
	if !ok {
		return authoringrealtime.ExamView{}, authoringrealtime.Denial(authoringrealtime.CodeEntityDeleted, "Exam not found.")
	}
	return view, nil
}

func astStrptr(s string) *string { return &s }

// authoringIntegrationApp wires an App whose realtime path needs no database:
// injected exam loader, memory admission, live hub. The sqlmock DB exists only
// so the gate passes and the replay path has a handle when a test exercises it.
// QueryMatcherEqual is used because the replay SQL contains regex metacharacters.
func authoringIntegrationApp(t *testing.T, loader authoringrealtime.ExamLoader) (*App, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	cfg := config.Load()
	cfg.WSAdmission = config.WSAdmissionMemory
	cfg.AuthoringRealtimeDelivery = true
	return &App{
		Config:              cfg,
		DB:                  db,
		LiveHub:             liveupdates.NewHub(),
		Admission:           liveupdates.NewAdmission(liveupdates.AdmissionCaps{Total: 16, PerUser: 4, PerSchedule: 16}),
		AuthoringExamLoader: loader,
		AuthoringBarrier:    staticBarrier{seq: defaultBarrierCursor},
	}, mock
}

// authoringIntegrationServer serves the handler with a per-request session
// taken from test headers, so one server can host several roles.
func authoringIntegrationServer(app *App) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		role := r.Header.Get("X-Test-Role")
		user := r.Header.Get("X-Test-User")
		if user == "" {
			authoringRealtimeHandler(app)(w, r)
			return
		}
		r = r.WithContext(sessionCtx(r.Context(), &auth.Session{UserID: user, Role: role}))
		authoringRealtimeHandler(app)(w, r)
	}))
}

func dialAuthoring(t *testing.T, srv *httptest.Server, user, role, examID string) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/ws/authoring?examId=" + url.QueryEscape(examID)
	header := http.Header{}
	header.Set("X-Test-User", user)
	header.Set("X-Test-Role", role)
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}
		t.Fatalf("dial authoring socket: %v (status %d)", err, status)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func writeAuthoringJSON(t *testing.T, conn *websocket.Conn, value any) {
	t.Helper()
	if err := conn.WriteJSON(value); err != nil {
		t.Fatalf("write frame: %v", err)
	}
}

func readAuthoringJSON(t *testing.T, conn *websocket.Conn, timeout time.Duration) map[string]any {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(timeout))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read frame: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("frame is not JSON: %v (%s)", err, data)
	}
	return out
}

func expectAuthoringSilence(t *testing.T, conn *websocket.Conn, timeout time.Duration) {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(timeout))
	_, data, err := conn.ReadMessage()
	if err == nil {
		t.Fatalf("expected no frame, got %s", data)
	}
}

func subscribeAuthoring(t *testing.T, conn *websocket.Conn, examID string, lastSeen *int64) {
	t.Helper()
	frame := map[string]any{"type": authoringrealtime.FrameTypeSubscribe, "v": authoringrealtime.ProtocolVersion, "examId": examID}
	if lastSeen != nil {
		frame["lastSeenCursor"] = *lastSeen
	}
	writeAuthoringJSON(t, conn, frame)
}

// readSubscribedHandshake reads the subscribed + capabilities frames every
// successful handshake emits, in order, and returns the capabilities frame.
func readSubscribedHandshake(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	subscribed := readAuthoringJSON(t, conn, 2*time.Second)
	if subscribed["type"] != authoringrealtime.FrameTypeSubscribed {
		t.Fatalf("want authoring.subscribed, got %v", subscribed)
	}
	caps := readAuthoringJSON(t, conn, 2*time.Second)
	if caps["type"] != authoringrealtime.FrameTypeCapabilities {
		t.Fatalf("want authoring.capabilities, got %v", caps)
	}
	return subscribed
}

// TestAuthoringWSIntegrationHandshake pins the happy path: the ack's draft id is
// SERVER-derived (the client never sends one) and the capabilities frame mirrors
// the negotiated posture.
func TestAuthoringWSIntegrationHandshake(t *testing.T) {
	loader := fakeExamLoader{views: map[string]authoringrealtime.ExamView{
		"exam-1": {ID: "exam-1", OrganizationID: astStrptr("org-1"), CurrentDraftVersionID: astStrptr("draft-7")},
	}}
	app, _ := authoringIntegrationApp(t, loader)
	srv := authoringIntegrationServer(app)
	defer srv.Close()

	conn := dialAuthoring(t, srv, "u-admin", auth.RoleAdmin, "exam-1")
	subscribeAuthoring(t, conn, "exam-1", nil)
	subscribed := readSubscribedHandshake(t, conn)

	if subscribed["examId"] != "exam-1" {
		t.Fatalf("ack must echo the authorized exam, got %v", subscribed["examId"])
	}
	if subscribed["draftVersionId"] != "draft-7" {
		t.Fatalf("ack must carry the server-resolved draft, got %v", subscribed["draftVersionId"])
	}
	if subscribed["barrierCursor"] != float64(defaultBarrierCursor) {
		t.Fatalf("ack must carry the server barrier cursor, got %v", subscribed["barrierCursor"])
	}
	// The socket is receive-only and the cursor is opaque: no write authority
	// and no "sequenceId" the client might do arithmetic on.
	for _, forbidden := range []string{"canWrite", "sequenceId"} {
		if _, ok := subscribed[forbidden]; ok {
			t.Fatalf("ack must not carry %q, got %v", forbidden, subscribed)
		}
	}
}

// TestAuthoringWSIntegrationObserverIsReadOnly pins least privilege: an
// observer subscribes in the read set but the transport grants no write path at
// all (no mutation frames exist).
func TestAuthoringWSIntegrationObserverIsReadOnly(t *testing.T) {
	loader := fakeExamLoader{views: map[string]authoringrealtime.ExamView{
		"exam-1": {ID: "exam-1", CurrentDraftVersionID: astStrptr("draft-7")},
	}}
	app, _ := authoringIntegrationApp(t, loader)
	srv := authoringIntegrationServer(app)
	defer srv.Close()

	conn := dialAuthoring(t, srv, "u-obs", auth.RoleAdminObserver, "exam-1")
	subscribeAuthoring(t, conn, "exam-1", nil)
	readSubscribedHandshake(t, conn)
}

// TestAuthoringWSIntegrationRejectsExamRebind pins the confused-deputy defense:
// a socket authorized for exam-1 cannot be rebound to exam-2 by the post-upgrade
// subscribe frame.
func TestAuthoringWSIntegrationRejectsExamRebind(t *testing.T) {
	loader := fakeExamLoader{views: map[string]authoringrealtime.ExamView{
		"exam-1": {ID: "exam-1", CurrentDraftVersionID: astStrptr("draft-7")},
		"exam-2": {ID: "exam-2", CurrentDraftVersionID: astStrptr("draft-9")},
	}}
	app, _ := authoringIntegrationApp(t, loader)
	srv := authoringIntegrationServer(app)
	defer srv.Close()

	conn := dialAuthoring(t, srv, "u-admin", auth.RoleAdmin, "exam-1")
	subscribeAuthoring(t, conn, "exam-2", nil)
	frame := readAuthoringJSON(t, conn, 2*time.Second)
	if frame["type"] != authoringrealtime.FrameTypeError || frame["code"] != authoringrealtime.ErrorCodeBadRequest {
		t.Fatalf("a rebind attempt must be BAD_REQUEST, got %v", frame)
	}
}

// TestAuthoringWSIntegrationPreUpgradeDenials pins the pre-upgrade gate: no
// socket is ever upgraded for a non-read role or a cross-tenant exam.
func TestAuthoringWSIntegrationPreUpgradeDenials(t *testing.T) {
	loader := fakeExamLoader{views: map[string]authoringrealtime.ExamView{
		"exam-1": {ID: "exam-1", CurrentDraftVersionID: astStrptr("draft-7")},
	}}
	app, _ := authoringIntegrationApp(t, loader)
	srv := authoringIntegrationServer(app)
	defer srv.Close()

	for _, tc := range []struct {
		name   string
		user   string
		role   string
		examID string
		want   int
	}{
		{"student denied", "u-student", auth.RoleStudent, "exam-1", http.StatusForbidden},
		{"graders denied", "u-grader", auth.RoleGrader, "exam-1", http.StatusForbidden},
		{"unknown exam is not-found family", "u-admin", auth.RoleAdmin, "exam-unknown", http.StatusGone},
	} {
		t.Run(tc.name, func(t *testing.T) {
			wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/ws/authoring?examId=" + url.QueryEscape(tc.examID)
			header := http.Header{}
			header.Set("X-Test-User", tc.user)
			header.Set("X-Test-Role", tc.role)
			conn, resp, err := websocket.DefaultDialer.Dial(wsURL, header)
			if err == nil {
				_ = conn.Close()
				t.Fatalf("a %s role must not be upgraded", tc.role)
			}
			if resp == nil || resp.StatusCode != tc.want {
				got := 0
				if resp != nil {
					got = resp.StatusCode
				}
				t.Fatalf("want status %d before upgrade, got %d", tc.want, got)
			}
		})
	}
}

// TestAuthoringWSIntegrationFanOutAndIsolation pins hub scoping: two conns on
// the same exam both receive one published authoring event, while a conn on a
// different exam and runtime-kind traffic reach nobody.
func TestAuthoringWSIntegrationFanOutAndIsolation(t *testing.T) {
	loader := fakeExamLoader{views: map[string]authoringrealtime.ExamView{
		"exam-1": {ID: "exam-1", OrganizationID: astStrptr("org-1"), CurrentDraftVersionID: astStrptr("draft-7")},
		"exam-2": {ID: "exam-2", OrganizationID: astStrptr("org-1"), CurrentDraftVersionID: astStrptr("draft-9")},
	}}
	app, _ := authoringIntegrationApp(t, loader)
	srv := authoringIntegrationServer(app)
	defer srv.Close()

	a := dialAuthoring(t, srv, "u-a", auth.RoleAdmin, "exam-1")
	subscribeAuthoring(t, a, "exam-1", nil)
	readSubscribedHandshake(t, a)

	b := dialAuthoring(t, srv, "u-b", auth.RoleBuilder, "exam-1")
	subscribeAuthoring(t, b, "exam-1", nil)
	readSubscribedHandshake(t, b)

	other := dialAuthoring(t, srv, "u-c", auth.RoleAdmin, "exam-2")
	subscribeAuthoring(t, other, "exam-2", nil)
	readSubscribedHandshake(t, other)

	evt, err := authoringrealtime.NewEvent(authoringrealtime.EventInput{
		Kind:           authoringrealtime.KindQuestionChanged,
		OrganizationID: astStrptr("org-1"),
		ExamID:         "exam-1",
		DraftVersionID: "draft-7",
		DraftRevision:  3,
		ActorID:        "u-a",
		Entity:         authoringrealtime.Entity{Kind: authoringrealtime.EntityQuestion, ExamQuestionID: "eq-1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(evt)
	app.LiveHub.Publish(liveupdates.Event{SequenceID: 42, Kind: liveupdates.KindAuthoring, ID: "exam-1", Payload: payload})

	for name, conn := range map[string]*websocket.Conn{"a": a, "b": b} {
		frame := readAuthoringJSON(t, conn, 2*time.Second)
		if frame["type"] != authoringrealtime.FrameTypeEvent {
			t.Fatalf("conn %s: want authoring.event, got %v", name, frame)
		}
		if cursor, _ := frame["cursor"].(float64); int64(cursor) != 42 {
			t.Fatalf("conn %s: want cursor 42, got %v", name, frame["cursor"])
		}
	}
	expectAuthoringSilence(t, other, 200*time.Millisecond)

	// Runtime traffic must never appear on the authoring socket.
	app.LiveHub.Publish(liveupdates.Event{SequenceID: 43, Kind: liveupdates.KindScheduleRuntime, ID: "exam-1"})
	expectAuthoringSilence(t, a, 200*time.Millisecond)
}

// TestAuthoringWSIntegrationReplayIsOrdered pins bounded replay: rows newer
// than the cursor are streamed in sequence order, straight from the Phase 02
// table (the exact replay SQL).
func TestAuthoringWSIntegrationReplayIsOrdered(t *testing.T) {
	loader := fakeExamLoader{views: map[string]authoringrealtime.ExamView{
		"exam-1": {ID: "exam-1", OrganizationID: astStrptr("org-1"), CurrentDraftVersionID: astStrptr("draft-7")},
	}}
	app, mock := authoringIntegrationApp(t, loader)

	// Barrier 20: replay owns (10, 20]; live owns (20, ...].
	app.AuthoringBarrier = staticBarrier{seq: 20}
	first := authoringReplayPayload(t, "exam-1", "draft-7", "event-1")
	second := authoringReplayPayload(t, "exam-1", "draft-7", "event-2")
	mock.ExpectQuery(authoringrealtime.RetentionFloorSQL).WillReturnRows(sqlmock.NewRows([]string{"floor"}).AddRow(int64(5)))
	mock.ExpectQuery(authoringrealtime.ReplaySQL).
		WithArgs(authoringrealtime.BusEventKind, "exam-1", int64(10), int64(20), 201).
		WillReturnRows(sqlmock.NewRows([]string{"sequence_id", "origin_instance_id", "event_name", "event_revision", "payload"}).
			AddRow(int64(11), "api", "question.changed", int64(3), first).
			AddRow(int64(12), "api", "question.changed", int64(4), second))

	srv := authoringIntegrationServer(app)
	defer srv.Close()

	conn := dialAuthoring(t, srv, "u-admin", auth.RoleAdmin, "exam-1")
	lastSeen := int64(10)
	subscribeAuthoring(t, conn, "exam-1", &lastSeen)
	readSubscribedHandshake(t, conn)

	for _, want := range []int64{11, 12} {
		frame := readAuthoringJSON(t, conn, 2*time.Second)
		if frame["type"] != authoringrealtime.FrameTypeEvent {
			t.Fatalf("want authoring.event, got %v", frame)
		}
		if cursor, _ := frame["cursor"].(float64); int64(cursor) != want {
			t.Fatalf("replay must be cursor-ordered: want %d, got %v", want, frame["cursor"])
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestAuthoringWSIntegrationCursorTooOldSnapshots pins that a cursor below the
// retention floor resolves to snapshot_required WITHOUT scanning history.
func TestAuthoringWSIntegrationCursorTooOldSnapshots(t *testing.T) {
	loader := fakeExamLoader{views: map[string]authoringrealtime.ExamView{
		"exam-1": {ID: "exam-1", OrganizationID: astStrptr("org-1"), CurrentDraftVersionID: astStrptr("draft-7")},
	}}
	app, mock := authoringIntegrationApp(t, loader)
	app.AuthoringBarrier = staticBarrier{seq: 1000}
	mock.ExpectQuery(authoringrealtime.RetentionFloorSQL).WillReturnRows(sqlmock.NewRows([]string{"floor"}).AddRow(int64(100)))

	srv := authoringIntegrationServer(app)
	defer srv.Close()

	conn := dialAuthoring(t, srv, "u-admin", auth.RoleAdmin, "exam-1")
	lastSeen := int64(10)
	subscribeAuthoring(t, conn, "exam-1", &lastSeen)
	readSubscribedHandshake(t, conn)

	frame := readAuthoringJSON(t, conn, 2*time.Second)
	if frame["type"] != authoringrealtime.FrameTypeSnapshotRequired {
		t.Fatalf("want authoring.snapshot_required, got %v", frame)
	}
	if frame["reason"] != string(authoringrealtime.ReasonCursorTooOld) {
		t.Fatalf("want reason cursor_too_old, got %v", frame["reason"])
	}
	// No history query may run: the floor already proved it unrecoverable.
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestAuthoringWSIntegrationReSubscribeRevalidates pins that a second subscribe
// on a live conn is honored against the CURRENT draft: same draft re-acks,
// replaced draft closes with an error frame.
func TestAuthoringWSIntegrationReSubscribeRevalidates(t *testing.T) {
	loader := fakeExamLoader{views: map[string]authoringrealtime.ExamView{
		"exam-1": {ID: "exam-1", OrganizationID: astStrptr("org-1"), CurrentDraftVersionID: astStrptr("draft-7")},
	}}
	app, mock := authoringIntegrationApp(t, loader)
	srv := authoringIntegrationServer(app)
	defer srv.Close()

	mock.ExpectQuery("SELECT current_draft_version_id FROM exam_entities WHERE id = ?").
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"current_draft_version_id"}).AddRow("draft-7"))

	conn := dialAuthoring(t, srv, "u-admin", auth.RoleAdmin, "exam-1")
	subscribeAuthoring(t, conn, "exam-1", nil)
	readSubscribedHandshake(t, conn)

	// A second subscribe on the same draft is re-acked.
	subscribeAuthoring(t, conn, "exam-1", nil)
	reAck := readAuthoringJSON(t, conn, 2*time.Second)
	if reAck["type"] != authoringrealtime.FrameTypeSubscribed {
		t.Fatalf("a same-draft re-subscribe must re-ack, got %v", reAck)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestAuthoringWSIntegrationReSubscribeDraftReplacedCloses pins lifecycle
// handling: when the bound draft no longer matches, the conn is terminated with
// a typed error so the client re-subscribes against the new draft.
func TestAuthoringWSIntegrationReSubscribeDraftReplacedCloses(t *testing.T) {
	loader := fakeExamLoader{views: map[string]authoringrealtime.ExamView{
		"exam-1": {ID: "exam-1", OrganizationID: astStrptr("org-1"), CurrentDraftVersionID: astStrptr("draft-7")},
	}}
	app, mock := authoringIntegrationApp(t, loader)
	srv := authoringIntegrationServer(app)
	defer srv.Close()

	mock.ExpectQuery("SELECT current_draft_version_id FROM exam_entities WHERE id = ?").
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"current_draft_version_id"}).AddRow("draft-8"))

	conn := dialAuthoring(t, srv, "u-admin", auth.RoleAdmin, "exam-1")
	subscribeAuthoring(t, conn, "exam-1", nil)
	readSubscribedHandshake(t, conn)

	subscribeAuthoring(t, conn, "exam-1", nil)
	frame := readAuthoringJSON(t, conn, 2*time.Second)
	if frame["type"] != authoringrealtime.FrameTypeError || frame["code"] != string(authoringrealtime.CodeDraftReplaced) {
		t.Fatalf("a replaced draft must close with draft_replaced, got %v", frame)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestAuthoringWSIntegrationDisconnectReleasesLease pins aggressive dead-conn
// cleanup: closing the socket without a clean frame still drains admission and
// unsubscribes, so dead connections never accumulate.
func TestAuthoringWSIntegrationDisconnectReleasesLease(t *testing.T) {
	loader := fakeExamLoader{views: map[string]authoringrealtime.ExamView{
		"exam-1": {ID: "exam-1", OrganizationID: astStrptr("org-1"), CurrentDraftVersionID: astStrptr("draft-7")},
	}}
	app, _ := authoringIntegrationApp(t, loader)
	srv := authoringIntegrationServer(app)
	defer srv.Close()

	conn := dialAuthoring(t, srv, "u-admin", auth.RoleAdmin, "exam-1")
	subscribeAuthoring(t, conn, "exam-1", nil)
	readSubscribedHandshake(t, conn)
	if got := app.Admission.Active(); got == 0 {
		t.Fatal("a live handshake must hold a lease")
	}

	_ = conn.Close()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if app.Admission.Active() == 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("disconnect must release the lease, active=%d", app.Admission.Active())
}

// TestAuthoringWSIntegrationLeaseCapRejects pins resource exhaustion: once the
// per-user cap is hit the pre-upgrade gate answers 429, never an unbounded
// number of sockets.
func TestAuthoringWSIntegrationLeaseCapRejects(t *testing.T) {
	loader := fakeExamLoader{views: map[string]authoringrealtime.ExamView{
		"exam-1": {ID: "exam-1", CurrentDraftVersionID: astStrptr("draft-7")},
	}}
	app, _ := authoringIntegrationApp(t, loader)
	for i := 0; i < 4; i++ {
		if _, ok, err := app.acquireWSLease(context.Background(), "api", "u-admin", nil); err != nil || !ok {
			t.Fatalf("lease %d must admit: ok=%v err=%v", i, ok, err)
		}
	}
	sess := &auth.Session{UserID: "u-admin", Role: auth.RoleAdmin}
	rec := httptest.NewRecorder()
	authoringRealtimeHandler(app)(rec, authoringRequest(sess, "exam-1"))
	if rec.Result().StatusCode != http.StatusTooManyRequests {
		t.Fatalf("a capped user must get 429, got %d", rec.Result().StatusCode)
	}
}

// buildAuthoringEvent marshals one valid Phase 01 envelope for hub delivery.
func buildAuthoringEvent(t *testing.T, kind authoringrealtime.Kind, examID, draftID string, entity authoringrealtime.Entity) []byte {
	t.Helper()
	evt, err := authoringrealtime.NewEvent(authoringrealtime.EventInput{
		Kind:           kind,
		OrganizationID: astStrptr("org-1"),
		ExamID:         examID,
		DraftVersionID: draftID,
		DraftRevision:  1,
		ActorID:        "u-a",
		Entity:         entity,
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(evt)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// TestAuthoringWSIntegrationBarrierHandoffDropsReplayedEvents pins the
// no-duplicate half of the barrier handoff: on resume, replay owns everything
// at or below the barrier, so a same-or-older event must never be forwarded
// live, while a strictly newer one must be.
func TestAuthoringWSIntegrationBarrierHandoffDropsReplayedEvents(t *testing.T) {
	loader := fakeExamLoader{views: map[string]authoringrealtime.ExamView{
		"exam-1": {ID: "exam-1", OrganizationID: astStrptr("org-1"), CurrentDraftVersionID: astStrptr("draft-7")},
	}}
	app, mock := authoringIntegrationApp(t, loader)
	app.AuthoringBarrier = staticBarrier{seq: 20}
	mock.ExpectQuery(authoringrealtime.RetentionFloorSQL).WillReturnRows(sqlmock.NewRows([]string{"floor"}).AddRow(int64(5)))
	mock.ExpectQuery(authoringrealtime.ReplaySQL).
		WithArgs(authoringrealtime.BusEventKind, "exam-1", int64(10), int64(20), 201).
		WillReturnRows(sqlmock.NewRows([]string{"sequence_id", "origin_instance_id", "event_name", "event_revision", "payload"}).
			AddRow(int64(11), "api", "question.changed", int64(1), string(authoringReplayPayload(t, "exam-1", "draft-7", "event-1"))))

	srv := authoringIntegrationServer(app)
	defer srv.Close()

	conn := dialAuthoring(t, srv, "u-admin", auth.RoleAdmin, "exam-1")
	lastSeen := int64(10)
	subscribeAuthoring(t, conn, "exam-1", &lastSeen)
	readSubscribedHandshake(t, conn)
	replayed := readAuthoringJSON(t, conn, 2*time.Second)
	if frameCursor(replayed) != 11 {
		t.Fatalf("want the replayed event at cursor 11, got %v", replayed)
	}

	// 15 <= barrier 20: already owned by replay, so it must NOT be re-sent.
	app.LiveHub.Publish(liveupdates.Event{SequenceID: 15, Kind: liveupdates.KindAuthoring, ID: "exam-1",
		Payload: buildAuthoringEvent(t, authoringrealtime.KindQuestionChanged, "exam-1", "draft-7", authoringrealtime.Entity{Kind: authoringrealtime.EntityQuestion, ExamQuestionID: "eq-1"})})
	// 25 > barrier 20: live owns it.
	app.LiveHub.Publish(liveupdates.Event{SequenceID: 25, Kind: liveupdates.KindAuthoring, ID: "exam-1",
		Payload: buildAuthoringEvent(t, authoringrealtime.KindQuestionChanged, "exam-1", "draft-7", authoringrealtime.Entity{Kind: authoringrealtime.EntityQuestion, ExamQuestionID: "eq-2"})})

	next := readAuthoringJSON(t, conn, 2*time.Second)
	if frameCursor(next) != 25 {
		t.Fatalf("the first live frame must be cursor 25 (15 is replay-owned), got %v", next)
	}
}

// TestAuthoringWSIntegrationTruncatedReplaySendsNoEvents pins the anti-partial
// rule on the wire: when more history exists than the bound, the client gets a
// replay_too_large snapshot and ZERO event frames.
func TestAuthoringWSIntegrationTruncatedReplaySendsNoEvents(t *testing.T) {
	loader := fakeExamLoader{views: map[string]authoringrealtime.ExamView{
		"exam-1": {ID: "exam-1", OrganizationID: astStrptr("org-1"), CurrentDraftVersionID: astStrptr("draft-7")},
	}}
	app, mock := authoringIntegrationApp(t, loader)
	app.Config.AuthoringWSReplayBound = 2
	app.AuthoringBarrier = staticBarrier{seq: 200}
	mock.ExpectQuery(authoringrealtime.RetentionFloorSQL).WillReturnRows(sqlmock.NewRows([]string{"floor"}).AddRow(int64(1)))
	rows := sqlmock.NewRows([]string{"sequence_id", "origin_instance_id", "event_name", "event_revision", "payload"})
	for i := 0; i < 3; i++ {
		rows.AddRow(int64(100+i), "api", "question.changed", int64(1), string(authoringReplayPayload(t, "exam-1", "draft-7", "event-x")))
	}
	// Bound 2 => LIMIT 3, and three rows back proves truncation.
	mock.ExpectQuery(authoringrealtime.ReplaySQL).
		WithArgs(authoringrealtime.BusEventKind, "exam-1", int64(1), int64(200), 3).WillReturnRows(rows)

	srv := authoringIntegrationServer(app)
	defer srv.Close()

	conn := dialAuthoring(t, srv, "u-admin", auth.RoleAdmin, "exam-1")
	lastSeen := int64(1)
	subscribeAuthoring(t, conn, "exam-1", &lastSeen)
	readSubscribedHandshake(t, conn)

	frame := readAuthoringJSON(t, conn, 2*time.Second)
	if frame["type"] != authoringrealtime.FrameTypeSnapshotRequired {
		t.Fatalf("a truncated replay must snapshot, got %v", frame)
	}
	if frame["reason"] != string(authoringrealtime.ReasonReplayTooLarge) {
		t.Fatalf("want reason replay_too_large, got %v", frame["reason"])
	}
}

// TestAuthoringWSIntegrationUnreadableReplaySnapshots pins that a malformed
// retained row never becomes a partial stream.
func TestAuthoringWSIntegrationUnreadableReplaySnapshots(t *testing.T) {
	loader := fakeExamLoader{views: map[string]authoringrealtime.ExamView{
		"exam-1": {ID: "exam-1", OrganizationID: astStrptr("org-1"), CurrentDraftVersionID: astStrptr("draft-7")},
	}}
	app, mock := authoringIntegrationApp(t, loader)
	app.AuthoringBarrier = staticBarrier{seq: 200}
	mock.ExpectQuery(authoringrealtime.RetentionFloorSQL).WillReturnRows(sqlmock.NewRows([]string{"floor"}).AddRow(int64(1)))
	mock.ExpectQuery(authoringrealtime.ReplaySQL).
		WithArgs(authoringrealtime.BusEventKind, "exam-1", int64(1), int64(200), 201).
		WillReturnRows(sqlmock.NewRows([]string{"sequence_id", "origin_instance_id", "event_name", "event_revision", "payload"}).
			AddRow(int64(2), "api", "question.changed", int64(1), "not json"))

	srv := authoringIntegrationServer(app)
	defer srv.Close()

	conn := dialAuthoring(t, srv, "u-admin", auth.RoleAdmin, "exam-1")
	lastSeen := int64(1)
	subscribeAuthoring(t, conn, "exam-1", &lastSeen)
	readSubscribedHandshake(t, conn)

	frame := readAuthoringJSON(t, conn, 2*time.Second)
	if frame["type"] != authoringrealtime.FrameTypeSnapshotRequired || frame["reason"] != string(authoringrealtime.ReasonUnsupportedEvent) {
		t.Fatalf("an unreadable replay row must snapshot unsupported_event, got %v", frame)
	}
}

// TestAuthoringWSIntegrationBarrierFailureIsFailClosed pins that a watermark
// failure is reported, never papered over with cursor 0 (which could silently
// skip or duplicate history).
func TestAuthoringWSIntegrationBarrierFailureIsFailClosed(t *testing.T) {
	loader := fakeExamLoader{views: map[string]authoringrealtime.ExamView{
		"exam-1": {ID: "exam-1", OrganizationID: astStrptr("org-1"), CurrentDraftVersionID: astStrptr("draft-7")},
	}}
	app, _ := authoringIntegrationApp(t, loader)
	app.AuthoringBarrier = staticBarrier{err: errors.New("bus unavailable")}

	srv := authoringIntegrationServer(app)
	defer srv.Close()

	conn := dialAuthoring(t, srv, "u-admin", auth.RoleAdmin, "exam-1")
	subscribeAuthoring(t, conn, "exam-1", nil)
	frame := readAuthoringJSON(t, conn, 2*time.Second)
	if frame["type"] != authoringrealtime.FrameTypeError {
		t.Fatalf("an unknown barrier must fail closed with authoring.error, got %v", frame)
	}
}

// TestAuthoringWSIntegrationUnsupportedClientFrameCloses pins that junk after
// the handshake is a protocol error that closes the socket, not silently
// tolerated traffic.
func TestAuthoringWSIntegrationUnsupportedClientFrameCloses(t *testing.T) {
	loader := fakeExamLoader{views: map[string]authoringrealtime.ExamView{
		"exam-1": {ID: "exam-1", OrganizationID: astStrptr("org-1"), CurrentDraftVersionID: astStrptr("draft-7")},
	}}
	app, _ := authoringIntegrationApp(t, loader)
	srv := authoringIntegrationServer(app)
	defer srv.Close()

	conn := dialAuthoring(t, srv, "u-admin", auth.RoleAdmin, "exam-1")
	subscribeAuthoring(t, conn, "exam-1", nil)
	readSubscribedHandshake(t, conn)

	writeAuthoringJSON(t, conn, map[string]any{"type": "authoring.publish", "v": 1, "examId": "exam-1"})
	frame := readAuthoringJSON(t, conn, 2*time.Second)
	if frame["type"] != authoringrealtime.FrameTypeError || frame["code"] != authoringrealtime.ErrorCodeBadRequest {
		t.Fatalf("an unsupported client frame must get BAD_REQUEST and close, got %v", frame)
	}
}

// TestAuthoringWSIntegrationDeliversOtherDraftLifecycle pins exam-scoped
// routing's whole point: a subscriber bound to draft-7 still receives the
// draft.replaced event that retires its draft (scope carries draft-8).
func TestAuthoringWSIntegrationDeliversOtherDraftLifecycle(t *testing.T) {
	loader := fakeExamLoader{views: map[string]authoringrealtime.ExamView{
		"exam-1": {ID: "exam-1", OrganizationID: astStrptr("org-1"), CurrentDraftVersionID: astStrptr("draft-7")},
	}}
	app, _ := authoringIntegrationApp(t, loader)
	srv := authoringIntegrationServer(app)
	defer srv.Close()

	conn := dialAuthoring(t, srv, "u-admin", auth.RoleAdmin, "exam-1")
	subscribeAuthoring(t, conn, "exam-1", nil)
	readSubscribedHandshake(t, conn)

	payload := buildAuthoringEvent(t, authoringrealtime.KindDraftReplaced, "exam-1", "draft-8",
		authoringrealtime.Entity{Kind: authoringrealtime.EntityDraft, ExamID: "exam-1", DraftVersionID: "draft-8"})
	app.LiveHub.Publish(liveupdates.Event{SequenceID: 42, Kind: liveupdates.KindAuthoring, ID: "exam-1", Payload: payload})

	frame := readAuthoringJSON(t, conn, 2*time.Second)
	if frame["type"] != authoringrealtime.FrameTypeEvent || frameCursor(frame) != 42 {
		t.Fatalf("the replacement event must reach the stale-draft subscriber, got %v", frame)
	}
	event, _ := frame["event"].(map[string]any)
	if event["kind"] != string(authoringrealtime.KindDraftReplaced) {
		t.Fatalf("want draft.replaced, got %v", event["kind"])
	}
}

func frameCursor(frame map[string]any) int64 {
	cursor, _ := frame["cursor"].(float64)
	return int64(cursor)
}

// authoringReplayPayload builds a valid Phase 01 envelope for a replay row.
func authoringReplayPayload(t *testing.T, examID, draftID, eventID string) string {
	t.Helper()
	evt, err := authoringrealtime.NewEvent(authoringrealtime.EventInput{
		Kind:           authoringrealtime.KindQuestionChanged,
		OrganizationID: astStrptr("org-1"),
		ExamID:         examID,
		DraftVersionID: draftID,
		DraftRevision:  3,
		ActorID:        "u-a",
		Entity:         authoringrealtime.Entity{Kind: authoringrealtime.EntityQuestion, ExamQuestionID: "eq-1"},
		EventID:        eventID,
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(evt)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
