package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	shared "example.com/ielts-proctoring/internal/app"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/background"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/crypto"
	platformdb "example.com/ielts-proctoring/internal/platform/db"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
	"example.com/ielts-proctoring/internal/terminalization"
)

// ieltsLoadFixture is a set of synthetic IELTS rooms on the personal timing
// model: a legacy snapshot-backed exam (no normalized question rows, so every
// save resolves through the snapshot fallback), live runtimes whose first
// section has opened, and candidates with signed attempt credentials spread
// over the rooms. Every row hangs off one synthetic exam and is purged through
// the production exam delete.
type ieltsLoadFixture struct {
	db *sql.DB
	// scheduleID/runtimeID are the first room; scheduleIDs lists every room.
	examID           string
	scheduleID       string
	runtimeID        string
	scheduleIDs      []string
	studentKeyPrefix string
	sections         []string
	// questions holds each section's response keys in snapshot order;
	// Writing uses the legacy taskId spelling.
	questions  map[string][]string
	candidates []ieltsLoadCandidate
}

type ieltsLoadCandidate struct {
	ScheduleID      string `json:"scheduleId"`
	AttemptID       string `json:"attemptId"`
	UserID          string `json:"userId"`
	ClientSessionID string `json:"clientSessionId"`
	Token           string `json:"token"`
}

// ieltsLoadSnapshot builds the legacy IELTS content tree: parts of questions
// for Listening/Reading with options, and Writing tasks keyed by taskId.
func ieltsLoadSnapshot(sections []string, questionsPerSection int) (string, map[string][]string) {
	root := map[string]any{}
	ids := map[string][]string{}
	for _, section := range sections {
		if section == "writing" {
			tasks := []any{}
			for task := 1; task <= 2; task++ {
				id := fmt.Sprintf("writing-task-%d", task)
				ids[section] = append(ids[section], id)
				tasks = append(tasks, map[string]any{"taskId": id, "prompt": "Write at least 150 words.", "minWords": 150 * task})
			}
			root[section] = map[string]any{"tasks": tasks}
			continue
		}
		parts := []any{}
		perPart := (questionsPerSection + 3) / 4
		for part := 0; len(ids[section]) < questionsPerSection; part++ {
			questions := []any{}
			for q := 0; q < perPart && len(ids[section]) < questionsPerSection; q++ {
				id := fmt.Sprintf("%s-q%03d", section, len(ids[section])+1)
				ids[section] = append(ids[section], id)
				questions = append(questions, map[string]any{
					"questionId": id, "type": "multiple-choice", "stem": "Choose the correct answer.",
					"options": []any{map[string]any{"id": "A"}, map[string]any{"id": "B"}, map[string]any{"id": "C"}},
				})
			}
			parts = append(parts, map[string]any{"title": fmt.Sprintf("Part %d", part+1), "questions": questions})
		}
		root[section] = map[string]any{"parts": parts}
	}
	raw, _ := json.Marshal(root)
	return string(raw), ids
}

// seedIELTSLoadFixture creates rooms with count candidates spread round-robin
// over them. sections[0] is each room's opened first section; later sections
// stay locked until a runtime advance.
func seedIELTSLoadFixture(t testing.TB, count, rooms int, sections []string, questionsPerSection int) ieltsLoadFixture {
	t.Helper()
	db := staleETagTestDB(t)
	ctx := context.Background()
	runID := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	owner := "ielts-load-" + runID
	userEmailPrefix := "ielts-load-" + runID + "-"
	f := ieltsLoadFixture{db: db, examID: uuid.NewString(), studentKeyPrefix: "ielts-load-" + runID + "-", sections: sections}
	runtimeIDs := make([]string, rooms)
	for room := range rooms {
		f.scheduleIDs = append(f.scheduleIDs, uuid.NewString())
		runtimeIDs[room] = uuid.NewString()
	}
	f.scheduleID, f.runtimeID = f.scheduleIDs[0], runtimeIDs[0]
	versionID := uuid.NewString()
	snapshot, questions := ieltsLoadSnapshot(sections, questionsPerSection)
	f.questions = questions
	t.Cleanup(func() {
		if err := exams.NewService(db, tx.NewRunner(db)).Delete(context.Background(), f.examID); err != nil {
			t.Errorf("purge synthetic IELTS load exam: %v", err)
		}
		if _, err := db.Exec(`DELETE FROM users WHERE email LIKE ?`, userEmailPrefix+"%@example.test"); err != nil {
			t.Errorf("delete synthetic IELTS load users: %v", err)
		}
	})

	seed, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer seed.Rollback()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := seed.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("seed IELTS load fixture: %v", err)
		}
	}
	exec(`INSERT INTO exam_entities (id, slug, title, provider_key, provider_exam_type, exam_type, status, visibility, organization_id, owner_id, schema_version, revision)
		VALUES (?, ?, 'IELTS throughput synthetic', 'ielts', 'IELTS', 'Academic', 'published', 'organization', 'ielts-load-org', ?, 1, 0)`, f.examID, f.examID, owner)
	exec(`INSERT INTO exam_versions (id, exam_id, version_number, content_snapshot, config_snapshot, created_by, is_published, revision)
		VALUES (?, ?, 1, ?, '{}', ?, TRUE, 1)`, versionID, f.examID, snapshot, owner)
	exec(`UPDATE exam_entities SET current_published_version_id = ? WHERE id = ?`, versionID, f.examID)
	for room, scheduleID := range f.scheduleIDs {
		runtimeID := runtimeIDs[room]
		exec(`INSERT INTO exam_schedules (id, exam_id, provider_key, organization_id, exam_title, proctor_display_name, grading_display_name, published_version_id,
				cohort_name, institution, start_time, end_time, planned_duration_minutes, delivery_mode, status, created_by, ielts_timing_model)
			VALUES (?, ?, 'ielts', 'ielts-load-org', 'IELTS throughput synthetic', 'IELTS throughput synthetic', 'IELTS throughput synthetic', ?,
				?, 'Codex', UTC_TIMESTAMP() - INTERVAL 1 HOUR, UTC_TIMESTAMP() + INTERVAL 4 HOUR, 180, 'proctor_start', 'live', ?, ?)`,
			scheduleID, f.examID, versionID, fmt.Sprintf("ielts-load room %d", room+1), owner, examruntime.TimingModelIELTSPersonal)
		// Database time opens the room so the readiness window does not depend
		// on the test host clock; the preparation allowance outlasts a slow run.
		exec(`INSERT INTO exam_session_runtimes (id, schedule_id, exam_id, provider_key, status, plan_snapshot, timing_model, ielts_preparation_seconds,
				actual_start_at, active_section_key, current_section_key)
			VALUES (?, ?, ?, 'ielts', 'live', '{}', ?, 1800, UTC_TIMESTAMP(6) - INTERVAL 5 SECOND, ?, ?)`,
			runtimeID, scheduleID, f.examID, examruntime.TimingModelIELTSPersonal, sections[0], sections[0])
		for order, section := range sections {
			if order == 0 {
				exec(`INSERT INTO exam_session_runtime_sections (id, runtime_id, section_key, label, section_order, planned_duration_minutes, status, actual_start_at)
					VALUES (?, ?, ?, ?, ?, 60, 'live', UTC_TIMESTAMP(6) - INTERVAL 5 SECOND)`, uuid.NewString(), runtimeID, section, section, order)
				continue
			}
			exec(`INSERT INTO exam_session_runtime_sections (id, runtime_id, section_key, label, section_order, planned_duration_minutes, status)
				VALUES (?, ?, ?, ?, ?, 60, 'locked')`, uuid.NewString(), runtimeID, section, section, order)
		}
	}

	expiresAt := time.Now().UTC().Add(2 * time.Hour)
	userRows := make([][]any, 0, count)
	attemptRows := make([][]any, 0, count)
	sessionRows := make([][]any, 0, count)
	tokenIDs := make([]string, count)
	f.candidates = make([]ieltsLoadCandidate, count)
	for i := range count {
		candidate := ieltsLoadCandidate{ScheduleID: f.scheduleIDs[i%rooms], AttemptID: uuid.NewString(), UserID: uuid.NewString(), ClientSessionID: uuid.NewString()}
		tokenIDs[i] = uuid.NewString()
		studentKey := fmt.Sprintf("%s%04d", f.studentKeyPrefix, i+1)
		email := fmt.Sprintf("%s%04d@example.test", userEmailPrefix, i+1)
		name := fmt.Sprintf("IELTS Load %04d", i+1)
		userRows = append(userRows, []any{candidate.UserID, email, name, "student", "active"})
		attemptRows = append(attemptRows, []any{
			candidate.AttemptID, candidate.ScheduleID, studentKey, "ielts-load-org", f.examID, versionID, "IELTS throughput synthetic",
			studentKey, name, email, "exam", sections[0], `{}`, `{}`, `{}`, `[]`, `{}`, `{}`,
			0, 2, "running", 1, 1, 0, "W" + strings.ReplaceAll(uuid.NewString(), "-", "")[:8], candidate.UserID, candidate.ClientSessionID,
		})
		sessionRows = append(sessionRows, []any{uuid.NewString(), candidate.UserID, candidate.ScheduleID, candidate.AttemptID, candidate.ClientSessionID, tokenIDs[i], expiresAt})
		f.candidates[i] = candidate
	}
	if err := insertSATLoadRows(ctx, seed, "users", []string{"id", "email", "display_name", "role", "state"}, userRows); err != nil {
		t.Fatalf("insert synthetic IELTS users: %v", err)
	}
	if err := insertSATLoadRows(ctx, seed, "student_attempts", []string{
		"id", "schedule_id", "student_key", "organization_id", "exam_id", "published_version_id", "exam_title",
		"candidate_id", "candidate_name", "candidate_email", "phase", "current_module", "answers", "writing_answers",
		"flags", "violations_snapshot", "integrity", "recovery", "revision", "protocol_version", "delivery_status",
		"lease_epoch", "control_epoch", "response_revision", "wcode", "user_id", "active_client_session_id",
	}, attemptRows); err != nil {
		t.Fatalf("insert synthetic IELTS attempts: %v", err)
	}
	if err := insertSATLoadRows(ctx, seed, "attempt_sessions", []string{
		"id", "user_id", "schedule_id", "attempt_id", "client_session_id", "token_id", "expires_at",
	}, sessionRows); err != nil {
		t.Fatalf("insert synthetic IELTS writer sessions: %v", err)
	}
	if err := seed.Commit(); err != nil {
		t.Fatal(err)
	}
	lease := uint64(1)
	for i := range f.candidates {
		c := &f.candidates[i]
		token, err := crypto.SignAttemptToken([]byte(submitTestSecret), crypto.AttemptClaims{
			TokenID: tokenIDs[i], UserID: c.UserID, ScheduleID: c.ScheduleID, AttemptID: c.AttemptID,
			ClientSessionID: c.ClientSessionID, LeaseEpoch: &lease, Exp: expiresAt.Unix(),
		})
		if err != nil {
			t.Fatalf("sign synthetic IELTS credential %d: %v", i+1, err)
		}
		c.Token = token
	}
	return f
}

// assertIELTSSealedAnswers reconciles one sealed attempt against the answers
// the test chose, not against a server digest: every V2 cell, both
// compatibility final_submission maps, and exactly one submitted receipt.
func assertIELTSSealedAnswers(t *testing.T, f ieltsLoadFixture, attemptID string, answers, writing map[string]string) {
	t.Helper()
	if err := ieltsSealedAnswersError(f.db, attemptID, answers, writing); err != nil {
		t.Fatal(err)
	}
}

func ieltsSealedAnswersError(db *sql.DB, attemptID string, answers, writing map[string]string) error {
	var delivery string
	var finalSubmission sql.NullString
	var receipts int
	if err := db.QueryRow(`SELECT COALESCE(a.delivery_status, ''), CAST(a.final_submission AS CHAR),
			(SELECT COUNT(*) FROM attempt_terminalizations t WHERE t.attempt_id = a.id AND t.outcome = ?)
		FROM student_attempts a WHERE a.id = ?`, terminalization.OutcomeSubmitted, attemptID).Scan(&delivery, &finalSubmission, &receipts); err != nil {
		return fmt.Errorf("attempt %s: read sealed state: %w", attemptID, err)
	}
	if delivery != "submitted" || receipts != 1 || !finalSubmission.Valid {
		return fmt.Errorf("attempt %s: delivery=%q submitted receipts=%d final_submission=%v, want one sealed submission", attemptID, delivery, receipts, finalSubmission.Valid)
	}
	want := make(map[string]string, len(answers)+len(writing))
	for id, value := range answers {
		want[id] = value
	}
	for id, value := range writing {
		want[id] = value
	}
	rows, err := db.Query(`SELECT question_id, CAST(response AS CHAR) FROM attempt_responses_v2 WHERE attempt_id = ?`, attemptID)
	if err != nil {
		return err
	}
	cells := map[string]string{}
	for rows.Next() {
		var id, raw string
		var payload struct {
			Answer string `json:"answer"`
		}
		if err := rows.Scan(&id, &raw); err != nil {
			rows.Close()
			return err
		}
		if err := json.Unmarshal([]byte(raw), &payload); err != nil {
			rows.Close()
			return fmt.Errorf("attempt %s: cell %s: %w", attemptID, id, err)
		}
		cells[id] = payload.Answer
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if !reflect.DeepEqual(cells, want) {
		return fmt.Errorf("attempt %s: V2 cells\n got: %v\nwant: %v", attemptID, cells, want)
	}
	var sealed struct {
		Answers        map[string]string `json:"answers"`
		WritingAnswers map[string]string `json:"writingAnswers"`
	}
	if err := json.Unmarshal([]byte(finalSubmission.String), &sealed); err != nil {
		return fmt.Errorf("attempt %s: final_submission: %w", attemptID, err)
	}
	if len(sealed.Answers) != len(answers) || len(sealed.WritingAnswers) != len(writing) {
		return fmt.Errorf("attempt %s: final_submission has %d answers + %d writing, want %d + %d",
			attemptID, len(sealed.Answers), len(sealed.WritingAnswers), len(answers), len(writing))
	}
	for id, value := range answers {
		if sealed.Answers[id] != value {
			return fmt.Errorf("attempt %s: final_submission answer %s = %q, want %q", attemptID, id, sealed.Answers[id], value)
		}
	}
	for id, value := range writing {
		if sealed.WritingAnswers[id] != value {
			return fmt.Errorf("attempt %s: final_submission writing %s has %d bytes, want %d", attemptID, id, len(sealed.WritingAnswers[id]), len(value))
		}
	}
	return nil
}

// endIELTSSectionsForSubmit moves attempts to their natural end without
// waiting out real section clocks: earlier sections completed, and the open
// section's own deadline just passed, as when a candidate's final section
// ends. where selects the attempts (alias a): "a.id = ?" or
// "a.student_key LIKE ?".
func endIELTSSectionsForSubmit(t testing.TB, db *sql.DB, where string, arg any) {
	t.Helper()
	ctx := context.Background()
	if _, err := db.ExecContext(ctx, `UPDATE ielts_attempt_section_timelines t JOIN student_attempts a ON a.id = t.attempt_id
		SET t.deadline_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE `+where+` AND t.state = 'active'`, arg); err != nil {
		t.Fatalf("end open IELTS sections: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO ielts_attempt_section_timelines
			(id, attempt_id, runtime_id, section_key, section_order, state, expected_start_at, preparation_deadline_at, started_at, deadline_at, finished_at, revision)
		SELECT UUID(), a.id, rs.runtime_id, rs.section_key, rs.section_order, 'completed', UTC_TIMESTAMP(6) - INTERVAL 2 HOUR, UTC_TIMESTAMP(6) - INTERVAL 2 HOUR,
			UTC_TIMESTAMP(6) - INTERVAL 2 HOUR, UTC_TIMESTAMP(6) - INTERVAL 1 SECOND, UTC_TIMESTAMP(6) - INTERVAL 1 SECOND, 1
		FROM student_attempts a
		JOIN exam_session_runtimes r ON r.schedule_id = a.schedule_id
		JOIN exam_session_runtime_sections rs ON rs.runtime_id = r.id
		WHERE `+where+`
		ON DUPLICATE KEY UPDATE id = ielts_attempt_section_timelines.id`, arg); err != nil {
		t.Fatalf("complete IELTS sections: %v", err)
	}
}

// TestIELTSThroughputK6MySQL runs k6/ielts-throughput.js against local API
// processes in its three phases (readiness wave, open-arrival steady mix with
// staff roster sweeps and the background worker, submit wave) and then
// reconciles every synthetic candidate from the database alone. A local run is
// a regression diagnostic; it does not qualify target-topology capacity.
//
//	IELTS_THROUGHPUT_K6_USERS        candidates = k6 VUs (1..2000), required
//	IELTS_THROUGHPUT_K6_RATE         steady offered logical operations/s (default 50)
//	IELTS_THROUGHPUT_K6_DURATION     steady duration (default 2m)
//	IELTS_THROUGHPUT_K6_ROOMS        rooms to spread candidates over (default 1)
//	IELTS_THROUGHPUT_K6_ROW_FIRST    API ROW_FIRST_WRITES (default false)
//	IELTS_THROUGHPUT_K6_INTERPOLATE  interpolateParams=true in the API DSN (default false)
//	IELTS_THROUGHPUT_K6_STAFF        staff roster sweepers in the steady phase (default 2)
//	IELTS_THROUGHPUT_K6_START_SPREAD seconds to spread the ready/submit waves over (default 0);
//	                                 a local host's 128-entry accept backlog resets a
//	                                 synchronized wave of several hundred dials
//
// SAT_RECOVERY_K6_API_POOL and SAT_K6_API_INSTANCES size the shared local API
// harness. Each candidate is paced to one operation per second, so keep the
// rate at or below the candidate count.
func TestIELTSThroughputK6MySQL(t *testing.T) {
	count, err := satK6UserCount(t, "IELTS_THROUGHPUT_K6_USERS")
	if err != nil || count == 0 {
		return
	}
	rate := strings.TrimSpace(os.Getenv("IELTS_THROUGHPUT_K6_RATE"))
	if rate == "" {
		rate = "50"
	}
	if value, err := strconv.ParseFloat(rate, 64); err != nil || value <= 0 {
		t.Fatal("IELTS_THROUGHPUT_K6_RATE must be a positive number")
	}
	duration := strings.TrimSpace(os.Getenv("IELTS_THROUGHPUT_K6_DURATION"))
	if duration == "" {
		duration = "2m"
	}
	steady, err := time.ParseDuration(duration)
	if err != nil {
		t.Fatalf("IELTS_THROUGHPUT_K6_DURATION: %v", err)
	}
	rowFirst := os.Getenv("IELTS_THROUGHPUT_K6_ROW_FIRST") == "true"
	interpolate := os.Getenv("IELTS_THROUGHPUT_K6_INTERPOLATE") == "true"
	staff := 2
	if raw := strings.TrimSpace(os.Getenv("IELTS_THROUGHPUT_K6_STAFF")); raw != "" {
		if staff, err = strconv.Atoi(raw); err != nil || staff < 0 || staff > 20 {
			t.Fatal("IELTS_THROUGHPUT_K6_STAFF must be from 0 through 20")
		}
	}
	rooms := satK6Rooms(t, "IELTS_THROUGHPUT_K6_ROOMS", count)

	f := seedIELTSLoadFixture(t, count, rooms, []string{"listening", "reading", "writing"}, 40)
	apiPool, err := satRecoveryK6APIPoolSize(t)
	if err != nil {
		t.Fatal(err)
	}
	apiInstances, err := satRecoveryK6APIInstances(t)
	if err != nil {
		t.Fatal(err)
	}
	logAndValidateSATRecoveryK6MySQL(t, f.db, apiPool, apiInstances)
	apiEnv := map[string]string{"ROW_FIRST_WRITES": strconv.FormatBool(rowFirst)}
	if interpolate {
		dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
		sep := "?"
		if strings.Contains(dsn, "?") {
			sep = "&"
		}
		apiEnv["TEST_MYSQL_DSN"] = dsn + sep + "interpolateParams=true"
	}
	proxyURL, apiURLs, apis := startSATRecoveryK6Proxy(t, count, apiEnv)

	type credential struct {
		ScheduleID string   `json:"scheduleId"`
		AttemptID  string   `json:"attemptId"`
		Token      string   `json:"token"`
		SectionKey string   `json:"sectionKey"`
		Questions  []string `json:"questions"`
	}
	file := struct {
		Synthetic  bool         `json:"synthetic"`
		RunID      string       `json:"runId"`
		Candidates []credential `json:"candidates"`
	}{Synthetic: true, RunID: strings.TrimSuffix(f.studentKeyPrefix, "-")}
	for _, c := range f.candidates {
		file.Candidates = append(file.Candidates, credential{c.ScheduleID, c.AttemptID, c.Token, f.sections[0], f.questions[f.sections[0]]})
	}
	encoded, err := json.Marshal(file)
	if err != nil {
		t.Fatal(err)
	}
	credentialsPath := filepath.Join(t.TempDir(), "ielts-throughput-credentials.json")
	if err := os.WriteFile(credentialsPath, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	const script = "../../../../k6/ielts-throughput.js"
	k6Env := func(phase string) map[string]string {
		return map[string]string{
			"K6_CONFIRM_IELTS":              "true",
			"K6_CONFIRM_IELTS_TARGET":       strings.TrimPrefix(proxyURL, "http://"),
			"K6_BASE_URL":                   proxyURL,
			"K6_ATTEMPT_TOKENS_PATH":        credentialsPath,
			"IELTS_TP_PHASE":                phase,
			"IELTS_TP_MAX_VUS":              strconv.Itoa(count),
			"IELTS_TP_RATE":                 rate,
			"IELTS_TP_DURATION":             duration,
			"IELTS_TP_RUN_ID":               file.RunID,
			"IELTS_TP_START_SPREAD_SECONDS": os.Getenv("IELTS_THROUGHPUT_K6_START_SPREAD"),
		}
	}
	poolBefore := satRecoveryAPIPoolStats(t, apiURLs)
	t.Logf("local IELTS throughput run: candidates=%d rooms=%d rate=%s/s duration=%s rowFirst=%v interpolate=%v staff=%d start-spread=%ss",
		count, rooms, rate, duration, rowFirst, interpolate, staff, os.Getenv("IELTS_THROUGHPUT_K6_START_SPREAD"))

	// Phase 1: readiness wave. Every candidate holds one active Listening
	// timeline with the full working time, audited at most once.
	runSATRecoveryK6(t, script, steady+5*time.Minute, k6Env("ready"), apis)
	if t.Failed() {
		t.FailNow()
	}
	pattern := f.studentKeyPrefix + "%"
	assertZero := func(label, query string, args ...any) {
		t.Helper()
		var got int
		if err := f.db.QueryRow(query, args...).Scan(&got); err != nil {
			t.Fatalf("reconcile %s: %v", label, err)
		}
		if got != 0 {
			t.Errorf("reconcile %s: %d violating rows", label, got)
		}
	}
	assertZero("one active Listening timeline with full working time", `
		SELECT COUNT(*) FROM student_attempts a WHERE a.student_key LIKE ?
		  AND NOT EXISTS (SELECT 1 FROM ielts_attempt_section_timelines t
			WHERE t.attempt_id = a.id AND t.section_key = 'listening' AND t.state = 'active'
			  AND TIMESTAMPDIFF(MICROSECOND, t.started_at, t.deadline_at) = 3600000000)`, pattern)
	assertZero("at most one delayed-start audit per candidate", `
		SELECT COUNT(*) FROM (SELECT l.target_student_id FROM session_audit_logs l
			JOIN student_attempts a ON a.id = l.target_student_id
			WHERE a.student_key LIKE ? AND l.action_type = 'IELTS_DELAYED_START'
			GROUP BY l.target_student_id HAVING COUNT(*) > 1) dup`, pattern)

	// Phase 2: steady mix beside the background worker and staff sweeps.
	stopWorker := startIELTSLoadWorker(t)
	stopStaff := startIELTSStaffSweepers(t, f, proxyURL, staff)
	runSATRecoveryK6(t, script, steady+5*time.Minute, k6Env("steady"), apis)
	stopStaff()
	stopWorker()
	// Logged before the failure check: pool waits are the first thing to read
	// when the steady phase saturates.
	t.Log("ready + steady phases:")
	poolSteady := satRecoveryAPIPoolStats(t, apiURLs)
	logSATRecoveryAPIPoolStats(t, poolBefore, poolSteady)
	if t.Failed() {
		t.FailNow()
	}

	// Phase 3: every candidate's final section ends, then the submit wave.
	endIELTSSectionsForSubmit(t, f.db, "a.student_key LIKE ?", pattern)
	runSATRecoveryK6(t, script, steady+5*time.Minute, k6Env("submit"), apis)
	t.Log("submit phase:")
	logSATRecoveryAPIPoolStats(t, poolSteady, satRecoveryAPIPoolStats(t, apiURLs))

	// Every candidate is accounted for: one sealed submission each.
	assertZero("one sealed submission per candidate", `
		SELECT COUNT(*) FROM student_attempts a WHERE a.student_key LIKE ?
		  AND NOT (a.delivery_status = 'submitted'
			AND (SELECT COUNT(*) FROM attempt_terminalizations t WHERE t.attempt_id = a.id AND t.outcome = 'submitted') = 1
			AND (SELECT COUNT(*) FROM attempt_submissions_v2 s WHERE s.attempt_id = a.id) = 1)`, pattern)
	// Each accepted answer advanced the attempt revision exactly once.
	assertZero("attempt revision = applied ledger rows", `
		SELECT COUNT(*) FROM student_attempts a WHERE a.student_key LIKE ?
		  AND a.response_revision <> (SELECT COUNT(*) FROM attempt_mutations_v2 m WHERE m.attempt_id = a.id AND m.outcome = 'applied')`, pattern)
	assertZero("unique applied server revisions", `
		SELECT COUNT(*) FROM (
			SELECT m.attempt_id, m.server_revision FROM attempt_mutations_v2 m
			JOIN student_attempts a ON a.id = m.attempt_id
			WHERE a.student_key LIKE ? AND m.outcome = 'applied'
			GROUP BY m.attempt_id, m.server_revision HAVING COUNT(*) > 1) dup`, pattern)
	assertZero("projection = newest applied write", `
		SELECT COUNT(*) FROM attempt_responses_v2 r
		JOIN student_attempts a ON a.id = r.attempt_id
		WHERE a.student_key LIKE ?
		  AND NOT EXISTS (
			SELECT 1 FROM attempt_mutations_v2 m
			WHERE m.attempt_id = r.attempt_id AND m.client_write_id = r.client_write_id
			  AND m.client_version = r.client_version AND m.response_hash = r.response_hash
			  AND m.outcome = 'applied'
			  AND m.client_version = (
				SELECT MAX(m2.client_version) FROM attempt_mutations_v2 m2
				WHERE m2.attempt_id = r.attempt_id AND m2.question_id = r.question_id AND m2.outcome = 'applied'))`, pattern)
	// The script's answer is a function of the client version alone.
	assertZero("stored answer = script answer for its version", `
		SELECT COUNT(*) FROM attempt_responses_v2 r JOIN student_attempts a ON a.id = r.attempt_id
		WHERE a.student_key LIKE ?
		  AND JSON_UNQUOTE(JSON_EXTRACT(r.response, '$.answer')) <> ELT(1 + r.client_version % 4, 'A', 'B', 'C', 'D')`, pattern)
	// The sealed submission carries exactly the script's final answers.
	sealedMismatches := 0
	for _, c := range f.candidates {
		rows, err := f.db.Query(`SELECT question_id, client_version FROM attempt_responses_v2 WHERE attempt_id = ?`, c.AttemptID)
		if err != nil {
			t.Fatal(err)
		}
		want := map[string]string{}
		for rows.Next() {
			var id string
			var version int
			if err := rows.Scan(&id, &version); err != nil {
				t.Fatal(err)
			}
			want[id] = string("ABCD"[version%4])
		}
		rows.Close()
		if err := ieltsSealedAnswersError(f.db, c.AttemptID, want, nil); err != nil {
			if sealedMismatches < 5 {
				t.Error(err)
			}
			sealedMismatches++
		}
	}
	var applied, answered int
	if err := f.db.QueryRow(`SELECT COUNT(*), COUNT(DISTINCT m.attempt_id) FROM attempt_mutations_v2 m JOIN student_attempts a ON a.id = m.attempt_id
		WHERE a.student_key LIKE ? AND m.outcome = 'applied'`, pattern).Scan(&applied, &answered); err != nil {
		t.Fatal(err)
	}
	if applied == 0 {
		t.Error("the run accepted no answers")
	}
	t.Logf("reconciled %d candidates: %d accepted answers on %d attempts, %d sealed-answer mismatches", count, applied, answered, sealedMismatches)
}

// startIELTSLoadWorker runs the production background worker in-process so
// its reconcile and outbox cycles compete for the same database during the
// steady phase. The returned func stops it and waits for in-flight jobs.
func startIELTSLoadWorker(t *testing.T) func() {
	t.Helper()
	cfg := config.Load()
	cfg.DatabaseURL = os.Getenv("TEST_MYSQL_DSN")
	cfg.AuthSecret = submitTestSecret
	cfg.OutboxExecOnly = true
	pool, err := platformdb.OpenRole(cfg, platformdb.RoleWorker)
	if err != nil {
		t.Fatalf("open worker pool: %v", err)
	}
	stop, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		background.New(cfg, pool, shared.Deps{}).RunUntil(stop, context.Background())
	}()
	return func() {
		cancel()
		<-done
		pool.Close()
	}
}

// startIELTSStaffSweepers logs in admin staff and has each sweep every page
// of the rooms' rosters through the proctor endpoint, like an open staff
// dashboard. The returned func stops them and reports page latency.
func startIELTSStaffSweepers(t *testing.T, f ieltsLoadFixture, baseURL string, n int) func() {
	t.Helper()
	if n == 0 {
		return func() {}
	}
	const password = "ielts-load-staff-password-0123"
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Timeout: 20 * time.Second}
	cookies := make([]string, n)
	for i := range n {
		userID, email := uuid.NewString(), fmt.Sprintf("%sstaff-%d@example.test", f.studentKeyPrefix, i)
		if _, err := f.db.Exec(`INSERT INTO users (id, email, display_name, role, state, organization_id) VALUES (?, ?, 'IELTS load staff', 'admin', 'active', 'ielts-load-org')`, userID, email); err != nil {
			t.Fatal(err)
		}
		if _, err := f.db.Exec(`INSERT INTO user_password_credentials (user_id, password_hash) VALUES (?, ?)`, userID, hash); err != nil {
			t.Fatal(err)
		}
		body, _ := json.Marshal(map[string]string{"email": email, "password": password})
		resp, err := client.Post(baseURL+"/api/v1/auth/login", "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("staff login: HTTP %d", resp.StatusCode)
		}
		var parts []string
		for _, cookie := range resp.Cookies() {
			parts = append(parts, cookie.Name+"="+cookie.Value)
		}
		cookies[i] = strings.Join(parts, "; ")
	}
	var mu sync.Mutex
	var pages []time.Duration
	var failures []string
	stop, cancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for sweep := 0; stop.Err() == nil; sweep++ {
				scheduleID := f.scheduleIDs[(i+sweep)%len(f.scheduleIDs)]
				query := url.Values{"limit": {"200"}}
				for stop.Err() == nil {
					req, _ := http.NewRequestWithContext(stop, http.MethodGet, baseURL+"/api/v1/proctor/sessions/"+scheduleID+"/roster?"+query.Encode(), nil)
					req.Header.Set("Cookie", cookies[i])
					started := time.Now()
					resp, err := client.Do(req)
					if err != nil {
						if stop.Err() == nil {
							mu.Lock()
							failures = append(failures, err.Error())
							mu.Unlock()
						}
						return
					}
					var page struct {
						HasMore           bool   `json:"hasMore"`
						NextCursorUpdated string `json:"nextCursorUpdated"`
						NextCursorID      string `json:"nextCursorID"`
					}
					decodeErr := json.NewDecoder(resp.Body).Decode(&page)
					resp.Body.Close()
					elapsed := time.Since(started)
					mu.Lock()
					switch {
					case resp.StatusCode == http.StatusTooManyRequests:
					case resp.StatusCode != http.StatusOK || decodeErr != nil:
						failures = append(failures, fmt.Sprintf("roster HTTP %d %v", resp.StatusCode, decodeErr))
					default:
						pages = append(pages, elapsed)
					}
					mu.Unlock()
					if resp.StatusCode != http.StatusOK || !page.HasMore {
						break
					}
					query.Set("cursorUpdatedAt", page.NextCursorUpdated)
					query.Set("cursorID", page.NextCursorID)
				}
				select {
				case <-stop.Done():
				case <-time.After(2 * time.Second):
				}
			}
		}(i)
	}
	return func() {
		cancel()
		wg.Wait()
		mu.Lock()
		defer mu.Unlock()
		if len(failures) > 0 {
			t.Errorf("staff roster sweeps: %d failures, first: %s", len(failures), failures[0])
		}
		if len(pages) == 0 {
			t.Error("staff roster sweeps loaded no pages")
			return
		}
		sort.Slice(pages, func(a, b int) bool { return pages[a] < pages[b] })
		at := func(q float64) time.Duration { return pages[min(len(pages)-1, int(q*float64(len(pages))))] }
		t.Logf("staff roster pages: n=%d p50=%s p95=%s p99=%s max=%s", len(pages), at(0.50), at(0.95), at(0.99), pages[len(pages)-1])
	}
}
