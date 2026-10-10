package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// SAT_CODE_LOAD_USERS=200, 600, or 2000 exercises a synchronized pre-registered
// HTTP wave. SAT_CODE_LOAD_RUNTIME=cold|warm selects the runtime profile.
// Set SAT_CODE_LOAD_STAGES=1 to print the low-cardinality stage histograms.
// This is a local API/DB qualification, not a production-capacity claim.
func TestSATStartCodeHTTPWaveMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	db.SetMaxOpenConns(32)
	db.SetMaxIdleConns(32)
	n := 2
	if raw := os.Getenv("SAT_CODE_LOAD_USERS"); raw != "" {
		var err error
		n, err = strconv.Atoi(raw)
		if err != nil || (n != 200 && n != 600 && n != 2000) {
			t.Fatal("SAT_CODE_LOAD_USERS must be 200, 600, or 2000")
		}
	}
	runtimeMode := os.Getenv("SAT_CODE_LOAD_RUNTIME")
	if runtimeMode == "" {
		runtimeMode = "cold"
	}
	if runtimeMode != "cold" && runtimeMode != "warm" {
		t.Fatal("SAT_CODE_LOAD_RUNTIME must be cold or warm")
	}
	now := time.Now().UTC()
	f := newCodeStartFixture(t, db, now.Add(-time.Minute), now.Add(2*time.Hour))
	code := f.code(t).Value
	warmup := 0
	if runtimeMode == "warm" {
		candidate := f.admit(t, "HTTP wave runtime warmup")
		if out, err := f.start(candidate, code); err != nil || out.Kind != "started" {
			t.Fatalf("warm runtime setup: response=%+v error=%v", out, err)
		}
		warmup = 1
	}
	tokens := make([]string, n)
	for i := range n {
		candidate := f.admit(t, "HTTP wave candidate")
		// Match the normal student-session bootstrap: the base module row is
		// present before the separate, synchronized start-code HTTP request.
		if err := f.app.Delivery.EnsureBaseModuleAttemptForSchedule(context.Background(), candidate.attemptID, f.scheduleID); err != nil {
			t.Fatalf("seed candidate base module: %v", err)
		}
		var user string
		if err := db.QueryRow("SELECT user_id FROM student_attempts WHERE id = ?", candidate.attemptID).Scan(&user); err != nil {
			t.Fatal(err)
		}
		lease := uint64(1)
		token, _, err := auth.IssueAttemptToken(context.Background(), db, f.app.Config, user, f.scheduleID, candidate.attemptID, candidate.session, nil, &lease, time.Now().UTC())
		if err != nil {
			t.Fatal(err)
		}
		tokens[i] = token
	}
	var mysqlVersion, isolation string
	var lockWaitTimeout int
	if err := db.QueryRow("SELECT VERSION(), @@transaction_isolation, @@innodb_lock_wait_timeout").Scan(&mysqlVersion, &isolation, &lockWaitTimeout); err != nil {
		t.Fatal(err)
	}
	rowLockStats := func() map[string]string {
		values := make(map[string]string, 3)
		rows, err := db.Query("SHOW GLOBAL STATUS WHERE Variable_name IN ('Innodb_row_lock_waits', 'Innodb_row_lock_time', 'Innodb_row_lock_time_max')")
		if err != nil {
			t.Logf("MySQL row-lock status unavailable: %v", err)
			return values
		}
		defer rows.Close()
		for rows.Next() {
			var name, value string
			if err := rows.Scan(&name, &value); err != nil {
				t.Logf("MySQL row-lock status scan failed: %v", err)
				return values
			}
			values[name] = value
		}
		return values
	}
	type statementStats struct {
		count uint64
		wait  uint64
		lock  uint64
	}
	slotStatementStats := func() statementStats {
		var stats statementStats
		err := db.QueryRow(`
			SELECT COALESCE(SUM(COUNT_STAR), 0),
			       COALESCE(SUM(SUM_TIMER_WAIT), 0),
			       COALESCE(SUM(SUM_LOCK_TIME), 0)
			FROM performance_schema.events_statements_summary_by_digest
			WHERE SCHEMA_NAME = DATABASE()
			  AND DIGEST_TEXT LIKE '%sat_start_code_reservation_slots%'
			  AND DIGEST_TEXT LIKE '%SKIP LOCKED%'`).Scan(&stats.count, &stats.wait, &stats.lock)
		if err != nil {
			t.Logf("MySQL slot-claim statement digest unavailable: %v", err)
		}
		return stats
	}
	slotsBefore := slotStatementStats()
	rowLocksBefore := rowLockStats()
	telemetry.ResetForTest(telemetry.DefaultRegistry)
	poolBefore := db.Stats()
	router := chi.NewRouter()
	router.Post("/api/v1/assessment-delivery/schedules/{scheduleID}/start-with-code", deliveryStartWithCodeHandler(f.app))
	server := httptest.NewServer(router)
	defer server.Close()
	client := &http.Client{Timeout: 90 * time.Second}
	failureClasses := make([]string, n)
	gate := make(chan struct{})
	latency := make([]time.Duration, n)
	errs := make([]error, n)
	type candidateTiming struct {
		endToEnd            time.Duration
		admission           time.Duration
		startWorker         time.Duration
		runtimeInitializer  time.Duration
		slotCapacity        time.Duration
		httpStatus          int
		outcome             string
		hasServerTiming     bool
		exposesServerTiming bool
	}
	candidateTimings := make([]candidateTiming, n)
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-gate
			began := time.Now()
			defer func() {
				candidateTimings[i].endToEnd = time.Since(began)
				latency[i] = candidateTimings[i].endToEnd
			}()
			request, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/assessment-delivery/schedules/"+f.scheduleID+"/start-with-code", strings.NewReader(fmt.Sprintf(`{"code":%q,"controlEpoch":0}`, code)))
			if err != nil {
				failureClasses[i] = "client"
				candidateTimings[i].outcome = "client_error"
				errs[i] = err
				return
			}
			request.Header.Set("Authorization", "Bearer "+tokens[i])
			request.Header.Set("Content-Type", "application/json")
			response, err := client.Do(request)
			if err != nil {
				failureClasses[i] = "transport"
				candidateTimings[i].outcome = "no_response"
				errs[i] = err
				return
			}
			defer response.Body.Close()
			candidateTimings[i].httpStatus = response.StatusCode
			candidateTimings[i].exposesServerTiming = response.Header.Get("Access-Control-Expose-Headers") == "Server-Timing"
			candidateTimings[i].admission, candidateTimings[i].startWorker,
				candidateTimings[i].runtimeInitializer, candidateTimings[i].slotCapacity,
				candidateTimings[i].hasServerTiming = parseSATStartCodeServerTiming(response.Header.Get("Server-Timing"))
			body, err := io.ReadAll(response.Body)
			if err != nil {
				failureClasses[i] = "transport"
				candidateTimings[i].outcome = "response_read_error"
				errs[i] = err
				return
			}
			if response.StatusCode != http.StatusOK {
				failureClasses[i] = startCodeHTTPFailureClass(response.StatusCode, string(body))
				candidateTimings[i].outcome = failureClasses[i]
				errs[i] = fmt.Errorf("status %d (%s): %s", response.StatusCode, failureClasses[i], body)
				return
			}
			var result delivery.SatCodeStartResponse
			if err := json.Unmarshal(body, &result); err != nil {
				failureClasses[i] = "invalid_response"
				candidateTimings[i].outcome = "invalid_response"
				errs[i] = err
				return
			}
			if result.Kind != "started" || result.Entry == nil || result.Entry.StartedAt == nil || result.Entry.SelectedSection == nil {
				failureClasses[i] = "invalid_response"
				candidateTimings[i].outcome = "invalid_response"
				errs[i] = fmt.Errorf("missing committed start or selected content")
				return
			}
			candidateTimings[i].outcome = result.Kind
		}(i)
	}
	waveStarted := time.Now()
	close(gate)
	wg.Wait()
	drain := time.Since(waveStarted)
	failures := 0
	classCounts := make(map[string]int)
	for i, err := range errs {
		if err != nil {
			failures++
			classCounts[failureClasses[i]]++
			if failures <= 5 {
				t.Log(err)
			}
		}
	}
	sortedLatency := append([]time.Duration(nil), latency...)
	sort.Slice(sortedLatency, func(i, j int) bool { return sortedLatency[i] < sortedLatency[j] })
	percentile := func(samples []time.Duration, percent int) time.Duration {
		if len(samples) == 0 {
			return 0
		}
		index := (len(samples)*percent+99)/100 - 1
		if index < 0 {
			index = 0
		}
		return samples[index]
	}
	admissionSamples := make([]time.Duration, 0, n)
	for _, sample := range candidateTimings {
		if sample.hasServerTiming {
			admissionSamples = append(admissionSamples, sample.admission)
		}
	}
	sort.Slice(admissionSamples, func(i, j int) bool { return admissionSamples[i] < admissionSamples[j] })
	admissionMax := time.Duration(0)
	if len(admissionSamples) > 0 {
		admissionMax = admissionSamples[len(admissionSamples)-1]
	}
	slotsAfter := slotStatementStats()
	rowLocksAfter := rowLockStats()
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	poolAfter := db.Stats()
	t.Logf("HTTP wave users=%d runtime=%s failures=%d classes=%v e2e_p50=%s e2e_p95=%s e2e_p99=%s e2e_max=%s drain=%s admission_samples=%d admission_wait_p50=%s admission_wait_p95=%s admission_wait_p99=%s admission_wait_max=%s mysql=%s isolation=%s innodb_lock_wait_timeout=%d pool_max=%d pool_wait_count_delta=%d pool_wait_duration_delta=%s cpu_count=%d go=%s heap_alloc_bytes=%d",
		n, runtimeMode, failures, classCounts, percentile(sortedLatency, 50), percentile(sortedLatency, 95), percentile(sortedLatency, 99), sortedLatency[len(sortedLatency)-1], drain,
		len(admissionSamples), percentile(admissionSamples, 50), percentile(admissionSamples, 95), percentile(admissionSamples, 99), admissionMax,
		mysqlVersion, isolation, lockWaitTimeout, poolBefore.MaxOpenConnections, poolAfter.WaitCount-poolBefore.WaitCount, poolAfter.WaitDuration-poolBefore.WaitDuration,
		runtime.NumCPU(), runtime.Version(), memory.HeapAlloc)
	for i, sample := range candidateTimings {
		if sample.httpStatus == 0 {
			continue
		}
		if !sample.exposesServerTiming {
			t.Errorf("candidate %d response does not expose Server-Timing to browser clients", i)
		}
		if !sample.hasServerTiming {
			t.Errorf("candidate %d response status=%d omitted per-request Server-Timing", i, sample.httpStatus)
			continue
		}
		stageTotal := sample.startWorker + sample.runtimeInitializer + sample.slotCapacity
		difference := stageTotal - sample.admission
		if difference < 0 {
			difference = -difference
		}
		if difference > 5*time.Microsecond {
			t.Errorf("candidate %d admission=%s stage total=%s", i, sample.admission, stageTotal)
		}
		if sample.admission > sample.endToEnd+5*time.Millisecond {
			t.Errorf("candidate %d admission wait %s exceeds end-to-end %s", i, sample.admission, sample.endToEnd)
		}
	}
	if os.Getenv("SAT_CODE_LOAD_DETAILS") == "1" {
		for i, sample := range candidateTimings {
			admission := "unavailable"
			if sample.hasServerTiming {
				admission = fmt.Sprintf("%.3f", float64(sample.admission)/float64(time.Millisecond))
			}
			t.Logf("student_wait student_index=%03d result=%s http_status=%d end_to_end_ms=%.3f admission_wait_ms=%s worker_wait_ms=%.3f initializer_wait_ms=%.3f slot_capacity_wait_ms=%.3f",
				i, sample.outcome, sample.httpStatus,
				float64(sample.endToEnd)/float64(time.Millisecond), admission,
				float64(sample.startWorker)/float64(time.Millisecond),
				float64(sample.runtimeInitializer)/float64(time.Millisecond),
				float64(sample.slotCapacity)/float64(time.Millisecond))
		}
	}
	t.Logf("MySQL slot-claim FOR UPDATE SKIP LOCKED digest before=%+v after=%+v", slotsBefore, slotsAfter)
	t.Logf("MySQL InnoDB row-lock status before=%v after=%v", rowLocksBefore, rowLocksAfter)
	if os.Getenv("SAT_CODE_LOAD_STAGES") == "1" {
		for _, line := range strings.Split(telemetry.DefaultRegistry.Snapshot(), "\n") {
			if strings.HasPrefix(line, "sat_start_code_stage_seconds") ||
				strings.HasPrefix(line, "sat_start_code_http_seconds") ||
				strings.HasPrefix(line, "sat_start_code_start_seconds") ||
				strings.HasPrefix(line, "sat_start_code_admission_waiter_total") ||
				strings.HasPrefix(line, "sat_start_code_verification_total") ||
				strings.HasPrefix(line, "sat_start_code_path_escalation_total") {
				if strings.Contains(line, "_bucket{") &&
					!strings.Contains(line, `le="2"`) &&
					!strings.Contains(line, `le="5"`) &&
					!strings.Contains(line, `le="10"`) &&
					!strings.Contains(line, `le="+Inf"`) {
					continue
				}
				t.Log(line)
			}
		}
	}
	accepted, started, runtimes := 0, 0, 0
	for _, check := range []struct {
		query  string
		target *int
	}{
		{"SELECT COUNT(*) FROM student_attempts WHERE schedule_id = ? AND sat_start_code_accepted_at IS NOT NULL", &accepted},
		{"SELECT COUNT(*) FROM assessment_module_attempts m JOIN student_attempts a ON a.id = m.attempt_id WHERE a.schedule_id = ? AND m.started_at IS NOT NULL", &started},
		{"SELECT COUNT(*) FROM exam_session_runtimes WHERE schedule_id = ?", &runtimes},
	} {
		if err := db.QueryRow(check.query, f.scheduleID).Scan(check.target); err != nil {
			t.Fatal(err)
		}
	}
	wantStarted := n + warmup
	if failures != 0 || accepted != wantStarted || started != wantStarted || runtimes != 1 {
		t.Errorf("failures=%d accepted=%d started=%d runtimes=%d users=%d warmup=%d", failures, accepted, started, runtimes, n, warmup)
	}
	if n == 600 && (drain > 2*time.Second || percentile(sortedLatency, 95) >= 2*time.Second) {
		t.Errorf("600-candidate latency gate failed: drain=%s p95=%s; want drain <=2s and p95 <2s", drain, percentile(sortedLatency, 95))
	}
}

func startCodeHTTPFailureClass(status int, body string) string {
	for _, reason := range []string{"START_CODE_BUSY", "START_CODE_COOLDOWN", "START_CODE_RATE_LIMITED"} {
		if strings.Contains(body, reason) {
			return reason
		}
	}
	if status >= http.StatusInternalServerError {
		return "server_error"
	}
	return "http_error"
}

func parseSATStartCodeServerTiming(header string) (total, worker, initializer, capacity time.Duration, ok bool) {
	found := map[string]bool{}
	for _, entry := range strings.Split(header, ",") {
		parts := strings.Split(entry, ";")
		if len(parts) < 2 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		for _, parameter := range parts[1:] {
			key, raw, hasValue := strings.Cut(strings.TrimSpace(parameter), "=")
			if !hasValue || key != "dur" {
				continue
			}
			milliseconds, err := strconv.ParseFloat(raw, 64)
			if err != nil || milliseconds < 0 {
				return 0, 0, 0, 0, false
			}
			duration := time.Duration(milliseconds * float64(time.Millisecond))
			switch name {
			case "sat_admission":
				total, found[name] = duration, true
			case "sat_start_worker":
				worker, found[name] = duration, true
			case "sat_runtime_initializer":
				initializer, found[name] = duration, true
			case "sat_slot_capacity":
				capacity, found[name] = duration, true
			}
		}
	}
	ok = found["sat_admission"] && found["sat_start_worker"] &&
		found["sat_runtime_initializer"] && found["sat_slot_capacity"]
	return total, worker, initializer, capacity, ok
}
