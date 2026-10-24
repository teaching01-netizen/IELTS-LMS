package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// TestSATThroughputK6MySQL runs the open-arrival k6/sat-throughput.js mix
// (new saves, exact replays, lifecycle reads) against local API processes and
// then reconciles every synthetic attempt from the database alone. A local run
// is a regression diagnostic; it does not qualify target-topology capacity.
//
//	SAT_THROUGHPUT_K6_USERS     distinct attempts = k6 VUs (1..2000), required
//	SAT_THROUGHPUT_K6_RATE      offered logical operations/s (default 50)
//	SAT_THROUGHPUT_K6_DURATION  steady duration (default 2m)
//	SAT_THROUGHPUT_K6_ROOMS     schedules to spread attempts over (default 1)
//
// Each attempt is paced to one operation per second, so keep the rate at or
// below the user count.
func TestSATThroughputK6MySQL(t *testing.T) {
	count, err := satK6UserCount(t, "SAT_THROUGHPUT_K6_USERS")
	if err != nil || count == 0 {
		return
	}
	rate := strings.TrimSpace(os.Getenv("SAT_THROUGHPUT_K6_RATE"))
	if rate == "" {
		rate = "50"
	}
	if value, err := strconv.ParseFloat(rate, 64); err != nil || value <= 0 {
		t.Fatal("SAT_THROUGHPUT_K6_RATE must be a positive number")
	}
	duration := strings.TrimSpace(os.Getenv("SAT_THROUGHPUT_K6_DURATION"))
	if duration == "" {
		duration = "2m"
	}
	steady, err := time.ParseDuration(duration)
	if err != nil {
		t.Fatalf("SAT_THROUGHPUT_K6_DURATION: %v", err)
	}

	fixture := seedSATRecoveryLoadFixture(t, count, satK6Rooms(t, "SAT_THROUGHPUT_K6_ROOMS", count))
	proxyURL, apiURLs, apis := startSATRecoveryK6Proxy(t, count)
	fixturePath := filepath.Join(t.TempDir(), "sat-throughput-credentials.json")
	encoded, err := json.Marshal(fixture.credentials)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fixturePath, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	poolBefore := satRecoveryAPIPoolStats(t, apiURLs)
	runSATRecoveryK6(t, "../../../../k6/sat-throughput.js", steady+5*time.Minute, map[string]string{
		"K6_CONFIRM_SAT":         "true",
		"K6_BASE_URL":            proxyURL,
		"K6_ATTEMPT_TOKENS_PATH": fixturePath,
		"SAT_TP_MAX_VUS":         strconv.Itoa(count),
		"SAT_TP_RATE":            rate,
		"SAT_TP_DURATION":        duration,
		"SAT_TP_RUN_ID":          strings.TrimSuffix(fixture.studentKeyPrefix, "-"),
	}, apis)
	logSATRecoveryAPIPoolStats(t, poolBefore, satRecoveryAPIPoolStats(t, apiURLs))
	t.Logf("local SAT throughput k6 run: users=%d rate=%s/s duration=%s", count, rate, duration)

	db, pattern := fixture.db, fixture.studentKeyPrefix+"%"
	assertZero := func(label, query string) {
		t.Helper()
		var got int
		if err := db.QueryRow(query, pattern).Scan(&got); err != nil {
			t.Fatalf("reconcile %s: %v", label, err)
		}
		if got != 0 {
			t.Errorf("reconcile %s: %d violating rows", label, got)
		}
	}
	// Each accepted answer advanced the attempt revision exactly once.
	assertZero("attempt revision = applied ledger rows", `
		SELECT COUNT(*) FROM student_attempts a
		WHERE a.student_key LIKE ?
		  AND a.response_revision <> (SELECT COUNT(*) FROM attempt_mutations_v2 m WHERE m.attempt_id = a.id AND m.outcome = 'applied')`)
	// No two accepted writes share a server revision within an attempt.
	assertZero("unique applied server revisions", `
		SELECT COUNT(*) FROM (
			SELECT m.attempt_id, m.server_revision FROM attempt_mutations_v2 m
			JOIN student_attempts a ON a.id = m.attempt_id
			WHERE a.student_key LIKE ? AND m.outcome = 'applied'
			GROUP BY m.attempt_id, m.server_revision HAVING COUNT(*) > 1) dup`)
	// Every projection is the newest accepted write for its question.
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
				WHERE m2.attempt_id = r.attempt_id AND m2.question_id = r.question_id AND m2.outcome = 'applied'))`)
	var applied int
	if err := db.QueryRow(`SELECT COUNT(*) FROM attempt_mutations_v2 m JOIN student_attempts a ON a.id = m.attempt_id WHERE a.student_key LIKE ? AND m.outcome = 'applied'`, pattern).Scan(&applied); err != nil {
		t.Fatal(err)
	}
	if applied == 0 {
		t.Error("the run accepted no answers")
	}
	t.Logf("reconciled %d accepted answers across %d attempts", applied, count)
}
