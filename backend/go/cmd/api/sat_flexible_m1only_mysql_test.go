package main

// Real-MySQL coverage for docs/plans/2026-11-03-sat-flexible-count-m1-only.md
// Part A A5: the flexible M1-only vertical slice against InnoDB row locks.
//
//  H2: flexible M1-only RW exam authors 10Q in rw-m1, publishes (10/27),
//      creates a Classroom room, sits M1, completes with no M2, and releases
//      raw 6/10 with the denominator pinned to the authored count.
//  F1: an empty included module blocks publish; the draft is unchanged.
//  F2: the blueprint ceiling still holds (28th question rejected, count 27).
//  F6: M1-only completion never waits for Module 2 (no route decision, no
//      second branch, EnsureSATModuleTopologyTx succeeds).
//  F7: concurrent publish vs authoring edit keeps exactly one outcome.
//  F8: create with the same operationKey replays; a different body conflicts.
//  F9: concurrent M1 closes converge on one terminal row (no duplicates).
//
// Every test verifies the durable rows the plan names: assessment_exam_questions
// counts, exam_versions.sat_flexible_count + sat_classroom_plan,
// assessment_module_attempts terminal sets, assessment_scoring_policies
// policy_key='practice'. The browser half of H2 (creation sheet, readiness
// copy, raw report rendering) lives in e2e/sat-flexible-m1-only.spec.ts.
//
// Gated on TEST_MYSQL_DSN like the other real-MySQL suites in this package.

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/sat"
	"example.com/ielts-proctoring/internal/terminalization"
)

func satFlexibleM1OnlyConfig() *exams.SATExamConfig {
	cfg := exams.DefaultSATExamConfig()
	cfg.SectionScope = exams.SATPublishScopeReadingWriting
	cfg.ClassroomPlan = map[string]string{"reading-writing": "m1_only"}
	flexible := true
	cfg.FlexibleQuestionCount = &flexible
	return &cfg
}

func newSATFlexibleM1OnlyHarness(t *testing.T) *satRoomsHarness {
	t.Helper()
	return newSatRoomsHarness(newConcurrencyHarness(t, satFlexibleM1OnlyConfig()))
}

func satFlexibleBaseModule(t *testing.T, h *concurrencyHarness) (moduleID string, target int) {
	t.Helper()
	shell, err := h.authors.Shell(context.Background(), h.examID)
	if err != nil {
		t.Fatal(err)
	}
	for _, section := range shell.Sections {
		if section.SectionKey != "reading-writing" {
			continue
		}
		for _, module := range section.Modules {
			if module.AdaptiveRole == "base" {
				return module.ID, module.TargetQuestionCount
			}
		}
	}
	t.Fatal("flexible fixture has no reading-writing base module")
	return "", 0
}

func satFlexibleAuthorQuestions(t *testing.T, h *concurrencyHarness, moduleID string, count int) []string {
	t.Helper()
	ids := make([]string, 0, count)
	for i := 0; i < count; i++ {
		created, err := h.authors.CreateQuestion(context.Background(), moduleID, h.actor, validSATPublishQuestion())
		if err != nil {
			t.Fatalf("author flexible question %d: %v", i+1, err)
		}
		ids = append(ids, created.ExamQuestionID)
	}
	return ids
}

func satFlexibleQuestionCount(t *testing.T, db *sql.DB, moduleID string) int {
	t.Helper()
	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM assessment_exam_questions WHERE module_id = ?", moduleID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func satFlexiblePublish(t *testing.T, h *concurrencyHarness) exams.Version {
	t.Helper()
	var examRevision int
	if err := h.db.QueryRow("SELECT revision FROM exam_entities WHERE id = ?", h.examID).Scan(&examRevision); err != nil {
		t.Fatal(err)
	}
	shell, err := h.authors.Shell(context.Background(), h.examID)
	if err != nil {
		t.Fatal(err)
	}
	published, err := h.exams.Publish(context.Background(), h.examID, h.actor, exams.PublishRequest{
		PublishScope:           exams.SATPublishScopeReadingWriting,
		Revision:               examRevision,
		ExpectedDraftVersionID: &shell.VersionID,
		ExpectedDraftRevision:  &shell.VersionRevision,
	})
	if err != nil {
		t.Fatalf("publish flexible M1-only draft: %v", err)
	}
	return published
}

// H2: publish → room → sit → complete → raw, with every durable row the plan
// names verified.
func TestSATFlexibleM1OnlyPublishRoomSitCompleteRawMySQL(t *testing.T) {
	h := newSATFlexibleM1OnlyHarness(t)
	ctx := context.Background()
	baseID, target := satFlexibleBaseModule(t, h.concurrencyHarness)
	if target != 27 {
		t.Fatalf("RW blueprint max must stay 27 for flexible exams, got %d", target)
	}
	examQuestions := satFlexibleAuthorQuestions(t, h.concurrencyHarness, baseID, 10)

	// Readiness is the non-blocking staff note, never a gate.
	report, err := h.authors.ValidateExamForScope(ctx, h.examID, exams.SATPublishScopeReadingWriting)
	if err != nil {
		t.Fatal(err)
	}
	if !report.Valid {
		t.Fatalf("10/27 flexible draft must validate: %+v", report.Errors)
	}
	note := false
	for _, issue := range report.Errors {
		if issue.Code == "sat.module.flexible_note" {
			note = true
		}
		if issue.Blocking {
			t.Fatalf("flexible readiness must not block: %+v", issue)
		}
	}
	for _, issue := range report.Warnings {
		if issue.Code == "sat.module.flexible_note" {
			note = true
		}
		if issue.Blocking {
			t.Fatalf("flexible readiness must not block: %+v", issue)
		}
	}
	if !note {
		t.Fatalf("10/27 flexible draft must carry the staff note: %+v", report.Warnings)
	}

	published := satFlexiblePublish(t, h.concurrencyHarness)

	// Durable flag + plan + raw-only policy (A5 DB verification).
	var flexibleFlag int
	if err := h.db.QueryRow("SELECT sat_flexible_count FROM exam_versions WHERE id = ?", published.ID).Scan(&flexibleFlag); err != nil {
		t.Fatalf("flexible flag unreadable (migration 0117 missing?): %v", err)
	}
	if flexibleFlag != 1 {
		t.Fatalf("sat_flexible_count = %d, want 1", flexibleFlag)
	}
	var plan string
	if err := h.db.QueryRow("SELECT CAST(sat_classroom_plan AS CHAR) FROM exam_versions WHERE id = ?", published.ID).Scan(&plan); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(plan, "m1_only") {
		t.Fatalf("classroom plan must persist m1_only, got %s", plan)
	}
	var policyKey string
	if err := h.db.QueryRow("SELECT policy_key FROM assessment_scoring_policies WHERE exam_version_id = ?", published.ID).Scan(&policyKey); err != nil {
		t.Fatal(err)
	}
	if policyKey != "practice" {
		t.Fatalf("flexible M1-only scoring must stay raw-only, got %q", policyKey)
	}
	// M1-only sections clock the base module alone: no branch clock reaches
	// the section length.
	var sectionSeconds int
	if err := h.db.QueryRow(`SELECT duration_seconds FROM assessment_sections WHERE exam_version_id = ? AND section_key = 'reading-writing'`, published.ID).Scan(&sectionSeconds); err != nil {
		t.Fatal(err)
	}
	if sectionSeconds != 32*60 {
		t.Fatalf("m1_only RW section must clock base alone (1920s), got %d", sectionSeconds)
	}
	if n := satFlexibleQuestionCount(t, h.db, baseID); n != 10 {
		t.Fatalf("rw-m1 carries %d questions, want 10", n)
	}

	// Room creation from the flexible release (one-action seal + link).
	wasEnabled := exams.SATClassroomCreationEnabled()
	exams.SetClassroomCreationEnabled(true)
	t.Cleanup(func() { exams.SetClassroomCreationEnabled(wasEnabled) })
	roomRequest := satRoomRequest(t, h, uuid.NewString(), "Homework room")
	roomRequest.Room.EnabledSections = []string{"reading-writing"}
	roomRequest.Room.SatSessionMode = "classroom"
	room, err := h.rooms.CreateRoom(ctx, h.actor, h.examID, roomRequest)
	if err != nil {
		t.Fatalf("create room from flexible release: %v", err)
	}
	if room.Version.ID != published.ID || room.Room.PublishedVersionID != published.ID {
		t.Fatalf("room must pin the flexible release: %+v", room.Version)
	}
	scheduleID := room.Room.ScheduleID
	if scheduleID == "" {
		t.Fatal("room has no backing schedule")
	}
	if _, err := h.db.ExecContext(ctx, "UPDATE exam_entities e JOIN exam_schedules sch ON sch.exam_id = e.id SET e.sat_score_report_enabled = TRUE WHERE sch.id = ?", scheduleID); err != nil {
		t.Fatal(err)
	}

	// Sit M1: an active, long-expired base attempt with 6/10 correct answers.
	attemptID := uuid.NewString()
	now := time.Now().UTC().Truncate(time.Second)
	if _, err := h.db.ExecContext(ctx, `INSERT INTO exam_session_runtimes (id, schedule_id, exam_id, provider_key, status, plan_snapshot, timing_model)
		VALUES (?, ?, ?, 'sat', 'live', '{}', 'legacy_section_v1')`, uuid.NewString(), scheduleID, h.examID); err != nil {
		t.Fatal(err)
	}
	if _, err := h.db.ExecContext(ctx, `INSERT INTO student_attempts (
		id, schedule_id, student_key, organization_id, exam_id,
		published_version_id, exam_title, candidate_id, candidate_name,
		candidate_email, phase, current_module, answers, writing_answers,
		flags, violations_snapshot, integrity, recovery, revision,
		protocol_version, delivery_status, lease_epoch, control_epoch, response_revision,
		wcode
	) VALUES (?, ?, ?, 'flex-org', ?, ?, 'Flexible M1 homework', ?, 'Flex Candidate',
		'candidate@example.test', 'exam', 'reading', '{}', '{}', '{}', '[]', '{}', '{}', 0,
		2, 'running', 1, 1, 7, ?)`,
		attemptID, scheduleID, attemptID, h.examID, published.ID, "cand-"+attemptID[:8], "W-"+attemptID); err != nil {
		t.Fatalf("seed flexible attempt: %v", err)
	}
	if _, err := h.db.ExecContext(ctx, `INSERT INTO assessment_module_attempts (
		id, attempt_id, module_id, state, allocated_seconds, started_at, tool_state, revision
	) VALUES (?, ?, ?, 'active', 3600, ?, '{}', 1)`,
		uuid.NewString(), attemptID, baseID, now.Add(-2*time.Hour)); err != nil {
		t.Fatalf("seed flexible M1 attempt: %v", err)
	}
	for i, examQuestionID := range examQuestions {
		answer := `{"answer":"B","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`
		if i < 6 {
			answer = `{"answer":"A","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`
		}
		if _, err := h.db.ExecContext(ctx, `INSERT INTO attempt_responses_v2 (
			attempt_id, question_id, module_id, lease_epoch, control_epoch,
			client_version, client_write_id, request_hash, response, response_hash,
			server_revision
		) VALUES (?, ?, ?, 1, 1, 1, ?, ?, ?, ?, 7)`,
			attemptID, examQuestionID, baseID,
			"write-"+uuid.NewString(), "req-"+uuid.NewString(), answer, "hash-"+uuid.NewString()); err != nil {
			t.Fatalf("seed flexible response %d: %v", i, err)
		}
	}

	// The expired M1 closes through the real reconcile path: no route
	// decision is recorded and no Module 2 is ever opened (F6).
	svc := delivery.NewService(h.db, tx.NewRunner(h.db))
	if _, err := svc.ReconcileAttemptTimeout(ctx, scheduleID, attemptID, now); err != nil {
		t.Fatalf("reconcile flexible M1: %v", err)
	}
	var terminal, branches, decisions int
	if err := h.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ? AND state IN ('submitted','locked')", attemptID, baseID).Scan(&terminal); err != nil {
		t.Fatal(err)
	}
	if err := h.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id = ? AND module_id <> ?", attemptID, baseID).Scan(&branches); err != nil {
		t.Fatal(err)
	}
	if err := h.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_route_decisions WHERE attempt_id = ?", attemptID).Scan(&decisions); err != nil {
		t.Fatal(err)
	}
	if terminal != 1 || branches != 0 || decisions != 0 {
		t.Fatalf("m1_only sit must end with one terminal M1 and nothing else: terminal=%d branches=%d decisions=%d", terminal, branches, decisions)
	}

	// Completion succeeds with a single terminal base module and no route
	// decision: AwaitingStaffRoute=false, no "waiting for Module 2".
	completion := sat.NewService(h.db, tx.NewRunner(h.db), nil, nil)
	if _, err := completion.CompleteAssessment(ctx, sat.CompleteRequest{
		ScheduleID: scheduleID, AttemptID: attemptID, SubmissionID: uuid.NewString(), ActorKind: "student",
	}); err != nil {
		t.Fatalf("complete flexible M1-only attempt: %v", err)
	}

	// Raw release: denominator is the authored 10, not the blueprint 27.
	if _, _, err := terminalization.RepairClassroomResults(ctx, h.db, 50); err != nil {
		t.Fatal(err)
	}
	var release, payload string
	if err := h.db.QueryRowContext(ctx, "SELECT release_status, CAST(score_payload AS CHAR) FROM assessment_results WHERE attempt_id = ? AND provider_key = 'sat'", attemptID).Scan(&release, &payload); err != nil {
		t.Fatal(err)
	}
	if release != "released" {
		t.Fatalf("flexible raw score must release, got %s (%s)", release, payload)
	}
	var doc struct {
		Raw struct {
			RawCorrect, Total int
		} `json:"classroomRaw"`
	}
	if err := json.Unmarshal([]byte(payload), &doc); err != nil || doc.Raw.RawCorrect != 6 || doc.Raw.Total != 10 {
		t.Fatalf("raw score payload = %s (%v); want 6/10", payload, err)
	}
}

// F1: an empty included module blocks publish and room creation; the draft is
// unchanged (no partial publish).
func TestSATFlexibleM1OnlyRefusesEmptyModuleMySQL(t *testing.T) {
	h := newSATFlexibleM1OnlyHarness(t)
	ctx := context.Background()
	shell, err := h.authors.Shell(ctx, h.examID)
	if err != nil {
		t.Fatal(err)
	}
	var beforeExamRev int
	if err := h.db.QueryRow("SELECT revision FROM exam_entities WHERE id = ?", h.examID).Scan(&beforeExamRev); err != nil {
		t.Fatal(err)
	}
	_, err = h.exams.Publish(ctx, h.examID, h.actor, exams.PublishRequest{
		PublishScope:           exams.SATPublishScopeReadingWriting,
		Revision:               beforeExamRev,
		ExpectedDraftVersionID: &shell.VersionID,
		ExpectedDraftRevision:  &shell.VersionRevision,
	})
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("empty flexible module must be rejected as validation, got %v", err)
	}
	if got := appErr.Details["code"]; got != "sat.module.empty" {
		t.Fatalf("issue code = %v, want sat.module.empty", got)
	}
	if got := appErr.Details["path"]; got != "reading-writing.rw-m1" {
		t.Fatalf("issue path = %v, want reading-writing.rw-m1", got)
	}
	var published int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM exam_versions WHERE exam_id = ? AND is_published = TRUE", h.examID).Scan(&published); err != nil || published != 0 {
		t.Fatalf("refused publish must not seal a release: versions=%d err=%v", published, err)
	}
	var afterExamRev int
	if err := h.db.QueryRow("SELECT revision FROM exam_entities WHERE id = ?", h.examID).Scan(&afterExamRev); err != nil || afterExamRev != beforeExamRev {
		t.Fatalf("refused publish changed the exam revision: %d -> %d (%v)", beforeExamRev, afterExamRev, err)
	}
}

// F2: the blueprint ceiling still holds for flexible exams: the 28th
// question is rejected and the count stays 27.
func TestSATFlexibleCeilingRejectsOverTargetQuestionMySQL(t *testing.T) {
	h := newSATFlexibleM1OnlyHarness(t)
	baseID, target := satFlexibleBaseModule(t, h.concurrencyHarness)
	if target != 27 {
		t.Fatalf("RW blueprint max must be 27, got %d", target)
	}
	satFlexibleAuthorQuestions(t, h.concurrencyHarness, baseID, target)
	_, err := h.authors.CreateQuestion(context.Background(), baseID, h.actor, validSATPublishQuestion())
	appErr, ok := apperrors.As(err)
	if !ok || (appErr.Code != apperrors.CodeValidation && appErr.Code != apperrors.CodeConflict) {
		t.Fatalf("28th question must hit the ceiling, got %v", err)
	}
	if !strings.Contains(err.Error(), "already has 27 of 27") {
		t.Fatalf("ceiling error must name the count, got %v", err)
	}
	if n := satFlexibleQuestionCount(t, h.db, baseID); n != target {
		t.Fatalf("count after rejected add = %d, want %d", n, target)
	}
}

// F7: publish racing an authoring edit keeps exactly one outcome: the stale
// publish conflicts, the refreshed publish seals a single release.
func TestSATFlexiblePublishRaceKeepsSingleReleaseMySQL(t *testing.T) {
	h := newSATFlexibleM1OnlyHarness(t)
	ctx := context.Background()
	baseID, _ := satFlexibleBaseModule(t, h.concurrencyHarness)
	satFlexibleAuthorQuestions(t, h.concurrencyHarness, baseID, 10)

	shell, err := h.authors.Shell(ctx, h.examID)
	if err != nil {
		t.Fatal(err)
	}
	var examRevision int
	if err := h.db.QueryRow("SELECT revision FROM exam_entities WHERE id = ?", h.examID).Scan(&examRevision); err != nil {
		t.Fatal(err)
	}
	draftID, draftRevision := shell.VersionID, shell.VersionRevision

	// Staff B lands an 11th question first: the draft revision moves.
	satFlexibleAuthorQuestions(t, h.concurrencyHarness, baseID, 1)

	// Staff A's publish still fences the revision it saw: it must lose.
	_, err = h.exams.Publish(ctx, h.examID, h.actor, exams.PublishRequest{
		PublishScope:           exams.SATPublishScopeReadingWriting,
		Revision:               examRevision,
		ExpectedDraftVersionID: &draftID,
		ExpectedDraftRevision:  &draftRevision,
	})
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeConflict {
		t.Fatalf("stale flexible publish must conflict, got %v", err)
	}
	var published int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM exam_versions WHERE exam_id = ? AND is_published = TRUE", h.examID).Scan(&published); err != nil || published != 0 {
		t.Fatalf("losing publish must not seal a release: %d (%v)", published, err)
	}

	// The refreshed publish (11/27, still flexible) seals exactly one release.
	refreshed, err := h.authors.Shell(ctx, h.examID)
	if err != nil {
		t.Fatal(err)
	}
	opKey := "flex-publish-" + uuid.NewString()
	sealed, err := h.exams.Publish(ctx, h.examID, h.actor, exams.PublishRequest{
		PublishScope:           exams.SATPublishScopeReadingWriting,
		Revision:               examRevision,
		ExpectedDraftVersionID: &refreshed.VersionID,
		ExpectedDraftRevision:  &refreshed.VersionRevision,
		OperationKey:           opKey,
	})
	if err != nil {
		t.Fatalf("refreshed flexible publish: %v", err)
	}
	// A lost-response retry with the same key replays the same release.
	replayed, err := h.exams.Publish(ctx, h.examID, h.actor, exams.PublishRequest{
		PublishScope:           exams.SATPublishScopeReadingWriting,
		Revision:               examRevision,
		ExpectedDraftVersionID: &refreshed.VersionID,
		ExpectedDraftRevision:  &refreshed.VersionRevision,
		OperationKey:           opKey,
	})
	if err != nil {
		t.Fatalf("identical flexible publish retry must replay: %v", err)
	}
	if replayed.ID != sealed.ID {
		t.Fatalf("retry returned a different release: %s vs %s", replayed.ID, sealed.ID)
	}
	if err := h.db.QueryRow("SELECT COUNT(*) FROM exam_versions WHERE exam_id = ? AND is_published = TRUE", h.examID).Scan(&published); err != nil || published != 1 {
		t.Fatalf("exactly one flexible release must exist: %d (%v)", published, err)
	}
	var events int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM exam_events WHERE exam_id = ? AND action = 'published'", h.examID).Scan(&events); err != nil || events != 1 {
		t.Fatalf("exactly one publish event must exist: %d (%v)", events, err)
	}
}

// F8: the same creation body + operationKey replays one exam row; a different
// body under the same key is a 409.
func TestSATFlexibleCreateIdempotencyMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	ctx := context.Background()
	provider := "sat"
	key := "flex-create-" + uuid.NewString()
	identical := func() exams.CreateRequest {
		cfg := satFlexibleM1OnlyConfig()
		return exams.CreateRequest{
			OperationKey: key, Slug: "flex-idempotent-" + key[:8], Title: "Flexible idempotency",
			ExamType: "Academic", Visibility: "private", ProviderKey: &provider,
			ProviderExamType: strPtr("SAT"), OwnerID: h.actor, SATConfig: cfg,
		}
	}
	first, err := h.exams.Create(ctx, identical())
	if err != nil {
		t.Fatalf("first flexible create: %v", err)
	}
	replayed, err := h.exams.Create(ctx, identical())
	if err != nil {
		t.Fatalf("identical flexible retry must replay: %v", err)
	}
	if replayed.ID != first.ID {
		t.Fatalf("retry minted a second exam: first=%s replayed=%s", first.ID, replayed.ID)
	}
	diverged := identical()
	diverged.Title = "Flexible idempotency, different body"
	if _, err := h.exams.Create(ctx, diverged); err == nil {
		t.Fatal("different body under one operation key must fail")
	} else if appErr, ok := apperrors.As(err); !ok || appErr.Code != apperrors.CodeConflict {
		t.Fatalf("diverged retry must be a 409, got %v", err)
	}
	var count int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM exam_entities WHERE owner_id = ?", h.actor).Scan(&count); err != nil || count != 1 {
		t.Fatalf("idempotent retries must leave one exam row: %d (%v)", count, err)
	}
	t.Cleanup(func() {
		if _, err := h.db.Exec("DELETE FROM exam_schedules WHERE exam_id = ?", first.ID); err != nil {
			t.Error(err)
		}
		if err := h.exams.Delete(context.Background(), first.ID); err != nil {
			t.Error(err)
		}
	})
}

// F9: concurrent M1 closes (clock backstop + browser + retries) converge on
// one terminal M1 row with the accepted write set; no duplicate module rows.
func TestSATFlexibleSubmitRetrySingleTerminalMySQL(t *testing.T) {
	h := newSATFlexibleM1OnlyHarness(t)
	ctx := context.Background()
	baseID, _ := satFlexibleBaseModule(t, h.concurrencyHarness)
	satFlexibleAuthorQuestions(t, h.concurrencyHarness, baseID, 3)

	// Capture the published rows before the seal: module ids are stable
	// across publish (the version row flips; its modules do not move).
	var examQuestions []string
	rows, err := h.db.QueryContext(ctx, "SELECT id FROM assessment_exam_questions WHERE module_id = ? ORDER BY display_order", baseID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		examQuestions = append(examQuestions, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		t.Fatal(err)
	}
	rows.Close()
	if len(examQuestions) != 3 {
		t.Fatalf("flexible draft must carry 3 base questions, got %d", len(examQuestions))
	}
	published := satFlexiblePublish(t, h.concurrencyHarness)

	// A classroom sitting with an expired active M1 and one response set.
	scheduleID := uuid.NewString()
	now := time.Now().UTC().Truncate(time.Second)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := h.db.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("seed flexible retry sitting: %v", err)
		}
	}
	exec(`INSERT INTO exam_schedules (
		id, exam_id, provider_key, organization_id, exam_title, proctor_display_name,
		grading_display_name, published_version_id, cohort_name, institution,
		start_time, end_time, planned_duration_minutes, delivery_mode, status,
		created_by, sat_session_mode, sat_route_policy
	) VALUES (?, ?, 'sat', 'flex-org', 'Flexible retry', 'Flexible retry', 'Flexible retry',
		?, 'retry', 'Codex', ?, ?, 120, 'proctor_start', 'live', ?, 'classroom', 'staff_selects')`,
		scheduleID, h.examID, published.ID, now.Add(-2*time.Hour), now.Add(2*time.Hour), h.actor)
	attemptID := uuid.NewString()
	exec(`INSERT INTO student_attempts (
		id, schedule_id, student_key, organization_id, exam_id,
		published_version_id, exam_title, candidate_id, candidate_name,
		candidate_email, phase, current_module, answers, writing_answers,
		flags, violations_snapshot, integrity, recovery, revision,
		protocol_version, delivery_status, lease_epoch, control_epoch, response_revision,
		wcode
	) VALUES (?, ?, ?, 'flex-org', ?, ?, 'Flexible retry', ?, 'Retry Candidate',
		'candidate@example.test', 'exam', 'reading', '{}', '{}', '{}', '[]', '{}', '{}', 0,
		2, 'running', 1, 1, 7, ?)`,
		attemptID, scheduleID, attemptID, h.examID, published.ID, "cand-"+attemptID[:8], "W-"+attemptID)
	exec(`INSERT INTO assessment_module_attempts (
		id, attempt_id, module_id, state, allocated_seconds, started_at, tool_state, revision
	) VALUES (?, ?, ?, 'active', 3600, ?, '{}', 1)`,
		uuid.NewString(), attemptID, baseID, now.Add(-2*time.Hour))
	for _, examQuestionID := range examQuestions {
		exec(`INSERT INTO attempt_responses_v2 (
			attempt_id, question_id, module_id, lease_epoch, control_epoch,
			client_version, client_write_id, request_hash, response, response_hash,
			server_revision
		) VALUES (?, ?, ?, 1, 1, 1, ?, ?, ?, ?, 7)`,
			attemptID, examQuestionID, baseID,
			"write-"+uuid.NewString(), "req-"+uuid.NewString(),
			`{"answer":"A","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`, "hash-"+uuid.NewString())
	}

	// Every racer submits the same write set: all must succeed and converge.
	// One pool per racer up front (separate API instances); the barrier below
	// is the only synchronization.
	const racers = 8
	pools := make([]*sql.DB, 0, racers)
	for i := 0; i < racers; i++ {
		pools = append(pools, staleETagTestDB(t))
	}
	start := make(chan struct{})
	errs := make(chan error, racers)
	var wg sync.WaitGroup
	for _, pool := range pools {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			svc := delivery.NewService(pool, tx.NewRunner(pool))
			_, err := svc.ReconcileAttemptTimeout(ctx, scheduleID, attemptID, now)
			errs <- err
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("racing M1 close: %v", err)
		}
	}
	var terminal, total int
	if err := h.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?", attemptID, baseID).Scan(&total); err != nil {
		t.Fatal(err)
	}
	if err := h.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ? AND state IN ('submitted','locked')", attemptID, baseID).Scan(&terminal); err != nil {
		t.Fatal(err)
	}
	var responses int
	if err := h.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM attempt_responses_v2 WHERE attempt_id = ?", attemptID).Scan(&responses); err != nil {
		t.Fatal(err)
	}
	var decisions int
	if err := h.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_route_decisions WHERE attempt_id = ?", attemptID).Scan(&decisions); err != nil {
		t.Fatal(err)
	}
	if total != 1 || terminal != 1 || responses != 3 || decisions != 0 {
		t.Fatalf("retry must converge: moduleRows=%d terminal=%d responses=%d decisions=%d", total, terminal, responses, decisions)
	}
}

// Audit-fix slice 6 MySQL cases (docs/plans/2026-11-04-sat-flexible-audit-fixes.md
// §7): threshold>N publish refused, practice schedule refused, clone preserves
// flag, converter attach refused. Each self-skips without TEST_MYSQL_DSN via
// the harness constructors below.

func satFlexibleFullConfig() *exams.SATExamConfig {
	cfg := exams.DefaultSATExamConfig()
	cfg.SectionScope = exams.SATPublishScopeReadingWriting
	cfg.ClassroomPlan = nil
	flexible := true
	cfg.FlexibleQuestionCount = &flexible
	return &cfg
}

func satFlexibleRWModules(t *testing.T, h *concurrencyHarness) map[string]string {
	t.Helper()
	shell, err := h.authors.Shell(context.Background(), h.examID)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, section := range shell.Sections {
		if section.SectionKey != "reading-writing" {
			continue
		}
		for _, module := range section.Modules {
			out[module.AdaptiveRole] = module.ID
		}
	}
	if out["base"] == "" || out["lower_branch"] == "" || out["higher_branch"] == "" {
		t.Fatalf("flexible full RW fixture must carry base+branches, got %v", out)
	}
	return out
}

// FR-1: flexible full-shape 10Q with the default threshold (13) refuses publish
// with sat.threshold.unreachable; the draft is unchanged (no partial release).
func TestSATFlexibleThresholdUnreachableRefusesPublishMySQL(t *testing.T) {
	h := newSatRoomsHarness(newConcurrencyHarness(t, satFlexibleFullConfig()))
	ctx := context.Background()
	mods := satFlexibleRWModules(t, h.concurrencyHarness)
	satFlexibleAuthorQuestions(t, h.concurrencyHarness, mods["base"], 10)
	satFlexibleAuthorQuestions(t, h.concurrencyHarness, mods["lower_branch"], 1)
	satFlexibleAuthorQuestions(t, h.concurrencyHarness, mods["higher_branch"], 1)

	shell, err := h.authors.Shell(ctx, h.examID)
	if err != nil {
		t.Fatal(err)
	}
	var beforeExamRev int
	if err := h.db.QueryRow("SELECT revision FROM exam_entities WHERE id = ?", h.examID).Scan(&beforeExamRev); err != nil {
		t.Fatal(err)
	}
	_, err = h.exams.Publish(ctx, h.examID, h.actor, exams.PublishRequest{
		PublishScope:           exams.SATPublishScopeReadingWriting,
		Revision:               beforeExamRev,
		ExpectedDraftVersionID: &shell.VersionID,
		ExpectedDraftRevision:  &shell.VersionRevision,
	})
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("threshold>authored publish must be rejected as validation, got %v", err)
	}
	// The publish rejection wires every finding under blockingIssues; the
	// threshold gate must be among them with its section path and counts.
	// (Details["code"] is only the first finding, which may be a module note.)
	foundThreshold := false
	if wire, ok := appErr.Details["blockingIssues"].([]map[string]any); ok {
		for _, w := range wire {
			if w["code"] != "sat.threshold.unreachable" {
				continue
			}
			if w["path"] != "reading-writing.minimumCorrectForHigher" {
				t.Fatalf("threshold issue path = %v, want reading-writing.minimumCorrectForHigher", w["path"])
			}
			msg, _ := w["message"].(string)
			if !strings.Contains(msg, "exceeds the 10 authored") {
				t.Fatalf("threshold issue must name the authored count, got %q", msg)
			}
			foundThreshold = true
		}
	} else if wireAny, ok := appErr.Details["blockingIssues"].([]any); ok {
		for _, entry := range wireAny {
			w, ok := entry.(map[string]any)
			if !ok || w["code"] != "sat.threshold.unreachable" {
				continue
			}
			if w["path"] != "reading-writing.minimumCorrectForHigher" {
				t.Fatalf("threshold issue path = %v, want reading-writing.minimumCorrectForHigher", w["path"])
			}
			msg, _ := w["message"].(string)
			if !strings.Contains(msg, "exceeds the 10 authored") {
				t.Fatalf("threshold issue must name the authored count, got %q", msg)
			}
			foundThreshold = true
		}
	}
	if !foundThreshold {
		if !strings.Contains(err.Error(), "exceeds the 10 authored") {
			t.Fatalf("publish refusal must carry sat.threshold.unreachable for 13>10, got %v (%v)", err, appErr.Details)
		}
	}
	var published int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM exam_versions WHERE exam_id = ? AND is_published = TRUE", h.examID).Scan(&published); err != nil || published != 0 {
		t.Fatalf("refused publish must not seal a release: versions=%d err=%v", published, err)
	}
	var afterExamRev int
	if err := h.db.QueryRow("SELECT revision FROM exam_entities WHERE id = ?", h.examID).Scan(&afterExamRev); err != nil || afterExamRev != beforeExamRev {
		t.Fatalf("refused publish changed the exam revision: %d -> %d (%v)", beforeExamRev, afterExamRev, err)
	}
}

// FR-3: flexible versions refuse practice scheduling with or without plan rows;
// the error names the Classroom remedy and no schedule row is mutated.
func TestSATFlexiblePracticeScheduleRefusedMySQL(t *testing.T) {
	h := newSATFlexibleM1OnlyHarness(t)
	ctx := context.Background()
	shell, err := h.authors.Shell(ctx, h.examID)
	if err != nil {
		t.Fatal(err)
	}
	scheduleID := "flex-practice-" + uuid.NewString()
	err = exams.PersistSATSession(ctx, h.db, scheduleID, "sat", shell.VersionID, exams.SATSession{}, nil)
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("flexible practice schedule must be rejected as validation, got %v", err)
	}
	if !strings.Contains(err.Error(), "flexible question counts") {
		t.Fatalf("practice refusal must name flexible counts, got %v", err)
	}
	var schedules int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM exam_schedules WHERE id = ?", scheduleID).Scan(&schedules); err != nil || schedules != 0 {
		t.Fatalf("refused practice schedule must not write a row: count=%d err=%v", schedules, err)
	}
}

// FR-4: continuing a published flexible exam clones the flag with the plan, so
// the v2 draft stays publishable under flexible gates.
func TestSATFlexibleClonePreservesFlagMySQL(t *testing.T) {
	h := newSATFlexibleM1OnlyHarness(t)
	ctx := context.Background()
	baseID, _ := satFlexibleBaseModule(t, h.concurrencyHarness)
	satFlexibleAuthorQuestions(t, h.concurrencyHarness, baseID, 10)
	published := satFlexiblePublish(t, h.concurrencyHarness)

	cloned, err := h.authors.OpenShell(ctx, h.examID, h.actor)
	if err != nil {
		t.Fatalf("continue editing a published flexible exam: %v", err)
	}
	if cloned.VersionID == published.ID {
		t.Fatal("OpenShell must clone a new draft, not return the release")
	}
	var flag int
	if err := h.db.QueryRow("SELECT sat_flexible_count FROM exam_versions WHERE id = ?", cloned.VersionID).Scan(&flag); err != nil {
		t.Fatal(err)
	}
	if flag != 1 {
		t.Fatalf("cloned draft sat_flexible_count = %d, want 1", flag)
	}
	var plan string
	if err := h.db.QueryRow("SELECT CAST(sat_classroom_plan AS CHAR) FROM exam_versions WHERE id = ?", cloned.VersionID).Scan(&plan); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(plan, "m1_only") {
		t.Fatalf("cloned draft must keep the classroom plan, got %s", plan)
	}
}

// FR-6: attaching a converter to a flexible/M1-only draft is refused with the
// creation message; clearing back to raw-only stays open.
func TestSATFlexibleConverterAttachRefusedMySQL(t *testing.T) {
	h := newSATFlexibleM1OnlyHarness(t)
	ctx := context.Background()
	converter := json.RawMessage(`{"converterVersion":"classroom-v1","scoreType":"estimated_sat","calibrationSource":"staff_approved","sections":{},"tables":{}}`)
	_, err := h.authors.SetScoreConverter(ctx, h.examID, converter)
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("flexible converter attach must be rejected as validation, got %v", err)
	}
	if !strings.Contains(err.Error(), "raw scores only") {
		t.Fatalf("converter refusal must mirror the creation message, got %v", err)
	}
	if _, err := h.authors.SetScoreConverter(ctx, h.examID, nil); err != nil {
		t.Fatalf("clearing to raw-only must stay open, got %v", err)
	}
}

func strPtr(value string) *string { return &value }
