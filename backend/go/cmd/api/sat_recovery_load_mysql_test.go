package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

type satRecoveryLoadQuestion struct {
	QuestionID   string `json:"questionId"`
	Answer       string `json:"answer"`
	FrozenAnswer string `json:"frozenAnswer"`
}

type satRecoveryLoadCredential struct {
	ScheduleID                    string                    `json:"scheduleId"`
	AttemptID                     string                    `json:"attemptId"`
	Token                         string                    `json:"token"`
	ModuleID                      string                    `json:"moduleId"`
	ModuleAttemptID               string                    `json:"moduleAttemptId"`
	ExpectedNextModuleID          string                    `json:"expectedNextModuleId"`
	ExpectedUnchangedNextModuleID string                    `json:"expectedUnchangedNextModuleId"`
	Questions                     []satRecoveryLoadQuestion `json:"questions"`
}

type satRecoveryLoadCandidate struct {
	credential satRecoveryLoadCredential
	studentKey string
	userID     string
	sessionID  string
	tokenID    string
}

type satRecoveryStatementStat struct {
	count     uint64
	totalPS   uint64
	lockPS    uint64
	statement string
}

var satRecoveryMySQLStatusNames = []string{
	"Innodb_buffer_pool_reads",
	"Innodb_buffer_pool_read_requests",
	"Innodb_buffer_pool_wait_free",
	"Innodb_data_fsyncs",
	"Innodb_log_waits",
	"Innodb_log_write_requests",
	"Innodb_log_writes",
	"Innodb_os_log_fsyncs",
	"Innodb_os_log_written",
	"Innodb_row_lock_time",
	"Innodb_row_lock_waits",
}

type satRecoveryLoadFixture struct {
	db               *sql.DB
	examID           string
	scheduleID       string
	baseModuleID     string
	lowerModuleID    string
	higherModuleID   string
	studentKeyPrefix string
	userEmailPrefix  string
	credentials      []satRecoveryLoadCredential
}

func seedSATRecoveryLoadFixture(t *testing.T, count, roomCount int) satRecoveryLoadFixture {
	t.Helper()
	db := staleETagTestDB(t)
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(8)
	apiPool, err := satRecoveryK6APIPoolSize(t)
	if err != nil {
		t.Fatal(err)
	}
	apiInstances, err := satRecoveryK6APIInstances(t)
	if err != nil {
		t.Fatal(err)
	}
	logAndValidateSATRecoveryK6MySQL(t, db, apiPool, apiInstances)
	scheduleID, sourceAttemptID, baseID, lowID, highID := seedStaleETagExam(t, db)
	var examID string
	if err := db.QueryRow(`SELECT exam_id FROM student_attempts WHERE id = ?`, sourceAttemptID).Scan(&examID); err != nil {
		t.Fatal(err)
	}
	runID := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	studentKeyPrefix := "sat-load-" + runID + "-"
	userEmailPrefix := "sat-recovery-" + runID + "-"
	// Delete through the production purge boundary. The exercise writes
	// immutable terminalization receipts, so direct test-row deletes are invalid.
	t.Cleanup(func() {
		if err := exams.NewService(db, tx.NewRunner(db)).Delete(context.Background(), examID); err != nil {
			t.Errorf("purge synthetic SAT load exam: %v", err)
		}
		if _, err := db.Exec(`DELETE FROM users WHERE email LIKE ?`, userEmailPrefix+"%@example.test"); err != nil {
			t.Errorf("delete synthetic SAT load users: %v", err)
		}
	})

	roomScheduleIDs := []string{scheduleID}
	for i := 1; i < roomCount; i++ {
		id := uuid.NewString()
		if _, err := db.Exec(`
			INSERT INTO exam_schedules (
				id, exam_id, provider_key, organization_id, exam_title, proctor_display_name,
				grading_display_name, published_version_id, cohort_name, institution,
				start_time, end_time, planned_duration_minutes, delivery_mode, status, created_by,
				sat_timing_model, sat_delivery_policy
			)
			SELECT ?, exam_id, provider_key, organization_id, exam_title, proctor_display_name,
				grading_display_name, published_version_id, ?, institution,
				start_time, end_time, planned_duration_minutes, delivery_mode, status, created_by,
				'sat_personal_v1', NULL
			FROM exam_schedules WHERE id = ?`, id, fmt.Sprintf("SAT recovery load room %d", i+1), scheduleID); err != nil {
			t.Fatalf("create synthetic room %d: %v", i+1, err)
		}
		if _, err := db.Exec(`
			INSERT INTO exam_session_runtimes (id, schedule_id, exam_id, provider_key, status, plan_snapshot, timing_model)
			SELECT ?, id, exam_id, 'sat', 'live', '{}', 'sat_personal_v1'
			FROM exam_schedules WHERE id = ?`, uuid.NewString(), id); err != nil {
			t.Fatalf("create synthetic room runtime %d: %v", i+1, err)
		}
		roomScheduleIDs = append(roomScheduleIDs, id)
	}

	var questions []string
	rows, err := db.Query(`SELECT id FROM assessment_exam_questions WHERE module_id = ? ORDER BY display_order LIMIT 2`, baseID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		questions = append(questions, id)
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	if len(questions) != 2 {
		t.Fatalf("recovery fixture needs two Module 1 questions, got %d", len(questions))
	}
	credentials, err := seedSATRecoveryLoadCohort(t, db, roomScheduleIDs, sourceAttemptID, baseID, lowID, highID, questions, count, studentKeyPrefix, userEmailPrefix)
	if err != nil {
		t.Fatal(err)
	}
	policy := `{"version":"sat_recovery_v1","recoverySeconds":120,"entryRecoverySeconds":120,"lateAnswerPolicy":"frozen_arrival_window"}`
	// Seed module attempts before enabling the writer fence; policy-enabled
	// schedules intentionally reject direct creation of active module rows.
	if _, err := db.Exec(`UPDATE exam_schedules SET sat_timing_model = 'sat_personal_v1', sat_delivery_policy = CAST(? AS JSON) WHERE exam_id = ?`, policy, examID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE exam_session_runtimes SET timing_model = 'sat_personal_v1' WHERE schedule_id IN (SELECT id FROM exam_schedules WHERE exam_id = ?)`, examID); err != nil {
		t.Fatal(err)
	}
	return satRecoveryLoadFixture{
		db: db, examID: examID, scheduleID: scheduleID,
		baseModuleID: baseID, lowerModuleID: lowID, higherModuleID: highID,
		studentKeyPrefix: studentKeyPrefix, userEmailPrefix: userEmailPrefix,
		credentials: credentials,
	}
}

func seedSATRecoveryWorkingBoundaries(t *testing.T, db *sql.DB, studentKeyPrefix, moduleID string, count int) {
	t.Helper()
	result, err := db.Exec(`
		INSERT INTO assessment_module_boundaries (
			module_attempt_id, attempt_id, phase, policy_version, work_deadline_at,
			entry_deadline_at, recovery_deadline_at, next_action_at
		)
		SELECT ma.id, ma.attempt_id, 'working', 'sat_recovery_v1',
			TIMESTAMPADD(SECOND, ma.allocated_seconds + ma.extension_seconds + ma.accumulated_paused_seconds, ma.started_at),
			NULL,
			TIMESTAMPADD(SECOND, ma.allocated_seconds + ma.extension_seconds + ma.accumulated_paused_seconds + 120, ma.started_at),
			TIMESTAMPADD(SECOND, ma.allocated_seconds + ma.extension_seconds + ma.accumulated_paused_seconds, ma.started_at)
		FROM assessment_module_attempts ma
		JOIN student_attempts a ON a.id = ma.attempt_id
		WHERE a.student_key LIKE ? AND ma.module_id = ?`, studentKeyPrefix+"%", moduleID)
	if err != nil {
		t.Fatalf("seed active SAT recovery boundaries: %v", err)
	}
	if inserted, err := result.RowsAffected(); err != nil || inserted != int64(count) {
		t.Fatalf("seed active SAT recovery boundaries: inserted=%d want=%d err=%v", inserted, count, err)
	}
}

func setSATRecoveryLoadSessionMode(t *testing.T, fixture satRecoveryLoadFixture, mode string) {
	t.Helper()
	if mode != "practice" && mode != "classroom" {
		t.Fatalf("SAT session mode must be practice or classroom, got %q", mode)
	}
	if _, err := fixture.db.Exec(`UPDATE exam_schedules SET sat_session_mode = ? WHERE exam_id = ?`, mode, fixture.examID); err != nil {
		t.Fatalf("set synthetic SAT session mode to %s: %v", mode, err)
	}
}

func satK6SessionMode(t *testing.T, key string) string {
	t.Helper()
	mode := strings.TrimSpace(os.Getenv(key))
	if mode == "" {
		mode = "practice"
	}
	if mode != "practice" && mode != "classroom" {
		t.Fatalf("%s must be practice or classroom", key)
	}
	return mode
}

// extraEnv adds API process settings (for example ROW_FIRST_WRITES) on top of
// the load defaults.
func startSATRecoveryK6Proxy(t *testing.T, count int, extraEnv ...map[string]string) (string, []string, []*exec.Cmd) {
	t.Helper()
	maxLimiterKeys := max(count, 2000)
	apiPool, err := satRecoveryK6APIPoolSize(t)
	if err != nil {
		t.Fatal(err)
	}
	apiInstances, err := satRecoveryK6APIInstances(t)
	if err != nil {
		t.Fatal(err)
	}
	apiEnv := map[string]string{
		// This process binds only an ephemeral localhost test port; exposing
		// metrics here lets the diagnostic capture its own admission histogram.
		"METRICS_PUBLIC":           "1",
		"RATE_LIMIT_MAX_KEYS":      strconv.Itoa(maxLimiterKeys),
		"SAT_RECOVERY_K6_USERS":    strconv.Itoa(count),
		"SAT_RECOVERY_K6_API_POOL": strconv.Itoa(apiPool),
	}
	for _, env := range extraEnv {
		for key, value := range env {
			apiEnv[key] = value
		}
	}
	apiURLs := make([]string, 0, apiInstances)
	apis := make([]*exec.Cmd, 0, apiInstances)
	for i := 0; i < apiInstances; i++ {
		api, apiURL := startBoundaryAPIWithEnv(t, false, apiEnv)
		apis = append(apis, api)
		apiURLs = append(apiURLs, apiURL)
	}
	var next atomic.Uint64
	proxies := make([]*httputil.ReverseProxy, 0, len(apiURLs))
	// Keep the local proxy above the VU count; application DB pools and SAT
	// close admission are the intended backpressure measurements.
	transport := &http.Transport{
		MaxIdleConns:        count * len(apiURLs),
		MaxIdleConnsPerHost: count,
		MaxConnsPerHost:     count,
		IdleConnTimeout:     90 * time.Second,
	}
	t.Cleanup(transport.CloseIdleConnections)
	for _, apiURL := range apiURLs {
		target, err := url.Parse(apiURL)
		if err != nil {
			t.Fatal(err)
		}
		upstream := httputil.NewSingleHostReverseProxy(target)
		upstream.Transport = transport
		proxies = append(proxies, upstream)
	}
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxies[int(next.Add(1)-1)%len(proxies)].ServeHTTP(w, r)
	}))
	t.Cleanup(proxy.Close)
	return proxy.URL, apiURLs, apis
}

func satRecoveryK6APIPoolSize(t *testing.T) (int, error) {
	t.Helper()
	apiPool := strings.TrimSpace(os.Getenv("SAT_RECOVERY_K6_API_POOL"))
	if apiPool == "" {
		return 100, nil
	}
	value, err := strconv.Atoi(apiPool)
	if err != nil || value < 1 || value > 200 {
		return 0, fmt.Errorf("SAT_RECOVERY_K6_API_POOL must be from 1 through 200")
	}
	return value, nil
}

func satRecoveryK6APIInstances(t *testing.T) (int, error) {
	t.Helper()
	raw := strings.TrimSpace(os.Getenv("SAT_K6_API_INSTANCES"))
	if raw == "" {
		return 2, nil
	}
	instances, err := strconv.Atoi(raw)
	if err != nil || instances < 1 || instances > 8 {
		return 0, fmt.Errorf("SAT_K6_API_INSTANCES must be from 1 through 8")
	}
	return instances, nil
}

func logAndValidateSATRecoveryK6MySQL(t *testing.T, db *sql.DB, apiPool, apiInstances int) {
	t.Helper()
	var version string
	var maxConnections int
	var bufferPoolBytes int64
	var flushAtCommit int
	if err := db.QueryRow(`SELECT VERSION(), @@GLOBAL.max_connections, @@GLOBAL.innodb_buffer_pool_size, @@GLOBAL.innodb_flush_log_at_trx_commit`).Scan(
		&version, &maxConnections, &bufferPoolBytes, &flushAtCommit,
	); err != nil {
		t.Fatalf("read SAT load MySQL capacity/profile: %v", err)
	}
	t.Logf("SAT load MySQL profile: version=%s max_connections=%d api_instances=%d api_pool=%d innodb_buffer_pool_bytes=%d innodb_flush_log_at_trx_commit=%d", version, maxConnections, apiInstances, apiPool, bufferPoolBytes, flushAtCommit)
	if err := satRecoveryK6ConnectionCapacityError(maxConnections, apiPool, apiInstances); err != nil {
		t.Fatal(err)
	}
}

func satRecoveryK6ConnectionCapacityError(maxConnections, apiPool, apiInstances int) error {
	requiredConnections := apiInstances*apiPool + 8 // API pools plus fixture/verification headroom
	if maxConnections < requiredConnections {
		return fmt.Errorf("SAT load MySQL max_connections=%d is below the required %d for %d API pools of %d plus fixture/verification headroom; increase the isolated server limit or lower SAT_RECOVERY_K6_API_POOL", maxConnections, requiredConnections, apiInstances, apiPool)
	}
	return nil
}

func TestSATRecoveryK6ConnectionCapacity(t *testing.T) {
	for _, tc := range []struct {
		name           string
		maxConnections int
		apiPool        int
		apiInstances   int
		wantError      bool
	}{
		{name: "rejects undersized local server", maxConnections: 120, apiPool: 100, apiInstances: 2, wantError: true},
		{name: "accepts required headroom", maxConnections: 208, apiPool: 100, apiInstances: 2},
		{name: "accepts smaller API pools", maxConnections: 48, apiPool: 20, apiInstances: 2},
		{name: "rejects server one below requirement", maxConnections: 47, apiPool: 20, apiInstances: 2, wantError: true},
		{name: "accepts two larger API pools", maxConnections: 408, apiPool: 200, apiInstances: 2},
		{name: "rejects server below two larger API pools", maxConnections: 407, apiPool: 200, apiInstances: 2, wantError: true},
		{name: "accounts for four API pools", maxConnections: 408, apiPool: 100, apiInstances: 4},
		{name: "rejects server below four-pool requirement", maxConnections: 407, apiPool: 100, apiInstances: 4, wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := satRecoveryK6ConnectionCapacityError(tc.maxConnections, tc.apiPool, tc.apiInstances)
			if (err != nil) != tc.wantError {
				t.Fatalf("capacity check err=%v wantError=%v", err, tc.wantError)
			}
		})
	}
}

func runSATRecoveryK6(t *testing.T, script string, timeout time.Duration, env map[string]string, apis []*exec.Cmd) {
	t.Helper()
	if _, err := exec.LookPath("k6"); err != nil {
		t.Fatalf("k6 is required for this opt-in MySQL E2E diagnostic: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "k6", "run", "--quiet", "--no-color", script)
	cmd.Env = withTestEnv(os.Environ(), env)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Errorf("%s failed: %v\n%s", filepath.Base(script), err, satRecoveryLoadOutputTail(output))
		for i, api := range apis {
			if logs, ok := api.Stderr.(*boundedTailBuffer); ok {
				t.Logf("API process %d stderr tail:\n%s", i+1, logs.String())
			}
		}
	} else {
		t.Logf("%s output:\n%s", filepath.Base(script), output)
	}
}

func satLifecycleStateFingerprint(db *sql.DB, studentKeyPrefix string) (string, error) {
	rows, err := db.Query(`
		SELECT entity, entity_id, projection FROM (
			SELECT 'attempt' AS entity, a.id AS entity_id,
				CONCAT_WS('|', a.revision, a.control_epoch, a.response_revision, a.delivery_status, a.current_module) AS projection
			FROM student_attempts a WHERE a.student_key LIKE ?
			UNION ALL
			SELECT 'module' AS entity, ma.id AS entity_id,
				CONCAT_WS('|', ma.module_id, ma.state, COALESCE(DATE_FORMAT(ma.started_at, '%Y-%m-%d %H:%i:%s.%f'), ''),
					ma.allocated_seconds, ma.extension_seconds, ma.accumulated_paused_seconds, ma.revision) AS projection
			FROM assessment_module_attempts ma JOIN student_attempts a ON a.id = ma.attempt_id WHERE a.student_key LIKE ?
			UNION ALL
			SELECT 'boundary' AS entity, b.module_attempt_id AS entity_id,
				CONCAT_WS('|', b.phase, b.policy_version,
					COALESCE(DATE_FORMAT(b.work_deadline_at, '%Y-%m-%d %H:%i:%s.%f'), ''),
					COALESCE(DATE_FORMAT(b.entry_deadline_at, '%Y-%m-%d %H:%i:%s.%f'), ''),
					COALESCE(DATE_FORMAT(b.recovery_deadline_at, '%Y-%m-%d %H:%i:%s.%f'), ''),
					COALESCE(DATE_FORMAT(b.next_action_at, '%Y-%m-%d %H:%i:%s.%f'), ''), b.revision) AS projection
			FROM assessment_module_boundaries b JOIN student_attempts a ON a.id = b.attempt_id WHERE a.student_key LIKE ?
			UNION ALL
			SELECT 'session' AS entity, s.id AS entity_id,
				CONCAT_WS('|', s.client_session_id, s.token_id, COALESCE(DATE_FORMAT(s.expires_at, '%Y-%m-%d %H:%i:%s.%f'), '')) AS projection
			FROM attempt_sessions s JOIN student_attempts a ON a.id = s.attempt_id WHERE a.student_key LIKE ?
		) state_rows ORDER BY entity, entity_id`,
		studentKeyPrefix+"%", studentKeyPrefix+"%", studentKeyPrefix+"%", studentKeyPrefix+"%")
	if err != nil {
		return "", err
	}
	defer rows.Close()
	hash := sha256.New()
	for rows.Next() {
		var entity, id, projection string
		if err := rows.Scan(&entity, &id, &projection); err != nil {
			return "", err
		}
		_, _ = fmt.Fprintf(hash, "%s\x00%s\x00%s\n", entity, id, projection)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

// This opt-in qualification runs the production recovery-close k6 protocol
// against local API processes and isolated MySQL. It needs an explicitly
// requested synthetic cohort because it performs thousands of real writes.
// It is a local baseline, not a production-capacity certification.
func TestSATRecoveryCloseK6LoadWaveMySQL(t *testing.T) {
	count, err := strconv.Atoi(os.Getenv("SAT_RECOVERY_K6_USERS"))
	if os.Getenv("SAT_RECOVERY_K6_USERS") == "" {
		t.Skip("set SAT_RECOVERY_K6_USERS to a value from 1 through 2000 to run the synthetic recovery load qualification")
	}
	if err != nil || count < 1 || count > 2000 {
		t.Fatal("SAT_RECOVERY_K6_USERS must be from 1 through 2000")
	}
	waveDelaySeconds := 120
	if raw := os.Getenv("SAT_RECOVERY_K6_WAVE_DELAY_SECONDS"); raw != "" {
		waveDelaySeconds, err = strconv.Atoi(raw)
		if err != nil || waveDelaySeconds < 1 || waveDelaySeconds > 600 {
			t.Fatal("SAT_RECOVERY_K6_WAVE_DELAY_SECONDS must be from 1 through 600")
		}
	}
	saveLeadMS := 60000
	if raw := os.Getenv("SAT_RECOVERY_K6_SAVE_LEAD_MS"); raw != "" {
		saveLeadMS, err = strconv.Atoi(raw)
		if err != nil || saveLeadMS < 250 || saveLeadMS > 60000 {
			t.Fatal("SAT_RECOVERY_K6_SAVE_LEAD_MS must be from 250 through 60000")
		}
	}
	if waveDelaySeconds*1000 < saveLeadMS+5000 {
		t.Fatal("the wave delay must leave at least five seconds beyond the save lead")
	}
	maxSaveSpreadMS := max(0, saveLeadMS-1000)
	saveSpreadMS := min(maxSaveSpreadMS, 10000)
	if raw := strings.TrimSpace(os.Getenv("SAT_RECOVERY_K6_SAVE_SPREAD_MS")); raw != "" {
		saveSpreadMS, err = strconv.Atoi(raw)
		if err != nil || saveSpreadMS < 0 || saveSpreadMS > maxSaveSpreadMS {
			t.Fatal("SAT_RECOVERY_K6_SAVE_SPREAD_MS must leave at least one second before the deadline")
		}
	}
	closeJitterMS := 2000
	if raw := strings.TrimSpace(os.Getenv("SAT_RECOVERY_K6_CLOSE_JITTER_MS")); raw != "" {
		closeJitterMS, err = strconv.Atoi(raw)
		if err != nil || closeJitterMS < 0 || closeJitterMS > 10000 {
			t.Fatal("SAT_RECOVERY_K6_CLOSE_JITTER_MS must be from 0 through 10000")
		}
	}
	rooms := 1
	if raw := os.Getenv("SAT_RECOVERY_K6_ROOMS"); raw != "" {
		rooms, err = strconv.Atoi(raw)
		if err != nil || rooms < 1 || rooms > count {
			t.Fatal("SAT_RECOVERY_K6_ROOMS must be between 1 and SAT_RECOVERY_K6_USERS")
		}
	}
	entryDelaySeconds := os.Getenv("SAT_RECOVERY_K6_ENTRY_DELAY_SECONDS")
	if entryDelaySeconds == "" {
		// Keep the default delayed-entry cohort safely inside the 120-second
		// window; cutoff-expiry behavior has its own dedicated E2E scenario.
		entryDelaySeconds = "60"
	}
	if delay, parseErr := strconv.Atoi(entryDelaySeconds); parseErr != nil || delay < 0 || delay >= 120 {
		t.Fatal("SAT_RECOVERY_K6_ENTRY_DELAY_SECONDS must be from 0 through 119")
	}
	offlinePercent := os.Getenv("SAT_RECOVERY_K6_OFFLINE_PERCENT")
	if offlinePercent == "" {
		offlinePercent = "20"
	}
	offlineDelaySeconds := os.Getenv("SAT_RECOVERY_K6_OFFLINE_DELAY_SECONDS")
	if offlineDelaySeconds == "" {
		offlineDelaySeconds = "45"
	}
	entryDelayPercent := os.Getenv("SAT_RECOVERY_K6_ENTRY_DELAY_PERCENT")
	if entryDelayPercent == "" {
		entryDelayPercent = "1"
	}
	finalEditPercent := os.Getenv("SAT_RECOVERY_K6_FINAL_EDIT_PERCENT")
	if finalEditPercent == "" {
		finalEditPercent = "10"
	}
	closeReplayPercent := strings.TrimSpace(os.Getenv("SAT_RECOVERY_K6_CLOSE_REPLAY_PERCENT"))
	if closeReplayPercent == "" {
		// Small smoke waves replay every committed close. At scale, the default
		// models a small ambiguous-ack cohort; use 100 for a separate replay flood.
		if count <= 10 {
			closeReplayPercent = "100"
		} else {
			closeReplayPercent = "1"
		}
	}
	closeReplayPercentValue, parseErr := strconv.Atoi(closeReplayPercent)
	if parseErr != nil || closeReplayPercentValue < 0 || closeReplayPercentValue > 100 {
		t.Fatal("SAT_RECOVERY_K6_CLOSE_REPLAY_PERCENT must be from 0 through 100")
	}
	offlinePercentValue, parseErr := strconv.ParseFloat(offlinePercent, 64)
	if parseErr != nil || math.IsNaN(offlinePercentValue) || math.IsInf(offlinePercentValue, 0) || offlinePercentValue < 0 || offlinePercentValue > 100 {
		t.Fatal("SAT_RECOVERY_K6_OFFLINE_PERCENT must be from 0 through 100")
	}
	entryDelayPercentValue, parseErr := strconv.ParseFloat(entryDelayPercent, 64)
	if parseErr != nil || math.IsNaN(entryDelayPercentValue) || math.IsInf(entryDelayPercentValue, 0) || entryDelayPercentValue < 0 || entryDelayPercentValue > 100 {
		t.Fatal("SAT_RECOVERY_K6_ENTRY_DELAY_PERCENT must be from 0 through 100")
	}
	finalEditPercentValue, parseErr := strconv.ParseFloat(finalEditPercent, 64)
	if parseErr != nil || math.IsNaN(finalEditPercentValue) || math.IsInf(finalEditPercentValue, 0) || finalEditPercentValue < 0 || finalEditPercentValue > 100 {
		t.Fatal("SAT_RECOVERY_K6_FINAL_EDIT_PERCENT must be from 0 through 100")
	}
	offlineCount := int(float64(count) * offlinePercentValue / 100)
	entryDelayCount := int(float64(count) * entryDelayPercentValue / 100)
	if offlineCount+entryDelayCount > count {
		t.Fatal("offline and entry-delay cohorts must not exceed SAT_RECOVERY_K6_USERS")
	}
	finalEditCount := int(float64(count-offlineCount-entryDelayCount) * finalEditPercentValue / 100)
	if offlineCount+entryDelayCount+finalEditCount > count {
		t.Fatal("offline, entry-delay, and final-edit cohorts must not exceed SAT_RECOVERY_K6_USERS")
	}

	fixture := seedSATRecoveryLoadFixture(t, count, rooms)
	sessionMode := satK6SessionMode(t, "SAT_RECOVERY_K6_SESSION_MODE")
	setSATRecoveryLoadSessionMode(t, fixture, sessionMode)
	db, baseID, lowID, highID := fixture.db, fixture.baseModuleID, fixture.lowerModuleID, fixture.higherModuleID
	studentKeyPrefix, credentials := fixture.studentKeyPrefix, fixture.credentials
	proxyURL, apiURLs, apis := startSATRecoveryK6Proxy(t, count)

	var waveAt time.Time
	if err := db.QueryRow(`SELECT TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))`, waveDelaySeconds).Scan(&waveAt); err != nil {
		t.Fatal(err)
	}
	startedAt := waveAt.Add(-time.Hour)
	if _, err := db.Exec(`
		UPDATE assessment_module_attempts ma
		JOIN student_attempts a ON a.id = ma.attempt_id
		SET ma.started_at = ?
		WHERE a.student_key LIKE ? AND ma.module_id = ?`, startedAt, studentKeyPrefix+"%", baseID); err != nil {
		t.Fatal(err)
	}
	// These attempts are already active when the measured save/close wave
	// begins. Seed the durable boundary that the production module-start path
	// creates; leaving it absent would charge the close wave with a compatibility
	// insert that does not occur for normally admitted recovery-policy sessions.
	boundaryResult, err := db.Exec(`
		INSERT INTO assessment_module_boundaries (
			module_attempt_id, attempt_id, phase, policy_version, work_deadline_at,
			entry_deadline_at, recovery_deadline_at, next_action_at
		)
		SELECT ma.id, ma.attempt_id, 'working', 'sat_recovery_v1',
			TIMESTAMPADD(SECOND, ma.allocated_seconds + ma.extension_seconds + ma.accumulated_paused_seconds, ma.started_at),
			NULL,
			TIMESTAMPADD(SECOND, ma.allocated_seconds + ma.extension_seconds + ma.accumulated_paused_seconds + 120, ma.started_at),
			TIMESTAMPADD(SECOND, ma.allocated_seconds + ma.extension_seconds + ma.accumulated_paused_seconds, ma.started_at)
		FROM assessment_module_attempts ma
		JOIN student_attempts a ON a.id = ma.attempt_id
		WHERE a.student_key LIKE ? AND ma.module_id = ?`, studentKeyPrefix+"%", baseID)
	if err != nil {
		t.Fatalf("seed active SAT recovery boundaries: %v", err)
	}
	if inserted, err := boundaryResult.RowsAffected(); err != nil || inserted != int64(count) {
		t.Fatalf("seed active SAT recovery boundaries: inserted=%d want=%d err=%v", inserted, count, err)
	}
	var statementStatsBefore map[string]satRecoveryStatementStat
	var mysqlStatusBefore map[string]uint64
	if os.Getenv("SAT_RECOVERY_K6_SQL_PROFILE") == "1" {
		statementStatsBefore = satRecoveryStatementStats(db)
		mysqlStatusBefore = satRecoveryMySQLStatusStats(db)
	}

	fixturePath := filepath.Join(t.TempDir(), "sat-recovery-load-credentials.json")
	encoded, err := json.Marshal(credentials)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fixturePath, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	// Leave setup/summary headroom beyond k6's five-minute scenario limit; the
	// parent context starts before k6 initializes all virtual users.
	env := map[string]string{
		"K6_CONFIRM_SAT":              "true",
		"K6_BASE_URL":                 proxyURL,
		"K6_ATTEMPT_TOKENS_PATH":      fixturePath,
		"K6_VUS":                      strconv.Itoa(count),
		"K6_WAVE_AT_MS":               strconv.FormatInt(waveAt.UnixMilli(), 10),
		"K6_SAVE_LEAD_MS":             strconv.Itoa(saveLeadMS),
		"K6_SAVE_SPREAD_MS":           strconv.Itoa(saveSpreadMS),
		"K6_CLOSE_JITTER_MS":          strconv.Itoa(closeJitterMS),
		"K6_OFFLINE_PERCENT":          offlinePercent,
		"K6_OFFLINE_DELAY_SECONDS":    offlineDelaySeconds,
		"K6_ENTRY_DELAY_PERCENT":      entryDelayPercent,
		"K6_NEXT_ENTRY_DELAY_SECONDS": entryDelaySeconds,
		"K6_FINAL_EDIT_PERCENT":       finalEditPercent,
		"K6_RECOVERY_LIMIT_SECONDS":   "120",
		"K6_CLOSE_REPLAY_PERCENT":     closeReplayPercent,
	}
	poolStatsBefore := satRecoveryAPIPoolStats(t, apiURLs)
	runSATRecoveryK6(t, "../../../../k6/sat-recovery-close-2000.js", 8*time.Minute, env, apis)
	logSATTransitionServiceMetrics(t, apiURLs)
	poolStatsAfter := satRecoveryAPIPoolStats(t, apiURLs)
	logSATRecoveryAPIPoolStats(t, poolStatsBefore, poolStatsAfter)
	t.Logf("local SAT recovery k6 wave: users=%d rooms=%d session_mode=%s mysql=local api_instances=%d save_lead_ms=%d save_spread_ms=%d close_jitter_ms=%d entry_delay_seconds=%s final_edit_percent=%s final_edit_count=%d replay_percent=%s limiter_keys=%d", count, rooms, sessionMode, len(apis), saveLeadMS, saveSpreadMS, closeJitterMS, entryDelaySeconds, finalEditPercent, finalEditCount, closeReplayPercent, max(count, 2000))
	if statementStatsBefore != nil {
		t.Logf("MySQL statement profile for the load wave (largest cumulative waits):\n%s", formatSATRecoveryStatementStats(statementStatsBefore, satRecoveryStatementStats(db), 12))
	}
	if mysqlStatusBefore != nil {
		t.Logf("MySQL InnoDB status deltas for the load wave:\n%s", formatSATRecoveryMySQLStatusStats(mysqlStatusBefore, satRecoveryMySQLStatusStats(db)))
	}

	assertCount := func(label string, want int, query string, args ...any) {
		t.Helper()
		var got int
		if err := db.QueryRow(query, args...).Scan(&got); err != nil {
			t.Fatalf("verify %s: %v", label, err)
		}
		if got != want {
			t.Errorf("%s count=%d, want %d", label, got, want)
		}
	}
	pattern := studentKeyPrefix + "%"
	assertCount("frozen close registrations", offlineCount, `SELECT COUNT(*) FROM assessment_module_close_intents i JOIN student_attempts a ON a.id = i.attempt_id WHERE a.student_key LIKE ?`, pattern)
	assertCount("settled module boundaries", count, `SELECT COUNT(*) FROM assessment_module_boundaries b JOIN student_attempts a ON a.id = b.attempt_id WHERE a.student_key LIKE ? AND b.phase = 'settled'`, pattern)
	highRouteCount := offlineCount + finalEditCount
	lowRouteCount := count - highRouteCount
	assertCount("higher route decisions", highRouteCount, `SELECT COUNT(*) FROM assessment_route_decisions d JOIN student_attempts a ON a.id = d.attempt_id WHERE a.student_key LIKE ? AND d.selected_module_id = ?`, pattern, highID)
	assertCount("lower route decisions", lowRouteCount, `SELECT COUNT(*) FROM assessment_route_decisions d JOIN student_attempts a ON a.id = d.attempt_id WHERE a.student_key LIKE ? AND d.selected_module_id = ?`, pattern, lowID)
	assertCount("active next-module attempts", count, `SELECT COUNT(*) FROM assessment_module_attempts ma JOIN student_attempts a ON a.id = ma.attempt_id WHERE a.student_key LIKE ? AND ma.module_id IN (?, ?) AND ma.state = 'active' AND ma.started_at IS NOT NULL`, pattern, highID, lowID)
	assertCount("confirmed response projections", 2*count, `SELECT COUNT(*) FROM attempt_responses_v2 r JOIN student_attempts a ON a.id = r.attempt_id WHERE a.student_key LIKE ?`, pattern)
	assertCount("canonical frozen answers", 2*(offlineCount+finalEditCount), `SELECT COUNT(*) FROM attempt_responses_v2 r JOIN student_attempts a ON a.id = r.attempt_id WHERE a.student_key LIKE ? AND r.module_id = ? AND JSON_UNQUOTE(JSON_EXTRACT(r.response, '$.answer')) = 'B'`, pattern, baseID)
}

func logSATTransitionServiceMetrics(t *testing.T, apiURLs []string) {
	t.Helper()
	client := &http.Client{Timeout: 2 * time.Second}
	for i, apiURL := range apiURLs {
		response, err := client.Get(apiURL + "/metrics")
		if err != nil {
			t.Errorf("scrape SAT close-admission metrics from API %d: %v", i+1, err)
			continue
		}
		body, readErr := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if readErr != nil {
			t.Errorf("read SAT close-admission metrics from API %d: %v", i+1, readErr)
			continue
		}
		if response.StatusCode != http.StatusOK {
			t.Errorf("scrape SAT close-admission metrics from API %d: status=%d", i+1, response.StatusCode)
			continue
		}
		var admissionWait, transitionService, queryDuration, transactionDuration []string
		for _, line := range strings.Split(string(body), "\n") {
			if strings.HasPrefix(line, "sat_close_admission_wait_seconds") {
				admissionWait = append(admissionWait, line)
			}
			if strings.HasPrefix(line, "sat_transition_service_seconds") {
				transitionService = append(transitionService, line)
			}
			if strings.HasPrefix(line, telemetry.MTxDur) {
				transactionDuration = append(transactionDuration, line)
			}
			if strings.HasPrefix(line, telemetry.MQueryDur) {
				queryDuration = append(queryDuration, line)
			}
		}
		if len(admissionWait) == 0 {
			t.Logf("SAT close-admission wait histogram API %d: no queued requests", i+1)
		} else {
			t.Logf("SAT close-admission wait histogram API %d:\n%s", i+1, strings.Join(admissionWait, "\n"))
		}
		if len(transitionService) > 0 {
			t.Logf("SAT transition service histogram API %d:\n%s", i+1, strings.Join(transitionService, "\n"))
		}
		if len(transactionDuration) > 0 {
			t.Logf("Database transaction duration histogram API %d:\n%s", i+1, strings.Join(transactionDuration, "\n"))
		}
		if len(queryDuration) > 0 {
			t.Logf("Database query duration histogram API %d:\n%s", i+1, strings.Join(queryDuration, "\n"))
		}
	}
}

func TestSATModuleEntryK6LoadWaveMySQL(t *testing.T) {
	count, err := satK6UserCount(t, "SAT_ENTRY_K6_USERS")
	if err != nil || count == 0 {
		return
	}
	rooms := satK6Rooms(t, "SAT_ENTRY_K6_ROOMS", count)
	waveDelaySeconds := 120
	if raw := strings.TrimSpace(os.Getenv("SAT_ENTRY_K6_WAVE_DELAY_SECONDS")); raw != "" {
		waveDelaySeconds, err = strconv.Atoi(raw)
		if err != nil || waveDelaySeconds < 10 || waveDelaySeconds > 600 {
			t.Fatal("SAT_ENTRY_K6_WAVE_DELAY_SECONDS must be from 10 through 600")
		}
	}

	fixture := seedSATRecoveryLoadFixture(t, count, rooms)
	sessionMode := satK6SessionMode(t, "SAT_ENTRY_K6_SESSION_MODE")
	setSATRecoveryLoadSessionMode(t, fixture, sessionMode)
	db, prefix, baseModuleID := fixture.db, fixture.studentKeyPrefix, fixture.baseModuleID
	proxyURL, apiURLs, apis := startSATRecoveryK6Proxy(t, count)
	fixturePath := filepath.Join(t.TempDir(), "sat-entry-load-credentials.json")
	encoded, err := json.Marshal(fixture.credentials)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fixturePath, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	var waveAt time.Time
	if err := db.QueryRow(`SELECT TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))`, waveDelaySeconds).Scan(&waveAt); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		UPDATE assessment_module_attempts ma
		JOIN student_attempts a ON a.id = ma.attempt_id
		SET ma.state = 'not_started', ma.started_at = NULL
		WHERE a.student_key LIKE ? AND ma.module_id = ?`, prefix+"%", baseModuleID); err != nil {
		t.Fatalf("prepare unstarted SAT modules: %v", err)
	}
	result, err := db.Exec(`
		INSERT INTO assessment_module_boundaries (
			module_attempt_id, attempt_id, phase, policy_version, entry_deadline_at, next_action_at
		)
		SELECT ma.id, ma.attempt_id, 'preparing', 'sat_recovery_v1',
			TIMESTAMPADD(SECOND, 120, ?), TIMESTAMPADD(SECOND, 120, ?)
		FROM assessment_module_attempts ma
		JOIN student_attempts a ON a.id = ma.attempt_id
		WHERE a.student_key LIKE ? AND ma.module_id = ?`, waveAt, waveAt, prefix+"%", baseModuleID)
	if err != nil {
		t.Fatalf("seed SAT entry deadlines: %v", err)
	}
	if inserted, err := result.RowsAffected(); err != nil || inserted != int64(count) {
		t.Fatalf("seed SAT entry deadlines: inserted=%d want=%d err=%v", inserted, count, err)
	}

	poolBefore := satRecoveryAPIPoolStats(t, apiURLs)
	runSATRecoveryK6(t, "../../../../k6/sat-module-entry-2000.js", 8*time.Minute, map[string]string{
		"K6_CONFIRM_SAT":                   "true",
		"K6_BASE_URL":                      proxyURL,
		"K6_ATTEMPT_TOKENS_PATH":           fixturePath,
		"K6_ENTRY_MODULE_FROM_CREDENTIALS": "1",
		"K6_VUS":                           strconv.Itoa(count),
		"K6_MODE":                          "initial",
		"K6_WAVE_AT_MS":                    strconv.FormatInt(waveAt.UnixMilli(), 10),
	}, apis)
	poolAfter := satRecoveryAPIPoolStats(t, apiURLs)
	logSATRecoveryAPIPoolStats(t, poolBefore, poolAfter)
	t.Logf("local SAT module-entry k6 wave: users=%d rooms=%d session_mode=%s wave_delay_seconds=%d MySQL=local API_instances=2", count, rooms, sessionMode, waveDelaySeconds)

	pattern := prefix + "%"
	assertCount := func(label string, want int, query string, args ...any) {
		t.Helper()
		var got int
		if err := db.QueryRow(query, args...).Scan(&got); err != nil {
			t.Fatalf("verify %s: %v", label, err)
		}
		if got != want {
			t.Errorf("%s count=%d, want %d", label, got, want)
		}
	}
	assertCount("module attempts", count, `SELECT COUNT(*) FROM assessment_module_attempts ma JOIN student_attempts a ON a.id = ma.attempt_id WHERE a.student_key LIKE ?`, pattern)
	assertCount("entered active module attempts", count, `SELECT COUNT(*) FROM assessment_module_attempts ma JOIN student_attempts a ON a.id = ma.attempt_id WHERE a.student_key LIKE ? AND ma.module_id = ? AND ma.state = 'active' AND ma.started_at IS NOT NULL`, pattern, baseModuleID)
	assertCount("working entry boundaries", count, `SELECT COUNT(*) FROM assessment_module_boundaries b JOIN student_attempts a ON a.id = b.attempt_id WHERE a.student_key LIKE ? AND b.phase = 'working' AND b.entry_deadline_at IS NULL`, pattern)
	assertCount("unresolved entry boundaries", 0, `SELECT COUNT(*) FROM assessment_module_boundaries b JOIN student_attempts a ON a.id = b.attempt_id WHERE a.student_key LIKE ? AND b.phase <> 'working'`, pattern)
	assertCount("duplicate module attempts", 0, `SELECT COUNT(*) FROM (SELECT ma.attempt_id FROM assessment_module_attempts ma JOIN student_attempts a ON a.id = ma.attempt_id WHERE a.student_key LIKE ? GROUP BY ma.attempt_id HAVING COUNT(*) > 1) duplicates`, pattern)
	assertCount("route decisions before Module 1 completion", 0, `SELECT COUNT(*) FROM assessment_route_decisions d JOIN student_attempts a ON a.id = d.attempt_id WHERE a.student_key LIKE ?`, pattern)
	assertCount("response projections before Module 1 completion", 0, `SELECT COUNT(*) FROM attempt_responses_v2 r JOIN student_attempts a ON a.id = r.attempt_id WHERE a.student_key LIKE ?`, pattern)
	assertCount("module starts outside the 120-second entry window", 0, `SELECT COUNT(*) FROM assessment_module_attempts ma JOIN student_attempts a ON a.id = ma.attempt_id WHERE a.student_key LIKE ? AND (ma.started_at < TIMESTAMPADD(SECOND, -2, ?) OR ma.started_at >= TIMESTAMPADD(SECOND, 120, ?))`, pattern, waveAt, waveAt)
	assertCount("working boundaries with an incorrect work deadline", 0, `SELECT COUNT(*) FROM assessment_module_boundaries b JOIN assessment_module_attempts ma ON ma.id = b.module_attempt_id JOIN student_attempts a ON a.id = ma.attempt_id WHERE a.student_key LIKE ? AND b.phase = 'working' AND b.work_deadline_at <> TIMESTAMPADD(SECOND, ma.allocated_seconds + ma.extension_seconds + ma.accumulated_paused_seconds, ma.started_at)`, pattern)
}

func TestSATRecoveryLifecycleK6LoadWaveMySQL(t *testing.T) {
	count, err := satK6UserCount(t, "SAT_LIFECYCLE_K6_USERS")
	if err != nil || count == 0 {
		return
	}
	rooms := satK6Rooms(t, "SAT_LIFECYCLE_K6_ROOMS", count)
	duration := strings.TrimSpace(os.Getenv("SAT_LIFECYCLE_K6_DURATION"))
	if duration == "" {
		duration = "2m"
	}

	fixture := seedSATRecoveryLoadFixture(t, count, rooms)
	sessionMode := satK6SessionMode(t, "SAT_LIFECYCLE_K6_SESSION_MODE")
	setSATRecoveryLoadSessionMode(t, fixture, sessionMode)
	db, prefix := fixture.db, fixture.studentKeyPrefix
	seedSATRecoveryWorkingBoundaries(t, db, prefix, fixture.baseModuleID, count)
	before, err := satLifecycleStateFingerprint(db, prefix)
	if err != nil {
		t.Fatalf("fingerprint lifecycle state before load: %v", err)
	}
	proxyURL, apiURLs, apis := startSATRecoveryK6Proxy(t, count)
	fixturePath := filepath.Join(t.TempDir(), "sat-lifecycle-load-credentials.json")
	encoded, err := json.Marshal(fixture.credentials)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fixturePath, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	poolBefore := satRecoveryAPIPoolStats(t, apiURLs)
	runSATRecoveryK6(t, "../../../../k6/sat-recovery-lifecycle-2000.js", 8*time.Minute, map[string]string{
		"K6_CONFIRM_SAT":         "true",
		"K6_BASE_URL":            proxyURL,
		"K6_ATTEMPT_TOKENS_PATH": fixturePath,
		"K6_VUS":                 strconv.Itoa(count),
		"SAT_LIFECYCLE_DURATION": duration,
		"K6_POLL_MIN_SECONDS":    "10",
		"K6_POLL_MAX_SECONDS":    "20",
	}, apis)
	poolAfter := satRecoveryAPIPoolStats(t, apiURLs)
	logSATRecoveryAPIPoolStats(t, poolBefore, poolAfter)
	t.Logf("local SAT lifecycle k6 wave: users=%d rooms=%d session_mode=%s duration=%s MySQL=local API_instances=2", count, rooms, sessionMode, duration)

	pattern := prefix + "%"
	assertCount := func(label string, want int, query string, args ...any) {
		t.Helper()
		var got int
		if err := db.QueryRow(query, args...).Scan(&got); err != nil {
			t.Fatalf("verify %s: %v", label, err)
		}
		if got != want {
			t.Errorf("%s count=%d, want %d", label, got, want)
		}
	}
	assertCount("active lifecycle module attempts", count, `SELECT COUNT(*) FROM assessment_module_attempts ma JOIN student_attempts a ON a.id = ma.attempt_id WHERE a.student_key LIKE ? AND ma.module_id = ? AND ma.state = 'active' AND ma.started_at IS NOT NULL`, pattern, fixture.baseModuleID)
	assertCount("working lifecycle boundaries", count, `SELECT COUNT(*) FROM assessment_module_boundaries b JOIN student_attempts a ON a.id = b.attempt_id WHERE a.student_key LIKE ? AND b.phase = 'working' AND b.policy_version = 'sat_recovery_v1'`, pattern)
	assertCount("lifecycle response projections", 0, `SELECT COUNT(*) FROM attempt_responses_v2 r JOIN student_attempts a ON a.id = r.attempt_id WHERE a.student_key LIKE ?`, pattern)
	assertCount("lifecycle route decisions", 0, `SELECT COUNT(*) FROM assessment_route_decisions d JOIN student_attempts a ON a.id = d.attempt_id WHERE a.student_key LIKE ?`, pattern)
	assertCount("lifecycle close intents", 0, `SELECT COUNT(*) FROM assessment_module_close_intents i JOIN student_attempts a ON a.id = i.attempt_id WHERE a.student_key LIKE ?`, pattern)
	after, err := satLifecycleStateFingerprint(db, prefix)
	if err != nil {
		t.Fatalf("fingerprint lifecycle state after load: %v", err)
	}
	if after != before {
		t.Errorf("lifecycle polling changed synthetic attempt, module, boundary, or writer-session state: before=%s after=%s", before, after)
	}
}

func satK6UserCount(t *testing.T, key string) (int, error) {
	t.Helper()
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		t.Skip("set " + key + " to a value from 1 through 2000 to run this synthetic MySQL/k6 diagnostic")
		return 0, nil
	}
	count, err := strconv.Atoi(raw)
	if err != nil || count < 1 || count > 2000 {
		t.Fatalf("%s must be from 1 through 2000", key)
	}
	return count, nil
}

func satK6Rooms(t *testing.T, key string, count int) int {
	t.Helper()
	rooms := 1
	if raw := strings.TrimSpace(os.Getenv(key)); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > count {
			t.Fatalf("%s must be between 1 and the configured user count", key)
		}
		rooms = value
	}
	return rooms
}

func satRecoveryLoadOutputTail(output []byte) string {
	const maxOutputBytes = 12 * 1024
	if len(output) <= maxOutputBytes {
		return string(output)
	}
	return fmt.Sprintf("[k6 output truncated to its final %d bytes]\n%s", maxOutputBytes, output[len(output)-maxOutputBytes:])
}

func satRecoveryAPIPoolStats(t *testing.T, apiURLs []string) []sql.DBStats {
	t.Helper()
	client := &http.Client{Timeout: 2 * time.Second}
	stats := make([]sql.DBStats, 0, len(apiURLs))
	for i, apiURL := range apiURLs {
		resp, err := client.Get(apiURL + "/__test/db-pool-stats")
		if err != nil {
			t.Errorf("read API process %d DB pool stats: %v", i+1, err)
			continue
		}
		var snapshot sql.DBStats
		decodeErr := json.NewDecoder(resp.Body).Decode(&snapshot)
		closeErr := resp.Body.Close()
		if resp.StatusCode != http.StatusOK || decodeErr != nil || closeErr != nil {
			t.Errorf("read API process %d DB pool stats: status=%d decode=%v close=%v", i+1, resp.StatusCode, decodeErr, closeErr)
			continue
		}
		stats = append(stats, snapshot)
	}
	return stats
}

func logSATRecoveryAPIPoolStats(t *testing.T, before, after []sql.DBStats) {
	t.Helper()
	if len(before) != len(after) {
		t.Logf("API DB pool stats unavailable for a complete before/after comparison (before=%d after=%d)", len(before), len(after))
	}
	for i := 0; i < len(before) && i < len(after); i++ {
		waitCount := after[i].WaitCount - before[i].WaitCount
		waitDuration := after[i].WaitDuration - before[i].WaitDuration
		t.Logf("API DB pool process=%d max_open=%d final_open=%d final_in_use=%d wait_count_delta=%d wait_duration_delta=%s",
			i+1, after[i].MaxOpenConnections, after[i].OpenConnections, after[i].InUse, waitCount, waitDuration)
	}
}

func satRecoveryStatementStats(db *sql.DB) map[string]satRecoveryStatementStat {
	rows, err := db.Query(`
		SELECT DIGEST, COALESCE(DIGEST_TEXT, ''), COUNT_STAR, SUM_TIMER_WAIT, SUM_LOCK_TIME
		FROM performance_schema.events_statements_summary_by_digest
		WHERE SCHEMA_NAME = DATABASE() AND DIGEST IS NOT NULL`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	stats := make(map[string]satRecoveryStatementStat)
	for rows.Next() {
		var digest string
		var stat satRecoveryStatementStat
		if err := rows.Scan(&digest, &stat.statement, &stat.count, &stat.totalPS, &stat.lockPS); err != nil {
			return nil
		}
		stats[digest] = stat
	}
	if rows.Err() != nil {
		return nil
	}
	return stats
}

func formatSATRecoveryStatementStats(before, after map[string]satRecoveryStatementStat, limit int) string {
	if len(after) == 0 {
		return "unavailable (performance_schema statement digests are disabled or inaccessible)"
	}
	type delta struct{ stat satRecoveryStatementStat }
	var deltas []delta
	for digest, current := range after {
		prior := before[digest]
		if current.count < prior.count || current.totalPS < prior.totalPS || current.lockPS < prior.lockPS {
			prior = satRecoveryStatementStat{}
		}
		current.count -= prior.count
		current.totalPS -= prior.totalPS
		current.lockPS -= prior.lockPS
		if current.count > 0 {
			deltas = append(deltas, delta{stat: current})
		}
	}
	sort.Slice(deltas, func(i, j int) bool { return deltas[i].stat.totalPS > deltas[j].stat.totalPS })
	if len(deltas) > limit {
		deltas = deltas[:limit]
	}
	var out strings.Builder
	for _, item := range deltas {
		stat := item.stat
		fmt.Fprintf(&out, "count=%d total=%.1fms avg=%.2fms lock=%.1fms sql=%s\n",
			stat.count, float64(stat.totalPS)/1e9, float64(stat.totalPS)/1e9/float64(stat.count),
			float64(stat.lockPS)/1e9, stat.statement)
	}
	return strings.TrimSpace(out.String())
}

func satRecoveryMySQLStatusStats(db *sql.DB) map[string]uint64 {
	rows, err := db.Query("SHOW GLOBAL STATUS")
	if err != nil {
		return nil
	}
	defer rows.Close()
	wanted := make(map[string]struct{}, len(satRecoveryMySQLStatusNames))
	for _, name := range satRecoveryMySQLStatusNames {
		wanted[name] = struct{}{}
	}
	stats := make(map[string]uint64, len(wanted))
	for rows.Next() {
		var name, value string
		if err := rows.Scan(&name, &value); err != nil {
			return nil
		}
		if _, ok := wanted[name]; !ok {
			continue
		}
		parsed, err := strconv.ParseUint(strings.TrimSpace(value), 10, 64)
		if err != nil {
			continue
		}
		stats[name] = parsed
	}
	if rows.Err() != nil {
		return nil
	}
	return stats
}

func formatSATRecoveryMySQLStatusStats(before, after map[string]uint64) string {
	if len(after) == 0 {
		return "unavailable (SHOW GLOBAL STATUS is inaccessible or exposes no supported InnoDB counters)"
	}
	var out strings.Builder
	for _, name := range satRecoveryMySQLStatusNames {
		current, ok := after[name]
		if !ok {
			continue
		}
		prior := before[name]
		if current < prior {
			prior = 0 // The server restarted or the status counter reset during the wave.
		}
		fmt.Fprintf(&out, "%s=%d\n", name, current-prior)
	}
	return strings.TrimSpace(out.String())
}

func TestFormatSATRecoveryMySQLStatusStats(t *testing.T) {
	got := formatSATRecoveryMySQLStatusStats(
		map[string]uint64{"Innodb_data_fsyncs": 10, "Innodb_log_waits": 4},
		map[string]uint64{"Innodb_data_fsyncs": 15, "Innodb_log_waits": 1, "Innodb_os_log_fsyncs": 7},
	)
	want := "Innodb_data_fsyncs=5\nInnodb_log_waits=1\nInnodb_os_log_fsyncs=7"
	if got != want {
		t.Fatalf("formatted MySQL status delta = %q, want %q", got, want)
	}
	if got := formatSATRecoveryMySQLStatusStats(nil, nil); !strings.Contains(got, "unavailable") {
		t.Fatalf("empty status snapshot = %q, want an unavailable diagnostic", got)
	}
}

func seedSATRecoveryLoadCohort(
	t *testing.T,
	db *sql.DB,
	roomScheduleIDs []string,
	sourceAttemptID, baseModuleID, unchangedNextModuleID, editedNextModuleID string,
	questionIDs []string,
	count int,
	studentKeyPrefix, userEmailPrefix string,
) ([]satRecoveryLoadCredential, error) {
	t.Helper()
	ctx := context.Background()
	var organizationID sql.NullString
	var examID, versionID, examTitle string
	if err := db.QueryRowContext(ctx, `
		SELECT organization_id, exam_id, published_version_id, exam_title
		FROM student_attempts WHERE id = ?`, sourceAttemptID).
		Scan(&organizationID, &examID, &versionID, &examTitle); err != nil {
		return nil, fmt.Errorf("read SAT source attempt: %w", err)
	}
	var organizationArg any
	if organizationID.Valid {
		organizationArg = organizationID.String
	}

	candidates := make([]satRecoveryLoadCandidate, count)
	userRows := make([][]any, 0, count)
	attemptRows := make([][]any, 0, count)
	moduleRows := make([][]any, 0, count)
	sessionRows := make([][]any, 0, count)
	startedAt := time.Now().UTC()
	expiresAt := startedAt.Add(time.Hour)
	for i := range count {
		attemptID, userID, sessionRowID, clientSessionID, tokenID, moduleAttemptID :=
			uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
		scheduleID := roomScheduleIDs[i%len(roomScheduleIDs)]
		studentKey := studentKeyPrefix + fmt.Sprintf("%04d", i+1)
		email := userEmailPrefix + fmt.Sprintf("%04d@example.test", i+1)
		name := fmt.Sprintf("SAT Recovery Load %04d", i+1)
		wcode := "W" + strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
		candidates[i] = satRecoveryLoadCandidate{
			studentKey: studentKey,
			userID:     userID,
			sessionID:  clientSessionID,
			tokenID:    tokenID,
			credential: satRecoveryLoadCredential{
				ScheduleID: scheduleID, AttemptID: attemptID, ModuleID: baseModuleID,
				ModuleAttemptID: moduleAttemptID, ExpectedNextModuleID: editedNextModuleID,
				ExpectedUnchangedNextModuleID: unchangedNextModuleID,
				Questions: []satRecoveryLoadQuestion{
					{QuestionID: questionIDs[0], Answer: "A", FrozenAnswer: "B"},
					{QuestionID: questionIDs[1], Answer: "A", FrozenAnswer: "B"},
				},
			},
		}
		userRows = append(userRows, []any{userID, email, name, "student", "active"})
		attemptRows = append(attemptRows, []any{
			attemptID, scheduleID, studentKey, organizationArg, examID, versionID, examTitle,
			studentKey, name, email, "exam", "reading", `{}`, `{}`, `{}`, `[]`, `{}`, `{}`,
			0, 2, "running", 1, 1, 0, wcode, userID, clientSessionID,
		})
		moduleRows = append(moduleRows, []any{moduleAttemptID, attemptID, baseModuleID, "active", 3600, startedAt, `{}`, 1})
		sessionRows = append(sessionRows, []any{sessionRowID, userID, scheduleID, attemptID, clientSessionID, tokenID, expiresAt})
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err := insertSATLoadRows(ctx, tx, "users", []string{"id", "email", "display_name", "role", "state"}, userRows); err != nil {
		return nil, fmt.Errorf("insert synthetic users: %w", err)
	}
	if err := insertSATLoadRows(ctx, tx, "student_attempts", []string{
		"id", "schedule_id", "student_key", "organization_id", "exam_id", "published_version_id", "exam_title",
		"candidate_id", "candidate_name", "candidate_email", "phase", "current_module", "answers", "writing_answers",
		"flags", "violations_snapshot", "integrity", "recovery", "revision", "protocol_version", "delivery_status",
		"lease_epoch", "control_epoch", "response_revision", "wcode", "user_id", "active_client_session_id",
	}, attemptRows); err != nil {
		return nil, fmt.Errorf("insert synthetic attempts: %w", err)
	}
	if err := insertSATLoadRows(ctx, tx, "assessment_module_attempts", []string{
		"id", "attempt_id", "module_id", "state", "allocated_seconds", "started_at", "tool_state", "revision",
	}, moduleRows); err != nil {
		return nil, fmt.Errorf("insert synthetic Module 1 attempts: %w", err)
	}
	if err := insertSATLoadRows(ctx, tx, "attempt_sessions", []string{
		"id", "user_id", "schedule_id", "attempt_id", "client_session_id", "token_id", "expires_at",
	}, sessionRows); err != nil {
		return nil, fmt.Errorf("insert synthetic writer sessions: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	for i := range candidates {
		candidate := &candidates[i]
		lease := uint64(1)
		token, err := crypto.SignAttemptToken([]byte(submitTestSecret), crypto.AttemptClaims{
			TokenID: candidate.tokenID, UserID: candidate.userID, ScheduleID: candidate.credential.ScheduleID,
			AttemptID: candidate.credential.AttemptID, ClientSessionID: candidate.sessionID,
			LeaseEpoch: &lease, Exp: expiresAt.Unix(),
		})
		if err != nil {
			return nil, fmt.Errorf("sign synthetic attempt credential %d: %w", i+1, err)
		}
		candidate.credential.Token = token
	}
	credentials := make([]satRecoveryLoadCredential, len(candidates))
	for i := range candidates {
		credentials[i] = candidates[i].credential
	}
	return credentials, nil
}

func insertSATLoadRows(ctx context.Context, tx *sql.Tx, table string, columns []string, rows [][]any) error {
	const batchSize = 100
	for start := 0; start < len(rows); start += batchSize {
		end := min(start+batchSize, len(rows))
		var query strings.Builder
		query.WriteString("INSERT INTO ")
		query.WriteString(table)
		query.WriteString(" (")
		query.WriteString(strings.Join(columns, ", "))
		query.WriteString(") VALUES ")
		args := make([]any, 0, (end-start)*len(columns))
		for i := start; i < end; i++ {
			if i > start {
				query.WriteString(", ")
			}
			query.WriteString("(")
			for j := range columns {
				if j > 0 {
					query.WriteString(", ")
				}
				query.WriteByte('?')
			}
			query.WriteByte(')')
			args = append(args, rows[i]...)
		}
		if _, err := tx.ExecContext(ctx, query.String(), args...); err != nil {
			return err
		}
	}
	return nil
}

func withTestEnv(base []string, overrides map[string]string) []string {
	filtered := make([]string, 0, len(base)+len(overrides))
	for _, entry := range base {
		key, _, ok := strings.Cut(entry, "=")
		if !ok {
			filtered = append(filtered, entry)
			continue
		}
		if _, replace := overrides[key]; !replace {
			filtered = append(filtered, entry)
		}
	}
	for key, value := range overrides {
		filtered = append(filtered, key+"="+value)
	}
	return filtered
}
