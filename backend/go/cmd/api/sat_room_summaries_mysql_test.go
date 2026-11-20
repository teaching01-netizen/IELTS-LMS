package main

// Real MySQL + real router witness for GET /api/v1/proctor/sessions scoping
// (SAT database RAM plan, rooms-sql task, properties P1/P2).
//
// The list route now applies ?providerKey= and the authenticated proctor's
// live assignment at SQL selection time (proctor.ListSessions scope) BEFORE
// runtime hydration and every grouped-count query. This test drives the REAL
// chi router, session middleware, handler and proctor service against MySQL
// and proves:
//   - P1 room visibility: admin/admin-observer keep the authorized SAT set,
//     a proctor sees ONLY currently assigned SAT rooms, a duplicate active
//     grant cannot multiply a room (EXISTS semijoin), a revoked grant is
//     excluded after a committed revocation, a proctor with no assignments
//     sees [], and the provider filter isolates sat/ielts/act.
//   - P2 parity: for the same fixed state, every HTTP summary's schedule,
//     counts, runtime status/id/sections/revision and degraded flag equals
//     the ORACLE path (ListSessions called with the zero scope and filtered by
//     the independently expected authorized room set), not the candidate
//     query. Ordering is compared as (start_time ASC, created_at DESC),
//     including a tied start_time resolved by created_at DESC.
//   - the invalid provider keeps the existing 422 VALIDATION_ERROR envelope.
//
// The fixture seeds unrelated providers, historical and live rooms, a room
// with no runtime (not_started synthesis), runtime sections, attempts with
// varied phase/proctor_status, registrations, admission-queue rows, audit
// logs, violation events and outbox rows so every summary field is
// exercised. All rows carry UUID ids / unique emails and are removed in
// t.Cleanup (best-effort; the database is disposable).
//
// Gated on TEST_MYSQL_DSN like the other real-MySQL suites in this package:
// absent -> skip; set but unusable -> FAIL (never a silent skip).

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/config"
	platformdb "example.com/ielts-proctoring/internal/platform/db"
	"example.com/ielts-proctoring/internal/proctor"
)

const (
	satRoomsPath       = "/api/v1/proctor/sessions"
	satRoomsTestCookie = "session"
	// nilRuntimeUUID mirrors proctor.nilUUID: the id of a synthesized runtime.
	nilRuntimeUUID = "00000000-0000-0000-0000-000000000000"
)

// satRoomAttemptSeed describes one student_attempts row by its count-relevant
// columns. Registration rows are created one-per-attempt by the seeder.
type satRoomAttemptSeed struct {
	phase         string
	proctorStatus string
	violations    int
}

// satRoomSectionSeed describes one exam_session_runtime_sections row.
type satRoomSectionSeed struct {
	key         string
	label       string
	order       int
	planned     int
	gap         int
	status      string
	actualStart *time.Time
}

// satRoomSeed is the independently-declared expectation for one room. The
// seeder writes exactly this shape, and the assertions derive the expected
// authorized set / ordering / counts from it without consulting the candidate
// query.
type satRoomSeed struct {
	key            string
	id             string
	provider       string
	scheduleStatus string
	start          time.Time
	created        time.Time
	revision       int64

	// runtime row (runtimeID == "" means no exam_session_runtimes row).
	runtimeID       string
	runtimeStatus   string
	runtimeRevision int64
	sections        []satRoomSectionSeed

	// expected projection values (terminal schedules synthesize a runtime).
	expectedRuntimeStatus   string
	expectedRuntimeRevision int64

	attempts             []satRoomAttemptSeed
	admissionQueued      int
	admissionCancelled   int
	alertCount           int
	degradedFromOutbox   bool
	expectedStudentC     int64
	expectedActiveC      int64
	expectedJoinReadyC   int64
	expectedJoinTotalC   int64
	expectedViolationC   int64
	expectedAlertC       int64
	expectedSectionCount int
}

// satRoomFixture is the whole seeded state plus the ids the assertions need.
type satRoomFixture struct {
	owner string

	rooms []satRoomSeed

	adminID    string
	observerID string
	proctor1ID string
	proctor2ID string

	// proctor1Active is the schedule-key set where proctor1 holds a live
	// role='proctor' assignment after seeding. satUpcomingA is revoked later
	// by the test (its assignment id is below); satHistorical is seeded
	// revoked; actRoom is granted with role='grader'; satUpcomingB has only
	// an actor_id-only grant (no user_id), which the list predicate never
	// matched.
	proctor1Active map[string]bool

	proctor1SATUpcomingAAssignmentID  string
	proctor1SATHistoricalAssignmentID string
	proctor1SATLiveAssignmentIDs      []string
	proctor1IELTSAssignmentID         string
	proctor1GraderACTAssignmentID     string
	proctor1ActorOnlyUpcomingBAssign  string
}

func (fx *satRoomFixture) room(key string) *satRoomSeed {
	for i := range fx.rooms {
		if fx.rooms[i].key == key {
			return &fx.rooms[i]
		}
	}
	panic("sat room fixture: unknown room key " + key)
}

func (fx *satRoomFixture) id(key string) string { return fx.room(key).id }

// sortedSATRoomKeys orders room seeds exactly like the SQL contract:
// ORDER BY start_time ASC, created_at DESC. The fixture never ties on both,
// so this is deterministic (and independent of the candidate query).
func sortedSATRoomKeys(rooms []satRoomSeed) []string {
	sorted := append([]satRoomSeed(nil), rooms...)
	sort.SliceStable(sorted, func(i, j int) bool {
		if !sorted[i].start.Equal(sorted[j].start) {
			return sorted[i].start.Before(sorted[j].start)
		}
		return sorted[i].created.After(sorted[j].created)
	})
	keys := make([]string, 0, len(sorted))
	for _, r := range sorted {
		keys = append(keys, r.key)
	}
	return keys
}

func (fx *satRoomFixture) expectedRoomKeys(provider string) []string {
	rooms := make([]satRoomSeed, 0, len(fx.rooms))
	for _, r := range fx.rooms {
		if provider == "" || r.provider == provider {
			rooms = append(rooms, r)
		}
	}
	return sortedSATRoomKeys(rooms)
}

func (fx *satRoomFixture) expectedRoomIDs(provider string) []string {
	keys := fx.expectedRoomKeys(provider)
	ids := make([]string, 0, len(keys))
	for _, key := range keys {
		ids = append(ids, fx.id(key))
	}
	return ids
}

// expectedProctor1Keys is the set the OLD handler would have allowed for
// proctor1: live schedule_staff_assignments rows with user_id = proctor1,
// role='proctor', revoked_at IS NULL (duplicates collapse), intersected with
// the provider filter.
func (fx *satRoomFixture) expectedProctor1Keys(provider string) []string {
	rooms := make([]satRoomSeed, 0, len(fx.rooms))
	for _, r := range fx.rooms {
		if !fx.proctor1Active[r.key] {
			continue
		}
		if provider != "" && r.provider != provider {
			continue
		}
		rooms = append(rooms, r)
	}
	return sortedSATRoomKeys(rooms)
}

func (fx *satRoomFixture) expectedProctor1IDs(provider string) []string {
	keys := fx.expectedProctor1Keys(provider)
	ids := make([]string, 0, len(keys))
	for _, key := range keys {
		ids = append(ids, fx.id(key))
	}
	return ids
}

// satRoomSummariesHarness is the real application graph plus a controllable
// session resolver: requests carry the fixed cookie `session=test`, and the
// resolver returns whichever session the test selected.
type satRoomSummariesHarness struct {
	cfg      config.Config
	app      *App
	router   http.Handler
	selected *auth.Session
}

func newSATRoomSession(userID, role string) *auth.Session {
	now := time.Now().UTC()
	return &auth.Session{
		ID:            "sess-" + userID,
		UserID:        userID,
		Role:          role,
		CSRFToken:     "csrf-" + userID,
		IssuedAt:      now.Add(-time.Minute),
		ExpiresAt:     now.Add(2 * time.Hour),
		IdleTimeoutAt: now.Add(time.Hour),
		ValidatedAt:   now,
	}
}

func newSATRoomSummariesHarness(t *testing.T, db *sql.DB) *satRoomSummariesHarness {
	t.Helper()
	cfg := config.Load()
	cfg.Environment = "test"
	cfg.CookieSecure = false
	cfg.SessionCacheEnabled = false
	cfg.RateLimitMode = config.RateLimitModeLocal
	cfg.BackgroundMode = config.BackgroundActivityDriven
	cfg.SessionCookieName = "session"
	cfg.CsrfCookieName = "csrf"
	// Pin live mode (ambient default is true): the degraded summary field is
	// seeded through stale outbox rows and must be exercised deterministically.
	cfg.LiveModeEnabled = true

	h := &satRoomSummariesHarness{cfg: cfg}
	app := BuildApp(cfg, db)
	if app.Proctor == nil {
		t.Fatal("BuildApp must wire the Proctor service for the sessions route")
	}
	h.app = app
	app.SessionResolver = func(context.Context, *sql.DB, *auth.SessionCache, config.Config, string) (*auth.Session, error) {
		if h.selected == nil {
			return nil, nil
		}
		copied := *h.selected
		return &copied, nil
	}
	h.router = BuildRouter(app)
	return h
}

func (h *satRoomSummariesHarness) rawGet(t *testing.T, sess *auth.Session, target string) *httptest.ResponseRecorder {
	t.Helper()
	h.selected = sess
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req.AddCookie(&http.Cookie{Name: satRoomsTestCookie, Value: "test"})
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	return rec
}

func (h *satRoomSummariesHarness) get(t *testing.T, sess *auth.Session, target string) []proctor.ProctorSessionSummary {
	t.Helper()
	rec := h.rawGet(t, sess, target)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s: status %d, body %s", target, rec.Code, rec.Body.String())
	}
	var out []proctor.ProctorSessionSummary
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("GET %s: summary list must decode: %v (body %s)", target, err, rec.Body.String())
	}
	if out == nil {
		t.Fatalf("GET %s: summary list must be a JSON array, got %s", target, rec.Body.String())
	}
	return out
}

func summaryIDs(summaries []proctor.ProctorSessionSummary) []string {
	ids := make([]string, 0, len(summaries))
	for _, s := range summaries {
		ids = append(ids, s.Schedule.ID)
	}
	return ids
}

// assertRoomIDs proves the exact authorized room set and ordering.
func assertRoomIDs(t *testing.T, label string, summaries []proctor.ProctorSessionSummary, want []string) {
	t.Helper()
	got := summaryIDs(summaries)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%s: authorized room set/order mismatch\n got: %v\nwant: %v", label, got, want)
	}
	seen := make(map[string]int, len(got))
	for _, id := range got {
		seen[id]++
		if seen[id] > 1 {
			t.Fatalf("%s: room %s appears more than once (duplicate grant must not multiply rooms): %v", label, id, got)
		}
	}
}

func countSummaryID(summaries []proctor.ProctorSessionSummary, id string) int {
	n := 0
	for _, s := range summaries {
		if s.Schedule.ID == id {
			n++
		}
	}
	return n
}

func findSummary(t *testing.T, label string, summaries []proctor.ProctorSessionSummary, id string) proctor.ProctorSessionSummary {
	t.Helper()
	for _, s := range summaries {
		if s.Schedule.ID == id {
			return s
		}
	}
	t.Fatalf("%s: room %s missing from response %v", label, id, summaryIDs(summaries))
	return proctor.ProctorSessionSummary{}
}

func assertRoomSummaryValues(t *testing.T, label string, got proctor.ProctorSessionSummary, want satRoomSeed) {
	t.Helper()
	if got.Schedule.ID != want.id {
		t.Fatalf("%s: schedule id %q, want %q", label, got.Schedule.ID, want.id)
	}
	if got.Schedule.ProviderKey != want.provider {
		t.Fatalf("%s/%s: providerKey %q, want %q", label, want.key, got.Schedule.ProviderKey, want.provider)
	}
	if got.Schedule.Status != want.scheduleStatus {
		t.Fatalf("%s/%s: schedule status %q, want %q", label, want.key, got.Schedule.Status, want.scheduleStatus)
	}
	if got.StudentCount != want.expectedStudentC {
		t.Fatalf("%s/%s: studentCount %d, want %d", label, want.key, got.StudentCount, want.expectedStudentC)
	}
	if got.ActiveCount != want.expectedActiveC {
		t.Fatalf("%s/%s: activeCount %d, want %d", label, want.key, got.ActiveCount, want.expectedActiveC)
	}
	if got.JoinReadyCount == nil || *got.JoinReadyCount != want.expectedJoinReadyC {
		t.Fatalf("%s/%s: joinReadyCount %v, want %d", label, want.key, got.JoinReadyCount, want.expectedJoinReadyC)
	}
	if got.JoinTotalCount == nil || *got.JoinTotalCount != want.expectedJoinTotalC {
		t.Fatalf("%s/%s: joinTotalCount %v, want %d", label, want.key, got.JoinTotalCount, want.expectedJoinTotalC)
	}
	if got.AlertCount != want.expectedAlertC {
		t.Fatalf("%s/%s: alertCount %d, want %d", label, want.key, got.AlertCount, want.expectedAlertC)
	}
	if got.ViolationCount != want.expectedViolationC {
		t.Fatalf("%s/%s: violationCount %d, want %d", label, want.key, got.ViolationCount, want.expectedViolationC)
	}
	if got.DegradedLiveMode != want.degradedFromOutbox {
		t.Fatalf("%s/%s: degradedLiveMode %v, want %v", label, want.key, got.DegradedLiveMode, want.degradedFromOutbox)
	}
	if got.Runtime.Status != want.expectedRuntimeStatus {
		t.Fatalf("%s/%s: runtime status %q, want %q", label, want.key, got.Runtime.Status, want.expectedRuntimeStatus)
	}
	if got.Runtime.Revision != want.expectedRuntimeRevision {
		t.Fatalf("%s/%s: runtime revision %d, want %d", label, want.key, got.Runtime.Revision, want.expectedRuntimeRevision)
	}
	if len(got.Runtime.Sections) != want.expectedSectionCount {
		t.Fatalf("%s/%s: runtime sections %d, want %d", label, want.key, len(got.Runtime.Sections), want.expectedSectionCount)
	}
}

// normalizeSATRuntimeTiming blanks only the volatile clock fields the plan
// allows the differential oracle to differ on. A synthesized runtime also
// stamps CreatedAt/UpdatedAt with the reading call's clock, so those are
// blanked for the nil-UUID projection only; counts/status/order are never
// normalized.
func normalizeSATRuntimeTiming(rt proctor.SessionRuntime) proctor.SessionRuntime {
	rt.ServerNow = time.Time{}
	rt.CurrentSectionRemainingSeconds = 0
	rt.CurrentSectionDeadlineAt = nil
	rt.NextSectionStartAt = nil
	if rt.ID == nilRuntimeUUID {
		rt.CreatedAt = time.Time{}
		rt.UpdatedAt = time.Time{}
	}
	return rt
}

// assertSummaryParity compares one HTTP summary against the unscoped service
// oracle for the same room.
func assertSummaryParity(t *testing.T, got, oracle proctor.ProctorSessionSummary) {
	t.Helper()
	gotSchedule, err := json.Marshal(got.Schedule)
	if err != nil {
		t.Fatalf("marshal HTTP schedule: %v", err)
	}
	oracleSchedule, err := json.Marshal(oracle.Schedule)
	if err != nil {
		t.Fatalf("marshal oracle schedule: %v", err)
	}
	if string(gotSchedule) != string(oracleSchedule) {
		t.Fatalf("room %s: HTTP schedule differs from oracle schedule\n http:   %s\n oracle: %s",
			got.Schedule.ID, gotSchedule, oracleSchedule)
	}
	if got.StudentCount != oracle.StudentCount ||
		got.ActiveCount != oracle.ActiveCount ||
		got.AlertCount != oracle.AlertCount ||
		got.ViolationCount != oracle.ViolationCount ||
		got.DegradedLiveMode != oracle.DegradedLiveMode {
		t.Fatalf("room %s: HTTP counts/degraded differ from oracle: http=%+v oracle=%+v", got.Schedule.ID, got, oracle)
	}
	if got.JoinReadyCount == nil || oracle.JoinReadyCount == nil || *got.JoinReadyCount != *oracle.JoinReadyCount {
		t.Fatalf("room %s: joinReadyCount http=%v oracle=%v", got.Schedule.ID, got.JoinReadyCount, oracle.JoinReadyCount)
	}
	if got.JoinTotalCount == nil || oracle.JoinTotalCount == nil || *got.JoinTotalCount != *oracle.JoinTotalCount {
		t.Fatalf("room %s: joinTotalCount http=%v oracle=%v", got.Schedule.ID, got.JoinTotalCount, oracle.JoinTotalCount)
	}
	httpRuntime := normalizeSATRuntimeTiming(got.Runtime)
	oracleRuntime := normalizeSATRuntimeTiming(oracle.Runtime)
	if !reflect.DeepEqual(httpRuntime, oracleRuntime) {
		gotJSON, _ := json.Marshal(httpRuntime)
		wantJSON, _ := json.Marshal(oracleRuntime)
		t.Fatalf("room %s: HTTP runtime differs from oracle runtime\n http:   %s\n oracle: %s", got.Schedule.ID, gotJSON, wantJSON)
	}
}

// satRoomSummariesTestDB opens TEST_MYSQL_DSN like the other real-MySQL
// suites: unset skips, set-but-broken fails.
func satRoomSummariesTestDB(t *testing.T) *sql.DB {
	t.Helper()
	raw := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if raw == "" {
		t.Skip("TEST_MYSQL_DSN not set; TestSATRoomSummaries requires isolated MySQL")
	}
	dsn, err := platformdb.NormalizeDSN(raw)
	if err != nil {
		t.Fatalf("normalize TEST_MYSQL_DSN: %v", err)
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("open TEST_MYSQL_DSN: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		t.Fatalf("TEST_MYSQL_DSN is set but unusable: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// TestSATRoomSummariesRouteScopeAndParity is the single end-to-end witness.
func TestSATRoomSummariesRouteScopeAndParity(t *testing.T) {
	db := satRoomSummariesTestDB(t)
	fx := seedSATRoomSummariesFixture(t, db, true)
	h := newSATRoomSummariesHarness(t, db)
	ctx := context.Background()

	admin := newSATRoomSession(fx.adminID, auth.RoleAdmin)
	observer := newSATRoomSession(fx.observerID, auth.RoleAdminObserver)
	proctor1 := newSATRoomSession(fx.proctor1ID, auth.RoleProctor)
	proctor2 := newSATRoomSession(fx.proctor2ID, auth.RoleProctor)

	// --- P1: admin provider scope is the authorized SAT set, once per room ---
	adminSAT := h.get(t, admin, satRoomsPath+"?providerKey=sat")
	assertRoomIDs(t, "admin ?providerKey=sat", adminSAT, fx.expectedRoomIDs("sat"))

	// --- P1: admin observer keeps the same visibility ---
	observerSAT := h.get(t, observer, satRoomsPath+"?providerKey=sat")
	assertRoomIDs(t, "admin observer ?providerKey=sat", observerSAT, fx.expectedRoomIDs("sat"))

	// --- P1: proctor provider scope: duplicate grant -> ONE room, revoked
	// grant and other-provider/role grants excluded ---
	proctorSAT := h.get(t, proctor1, satRoomsPath+"?providerKey=sat")
	assertRoomIDs(t, "proctor ?providerKey=sat", proctorSAT, fx.expectedProctor1IDs("sat"))
	if n := countSummaryID(proctorSAT, fx.id("satLive")); n != 1 {
		t.Fatalf("duplicate active assignment on satLive must yield ONE summary, got %d", n)
	}
	for _, excluded := range []string{"satHistorical", "actRoom", "satUpcomingB"} {
		if n := countSummaryID(proctorSAT, fx.id(excluded)); n != 0 {
			t.Fatalf("proctor must not see %s (revoked/other-role/actor-only grant): got %d summaries", excluded, n)
		}
	}

	// --- P1: a proctor with no assignments sees [] ---
	proctor2SAT := h.get(t, proctor2, satRoomsPath+"?providerKey=sat")
	if len(proctor2SAT) != 0 {
		t.Fatalf("proctor with no assignments must see [], got %v", summaryIDs(proctor2SAT))
	}
	proctor2All := h.get(t, proctor2, satRoomsPath)
	if len(proctor2All) != 0 {
		t.Fatalf("unassigned proctor without provider must see [], got %v", summaryIDs(proctor2All))
	}

	// --- P1: proctor without provider sees ALL actively assigned rooms
	// (SAT + IELTS), never an unassigned room, in the same SQL order ---
	proctorAll := h.get(t, proctor1, satRoomsPath)
	assertRoomIDs(t, "proctor unfiltered", proctorAll, fx.expectedProctor1IDs(""))
	if n := countSummaryID(proctorAll, fx.id("ieltsRoom")); n != 1 {
		t.Fatalf("proctor's active IELTS assignment must be visible without the provider filter, got %d", n)
	}
	for _, excluded := range []string{"actRoom", "satHistorical", "satUpcomingB"} {
		if n := countSummaryID(proctorAll, fx.id(excluded)); n != 0 {
			t.Fatalf("proctor must not see unassigned/historical-revoked %s without a provider filter: got %d", excluded, n)
		}
	}

	// --- P1: other-provider isolation and invalid-provider validation ---
	adminIELTS := h.get(t, admin, satRoomsPath+"?providerKey=ielts")
	assertRoomIDs(t, "admin ?providerKey=ielts", adminIELTS, fx.expectedRoomIDs("ielts"))

	bogus := h.rawGet(t, admin, satRoomsPath+"?providerKey=bogus")
	if bogus.Code != http.StatusUnprocessableEntity {
		t.Fatalf("?providerKey=bogus must be 422, got %d (%s)", bogus.Code, bogus.Body.String())
	}
	var envelope apperrors.Envelope
	if err := json.Unmarshal(bogus.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("422 body must decode: %v (%s)", err, bogus.Body.String())
	}
	if envelope.Code != string(apperrors.CodeValidation) || envelope.Message != "providerKey must be sat, ielts, or act." {
		t.Fatalf("422 body changed: code=%q message=%q (want VALIDATION_ERROR / providerKey must be sat, ielts, or act.)",
			envelope.Code, envelope.Message)
	}

	// --- P2: unfiltered admin route returns the full seeded set in the same
	// order as the unscoped service path ---
	adminAll := h.get(t, admin, satRoomsPath)
	assertRoomIDs(t, "admin unfiltered", adminAll, fx.expectedRoomIDs(""))

	// Every summary field is exercised against independently declared values.
	for _, key := range []string{"satLive", "satUpcomingA", "satUpcomingB", "satHistorical"} {
		want := *fx.room(key)
		got := findSummary(t, "admin ?providerKey=sat", adminSAT, want.id)
		assertRoomSummaryValues(t, "admin ?providerKey=sat", got, want)
	}

	// --- P2 parity oracle: the OLD unscoped path, filtered by the
	// independently expected authorized SAT id set, must agree field-by-field
	// with the HTTP response. This compares against the baseline service read,
	// not against the candidate selection query. ---
	oracle, err := h.app.Proctor.ListSessions(ctx,
		proctor.Actor{ID: fx.adminID, Role: proctor.RoleAdmin, CSRFVerified: true},
		h.cfg.LiveModeEnabled, proctor.SessionListScope{})
	if err != nil {
		t.Fatalf("unscoped oracle ListSessions must succeed: %v", err)
	}
	wantSAT := make(map[string]bool, len(fx.expectedRoomKeys("sat")))
	for _, id := range fx.expectedRoomIDs("sat") {
		wantSAT[id] = true
	}
	oracleSAT := make([]proctor.ProctorSessionSummary, 0, len(wantSAT))
	for _, summary := range oracle {
		if wantSAT[summary.Schedule.ID] {
			oracleSAT = append(oracleSAT, summary)
		}
	}
	if len(oracleSAT) != len(adminSAT) {
		t.Fatalf("oracle authorized SAT set has %d rooms, HTTP has %d (oracle %v, http %v)",
			len(oracleSAT), len(adminSAT), summaryIDs(oracleSAT), summaryIDs(adminSAT))
	}
	for i := range adminSAT {
		assertSummaryParity(t, adminSAT[i], oracleSAT[i])
	}
	if got, want := summaryIDs(adminAll), summaryIDs(oracle); !reflect.DeepEqual(got, want) {
		t.Fatalf("unfiltered route order must match the unscoped service order\n got: %v\nwant: %v", got, want)
	}

}

// TestSATRoomSummariesCommittedRevocation is the dedicated negative witness
// for the assignment predicate's revoked_at IS NULL clause: after a committed
// revocation a FRESH request must drop the room. A mutant that removes the
// revoked predicate fails exactly this assertion.
func TestSATRoomSummariesCommittedRevocation(t *testing.T) {
	db := satRoomSummariesTestDB(t)
	// The seeded revoked grant is omitted here so the before/after delta is
	// solely the committed revocation performed below.
	fx := seedSATRoomSummariesFixture(t, db, false)
	h := newSATRoomSummariesHarness(t, db)
	proctor1 := newSATRoomSession(fx.proctor1ID, auth.RoleProctor)
	ctx := context.Background()

	before := h.get(t, proctor1, satRoomsPath+"?providerKey=sat")
	assertRoomIDs(t, "proctor ?providerKey=sat before revocation", before, fx.expectedProctor1IDs("sat"))

	if _, err := db.ExecContext(ctx,
		`UPDATE schedule_staff_assignments SET revoked_at = UTC_TIMESTAMP() WHERE id = ?`,
		fx.proctor1SATUpcomingAAssignmentID); err != nil {
		t.Fatalf("commit revocation of proctor1's satUpcomingA assignment: %v", err)
	}

	afterRevoke := h.get(t, proctor1, satRoomsPath+"?providerKey=sat")
	assertRoomIDs(t, "proctor ?providerKey=sat after committed revocation", afterRevoke, []string{fx.id("satLive")})
}

// seedSATRoomSummariesFixture inserts one disposable room universe and
// returns the independently expected state. seededRevokedGrant controls the
// pre-revoked satHistorical grant (the P1 exclusion case); the
// committed-revocation witness omits it so its before/after delta is the
// committed UPDATE alone. All rows are removed in t.Cleanup.
func seedSATRoomSummariesFixture(t *testing.T, db *sql.DB, seededRevokedGrant bool) *satRoomFixture {
	t.Helper()
	ctx := context.Background()
	owner := "sat-rooms-" + uuid.NewString()
	now := time.Now().UTC().Truncate(time.Second)

	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("seed sat room summaries (%.80q): %v", query, err)
		}
	}
	newID := func() string { return uuid.NewString() }

	// ---- staff accounts (unique emails) ----
	adminID, observerID, proctor1ID, proctor2ID := newID(), newID(), newID(), newID()
	seedUser := func(id, role string) {
		exec(`INSERT INTO users (id, email, display_name, role, state) VALUES (?, ?, ?, ?, 'active')`,
			id, owner+"-"+id+"@example.test", "SAT rooms "+role, role)
	}
	seedUser(adminID, auth.RoleAdmin)
	seedUser(observerID, auth.RoleAdminObserver)
	seedUser(proctor1ID, auth.RoleProctor)
	seedUser(proctor2ID, auth.RoleProctor)

	// ---- three provider exam entities + published versions (one per provider) ----
	type providerExams struct{ examID, versionID string }
	seedProvider := func(provider, examType string) providerExams {
		examID, versionID := newID(), newID()
		exec(`INSERT INTO exam_entities (
			id, slug, title, provider_key, provider_exam_type, exam_type,
			status, visibility, organization_id, owner_id, schema_version, revision
		) VALUES (?, ?, ?, ?, ?, ?, 'published', 'organization', ?, ?, 1, 1)`,
			examID, owner+"-"+provider+"-"+examID, "SAT rooms "+provider, provider, provider, examType,
			"sat-rooms-org", owner)
		scope := any(nil)
		if provider == "sat" {
			scope = "full"
		}
		exec(`INSERT INTO exam_versions (
			id, exam_id, version_number, content_snapshot, config_snapshot,
			created_by, is_published, revision, sat_publish_scope
		) VALUES (?, ?, 1, '{}', '{}', ?, TRUE, 1, ?)`,
			versionID, examID, owner, scope)
		exec(`UPDATE exam_entities SET current_published_version_id = ? WHERE id = ?`, versionID, examID)
		return providerExams{examID: examID, versionID: versionID}
	}
	satExams := seedProvider("sat", "Academic")
	ieltsExams := seedProvider("ielts", "Academic")
	actExams := seedProvider("act", "ACT")

	// ---- rooms ----
	liveStartActual := now.Add(-20 * time.Minute)
	fx := &satRoomFixture{
		owner:          owner,
		adminID:        adminID,
		observerID:     observerID,
		proctor1ID:     proctor1ID,
		proctor2ID:     proctor2ID,
		proctor1Active: map[string]bool{"satLive": true, "satUpcomingA": true, "ieltsRoom": true},
	}
	fx.rooms = []satRoomSeed{
		{
			key: "satHistorical", id: newID(), provider: "sat", scheduleStatus: "completed",
			start: now.Add(-5 * time.Hour), created: now.Add(-6 * time.Hour), revision: 3,
			// No runtime row: the terminal schedule status projects the
			// synthesized runtime to completed (not not_started).
			expectedRuntimeStatus: "completed", expectedRuntimeRevision: 3,
			attempts:           []satRoomAttemptSeed{{phase: "post-exam", proctorStatus: "terminated"}},
			expectedStudentC:   1,
			expectedActiveC:    0,
			expectedJoinReadyC: 1,
			expectedJoinTotalC: 1,
		},
		{
			key: "satLive", id: newID(), provider: "sat", scheduleStatus: "live",
			start: now.Add(-30 * time.Minute), created: now.Add(-3 * time.Hour), revision: 4,
			runtimeID: newID(), runtimeStatus: "live", runtimeRevision: 7,
			sections: []satRoomSectionSeed{
				{key: "reading-writing", label: "Reading and Writing", order: 0, planned: 64, gap: 10, status: "live", actualStart: &liveStartActual},
				{key: "math", label: "Math", order: 1, planned: 35, gap: 0, status: "locked"},
			},
			expectedRuntimeStatus: "live", expectedRuntimeRevision: 7,
			attempts: []satRoomAttemptSeed{
				{phase: "exam", proctorStatus: "active", violations: 2},
				{phase: "exam", proctorStatus: "paused", violations: 1},
				{phase: "post-exam", proctorStatus: "terminated"},
			},
			admissionQueued:      4,
			admissionCancelled:   1,
			alertCount:           2,
			degradedFromOutbox:   true,
			expectedStudentC:     3,
			expectedActiveC:      1,
			expectedJoinReadyC:   3,
			expectedJoinTotalC:   4,
			expectedViolationC:   3,
			expectedAlertC:       2,
			expectedSectionCount: 2,
		},
		{
			key: "satUpcomingA", id: newID(), provider: "sat", scheduleStatus: "scheduled",
			start: now.Add(2 * time.Hour), created: now.Add(-2 * time.Hour), revision: 1,
			// No runtime row -> not_started synthesis.
			expectedRuntimeStatus: "not_started", expectedRuntimeRevision: 0,
			attempts:           []satRoomAttemptSeed{{phase: "lobby", proctorStatus: "active"}},
			admissionQueued:    1,
			expectedStudentC:   1,
			expectedActiveC:    0,
			expectedJoinReadyC: 1,
			expectedJoinTotalC: 1,
		},
		{
			// Tied start_time with satUpcomingA: created_at DESC puts B first.
			key: "satUpcomingB", id: newID(), provider: "sat", scheduleStatus: "scheduled",
			start: now.Add(2 * time.Hour), created: now.Add(-1 * time.Hour), revision: 1,
			runtimeID: newID(), runtimeStatus: "not_started", runtimeRevision: 2,
			expectedRuntimeStatus: "not_started", expectedRuntimeRevision: 2,
			expectedStudentC:   0,
			expectedActiveC:    0,
			expectedJoinReadyC: 0,
			expectedJoinTotalC: 0,
		},
		{
			key: "ieltsRoom", id: newID(), provider: "ielts", scheduleStatus: "live",
			start: now.Add(-10 * time.Minute), created: now.Add(-4 * time.Hour), revision: 2,
			runtimeID: newID(), runtimeStatus: "live", runtimeRevision: 4,
			sections: []satRoomSectionSeed{
				{key: "reading", label: "Reading", order: 0, planned: 60, gap: 0, status: "live", actualStart: &liveStartActual},
			},
			expectedRuntimeStatus: "live", expectedRuntimeRevision: 4,
			attempts: []satRoomAttemptSeed{
				{phase: "exam", proctorStatus: "active", violations: 1},
				{phase: "pre-check", proctorStatus: "active"},
			},
			admissionQueued:      1,
			alertCount:           1,
			expectedStudentC:     2,
			expectedActiveC:      1,
			expectedJoinReadyC:   2,
			expectedJoinTotalC:   2,
			expectedViolationC:   1,
			expectedAlertC:       1,
			expectedSectionCount: 1,
		},
		{
			key: "actRoom", id: newID(), provider: "act", scheduleStatus: "scheduled",
			start: now.Add(3 * time.Hour), created: now.Add(-5 * time.Hour), revision: 1,
			expectedRuntimeStatus: "not_started", expectedRuntimeRevision: 0,
		},
	}
	examByProvider := map[string]providerExams{
		"sat": satExams, "ielts": ieltsExams, "act": actExams,
	}

	for i := range fx.rooms {
		room := &fx.rooms[i]
		exams := examByProvider[room.provider]
		timingModel := "legacy_section_v1"
		if room.provider == "sat" {
			timingModel = "sat_personal_v1"
		}
		exec(`INSERT INTO exam_schedules (
			id, exam_id, provider_key, organization_id, exam_title, proctor_display_name,
			grading_display_name, published_version_id, cohort_name, institution,
			start_time, end_time, planned_duration_minutes, delivery_mode,
			status, created_at, created_by, updated_at, revision
		) VALUES (?, ?, ?, 'sat-rooms-org', ?, ?, ?, ?, ?, 'Codex',
			?, ?, 120, 'proctor_start', ?, ?, ?, ?, ?)`,
			room.id, exams.examID, room.provider, "SAT rooms "+room.key, "SAT rooms "+room.key,
			"SAT rooms "+room.key, exams.versionID, "sat-rooms-"+room.key,
			room.start, room.start.Add(2*time.Hour), room.scheduleStatus,
			room.created, owner, room.created, room.revision)
		if room.runtimeID != "" {
			exec(`INSERT INTO exam_session_runtimes (
				id, schedule_id, exam_id, provider_key, status, plan_snapshot,
				timing_model, active_section_key, current_section_key,
				current_section_remaining_seconds, created_at, updated_at, revision
			) VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, 900, ?, ?, ?)`,
				room.runtimeID, room.id, exams.examID, room.provider, room.runtimeStatus,
				timingModel,
				sectionKeyPtr(room.sections, "live"), sectionKeyPtr(room.sections, "live"),
				room.created, room.created, room.runtimeRevision)
			for _, sec := range room.sections {
				exec(`INSERT INTO exam_session_runtime_sections (
					id, runtime_id, section_key, label, section_order,
					planned_duration_minutes, gap_after_minutes, status,
					available_at, actual_start_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					newID(), room.runtimeID, sec.key, sec.label, sec.order,
					sec.planned, sec.gap, sec.status, room.start, sec.actualStart)
			}
		}

		// Registrations + attempts (one registration per attempt).
		roomAttemptIDs := make([]string, 0, len(room.attempts))
		for _, attempt := range room.attempts {
			attemptID, registrationID := newID(), newID()
			roomAttemptIDs = append(roomAttemptIDs, attemptID)
			studentKey := owner + "-" + room.key + "-" + attemptID
			exec(`INSERT INTO schedule_registrations (
				id, schedule_id, student_key, student_id, student_name,
				student_email, access_state, wcode
			) VALUES (?, ?, ?, ?, ?, ?, 'checked_in', ?)`,
				registrationID, room.id, studentKey, "student-"+attemptID,
				"SAT rooms student", owner+"-reg-"+attemptID+"@example.test", owner+"-wcode-"+attemptID)
			exec(`INSERT INTO student_attempts (
				id, schedule_id, registration_id, student_key, organization_id,
				exam_id, published_version_id, exam_title, candidate_id,
				candidate_name, candidate_email, phase, current_module,
				answers, writing_answers, flags, violations_snapshot, integrity,
				recovery, proctor_status, wcode
			) VALUES (?, ?, ?, ?, 'sat-rooms-org', ?, ?, ?, ?, ?, ?, ?, 'reading',
				'{}', '{}', '{}', '[]', '{}', '{}', ?, ?)`,
				attemptID, room.id, registrationID, studentKey,
				exams.examID, exams.versionID, "SAT rooms "+room.key,
				"candidate-"+attemptID, "SAT rooms candidate",
				owner+"-cand-"+attemptID+"@example.test", attempt.phase, attempt.proctorStatus,
				owner+"-attempt-wcode-"+attemptID)
			for v := 0; v < attempt.violations; v++ {
				exec(`INSERT INTO student_violation_events (
					id, schedule_id, attempt_id, violation_id, violation_type,
					severity, description, payload
				) VALUES (?, ?, ?, ?, 'focus_lost', 'medium', 'seeded violation', '{}')`,
					newID(), room.id, attemptID, "violation-"+attemptID+"-"+string(rune('a'+v)))
			}
		}

		// Admission queue rows: non-cancelled totals + a cancelled row that
		// must not count.
		for q := 0; q < room.admissionQueued; q++ {
			exec(`INSERT INTO student_admission_queue (
				id, schedule_id, wcode, student_email, student_name, status, queue_key
			) VALUES (?, ?, ?, ?, 'SAT rooms queued', 'queued', ?)`,
				newID(), room.id, owner+"-aq-"+room.key+"-"+newID(),
				owner+"-aq-"+newID()+"@example.test", owner+"-qk-"+newID())
		}
		for c := 0; c < room.admissionCancelled; c++ {
			exec(`INSERT INTO student_admission_queue (
				id, schedule_id, wcode, student_email, student_name, status, queue_key
			) VALUES (?, ?, ?, ?, 'SAT rooms cancelled', 'cancelled', ?)`,
				newID(), room.id, owner+"-aqc-"+room.key+"-"+newID(),
				owner+"-aqc-"+newID()+"@example.test", owner+"-qkc-"+newID())
		}

		// Alert-counting audit rows: alertCount alerting rows, plus
		// acknowledged / low-severity / non-alert-type rows that must not count.
		alerting := []struct {
			actionType string
			payload    string
		}{
			{actionType: "HEARTBEAT_LOST", payload: "{}"},
			{actionType: "VIOLATION_DETECTED", payload: `{"severity":"high"}`},
			{actionType: "STUDENT_WARN", payload: "{}"},
		}
		nonAlerting := []struct {
			actionType string
			payload    string
			acked      bool
		}{
			{actionType: "VIOLATION_DETECTED", payload: `{"severity":"low"}`},
			{actionType: "STUDENT_WARN", payload: "{}", acked: true},
			{actionType: "SESSION_STARTED", payload: "{}"},
		}
		auditTarget := ""
		if len(roomAttemptIDs) > 0 {
			auditTarget = roomAttemptIDs[0]
		}
		for a := 0; a < room.alertCount; a++ {
			row := alerting[a%len(alerting)]
			var target any
			if auditTarget != "" {
				target = auditTarget
			}
			exec(`INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, target_student_id, payload)
				VALUES (?, ?, 'seeded', ?, ?, ?)`,
				newID(), room.id, row.actionType, target, row.payload)
		}
		for _, row := range nonAlerting {
			var acked any
			if row.acked {
				acked = now
			}
			exec(`INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, payload, acknowledged_at)
				VALUES (?, ?, 'seeded', ?, ?, ?)`,
				newID(), room.id, row.actionType, row.payload, acked)
		}

		// Outbox rows: satLive owns a stale unpublished schedule_runtime row
		// (degraded); ieltsRoom owns a stale PUBLISHED row (not degraded).
		switch room.key {
		case "satLive":
			exec(`INSERT INTO outbox_events (id, aggregate_kind, aggregate_id, revision, event_family, payload, created_at)
				VALUES (?, 'schedule_runtime', ?, 1, 'runtime_state', '{}', ?)`,
				newID(), room.id, now.Add(-90*time.Second))
		case "ieltsRoom":
			exec(`INSERT INTO outbox_events (id, aggregate_kind, aggregate_id, revision, event_family, payload, created_at, published_at)
				VALUES (?, 'schedule_runtime', ?, 1, 'runtime_state', '{}', ?, ?)`,
				newID(), room.id, now.Add(-90*time.Second), now.Add(-60*time.Second))
		}
	}

	// ---- staff assignments ----
	// proctor1: two active satLive grants (duplicate; no unique constraint),
	// one active satUpcomingA grant (revoked mid-test), one seeded-revoked
	// satHistorical grant, one active ieltsRoom grant, one role='grader'
	// actRoom grant, and one actor_id-only satUpcomingB grant (user_id NULL).
	seedAssignment := func(scheduleKey, userID, role string, revoked bool, actorID string) string {
		id := newID()
		var revokedAt any
		if revoked {
			revokedAt = now.Add(-time.Hour)
		}
		var actor any
		if actorID != "" {
			actor = actorID
		}
		var uid any
		if userID != "" {
			uid = userID
		}
		if actor == nil {
			actor = userID
		}
		exec(`INSERT INTO schedule_staff_assignments (id, schedule_id, actor_id, role, granted_by, revoked_at, user_id)
			VALUES (?, ?, ?, ?, 'seeded', ?, ?)`,
			id, fx.id(scheduleKey), actor, role, revokedAt, uid)
		return id
	}
	fx.proctor1SATLiveAssignmentIDs = []string{
		seedAssignment("satLive", proctor1ID, "proctor", false, ""),
		seedAssignment("satLive", proctor1ID, "proctor", false, ""),
	}
	fx.proctor1SATUpcomingAAssignmentID = seedAssignment("satUpcomingA", proctor1ID, "proctor", false, "")
	if seededRevokedGrant {
		fx.proctor1SATHistoricalAssignmentID = seedAssignment("satHistorical", proctor1ID, "proctor", true, "")
	}
	fx.proctor1IELTSAssignmentID = seedAssignment("ieltsRoom", proctor1ID, "proctor", false, "")
	fx.proctor1GraderACTAssignmentID = seedAssignment("actRoom", proctor1ID, "grader", false, "")
	fx.proctor1ActorOnlyUpcomingBAssign = seedAssignment("satUpcomingB", "", "proctor", false, proctor1ID)

	// ---- cleanup: children before parents; best-effort logging is fine ----
	roomIDs := make([]any, 0, len(fx.rooms))
	scheduleIDsIn := make([]string, 0, len(fx.rooms))
	for _, room := range fx.rooms {
		roomIDs = append(roomIDs, room.id)
		scheduleIDsIn = append(scheduleIDsIn, room.id)
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?, ", len(scheduleIDsIn)), ", ")
	inClauseArgs := append([]any{}, roomIDs...)
	quiet := func(query string, args ...any) {
		if _, err := db.ExecContext(context.Background(), query, args...); err != nil {
			t.Logf("cleanup sat room summaries (%.70q): %v", query, err)
		}
	}
	t.Cleanup(func() {
		quiet(`DELETE FROM session_audit_logs WHERE schedule_id IN (`+placeholders+`)`, inClauseArgs...)
		quiet(`DELETE FROM student_violation_events WHERE schedule_id IN (`+placeholders+`)`, inClauseArgs...)
		quiet(`DELETE FROM outbox_events WHERE aggregate_kind = 'schedule_runtime' AND aggregate_id IN (`+placeholders+`)`, inClauseArgs...)
		quiet(`DELETE FROM student_admission_queue WHERE schedule_id IN (`+placeholders+`)`, inClauseArgs...)
		quiet(`DELETE FROM student_attempts WHERE schedule_id IN (`+placeholders+`)`, inClauseArgs...)
		quiet(`DELETE FROM schedule_registrations WHERE schedule_id IN (`+placeholders+`)`, inClauseArgs...)
		quiet(`DELETE FROM schedule_staff_assignments WHERE schedule_id IN (`+placeholders+`)`, inClauseArgs...)
		quiet(`DELETE FROM exam_session_runtime_sections WHERE runtime_id IN (SELECT id FROM exam_session_runtimes WHERE schedule_id IN (`+placeholders+`))`, inClauseArgs...)
		quiet(`DELETE FROM exam_session_runtimes WHERE schedule_id IN (`+placeholders+`)`, inClauseArgs...)
		quiet(`DELETE FROM exam_schedules WHERE id IN (`+placeholders+`)`, inClauseArgs...)
		quiet(`DELETE FROM exam_versions WHERE exam_id IN (SELECT id FROM exam_entities WHERE owner_id = ?)`, owner)
		quiet(`DELETE FROM exam_entities WHERE owner_id = ?`, owner)
		quiet(`DELETE FROM users WHERE id IN (?, ?, ?, ?)`, adminID, observerID, proctor1ID, proctor2ID)
	})
	return fx
}

// sectionKeyPtr returns a pointer to the first live section key, or nil.
func sectionKeyPtr(sections []satRoomSectionSeed, status string) any {
	for _, sec := range sections {
		if sec.status == status {
			key := sec.key
			return &key
		}
	}
	return nil
}
