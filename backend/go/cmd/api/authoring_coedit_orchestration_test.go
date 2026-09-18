package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/authoring"
	"example.com/ielts-proctoring/internal/authoringcoedit"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/tx"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// Destructive lifecycle orchestration: publish freezes every open room, proves
// the committed manifest against MySQL, and only then runs the publish; delete
// and draft/workbook replacement flush and close the affected rooms; and a
// service that cannot be reached fails the operation closed while a room is
// still open.

const (
	coeditTestDocID      = "2f1b6c1e-6a0a-4a5b-9f0e-9d3a2f4c5b6d"
	coeditTestExamID     = "exam-1"
	coeditTestRevisionID = "rev-1"
	coeditTestActorID    = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
	coeditTestSecret     = "0123456789abcdef0123456789abcdef"
	coeditTestHash       = "abababababababababababababababababababababababababababababababab"
)

type fakeControlService struct {
	mu          sync.Mutex
	server      *httptest.Server
	paths       []string
	freezeToken string
	manifest    []authoringcoedit.FreezeManifestEntry
	failFreeze  bool
	failClose   bool
	unsigned    int
}

func newFakeControlService(t *testing.T) *fakeControlService {
	t.Helper()
	service := &fakeControlService{freezeToken: "lease-1"}
	service.manifest = []authoringcoedit.FreezeManifestEntry{{
		DocumentName:         controlDocumentName(t),
		StateHash:            coeditTestHash,
		MaterializedRevision: 4,
		QuestionRevision:     4,
	}}
	signer, err := authoringcoedit.NewServiceSigner(coeditTestSecret)
	if err != nil {
		t.Fatal(err)
	}
	service.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := readAll(t, r)
		// Every private call must carry a service signature over
		// method + path + timestamp + body hash.
		if err := signer.Verify(r.Method, r.URL.Path,
			r.Header.Get(authoringcoedit.HeaderServiceTimestamp),
			r.Header.Get(authoringcoedit.HeaderServiceSignature), body); err != nil {
			service.mu.Lock()
			service.unsigned++
			service.mu.Unlock()
			w.WriteHeader(http.StatusForbidden)
			return
		}
		service.mu.Lock()
		service.paths = append(service.paths, r.URL.Path)
		fail := service.failFreeze
		closeFails := service.failClose
		manifest := service.manifest
		token := service.freezeToken
		service.mu.Unlock()

		switch r.URL.Path {
		case authoringcoedit.ControlPathFreeze:
			if fail {
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = w.Write([]byte(`{"error":"unavailable"}`))
				return
			}
			writeJSON(t, w, authoringcoedit.FreezeResponse{FreezeToken: token, Manifest: manifest})
		case authoringcoedit.ControlPathClose:
			if closeFails {
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = w.Write([]byte(`{"error":"unavailable"}`))
				return
			}
			writeJSON(t, w, map[string]any{"ok": true})
		default:
			writeJSON(t, w, map[string]any{"ok": true})
		}
	}))
	t.Cleanup(service.server.Close)
	return service
}

func (s *fakeControlService) seen(path string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, candidate := range s.paths {
		if candidate == path {
			return true
		}
	}
	return false
}

func (s *fakeControlService) calls() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, len(s.paths))
	copy(out, s.paths)
	return out
}

func controlDocumentName(t *testing.T) string {
	t.Helper()
	name, err := authoringcoedit.NewDocumentName(coeditTestDocID)
	if err != nil {
		t.Fatal(err)
	}
	return string(name)
}

func readAll(t *testing.T, r *http.Request) []byte {
	t.Helper()
	if r.Body == nil {
		return nil
	}
	defer func() { _ = r.Body.Close() }()
	buf := make([]byte, 0, 1024)
	tmp := make([]byte, 1024)
	for {
		n, err := r.Body.Read(tmp)
		buf = append(buf, tmp[:n]...)
		if err != nil {
			return buf
		}
	}
}

func writeJSON(t *testing.T, w http.ResponseWriter, payload any) {
	t.Helper()
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}

// coeditApp builds an App whose capability is on, whose authoring service is a
// sqlmock-backed one, and whose control client points at the fake service.
func coeditApp(t *testing.T, control *fakeControlService) (*App, sqlmock.Sqlmock) {
	t.Helper()
	previousOperationID := coeditLifecycleOperationID
	coeditLifecycleOperationID = func() string { return "phase4-test-operation" }
	t.Cleanup(func() { coeditLifecycleOperationID = previousOperationID })
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = db.Close()
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Error(err)
		}
	})
	signer, err := authoringcoedit.NewServiceSigner(coeditTestSecret)
	if err != nil {
		t.Fatal(err)
	}
	client, err := authoringcoedit.NewControlClient(control.server.URL, signer)
	if err != nil {
		t.Fatal(err)
	}
	issuer, err := authoringcoedit.NewTokenIssuer(coeditTestSecret)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Load()
	cfg.AuthoringRealtimeCoediting = true
	cfg.AuthoringCoeditServiceEnabled = true
	return &App{
		Config:        cfg,
		DB:            db,
		Authoring:     authoring.NewService(db, tx.NewRunner(db)).SetCoeditEnabled(true),
		CoeditSigner:  signer,
		CoeditControl: client,
		CoeditTokens:  issuer,
	}, mock
}

func coeditRequest(param, examID string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/assessment-authoring/exams/"+examID+"/publish", nil)
	ctx := chi.NewRouteContext()
	ctx.URLParams.Add(param, examID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, ctx))
}

func coeditDocumentRows(t *testing.T) *sqlmock.Rows {
	t.Helper()
	return sqlmock.NewRows([]string{"id", "organization_id", "exam_id", "draft_version_id", "exam_question_id",
		"question_revision_id", "schema_version", "field_set", "lifecycle_state", "seed_revision",
		"materialized_revision", "ydoc_state", "state_vector", "state_hash", "previous_state_hash",
		"closed_reason", "last_actor_id", "updated_at", "state_epoch", "commit_sequence",
		"freeze_operation_id", "freeze_expires_at"}).
		AddRow(coeditTestDocID, "org-1", coeditTestExamID, "draft-1", "eq-1", coeditTestRevisionID,
			authoringcoedit.SchemaVersion, authoringcoedit.FieldSetPrompt, "freezing", 4, 4,
			[]byte("state"), []byte("vector"), mustHash(t), nil, nil, coeditTestActorID, time.Now(), uint64(0), uint64(0), "phase4-test-operation", time.Now().Add(time.Minute))
}

func mustHash(t *testing.T) []byte {
	t.Helper()
	decoded, err := hex.DecodeString(coeditTestHash)
	if err != nil {
		t.Fatal(err)
	}
	return decoded
}

// expectFreezing asserts the freezing transition SQL for one document.
func expectFreezing(t *testing.T, mock sqlmock.Sqlmock) {
	t.Helper()
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta("SET lifecycle_state = ?, freeze_operation_id = ?, freeze_expires_at = ?")).
		WithArgs("freezing", sqlmock.AnyArg(), sqlmock.AnyArg(), coeditTestDocID, "active", "initializing").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
}

func expectReopen(t *testing.T, mock sqlmock.Sqlmock) {
	t.Helper()
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta("SET lifecycle_state = ?, freeze_operation_id = NULL, freeze_expires_at = NULL")).
		WithArgs("active", coeditTestDocID, "freezing", "frozen", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
}

func expectCloseDocuments(t *testing.T, mock sqlmock.Sqlmock, reason authoringcoedit.CloseReason) {
	t.Helper()
	expectFamilyClose(t, mock, "authoring_coedit_documents", reason, nil)
}

// expectWorkspaceCloseDocuments asserts the EXAM ROOM family's close. The two
// families' statements differ only by their table, so the expectation has to
// name the table to prove which one ran.
func expectWorkspaceCloseDocuments(t *testing.T, mock sqlmock.Sqlmock, reason authoringcoedit.CloseReason) {
	t.Helper()
	expectFamilyClose(t, mock, "authoring_coedit_workspaces", reason, nil)
}

// expectFamilyClose asserts one room family's close transaction, optionally
// making its UPDATE fail so a caller's independence can be observed.
func expectFamilyClose(
	t *testing.T,
	mock sqlmock.Sqlmock,
	table string,
	reason authoringcoedit.CloseReason,
	failure error,
) {
	t.Helper()
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	expectation := mock.ExpectExec(regexp.QuoteMeta("UPDATE "+table)).
		WithArgs("closed", string(reason), coeditTestDocID, "closed")
	if failure != nil {
		expectation.WillReturnError(failure)
		mock.ExpectRollback()
		return
	}
	expectation.WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
}

// coeditTestFamilies builds one document name per room family: the v1
// question-scoped prompt room and the v2 exam-level workspace room.
func coeditTestFamilies(t *testing.T) []authoringcoedit.DocumentName {
	t.Helper()
	prompt, err := authoringcoedit.NewDocumentName(coeditTestDocID)
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := authoringcoedit.NewWorkspaceDocumentName(coeditTestDocID)
	if err != nil {
		t.Fatal(err)
	}
	return []authoringcoedit.DocumentName{prompt, workspace}
}

func expectManifestLoad(t *testing.T, mock sqlmock.Sqlmock) {
	t.Helper()
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM authoring_coedit_documents WHERE id = ?")).
		WithArgs(coeditTestDocID).
		WillReturnRows(coeditDocumentRows(t))
	mock.ExpectCommit()
}

func expectManifestMismatchRollback(t *testing.T, mock sqlmock.Sqlmock) {
	t.Helper()
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM authoring_coedit_documents WHERE id = ?")).
		WithArgs(coeditTestDocID).
		WillReturnRows(coeditDocumentRows(t))
	mock.ExpectRollback()
}

// --- capability posture ----------------------------------------------------

func TestPublishGuardIsTransparentWhileCoeditIsDisabled(t *testing.T) {
	control := newFakeControlService(t)
	app, _ := coeditApp(t, control)
	app.Config.AuthoringRealtimeCoediting = false
	ran := false

	coeditPublishGuard(app, func(http.ResponseWriter, *http.Request) { ran = true })(
		httptest.NewRecorder(), coeditRequest("id", coeditTestExamID))

	if !ran {
		t.Fatal("publish must run unchanged when the capability is off")
	}
	if len(control.calls()) != 0 {
		t.Fatalf("a disabled capability must not contact the service, saw %v", control.calls())
	}
}

func TestPublishGuardSkipsTheServiceWhenNoRoomIsOpen(t *testing.T) {
	control := newFakeControlService(t)
	app, mock := coeditApp(t, control)
	mock.ExpectQuery("FROM authoring_coedit_documents").WithArgs(coeditTestExamID, "closed").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	ran := false

	coeditPublishGuard(app, func(w http.ResponseWriter, _ *http.Request) { ran = true; w.WriteHeader(200) })(
		httptest.NewRecorder(), coeditRequest("id", coeditTestExamID))

	if !ran {
		t.Fatal("publish must run when no room is open")
	}
	if len(control.calls()) != 0 {
		t.Fatalf("no open room must mean no control calls, saw %v", control.calls())
	}
}

// The publish is the only place a revision becomes immutable, so an
// unreachable service while a room is open must fail closed and retryably.
func TestPublishGuardFailsClosedWhenTheServiceIsUnavailable(t *testing.T) {
	control := newFakeControlService(t)
	control.failFreeze = true
	app, mock := coeditApp(t, control)
	mock.ExpectQuery("FROM authoring_coedit_documents").WithArgs(coeditTestExamID, "closed").
		WillReturnRows(coeditDocumentRows(t))
	expectFreezing(t, mock)
	expectReopen(t, mock)
	ran := false

	rec := httptest.NewRecorder()
	coeditPublishGuard(app, func(http.ResponseWriter, *http.Request) { ran = true })(
		rec, coeditRequest("id", coeditTestExamID))

	if ran {
		t.Fatal("publish must not run while an open room could not be frozen")
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
	if !control.seen(authoringcoedit.ControlPathFreeze) {
		t.Fatal("the guard must ask the service to freeze")
	}
}

// A manifest that disagrees with MySQL is the split-room condition.
func TestPublishGuardRejectsAMismatchedManifest(t *testing.T) {
	control := newFakeControlService(t)
	control.manifest = []authoringcoedit.FreezeManifestEntry{{
		DocumentName: controlDocumentName(t),
		StateHash:    strings.Repeat("ff", 32),
	}}
	app, mock := coeditApp(t, control)
	mock.ExpectQuery("FROM authoring_coedit_documents").WithArgs(coeditTestExamID, "closed").
		WillReturnRows(coeditDocumentRows(t))
	expectFreezing(t, mock)
	expectManifestMismatchRollback(t, mock)
	expectReopen(t, mock)
	ran := false

	rec := httptest.NewRecorder()
	coeditPublishGuard(app, func(http.ResponseWriter, *http.Request) { ran = true })(
		rec, coeditRequest("id", coeditTestExamID))

	if ran {
		t.Fatal("publish must not run on a manifest mismatch")
	}
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected the manifest conflict to fail publish, got %d", rec.Code)
	}
	if !control.seen(authoringcoedit.ControlPathUnfreeze) {
		t.Fatal("a mismatch must unfreeze so authors keep working")
	}
}

func TestPublishGuardFreezesVerifiesPublishesThenCloses(t *testing.T) {
	control := newFakeControlService(t)
	app, mock := coeditApp(t, control)
	mock.ExpectQuery("FROM authoring_coedit_documents").WithArgs(coeditTestExamID, "closed").
		WillReturnRows(coeditDocumentRows(t))
	expectFreezing(t, mock)
	expectManifestLoad(t, mock)
	expectCloseDocuments(t, mock, authoringcoedit.CloseExamPublished)
	ran := false

	rec := httptest.NewRecorder()
	coeditPublishGuard(app, func(w http.ResponseWriter, _ *http.Request) {
		ran = true
		w.WriteHeader(http.StatusOK)
	})(rec, coeditRequest("id", coeditTestExamID))

	if !ran {
		t.Fatal("publish must run once the rooms are frozen and the manifest verifies")
	}
	if !control.seen(authoringcoedit.ControlPathClose) {
		t.Fatalf("a committed publish must close the rooms, saw %v", control.calls())
	}
	if !control.seen(authoringcoedit.ControlPathFreeze) {
		t.Fatal("publish must freeze before committing")
	}
}

func TestPublishGuardUnfreezesWhenThePublishFails(t *testing.T) {
	control := newFakeControlService(t)
	app, mock := coeditApp(t, control)
	mock.ExpectQuery("FROM authoring_coedit_documents").WithArgs(coeditTestExamID, "closed").
		WillReturnRows(coeditDocumentRows(t))
	expectFreezing(t, mock)
	expectManifestLoad(t, mock)
	expectReopen(t, mock)

	rec := httptest.NewRecorder()
	coeditPublishGuard(app, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusConflict)
	})(rec, coeditRequest("id", coeditTestExamID))

	if !control.seen(authoringcoedit.ControlPathUnfreeze) {
		t.Fatal("a failed publish must unfreeze the authors")
	}
	if control.seen(authoringcoedit.ControlPathClose) {
		t.Fatal("a failed publish must not close the rooms")
	}
}

// --- draft replacement -----------------------------------------------------

func TestScopeCloseGuardFlushesThenClosesWithTheMatchingReason(t *testing.T) {
	control := newFakeControlService(t)
	app, mock := coeditApp(t, control)
	mock.ExpectQuery("FROM authoring_coedit_documents").WithArgs("draft-1", "closed").
		WillReturnRows(coeditDocumentRows(t))
	expectFreezing(t, mock)
	expectManifestLoad(t, mock)
	expectCloseDocuments(t, mock, authoringcoedit.CloseDraftReplaced)
	ran := false

	rec := httptest.NewRecorder()
	coeditScopeCloseGuard(app, authoringcoedit.CloseDraftReplaced, "id",
		func(w http.ResponseWriter, _ *http.Request) { ran = true; w.WriteHeader(200) })(
		rec, coeditRequest("id", "draft-1"))

	if !ran {
		t.Fatal("the destructive mutation must run after the flush")
	}
	if control.seen(authoringcoedit.ControlPathFlush) {
		t.Fatalf("fenced replacement must use the operation-owned freeze/final-store path, saw %v", control.calls())
	}
	if !control.seen(authoringcoedit.ControlPathClose) {
		t.Fatal("draft replacement must close the affected rooms")
	}
}

func TestScopeCloseGuardLeavesRoomsOpenWhenTheMutationFails(t *testing.T) {
	control := newFakeControlService(t)
	app, mock := coeditApp(t, control)
	mock.ExpectQuery("FROM authoring_coedit_documents").WithArgs("draft-1", "closed").
		WillReturnRows(coeditDocumentRows(t))
	expectFreezing(t, mock)
	expectManifestLoad(t, mock)
	expectReopen(t, mock)

	rec := httptest.NewRecorder()
	coeditScopeCloseGuard(app, authoringcoedit.CloseDraftReplaced, "id",
		func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusConflict) })(
		rec, coeditRequest("id", "draft-1"))

	if control.seen(authoringcoedit.ControlPathClose) {
		t.Fatal("a failed replacement must not close the rooms")
	}
}

// --- v1/v2 close independence ---------------------------------------------
//
// Both room families are closed for one destructive mutation, in two separate
// service calls over two tables: v1 question-scoped prompt rooms and the v2
// exam-level workspace room. An early return or an else-if between them would
// leave the workspace open on a draft that was just replaced — and the next
// open would rebind it, which is the stale-write condition the freeze protocol
// exists to prevent. These tests pin that neither family hides behind the
// other's failure.

func TestCloseAfterSuccessClosesTheWorkspaceWhenThePromptCloseFails(t *testing.T) {
	control := newFakeControlService(t)
	app, mock := coeditApp(t, control)

	expectFamilyClose(t, mock, "authoring_coedit_documents", authoringcoedit.CloseDraftReplaced,
		errors.New("prompt close exploded"))
	expectWorkspaceCloseDocuments(t, mock, authoringcoedit.CloseDraftReplaced)

	err := coeditCloseAfterSuccess(context.Background(), app, coeditTestFamilies(t),
		authoringcoedit.CoeditLifecycleOperation{FreezeOperationID: "phase4-test-operation"},
		authoringcoedit.CloseDraftReplaced)
	if err == nil {
		t.Fatal("a failed durable close must be reported, not swallowed")
	}
	if !control.seen(authoringcoedit.ControlPathClose) {
		t.Fatalf("the affected rooms must be closed through the service, saw %v", control.calls())
	}
}

func TestCloseAfterSuccessClosesThePromptRoomWhenTheWorkspaceCloseFails(t *testing.T) {
	control := newFakeControlService(t)
	app, mock := coeditApp(t, control)

	expectCloseDocuments(t, mock, authoringcoedit.CloseWorkbookReplaced)
	expectFamilyClose(t, mock, "authoring_coedit_workspaces", authoringcoedit.CloseWorkbookReplaced,
		errors.New("workspace close exploded"))

	err := coeditCloseAfterSuccess(context.Background(), app, coeditTestFamilies(t),
		authoringcoedit.CoeditLifecycleOperation{FreezeOperationID: "phase4-test-operation"},
		authoringcoedit.CloseWorkbookReplaced)
	if err == nil {
		t.Fatal("a failed durable close must be reported, not swallowed")
	}
}

func TestCloseAfterSuccessStillClosesBothFamiliesWhenTheServiceCloseFails(t *testing.T) {
	control := newFakeControlService(t)
	control.failClose = true
	app, mock := coeditApp(t, control)

	// The durable close is attempted even though the live room cannot be told:
	// the destructive mutation already committed, so a room left writable in
	// MySQL would be the stale writer on the next open.
	expectCloseDocuments(t, mock, authoringcoedit.CloseExamPublished)
	expectWorkspaceCloseDocuments(t, mock, authoringcoedit.CloseExamPublished)

	err := coeditCloseAfterSuccess(context.Background(), app, coeditTestFamilies(t),
		authoringcoedit.CoeditLifecycleOperation{FreezeOperationID: "phase4-test-operation"},
		authoringcoedit.CloseExamPublished)
	if err == nil {
		t.Fatal("an unreachable control service must surface as an error")
	}
}

// --- question delete -------------------------------------------------------

func TestQuestionDeleteGuardIsTransparentWithoutAnActiveRoom(t *testing.T) {
	control := newFakeControlService(t)
	app, mock := coeditApp(t, control)
	mock.ExpectQuery("SELECT COUNT").
		WithArgs("eq-1", "closed", "eq-1", "closed").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	ran := false

	rec := httptest.NewRecorder()
	coeditQuestionDeleteGuard(app, func(w http.ResponseWriter, _ *http.Request) {
		ran = true
		w.WriteHeader(200)
	})(rec, coeditRequest("examQuestionID", "eq-1"))

	if !ran {
		t.Fatal("delete must run unchanged when no room is open")
	}
	if len(control.calls()) != 0 {
		t.Fatalf("no active room must mean no control calls, saw %v", control.calls())
	}
}

func TestQuestionDeleteGuardClosesTheRoomWithQuestionDeleted(t *testing.T) {
	control := newFakeControlService(t)
	app, mock := coeditApp(t, control)
	mock.ExpectQuery("SELECT COUNT").
		WithArgs("eq-1", "closed", "eq-1", "closed").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery("SELECT e.id FROM assessment_exam_questions eq").WithArgs("eq-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(coeditTestExamID))
	mock.ExpectQuery("FROM authoring_coedit_documents").WithArgs(coeditTestExamID, "closed").
		WillReturnRows(coeditDocumentRows(t))
	expectFreezing(t, mock)
	expectManifestLoad(t, mock)
	expectCloseDocuments(t, mock, authoringcoedit.CloseQuestionDeleted)
	ran := false

	rec := httptest.NewRecorder()
	coeditQuestionDeleteGuard(app, func(w http.ResponseWriter, _ *http.Request) {
		ran = true
		w.WriteHeader(200)
	})(rec, coeditRequest("examQuestionID", "eq-1"))

	if !ran {
		t.Fatal("delete must run after the room is flushed")
	}
	if !control.seen(authoringcoedit.ControlPathClose) {
		t.Fatal("a deleted question's room must be closed")
	}
	if len(control.calls()) == 0 {
		t.Fatal("expected control calls")
	}
}

func TestControlClientSignsEveryCall(t *testing.T) {
	control := newFakeControlService(t)
	app, _ := coeditApp(t, control)
	if err := app.CoeditControl.Flush(context.Background(), authoringcoedit.FlushRequest{
		DocumentNames: []string{controlDocumentName(t)},
	}); err != nil {
		t.Fatal(err)
	}
	if err := app.CoeditControl.Renew(context.Background(), authoringcoedit.RenewRequest{
		FreezeToken:       "lease-1",
		FreezeOperationID: "phase4-test-operation",
		FreezeExpiresAt:   time.Now().Add(time.Minute).Unix(),
	}); err != nil {
		t.Fatal(err)
	}
	control.mu.Lock()
	defer control.mu.Unlock()
	if control.unsigned != 0 {
		t.Fatalf("every private call must be signed, saw %d unsigned", control.unsigned)
	}
	foundRenew := false
	for _, path := range control.paths {
		if path == authoringcoedit.ControlPathRenew {
			foundRenew = true
			break
		}
	}
	if !foundRenew {
		t.Fatalf("renew call was not sent, saw %v", control.paths)
	}
}
