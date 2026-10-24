package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/config"
	"github.com/google/uuid"
)

// TC-31 exercises the real deployment shape: two API binaries and two worker
// binaries share only MySQL. It drops committed wake-up hints, then verifies
// that either API can reconstruct the same lifecycle state from durable rows;
// duplicate hints must not change that state.
func TestSATRecoveryTwoAPITwoWorkerProcessesRecoverLostAndDuplicateHintsMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	db.SetMaxOpenConns(8)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	scheduleID, attemptID, baseModuleID, _, _ := seedStaleETagExam(t, db)
	userID := uuid.NewString()
	if _, err := db.ExecContext(ctx, `INSERT INTO users (id, email, display_name, role, state)
		VALUES (?, ?, 'SAT multi-process candidate', 'student', 'active')`, userID, userID+"@example.test"); err != nil {
		t.Fatalf("insert SAT candidate: %v", err)
	}
	t.Cleanup(func() {
		if _, err := db.ExecContext(context.Background(), `DELETE FROM attempt_sessions WHERE attempt_id = ?`, attemptID); err != nil {
			t.Errorf("delete SAT worker test attempt sessions: %v", err)
		}
		if _, err := db.ExecContext(context.Background(), `DELETE FROM users WHERE id = ?`, userID); err != nil {
			t.Errorf("delete SAT worker test candidate: %v", err)
		}
		if _, err := db.ExecContext(context.Background(), `DELETE FROM live_update_events WHERE event_target_id IN (?, ?)`, attemptID, scheduleID); err != nil {
			t.Errorf("delete SAT worker test live events: %v", err)
		}
	})

	policy := `{"version":"sat_recovery_v1","recoverySeconds":120,"entryRecoverySeconds":120,"lateAnswerPolicy":"frozen_arrival_window"}`
	if _, err := db.ExecContext(ctx, `UPDATE exam_schedules
		SET sat_timing_model = 'sat_personal_v1', sat_delivery_policy = CAST(? AS JSON)
		WHERE id = ?`, policy, scheduleID); err != nil {
		t.Fatalf("enable SAT recovery policy: %v", err)
	}
	if _, err := db.ExecContext(ctx,
		`UPDATE exam_session_runtimes SET timing_model = 'sat_personal_v1' WHERE schedule_id = ?`, scheduleID); err != nil {
		t.Fatalf("enable SAT personal runtime: %v", err)
	}
	var moduleAttemptID string
	if err := db.QueryRowContext(ctx, `SELECT id FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?`, attemptID, baseModuleID).Scan(&moduleAttemptID); err != nil {
		t.Fatalf("read Module 1 attempt: %v", err)
	}
	workDeadline := time.Now().UTC().Add(-time.Hour)
	startedAt := workDeadline.Add(-time.Hour)
	recoveryDeadline := workDeadline.Add(120 * time.Second)
	if _, err := db.ExecContext(ctx, `UPDATE assessment_module_attempts SET started_at = ? WHERE id = ?`, startedAt, moduleAttemptID); err != nil {
		t.Fatalf("backdate Module 1 deadline: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO assessment_module_boundaries (
		module_attempt_id, attempt_id, phase, policy_version, work_deadline_at,
		entry_deadline_at, recovery_deadline_at, next_action_at
	) VALUES (?, ?, 'working', 'sat_recovery_v1', ?, NULL, ?, ?)
	ON DUPLICATE KEY UPDATE phase = VALUES(phase), policy_version = VALUES(policy_version),
		work_deadline_at = VALUES(work_deadline_at), entry_deadline_at = NULL,
		recovery_deadline_at = VALUES(recovery_deadline_at), next_action_at = VALUES(next_action_at)`,
		moduleAttemptID, attemptID, workDeadline, recoveryDeadline, workDeadline); err != nil {
		t.Fatalf("seed due SAT recovery boundary: %v", err)
	}

	const authSecret = "sat-multi-process-test-secret-with-32-bytes"
	cfg := config.Load()
	cfg.AuthSecret = authSecret
	leaseEpoch := uint64(1)
	token, _, err := auth.IssueAttemptToken(ctx, db, cfg, userID, scheduleID, attemptID, "sat-multi-process-session", nil, &leaseEpoch, time.Now().UTC())
	if err != nil {
		t.Fatalf("issue attempt token: %v", err)
	}

	binDir := t.TempDir()
	apiBin := filepath.Join(binDir, "api")
	workerBin := filepath.Join(binDir, "worker")
	buildSATProcessBinary(t, apiBin, ".")
	buildSATProcessBinary(t, workerBin, "../worker")
	baseEnv := withTestEnv(os.Environ(), map[string]string{
		"DATABASE_URL":                     os.Getenv("TEST_MYSQL_DSN"),
		"AUTH_SECRET":                      authSecret,
		"APP_ENV":                          "test",
		"ENVIRONMENT":                      "test",
		"COOKIE_SECURE":                    "false",
		"SESSION_COOKIE_NAME":              "session",
		"CSRF_COOKIE_NAME":                 "csrf",
		"SAT_CLASSROOM_ENABLED":            "true",
		"BACKGROUND_RUNTIME_MODE":          "continuous",
		"WORKER_FALLBACK_INTERVAL_SECS":    "60",
		"WORKER_MAINTENANCE_INTERVAL_SECS": "300",
	})
	apiBases := make([]string, 0, 2)
	for i := 0; i < 2; i++ {
		apiBases = append(apiBases, startSATRecoveryAPIProcess(t, apiBin, baseEnv))
	}
	for i := 0; i < 2; i++ {
		startSATRecoveryWorkerProcess(t, workerBin, baseEnv)
	}

	deadline := time.Now().Add(45 * time.Second)
	for {
		var phase string
		if err := db.QueryRowContext(ctx, `SELECT phase FROM assessment_module_boundaries WHERE module_attempt_id = ?`, moduleAttemptID).Scan(&phase); err != nil {
			t.Fatalf("read worker recovery phase: %v", err)
		}
		if phase == "blocked" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("two workers did not converge the expired recovery boundary; last phase=%q", phase)
		}
		time.Sleep(200 * time.Millisecond)
	}

	var hintCount, revision int64
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*), MAX(event_revision) FROM live_update_events
		WHERE event_name = 'sat_module_submitted' AND event_target_id IN (?, ?)`, attemptID, scheduleID).Scan(&hintCount, &revision); err != nil {
		t.Fatalf("read committed worker hints: %v", err)
	}
	if hintCount < 2 {
		t.Fatalf("worker transition wrote %d live hints, want an attempt and roster hint", hintCount)
	}
	// Simulate a notification transport loss after the authoritative worker commit.
	if _, err := db.ExecContext(ctx, `DELETE FROM live_update_events WHERE event_name = 'sat_module_submitted' AND event_target_id IN (?, ?)`, attemptID, scheduleID); err != nil {
		t.Fatalf("drop worker hints: %v", err)
	}
	stateA := readSATRecoveryLifecycleState(t, apiBases[0], scheduleID, token)
	stateB := readSATRecoveryLifecycleState(t, apiBases[1], scheduleID, token)
	if !reflect.DeepEqual(stateA, stateB) {
		t.Fatalf("API instances returned different lifecycle state after lost hints: api1=%v api2=%v", stateA, stateB)
	}
	if got := stateA[baseModuleID]; got != "active:blocked" {
		t.Fatalf("durable blocked Module 1 state = %q, want active:blocked", got)
	}
	if len(stateA) != 1 {
		t.Fatalf("lost hints exposed %d module attempts, want only the blocked Module 1 and no routed branch: %v", len(stateA), stateA)
	}

	// Re-publish two identical revision hints per target. They are invalidation
	// hints only, so fresh state from either stateless API must remain identical.
	origin := "sat-multibinary-duplicate-" + uuid.NewString()
	for i := 0; i < 2; i++ {
		for _, target := range []struct{ kind, id string }{
			{liveupdates.KindAttempt, attemptID},
			{liveupdates.KindScheduleRoster, scheduleID},
		} {
			if _, err := db.ExecContext(ctx, `INSERT INTO live_update_events
				(origin_instance_id, event_kind, event_target_id, event_revision, event_name, event_payload, created_at)
				VALUES (?, ?, ?, ?, 'sat_module_submitted', NULL, UTC_TIMESTAMP())`, origin, target.kind, target.id, revision); err != nil {
				t.Fatalf("insert duplicate live hint for %s: %v", target.kind, err)
			}
		}
	}
	stateA = readSATRecoveryLifecycleState(t, apiBases[0], scheduleID, token)
	stateB = readSATRecoveryLifecycleState(t, apiBases[1], scheduleID, token)
	if !reflect.DeepEqual(stateA, stateB) || !reflect.DeepEqual(stateA, map[string]string{baseModuleID: "active:blocked"}) {
		t.Fatalf("duplicate hints changed or split authoritative lifecycle state: api1=%v api2=%v", stateA, stateB)
	}
	var decisions, moduleAttempts, blockedBoundaries int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM assessment_route_decisions WHERE attempt_id = ?`, attemptID).Scan(&decisions); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id = ?`, attemptID).Scan(&moduleAttempts); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM assessment_module_boundaries WHERE attempt_id = ? AND phase = 'blocked'`, attemptID).Scan(&blockedBoundaries); err != nil {
		t.Fatal(err)
	}
	if decisions != 0 || moduleAttempts != 1 || blockedBoundaries != 1 {
		t.Fatalf("duplicate/lost hints changed durable outcomes: decisions=%d module_attempts=%d blocked_boundaries=%d", decisions, moduleAttempts, blockedBoundaries)
	}
}

func buildSATProcessBinary(t *testing.T, output, packagePath string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "go", "build", "-o", output, packagePath)
	outputBytes, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("build %s: %v\n%s", packagePath, err, outputBytes)
	}
}

func startSATRecoveryAPIProcess(t *testing.T, binary string, baseEnv []string) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	var logs boundedTailBuffer
	logs.maxBytes = 64 * 1024
	cmd := exec.Command(binary)
	cmd.Env = withTestEnv(baseEnv, map[string]string{"PORT": fmt.Sprint(port), "API_PORT": fmt.Sprint(port)})
	cmd.Stdout, cmd.Stderr = &logs, &logs
	if err := cmd.Start(); err != nil {
		t.Fatalf("start API process: %v", err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		if t.Failed() {
			t.Logf("API process %d log:\n%s", port, logs.String())
		}
	})
	base := fmt.Sprintf("http://127.0.0.1:%d", port)
	client := &http.Client{Timeout: 2 * time.Second}
	deadline := time.Now().Add(45 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := client.Get(base + "/healthz")
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return base
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("API process did not become healthy: %s", logs.String())
	return ""
}

func startSATRecoveryWorkerProcess(t *testing.T, binary string, env []string) {
	t.Helper()
	var logs boundedTailBuffer
	logs.maxBytes = 64 * 1024
	cmd := exec.Command(binary, "--sat-timeouts-only")
	cmd.Env = env
	cmd.Stdout, cmd.Stderr = &logs, &logs
	if err := cmd.Start(); err != nil {
		t.Fatalf("start worker process: %v", err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		if t.Failed() {
			t.Logf("worker process log:\n%s", logs.String())
		}
	})
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(logs.String(), "worker: starting job set=") {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("worker process did not start: %s", logs.String())
}

func readSATRecoveryLifecycleState(t *testing.T, base, scheduleID, token string) map[string]string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		base+"/api/v1/assessment-delivery/schedules/"+scheduleID+"/state", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("read lifecycle state from %s: %v", base, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read lifecycle response: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("lifecycle state status=%d body=%s", resp.StatusCode, body)
	}
	if got := resp.Header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("lifecycle cache-control=%q, want no-store", got)
	}
	var out delivery.Bootstrap
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("decode lifecycle state %s: %v; body=%s", base, err, body)
	}
	state := make(map[string]string, len(out.Attempt.ModuleAttempts))
	for _, module := range out.Attempt.ModuleAttempts {
		phase := "missing"
		if module.SATBoundary != nil {
			phase = module.SATBoundary.Phase
		}
		state[module.ModuleID] = module.State + ":" + phase
	}
	return state
}
