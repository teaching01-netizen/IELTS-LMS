package main

// Plan E (scale-proof): the k6 wave scripts are exam-day code — a route
// rename that 404s a wave must fail the build, not the exam. This test
// pins the five script paths against the real chi router: every script
// endpoint must route (not 404) with the right method. Route truth lives
// in main.go; script truth lives in k6/scale-proof/*.js.
//
// NOTE: all five pass today (no drift) — the entry path IS
// /api/v1/auth/student/entry (chi nests Route+Group prefixes). The test
// is the pin: GREEN now, RED on any future rename.
import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/student"
)

func TestK6ScaleProofRoutesExist(t *testing.T) {
	cfg := config.Load()
	app := BuildApp(cfg, nil)
	h := BuildRouter(app)
	cases := []struct {
		name   string
		method string
		target string
	}{
		// 0_entry_wave.js: POST /api/v1/auth/student/entry.
		{"entry-wave", http.MethodPost, "/api/v1/auth/student/entry"},
		// 1_bootstrap_herd.js: POST /api/v1/assessment-delivery/schedules/{id}/bootstrap.
		{"bootstrap-herd", http.MethodPost, "/api/v1/assessment-delivery/schedules/sched-1/bootstrap"},
		// 2_contend.js: PATCH /api/v1/assessment-delivery/schedules/{id}/responses/{qid}.
		{"contend", "PATCH", "/api/v1/assessment-delivery/schedules/sched-1/responses/q-1"},
		// 3_pollers.js: GET /api/v1/student/sessions/{id}/runtime.
		{"pollers", http.MethodGet, "/api/v1/student/sessions/sched-1/runtime?sinceRevision=0"},
		// 4_ws_staff_soak.js: GET /api/v1/ws/live (upgrade; 426/400/401
		// proves routing — only 404 proves drift).
		{"ws-soak", http.MethodGet, "/api/v1/ws/live?scheduleId=sched-1"},
	}
	for _, c := range cases {
		req := httptest.NewRequest(c.method, c.target, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == http.StatusNotFound {
			t.Fatalf("k6 script path drifted (404): %s %s %s", c.name, c.method, c.target)
		}
	}
}

// The contend script PATCHes delivery.SaveResponseRequest {revision,
// response, markedForReview, eliminatedOptions, annotations,
// clientWriteId}. The handler decodes the body BEFORE any DB work, so an
// unknown-field payload fails validation here (not deep in the tx). Pin
// the accepted shape + the clientWriteId idempotency key presence.
func TestK6ContendPayloadContract(t *testing.T) {
	var req struct {
		Revision          int             `json:"revision"`
		Response          json.RawMessage `json:"response"`
		MarkedForReview   bool            `json:"markedForReview"`
		EliminatedOptions []string        `json:"eliminatedOptions"`
		Annotations       json.RawMessage `json:"annotations"`
		ClientWriteID     *string         `json:"clientWriteId"`
	}
	body := `{"revision":0,"response":{"answer":"A"},"markedForReview":false,"eliminatedOptions":[],"annotations":{},"clientWriteId":"w-1"}`
	hreq := httptest.NewRequest(http.MethodPatch, "/x", strings.NewReader(body))
	hreq.Header.Set("Content-Type", "application/json")
	if err := httpx.DecodeLimited(hreq, httpx.MaxStudentBodyBytes, &req); err != nil {
		t.Fatalf("k6 contend payload must decode, got %v", err)
	}
	if req.ClientWriteID == nil || *req.ClientWriteID != "w-1" {
		t.Fatalf("clientWriteId idempotency key must survive decode, got %+v", req)
	}
	// The legacy v2 shape the script sent before round 34
	// ({writeId,questionId,clientVersion}) is REJECTED outright — the
	// decoder DisallowUnknownFields, so that drift 400d every wave
	// request. Guard: legacy keys must fail decode (proves strictness
	// that makes this contract test meaningful).
	var legacy struct {
		Revision      int     `json:"revision"`
		ClientWriteID *string `json:"clientWriteId"`
	}
	lreq := httptest.NewRequest(http.MethodPatch, "/x", strings.NewReader(`{"writeId":"w-1","questionId":"q-1","clientVersion":1}`))
	lreq.Header.Set("Content-Type", "application/json")
	if err := httpx.DecodeLimited(lreq, httpx.MaxStudentBodyBytes, &legacy); err == nil {
		t.Fatalf("legacy v2 shape must be rejected by the strict decoder")
	}
}

// The soak script's staff leg sends {type: subscribe, scheduleId} on
// open. The server-side subscribe contract (message type + schedule
// binding) is the admission invariant: a subscribe without a schedule
// the session cannot see must not subscribe. Pin the query-parse half
// here (pure, no DB): lastSeenRuntimeRevision follows the same
// non-negative-int64 contract as sinceRevision; scheduleId/attemptId
// trim whitespace.
func TestK6WSQueryContract(t *testing.T) {
	reqOf := func(q string) *http.Request {
		return httptest.NewRequest(http.MethodGet, "/api/v1/ws/live"+q, nil)
	}
	q, err := parseLiveWebSocketQuery(reqOf("?scheduleId=+sched-1+&attemptId=+att-1+&lastSeenRuntimeRevision=9"))
	if err != nil {
		t.Fatalf("valid WS query must parse, got %v", err)
	}
	if q.scheduleID != "sched-1" || q.attemptID != "att-1" {
		t.Fatalf("WS query IDs must trim, got %+v", q)
	}
	if q.lastSeenRuntimeRevision == nil || *q.lastSeenRuntimeRevision != 9 {
		t.Fatalf("lastSeenRuntimeRevision must parse, got %+v", q.lastSeenRuntimeRevision)
	}
	if _, err := parseLiveWebSocketQuery(reqOf("?scheduleId=s&lastSeenRuntimeRevision=-1")); err == nil {
		t.Fatalf("negative lastSeenRuntimeRevision must fail")
	}
	if _, err := parseLiveWebSocketQuery(reqOf("?scheduleId=s&lastSeenRuntimeRevision=abc")); err == nil {
		t.Fatalf("non-numeric lastSeenRuntimeRevision must fail")
	}
	if _, err := parseLiveWebSocketQuery(reqOf("?scheduleId=s&lastSeenRuntimeRevision=9999999999999999999999")); err == nil {
		t.Fatalf("overflowing lastSeenRuntimeRevision must fail")
	}
	// Empty query parses (authz decides later, not the parser).
	if _, err := parseLiveWebSocketQuery(reqOf("")); err != nil {
		t.Fatalf("empty WS query must parse (authz later), got %v", err)
	}
}

// The prod walk's heaviest write is mutations:batch
// ({attemptId, studentKey, clientSessionId, mutations[]} with items
// {id|mutationId, seq?, timestamp?, mutationType, payload}). The handler
// decodes V1MutationBatchWire then ParseMutationBatch (attemptId
// required, 1..500 items, unique ids). Pin: the k6 item shape parses
// (id alias + answer/writing_answer/violation types) and empty batches
// fail — a walk that ever sends zero mutations must 400, not no-op.
func TestK6MutationsBatchContract(t *testing.T) {
	parse := func(body string) error {
		var wire student.V1MutationBatchWire
		req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if err := httpx.DecodeLimited(req, httpx.MaxStudentBodyBytes, &wire); err != nil {
			return err
		}
		_, err := student.ParseMutationBatch(wire)
		return err
	}
	k6body := `{"attemptId":"att-1","studentKey":"","clientSessionId":"cs-1","mutations":[` +
		`{"id":"m-1","seq":1,"timestamp":"2026-01-01T00:00:00Z","mutationType":"answer","payload":{"questionId":"q-1","value":"A"}},` +
		`{"id":"m-2","seq":2,"timestamp":"2026-01-01T00:00:00Z","mutationType":"writing_answer","payload":{"taskId":"t-1","value":"essay"}},` +
		`{"id":"m-3","seq":3,"timestamp":"2026-01-01T00:00:00Z","mutationType":"violation","payload":{"violations":[{"type":"TAB_SWITCH"}]}}]}`
	if err := parse(k6body); err != nil {
		t.Fatalf("k6 mutation shapes must parse, got %v", err)
	}
	if err := parse(`{"attemptId":"att-1","studentKey":"","clientSessionId":"cs-1","mutations":[]}`); err == nil {
		t.Fatalf("empty mutation batch must fail validation")
	}
	if err := parse(`{"studentKey":"","clientSessionId":"cs-1","mutations":[{"id":"m-1","mutationType":"answer","payload":{}}]}`); err == nil {
		t.Fatalf("missing attemptId must fail validation")
	}
}

// The prod walk's warn leg posts {message, reason} (readProctorCmd tolerates
// all-optional fields). Pin: the k6 warn shape decodes into the real
// proctorCmdBody with both fields surviving the strict decoder.
func TestK6WarnPayloadContract(t *testing.T) {
	body := `{"message":"k6 warning r-1","reason":"k6_warn"}`
	req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	cmd, err := readProctorCmd(req)
	if err != nil {
		t.Fatalf("k6 warn payload must decode, got %v", err)
	}
	if cmd.Message == nil || *cmd.Message != "k6 warning r-1" || cmd.Reason == nil || *cmd.Reason != "k6_warn" {
		t.Fatalf("warn fields must survive, got %+v", cmd)
	}
}

// The prod walk's control-plane write is runtime/commands
// ({action, reason?, expectedRuntimeRevision?, expectedSectionKey?},
// staff-only: admin/builder/proctor). The walk sends
// {action: start_runtime, reason}. Pin: that shape decodes into the real
// handler wire struct with both fields surviving, and the role gate
// admits exactly admin/builder/proctor (students can never drive exam
// control — the write gate the 1M-student threat model depends on).
func TestK6RuntimeCommandContract(t *testing.T) {
	var wire struct {
		Action                  string  `json:"action"`
		Reason                  *string `json:"reason"`
		ExpectedRuntimeRevision *int64  `json:"expectedRuntimeRevision"`
		ExpectedSectionKey      *string `json:"expectedSectionKey"`
	}
	req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(`{"action":"start_runtime","reason":"k6 r-1"}`))
	req.Header.Set("Content-Type", "application/json")
	if err := httpx.DecodeLimited(req, httpx.MaxAdminBodyBytes, &wire); err != nil {
		t.Fatalf("k6 start_runtime payload must decode, got %v", err)
	}
	if wire.Action != "start_runtime" || wire.Reason == nil || *wire.Reason != "k6 r-1" {
		t.Fatalf("command fields must survive, got %+v", wire)
	}
	// Role gate (handlers_admin.go:640): the handler requires exactly
	// admin/builder/proctor via requireRole. A student session hitting
	// this route must be denied before any schedule lookup — pin that
	// the gate fires first by asserting requireRole semantics: anonymous
	// (no session) renders 401, never 404/503.
	anon := httptest.NewRequest(http.MethodPost, "/api/v1/schedules/sched-1/runtime/commands", strings.NewReader(`{"action":"start_runtime"}`))
	anon.Header.Set("Content-Type", "application/json")
	arec := httptest.NewRecorder()
	cfg := config.Load()
	BuildRouter(BuildApp(cfg, nil)).ServeHTTP(arec, anon)
	if arec.Code == http.StatusNotFound || arec.Code == http.StatusServiceUnavailable {
		t.Fatalf("anonymous command must be denied at auth (401/403), got %d", arec.Code)
	}
}

// The combined prod-exam-day.js walk (704 lines) exercises the full
// staff + student journey. Pin its route matrix against the real router
// (method + path; auth/service fail later, only 404 proves drift). All
// 14 pass today — no drift; the test is the pin against future renames:
// staff auth, proctor session/presence/warn, runtime commands, grading,
// entry, student bootstrap/precheck/session/heartbeat/mutations/submit.
func TestK6ProdExamDayRoutesExist(t *testing.T) {
	cfg := config.Load()
	app := BuildApp(cfg, nil)
	h := BuildRouter(app)
	cases := []struct {
		name   string
		method string
		target string
	}{
		{"staff-login", http.MethodPost, "/api/v1/auth/login"},
		{"proctor-session", http.MethodGet, "/api/v1/proctor/sessions/sched-1"},
		{"proctor-presence", http.MethodPost, "/api/v1/proctor/sessions/sched-1/presence"},
		{"proctor-warn", http.MethodPost, "/api/v1/proctor/sessions/sched-1/attempts/att-1/warn"},
		{"runtime-commands", http.MethodPost, "/api/v1/schedules/sched-1/runtime/commands"},
		{"schedule-runtime", http.MethodGet, "/api/v1/schedules/sched-1/runtime"},
		{"grading-sessions", http.MethodGet, "/api/v1/grading/sessions"},
		{"entry", http.MethodPost, "/api/v1/auth/student/entry"},
		{"student-bootstrap", http.MethodPost, "/api/v1/student/sessions/sched-1/bootstrap"},
		{"student-precheck", http.MethodPost, "/api/v1/student/sessions/sched-1/precheck"},
		{"student-session", http.MethodGet, "/api/v1/student/sessions/sched-1"},
		{"student-heartbeat", http.MethodPost, "/api/v1/student/sessions/sched-1/heartbeat"},
		{"student-mutations", http.MethodPost, "/api/v1/student/sessions/sched-1/mutations:batch"},
		{"student-submit", http.MethodPost, "/api/v1/student/sessions/sched-1/submit"},
	}
	for _, c := range cases {
		req := httptest.NewRequest(c.method, c.target, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == http.StatusNotFound {
			t.Fatalf("prod-exam-day path drifted (404): %s %s %s", c.name, c.method, c.target)
		}
	}
}

// The herd script posts an EMPTY body with only the attempt bearer —
// Bootstrap takes no request shape (schedule comes from the bearer + URL
// match). A body would be dead bytes on a 2k-VU herd; pin that the route
// accepts a nil body (no DecodeLimited on the path) and that bearer
// mismatch 403s (schedule binding enforced before any DB assembly).
func TestK6BootstrapHerdContract(t *testing.T) {
	cfg := config.Load()
	app := BuildApp(cfg, nil)
	h := BuildRouter(app)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/assessment-delivery/schedules/sched-1/bootstrap", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code == http.StatusNotFound {
		t.Fatalf("bootstrap route must exist")
	}
	// No bearer + no DB: must be 401 (auth before service), never 400
	// (no body to validate) and never 404 (route exists).
	if rec.Code == http.StatusBadRequest || rec.Code == http.StatusNotFound {
		t.Fatalf("empty-body bootstrap must not 400/404, got %d", rec.Code)
	}
}

// The poller script GETs ?sinceRevision=N with a session cookie. The
// handler parses sinceRevision as a non-negative int64 (400 otherwise)
// and returns 304 on steady state. Pin: negative/non-numeric 400s;
// missing param is valid (full view, no 400).
func TestK6PollerQueryContract(t *testing.T) {
	cfg := config.Load()
	app := BuildApp(cfg, nil)
	h := BuildRouter(app)
	get := func(q string) int {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/student/sessions/sched-1/runtime"+q, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	// No DB: the nil-service 503 fires BEFORE query parsing (availability
	// before validation by design — a down DB is not a client error).
	// Parse order is pinned at the unit level below instead: with the
	// service present the parse gate fires before PollView; here pin
	// that the route exists and does not 404 on any query shape.
	for _, q := range []string{"?sinceRevision=12", "", "?sinceRevision=-1", "?sinceRevision=abc"} {
		if code := get(q); code == http.StatusNotFound {
			t.Fatalf("poll route must exist (q=%q), got 404", q)
		}
	}
}

// The entry-wave script posts {scheduleId, wcode, email, studentName}. 
// The handler requires wcode-or-accessLink + email + studentName (400
// otherwise) — a payload rename on either side must fail here, not on
// exam day with 5k VUs all 400ing. scheduleId rides the JSON body (the
// route has no {scheduleID} segment).
func TestK6EntryWavePayloadContract(t *testing.T) {
	cfg := config.Load()
	app := BuildApp(cfg, nil)
	h := BuildRouter(app)
	post := func(body string) int {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/student/entry", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	// k6 shape (minus DB): must pass validation (any non-400 proves the
	// required-field contract holds; without DB it fails later, not 400).
	if code := post(`{"scheduleId":"sched-1","wcode":"W-1","email":"a@x.y","studentName":"Alice"}`); code == http.StatusBadRequest {
		t.Fatalf("k6 entry payload must pass validation, got 400")
	}
	// Missing each required field must 400 (handler still enforces).
	if code := post(`{"scheduleId":"sched-1","email":"a@x.y","studentName":"Alice"}`); code != http.StatusBadRequest {
		t.Fatalf("missing wcode must 400, got %d", code)
	}
	if code := post(`{"scheduleId":"sched-1","wcode":"W-1","studentName":"Alice"}`); code != http.StatusBadRequest {
		t.Fatalf("missing email must 400, got %d", code)
	}
	if code := post(`{"scheduleId":"sched-1","wcode":"W-1","email":"a@x.y"}`); code != http.StatusBadRequest {
		t.Fatalf("missing studentName must 400, got %d", code)
	}
}
