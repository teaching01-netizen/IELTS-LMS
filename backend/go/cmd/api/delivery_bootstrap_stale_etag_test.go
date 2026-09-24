package main

// Handler-level stale-ETag regression for the dynamic SAT bootstrap.
//
// The AST contract test (delivery_bootstrap_contract_test.go) pins that the
// conditional-read identifiers cannot reappear in deliveryBootstrapInner, but
// an AST check passes if the same behavior is reintroduced under different
// identifiers or from a wrapper. This test is the executable counterpart: it
// drives the REAL route — chi router, bearer verification, reconcile-then-
// read Bootstrap against MySQL — with a genuinely stale version ETag and
// asserts HTTP 200 (never 304) carrying the post-routing HIGH attempt.
//
// Scenario (plan T5, executable form):
//  1. Seed an exam whose Module 1 is expired with all-correct answers.
//  2. Capture the version ETag BEFORE routing (this is the validator a
//     reconnecting client would still hold).
//  3. First bootstrap (no If-None-Match): reconcile routes M1 -> HIGH.
//  4. Second bootstrap WITH If-None-Match: <stale etag> must STILL return
//     200 + Cache-Control: no-store with the HIGH module attempt present —
//     exam-version equality must never suppress live attempt updates.
//
// Gated on TEST_MYSQL_DSN like the other real-MySQL suites in this package.

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/config"
	platformdb "example.com/ielts-proctoring/internal/platform/db"
)

func staleETagTestDB(t *testing.T) *sql.DB {
	t.Helper()
	raw := os.Getenv("TEST_MYSQL_DSN")
	if raw == "" {
		t.Skip("TEST_MYSQL_DSN not set; requires isolated MySQL")
	}
	dsn, err := platformdb.NormalizeDSN(raw)
	if err != nil {
		t.Fatalf("normalize TEST_MYSQL_DSN: %v", err)
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// seedStaleETagExam builds one RW section (base/lower/higher, threshold 2 of
// 3) plus one attempt whose Module 1 expired with 3/3 correct answers, and
// returns the ids the assertions need.
func seedStaleETagExam(t *testing.T, db *sql.DB) (scheduleID, attemptID, baseID, lowID, highID string) {
	t.Helper()
	ctx := context.Background()
	owner := "stale-etag-" + uuid.NewString()
	examID := uuid.NewString()
	versionID := uuid.NewString()
	scheduleID = uuid.NewString()
	attemptID = uuid.NewString()
	now := time.Now().UTC().Truncate(time.Second)

	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("seed stale-etag exam: %v", err)
		}
	}

	exec(`INSERT INTO exam_entities (
		id, slug, title, provider_key, provider_exam_type, exam_type,
		status, visibility, organization_id, owner_id, schema_version, revision
	) VALUES (?, ?, 'SAT stale-etag integration', 'sat', 'SAT', 'Academic',
		'published', 'organization', ?, ?, 1, 0)`,
		examID, examID, "stale-etag-org", owner)
	exec(`INSERT INTO exam_versions (
		id, exam_id, version_number, content_snapshot, config_snapshot,
		created_by, is_published, revision
	) VALUES (?, ?, 1, '{}', '{}', ?, TRUE, 1)`,
		versionID, examID, owner)
	exec(`UPDATE exam_entities SET current_published_version_id = ? WHERE id = ?`, versionID, examID)
	exec(`INSERT INTO exam_schedules (
		id, exam_id, provider_key, organization_id, exam_title, proctor_display_name,
		grading_display_name, published_version_id,
		cohort_name, institution, start_time, end_time, planned_duration_minutes,
		delivery_mode, status, created_by
	) VALUES (?, ?, 'sat', ?, 'SAT stale-etag integration', 'SAT stale-etag integration',
		'SAT stale-etag integration', ?, 'stale-etag', 'Codex', ?, ?, 120,
		'proctor_start', 'live', ?)`,
		scheduleID, examID, "stale-etag-org", versionID,
		now.Add(-2*time.Hour), now.Add(2*time.Hour), owner)
	exec(`INSERT INTO exam_session_runtimes (
		id, schedule_id, exam_id, provider_key, status, plan_snapshot, timing_model
	) VALUES (?, ?, ?, 'sat', 'live', '{}', 'legacy_section_v1')`,
		uuid.NewString(), scheduleID, examID)

	sectionID := uuid.NewString()
	exec(`INSERT INTO assessment_sections (
		id, exam_version_id, section_key, title, display_order, duration_seconds,
		break_after_seconds, instructions, tool_policy
	) VALUES (?, ?, 'reading-writing', 'Reading and Writing', 0, 3600, 0, '{"version":1,"nodes":[]}', '[]')`,
		sectionID, versionID)
	baseID, lowID, highID = uuid.NewString(), uuid.NewString(), uuid.NewString()
	var baseExamQuestionIDs []string
	seedModule := func(id, key, title string, order int, role string) {
		exec(`INSERT INTO assessment_modules (
			id, section_id, module_key, title, display_order, duration_seconds,
			target_question_count, adaptive_role, instructions, tool_policy
		) VALUES (?, ?, ?, ?, ?, 3600, 3, ?, '{"version":1,"nodes":[]}', '[]')`,
			id, sectionID, key, title, order, role)
		for q := 0; q < 3; q++ {
			questionID := uuid.NewString()
			revisionID := uuid.NewString()
			examQuestionID := uuid.NewString()
			exec(`INSERT INTO assessment_questions (id, provider_key, created_by) VALUES (?, 'sat', ?)`, questionID, owner)
			exec(`INSERT INTO assessment_question_revisions (
				id, question_id, semantic_revision, state, question_type, stimulus,
				prompt, answer_definition, rationale, metadata, accessibility, created_by
			) VALUES (?, ?, 1, 'sealed', 'single_choice', '{"version":1,"nodes":[]}',
				'{"version":1,"nodes":[]}', '{"kind":"single_choice","correctOptionId":"B"}',
				'{}', '{}', '{}', ?)`, revisionID, questionID, owner)
			exec(`INSERT INTO assessment_exam_questions (
				id, module_id, question_id, question_revision_id, display_order, is_pretest
			) VALUES (?, ?, ?, ?, ?, FALSE)`, examQuestionID, id, questionID, revisionID, q)
			if id == baseID {
				baseExamQuestionIDs = append(baseExamQuestionIDs, examQuestionID)
			}
		}
	}
	seedModule(baseID, "reading-writing-m1", "Reading and Writing Module 1", 0, "base")
	seedModule(lowID, "reading-writing-m2-lower", "Reading and Writing Module 2 Lower", 1, "lower_branch")
	seedModule(highID, "reading-writing-m2-higher", "Reading and Writing Module 2 Higher", 2, "higher_branch")
	exec(`INSERT INTO assessment_routing_policies (
		id, section_id, base_module_id, lower_module_id, higher_module_id,
		policy_key, policy_config, revision
	) VALUES (?, ?, ?, ?, ?, 'threshold', '{"minimumCorrectForHigher":2}', 1)`,
		uuid.NewString(), sectionID, baseID, lowID, highID)

	exec(`INSERT INTO student_attempts (
		id, schedule_id, student_key, organization_id, exam_id,
		published_version_id, exam_title, candidate_id, candidate_name,
		candidate_email, phase, current_module, answers, writing_answers,
		flags, violations_snapshot, integrity, recovery, revision,
		protocol_version, delivery_status, lease_epoch, control_epoch, response_revision,
		wcode
	) VALUES (?, ?, ?, ?, ?, ?, 'SAT stale-etag integration', ?, 'Stale ETag Candidate',
		'candidate@example.test', 'exam', 'reading', '{}', '{}', '{}', '[]', '{}', '{}', 0,
		2, 'running', 1, 1, 7, ?)`,
		attemptID, scheduleID, attemptID, "stale-etag-org", examID, versionID, "cand-"+attemptID[:8], "W-"+attemptID)
	// All-correct V2 answers through the transport the scorer reads:
	// 3/3 clears the threshold of 2, so reconcile routes HIGH.
	for _, examQuestionID := range baseExamQuestionIDs {
		exec(`INSERT INTO attempt_responses_v2 (
			attempt_id, question_id, module_id, lease_epoch, control_epoch,
			client_version, client_write_id, request_hash, response, response_hash,
			server_revision
		) VALUES (?, ?, ?, 1, 1, 1, ?, ?, ?, ?, 7)`,
			attemptID, examQuestionID, baseID,
			"write-"+uuid.NewString(), "req-"+uuid.NewString(),
			`{"answer":"B","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`,
			"hash-"+uuid.NewString())
	}
	// Module 1 active but long expired, so the reconcile-then-read inside
	// Bootstrap routes it on the first call.
	exec(`INSERT INTO assessment_module_attempts (
		id, attempt_id, module_id, state, allocated_seconds, started_at, tool_state, revision
	) VALUES (?, ?, ?, 'active', 3600, ?, '{}', 1)`,
		uuid.NewString(), attemptID, baseID, now.Add(-2*time.Hour))

	t.Cleanup(func() {
		ctx := context.Background()
		quiet := func(query string, args ...any) {
			if _, err := db.ExecContext(ctx, query, args...); err != nil {
				t.Logf("cleanup stale-etag exam (%.60q): %v", query, err)
			}
		}
		quiet(`DELETE FROM attempt_sessions WHERE attempt_id = ?`, attemptID)
		quiet(`DELETE FROM attempt_responses_v2 WHERE attempt_id = ?`, attemptID)
		quiet(`DELETE FROM assessment_route_decisions WHERE attempt_id = ?`, attemptID)
		quiet(`DELETE FROM assessment_module_attempts WHERE attempt_id = ?`, attemptID)
		quiet(`DELETE FROM student_attempts WHERE id = ?`, attemptID)
		quiet(`DELETE FROM assessment_exam_questions WHERE module_id IN (?, ?, ?)`, baseID, lowID, highID)
		quiet(`DELETE FROM assessment_question_revisions WHERE question_id IN (SELECT id FROM assessment_questions WHERE created_by = ?)`, owner)
		quiet(`DELETE FROM assessment_questions WHERE created_by = ?`, owner)
		quiet(`DELETE FROM assessment_routing_policies WHERE section_id = ?`, sectionID)
		quiet(`DELETE FROM assessment_modules WHERE id IN (?, ?, ?)`, baseID, lowID, highID)
		quiet(`DELETE FROM assessment_sections WHERE id = ?`, sectionID)
		quiet(`DELETE FROM exam_session_runtimes WHERE schedule_id = ?`, scheduleID)
		quiet(`DELETE FROM exam_schedules WHERE id = ?`, scheduleID)
		quiet(`DELETE FROM exam_versions WHERE id = ?`, versionID)
		quiet(`DELETE FROM exam_entities WHERE id = ?`, examID)
	})
	return scheduleID, attemptID, baseID, lowID, highID
}

func TestDeliveryBootstrapStaleVersionETagReturnsCurrentState(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()

	cfg := config.Load()
	cfg.AuthSecret = "test-secret-with-at-least-32-characters!!"
	app := BuildApp(cfg, db)
	if app.Delivery == nil {
		t.Fatal("BuildApp must wire the Delivery service for the bootstrap route")
	}

	scheduleID, attemptID, _, lowID, highID := seedStaleETagExam(t, db)

	// Mint a real attempt bearer (HMAC + attempt_sessions row), the same
	// credential a reconnecting student presents.
	lease := uint64(1)
	token, _, err := auth.IssueAttemptToken(ctx, db, cfg, "user-1", scheduleID, attemptID, "sess-1", nil, &lease, time.Now().UTC())
	if err != nil {
		t.Fatalf("issue attempt token: %v", err)
	}

	// The validator a reconnecting client still holds: captured BEFORE the
	// server routes Module 1 -> HIGH.
	_, _, staleETag, err := app.Delivery.VersionTag(ctx, scheduleID)
	if err != nil {
		t.Fatalf("version tag before routing: %v", err)
	}
	if staleETag == "" {
		t.Fatal("version tag must be non-empty")
	}

	router := chi.NewRouter()
	router.Post("/api/v1/assessment-delivery/schedules/{scheduleID}/bootstrap", deliveryBootstrapHandler(app))
	call := func(t *testing.T, ifNoneMatch string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost,
			"/api/v1/assessment-delivery/schedules/"+scheduleID+"/bootstrap", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		if ifNoneMatch != "" {
			req.Header.Set("If-None-Match", ifNoneMatch)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	decodeModuleAttempts := func(t *testing.T, rec *httptest.ResponseRecorder) map[string]string {
		t.Helper()
		var out delivery.Bootstrap
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("bootstrap body must decode, got %q: %v", rec.Body.String(), err)
		}
		ids := map[string]string{}
		for _, ma := range out.Attempt.ModuleAttempts {
			ids[ma.ModuleID] = ma.State
		}
		return ids
	}

	// First bootstrap (no conditional header): reconcile-then-read routes
	// the expired Module 1 to HIGH.
	first := call(t, "")
	if first.Code != http.StatusOK {
		t.Fatalf("first bootstrap must be 200, got %d (%s)", first.Code, first.Body.String())
	}
	if _, ok := decodeModuleAttempts(t, first)[highID]; !ok {
		t.Fatalf("first bootstrap must already carry HIGH after reconcile: %s", first.Body.String())
	}

	// The published version did not move under routing: the client's held
	// validator still matches the server's current tag. A version-keyed
	// conditional read would answer 304 here (the original bug).
	_, _, currentETag, err := app.Delivery.VersionTag(ctx, scheduleID)
	if err != nil {
		t.Fatalf("version tag after routing: %v", err)
	}
	if currentETag != staleETag {
		t.Fatalf("routing must not move the published version (etag %q -> %q)", staleETag, currentETag)
	}

	// Second bootstrap WITH the stale validator: must STILL be 200 with
	// Cache-Control: no-store and the HIGH attempt present — never 304.
	second := call(t, staleETag)
	if second.Code == http.StatusNotModified {
		t.Fatal("bootstrap with a stale version ETag must never render 304: attempt state is not version state")
	}
	if second.Code != http.StatusOK {
		t.Fatalf("stale-ETag bootstrap must be 200, got %d (%s)", second.Code, second.Body.String())
	}
	if got := second.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	modules := decodeModuleAttempts(t, second)
	if _, ok := modules[highID]; !ok {
		t.Fatalf("stale-ETag bootstrap must contain HIGH, got %v", modules)
	}
	if _, ok := modules[lowID]; ok {
		t.Fatalf("stale-ETag bootstrap must not contain LOW, got %v", modules)
	}

	// The recorded decision and the delivered attempt agree at the HTTP
	// boundary: the chain is unbroken end to end.
	var selectedModuleID string
	if err := db.QueryRowContext(ctx,
		`SELECT selected_module_id FROM assessment_route_decisions WHERE attempt_id = ?`, attemptID,
	).Scan(&selectedModuleID); err != nil {
		t.Fatalf("read route decision: %v", err)
	}
	if selectedModuleID != highID {
		t.Fatalf("route decision selected %q, delivered HIGH is %q", selectedModuleID, highID)
	}
}
