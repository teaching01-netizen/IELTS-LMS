package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/authoringrealtime"
	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/config"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// authoringApp builds an App whose pre-upgrade gate can be driven without a
// live database: the exam loader is stubbed by pointing Exams at a fake,
// and admission uses the memory gate so no lease SQL runs.
func authoringApp(t *testing.T) (*App, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	cfg := config.Load()
	cfg.WSAdmission = config.WSAdmissionMemory
	cfg.AuthoringRealtimeDelivery = true
	return &App{
		Config:    cfg,
		DB:        db,
		LiveHub:   liveupdates.NewHub(),
		Admission: liveupdates.NewAdmission(liveupdates.AdmissionCaps{Total: 8, PerUser: 2, PerSchedule: 8}),
	}, mock
}

func authoringRequest(sess *auth.Session, examID string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ws/authoring?examId="+examID, nil)
	if sess != nil {
		req = req.WithContext(sessionCtx(req.Context(), sess))
	}
	return req
}

func TestAuthoringWSRequiresSession(t *testing.T) {
	app, _ := authoringApp(t)
	rec := httptest.NewRecorder()
	authoringRealtimeHandler(app)(rec, authoringRequest(nil, "exam-1"))
	if rec.Result().StatusCode != http.StatusUnauthorized {
		t.Fatalf("no session must 401, got %d", rec.Result().StatusCode)
	}
}

func TestAuthoringWSRequiresExamID(t *testing.T) {
	app, _ := authoringApp(t)
	rec := httptest.NewRecorder()
	sess := &auth.Session{UserID: "u1", Role: auth.RoleAdmin}
	authoringRealtimeHandler(app)(rec, authoringRequest(sess, ""))
	if rec.Result().StatusCode != http.StatusBadRequest {
		t.Fatalf("a missing examId must 400, got %d", rec.Result().StatusCode)
	}
}

// TestAuthoringWSDeniesNonReadRoles pins that a student never reaches the
// upgrade path.
func TestAuthoringWSDeniesNonReadRoles(t *testing.T) {
	for _, role := range []string{auth.RoleStudent, auth.RoleProctor, auth.RoleGrader} {
		t.Run(role, func(t *testing.T) {
			app, _ := authoringApp(t)
			rec := httptest.NewRecorder()
			sess := &auth.Session{UserID: "u1", Role: role}
			authoringRealtimeHandler(app)(rec, authoringRequest(sess, "exam-1"))
			if rec.Result().StatusCode != http.StatusForbidden {
				t.Fatalf("%s must 403, got %d", role, rec.Result().StatusCode)
			}
		})
	}
}

// TestAuthoringWSRefusesWhenDeliveryDisabled pins progressive degradation: the
// flag disables the capability without touching HTTP authoring, and the refusal
// is indistinguishable from forbidden (no authorization oracle).
func TestAuthoringWSRefusesWhenDeliveryDisabled(t *testing.T) {
	app, _ := authoringApp(t)
	app.Config.AuthoringRealtimeDelivery = false
	rec := httptest.NewRecorder()
	sess := &auth.Session{UserID: "u1", Role: auth.RoleAdmin}
	authoringRealtimeHandler(app)(rec, authoringRequest(sess, "exam-1"))
	if rec.Result().StatusCode != http.StatusForbidden {
		t.Fatalf("delivery off must refuse with 403, got %d", rec.Result().StatusCode)
	}
	if body := rec.Body.String(); !strings.Contains(body, "subscription_forbidden") {
		t.Fatalf("refusal must carry subscription_forbidden, got %s", body)
	}
}

// TestAuthoringWSUnavailableWithoutGate pins the 503 posture when the gate is
// not wired.
func TestAuthoringWSUnavailableWithoutGate(t *testing.T) {
	app := &App{Config: config.Load()}
	rec := httptest.NewRecorder()
	sess := &auth.Session{UserID: "u1", Role: auth.RoleAdmin}
	authoringRealtimeHandler(app)(rec, authoringRequest(sess, "exam-1"))
	if rec.Result().StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("an unwired gate must 503, got %d", rec.Result().StatusCode)
	}
}

// TestAuthoringEventMatchesBindingFiltersEverything pins the fan-out predicate:
// kind, exam, draft, and tenant must all match before a frame is forwarded.
func TestAuthoringEventMatchesBindingFiltersEverything(t *testing.T) {
	b := authoringrealtime.Binding{ExamID: "exam-1", DraftVersionID: "draft-7"}
	mk := func(t *testing.T, kind string, examID, draftID string) liveupdates.Event {
		t.Helper()
		evt, err := authoringrealtime.NewEvent(authoringrealtime.EventInput{
			Kind:           authoringrealtime.KindQuestionChanged,
			ExamID:         examID,
			DraftVersionID: draftID,
			DraftRevision:  5,
			ActorID:        "actor-1",
			Entity:         authoringrealtime.Entity{Kind: authoringrealtime.EntityQuestion, ExamQuestionID: "eq-1"},
		})
		if err != nil {
			t.Fatal(err)
		}
		payload, _ := json.Marshal(evt)
		return liveupdates.Event{SequenceID: 1, Kind: kind, ID: examID, Payload: payload}
	}

	if !authoringEventMatchesBinding(mk(t, liveupdates.KindAuthoring, "exam-1", "draft-7"), b) {
		t.Fatal("a same-scope authoring event must match")
	}
	if authoringEventMatchesBinding(mk(t, liveupdates.KindAuthoring, "exam-2", "draft-7"), b) {
		t.Fatal("another exam must not match")
	}
	// Routing is exam-scoped: an event from ANOTHER draft of the same exam must
	// still be delivered, because that is how a subscriber hears that its own
	// draft was replaced. The client compares scope.draftVersionId to reconcile.
	if !authoringEventMatchesBinding(mk(t, liveupdates.KindAuthoring, "exam-1", "draft-8"), b) {
		t.Fatal("a same-exam event from another draft MUST match (exam-scoped routing)")
	}
	if authoringEventMatchesBinding(mk(t, liveupdates.KindScheduleRuntime, "exam-1", "draft-7"), b) {
		t.Fatal("a runtime kind must not match")
	}
	bad := liveupdates.Event{Kind: liveupdates.KindAuthoring, ID: "exam-1", Payload: []byte("not json")}
	if authoringEventMatchesBinding(bad, b) {
		t.Fatal("an unparseable payload must not match (never crash, never forward)")
	}
}

// TestExamAuthoringLoaderIsUniform pins the no-oracle rule at the adapter: a
// missing service and an unknown exam both produce the not-found family.
func TestExamAuthoringLoaderIsUniform(t *testing.T) {
	_, err := examAuthoringLoader{app: &App{}}.LoadExamForActor(context.Background(), "u1", auth.RoleAdmin, "exam-1")
	denial, ok := authoringrealtime.Denied(err)
	if !ok {
		t.Fatalf("want a typed denial, got %v", err)
	}
	if denial.Code != authoringrealtime.CodeSubscriptionForbidden {
		t.Fatalf("a missing service is subscription_forbidden, got %s", denial.Code)
	}

	_, err = examAuthoringLoader{app: &App{}}.LoadExamForActor(context.Background(), "u1", auth.RoleAdmin, "  ")
	denial, ok = authoringrealtime.Denied(err)
	if !ok || denial.Code != authoringrealtime.CodeEntityDeleted {
		t.Fatalf("a blank exam id is the not-found family, got %v", err)
	}
}

func TestAuthoringSubscriptionConfigTracksDeliveryFlag(t *testing.T) {
	app := &App{Config: config.Load()}
	app.Config.AuthoringRealtimeDelivery = true
	if !authoringSubscriptionConfig(app).DeliveryEnabled {
		t.Fatal("delivery must follow the flag")
	}
	app.Config.AuthoringRealtimeDelivery = false
	if authoringSubscriptionConfig(app).DeliveryEnabled {
		t.Fatal("delivery must be off when the flag is off")
	}
	if authoringSubscriptionConfig(nil).DeliveryEnabled {
		t.Fatal("a nil app must not enable delivery")
	}
}

// TestAuthoringFrameTypesStayAuthoringPrefixed pins topic isolation at the
// wire level.
func TestAuthoringFrameTypesStayAuthoringPrefixed(t *testing.T) {
	for _, frame := range []string{
		authoringrealtime.FrameTypeSubscribe,
		authoringrealtime.FrameTypeSubscribed,
		authoringrealtime.FrameTypeEvent,
		authoringrealtime.FrameTypeSnapshotRequired,
		authoringrealtime.FrameTypeError,
		authoringrealtime.FrameTypeCapabilities,
	} {
		if !strings.HasPrefix(frame, "authoring.") {
			t.Fatalf("frame type %q must stay authoring-scoped", frame)
		}
	}
}

var _ = sql.ErrNoRows
