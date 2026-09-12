package authoring

// Phase 01 read-path performance baseline: benchmark harness.
//
// Test-only. Measures the three authoring read endpoints Phase 02-05 must
// improve, on the deterministic fixture from readperf_fixture_test.go:
//
//   shell     -> Service.Shell      (the read the frontend wants)
//   openshell -> Service.OpenShell  (what the frontend actually calls)
//   preview   -> Service.Preview    (Shell + delivery double-build)
//
// For each endpoint and each concurrency level it records p50/p95/p99/mean wall
// latency and the exact number of SQL statements the service issued.
//
// HOW STATEMENTS ARE COUNTED. A driver.Connector wrapper intercepts every
// driver-level statement operation. This matters because MySQL's Go driver
// speaks the binary prepared-statement protocol, so ONE logical query costs
// three protocol operations:
//
//   PREPARE <sql>     (driver.Conn.PrepareContext)
//   EXECUTE <sql>     (driver.Stmt.Query/Exec)
//   DEALLOCATE <sql>  (driver.Stmt.Close, on stmt-cache eviction / conn close)
//
// The harness therefore reports both:
//   * executions  = logical queries per request (the number to optimize)
//   * prepares    = PREPARE round trips (amortized: database/sql caches a
//                   prepared statement per connection, so a warm pool
//                   prepares each distinct query once per connection)
//
// Counting at the driver boundary rather than performance_schema is
// deliberate: the shared dev MySQL carries background traffic from other
// sessions (session heartbeats + rate-limit inserts), so digest deltas are
// noisy and unattributable. A driver wrapper attributes every statement to the
// request that caused it.
//
// RUN IT:
//
//   READPERF_BENCH=1 \
//   TEST_MYSQL_DSN='root:root@tcp(127.0.0.1:3306)/ielts_go_fresh?parseTime=true&multiStatements=true' \
//     go test ./internal/authoring/ -run 'TestReadPerf(Benchmark|StatementBudget)' -v -count=1 -timeout 30m
//
// Knobs (optional; keep defaults for a comparable baseline):
//
//   READPERF_RUNS      iterations PER WORKER, per (endpoint, concurrency) [default 20]
//   READPERF_WARMUP    warmup iterations per worker before measuring       [default 5]
//   READPERF_LEVELS    comma-separated concurrency levels                  [default 1,10,50]
//   READPERF_ENDPOINTS comma-separated subset of shell,openshell,preview
//
// Both tests SKIP unless READPERF_BENCH=1, so an ordinary go test run never
// pays the cost.

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	mysql "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

// readPerfCountingConnector wraps the MySQL connector and counts every
// driver-level statement operation.
type readPerfCountingConnector struct {
	inner driver.Connector
	// executions counts logical query executions (the EXECUTE leg). One
	// execution == one SQL statement the service asked for.
	executions atomic.Int64
	// prepares counts PREPARE round trips. Amortized per connection by the
	// database/sql statement cache.
	prepares atomic.Int64
	// deallocates counts DEALLOCATE round trips (Stmt.Close).
	deallocates atomic.Int64
}

func (c *readPerfCountingConnector) Connect(ctx context.Context) (driver.Conn, error) {
	conn, err := c.inner.Connect(ctx)
	if err != nil {
		return nil, err
	}
	return &readPerfCountingConn{Conn: conn, counter: c}, nil
}

func (c *readPerfCountingConnector) Driver() driver.Driver { return c.inner.Driver() }

// readPerfCountingConn intercepts connection-level entry points.
type readPerfCountingConn struct {
	driver.Conn
	counter *readPerfCountingConnector
}

func (c *readPerfCountingConn) Prepare(query string) (driver.Stmt, error) {
	c.counter.prepares.Add(1)
	stmt, err := c.Conn.Prepare(query)
	if err != nil {
		return nil, err
	}
	return &readPerfCountingStmt{Stmt: stmt, counter: c.counter}, nil
}

func (c *readPerfCountingConn) PrepareContext(ctx context.Context, query string) (driver.Stmt, error) {
	c.counter.prepares.Add(1)
	var (
		stmt driver.Stmt
		err  error
	)
	if preparer, ok := c.Conn.(driver.ConnPrepareContext); ok {
		stmt, err = preparer.PrepareContext(ctx, query)
	} else {
		stmt, err = c.Conn.Prepare(query)
	}
	if err != nil {
		return nil, err
	}
	return &readPerfCountingStmt{Stmt: stmt, counter: c.counter}, nil
}

// QueryContext is the no-argument fast path: the driver executes the query
// without a separate prepare.
func (c *readPerfCountingConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	queryer, ok := c.Conn.(driver.QueryerContext)
	if !ok {
		return nil, driver.ErrSkip
	}
	rows, err := queryer.QueryContext(ctx, query, args)
	// The MySQL driver answers driver.ErrSkip for a parameterized query when
	// InterpolateParams is off; database/sql then retries through
	// Prepare+Stmt.Query. Counting the skipped attempt would double-count, so
	// only a served call counts as one execution.
	if err != driver.ErrSkip {
		c.counter.executions.Add(1)
	}
	return rows, err
}

func (c *readPerfCountingConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	execer, ok := c.Conn.(driver.ExecerContext)
	if !ok {
		return nil, driver.ErrSkip
	}
	result, err := execer.ExecContext(ctx, query, args)
	// Same ErrSkip caveat as QueryContext: only count a served execution.
	if err != driver.ErrSkip {
		c.counter.executions.Add(1)
	}
	return result, err
}

func (c *readPerfCountingConn) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	if beginner, ok := c.Conn.(driver.ConnBeginTx); ok {
		return beginner.BeginTx(ctx, opts)
	}
	return c.Conn.Begin()
}

// readPerfCountingStmt counts the EXECUTE and DEALLOCATE legs.
type readPerfCountingStmt struct {
	driver.Stmt
	counter *readPerfCountingConnector
}

func (s *readPerfCountingStmt) Exec(args []driver.Value) (driver.Result, error) {
	s.counter.executions.Add(1)
	return s.Stmt.Exec(args)
}

func (s *readPerfCountingStmt) Query(args []driver.Value) (driver.Rows, error) {
	s.counter.executions.Add(1)
	return s.Stmt.Query(args)
}

func (s *readPerfCountingStmt) ExecContext(ctx context.Context, args []driver.NamedValue) (driver.Result, error) {
	s.counter.executions.Add(1)
	if execer, ok := s.Stmt.(driver.StmtExecContext); ok {
		return execer.ExecContext(ctx, args)
	}
	values := make([]driver.Value, len(args))
	for i, arg := range args {
		values[i] = arg.Value
	}
	return s.Stmt.Exec(values)
}

func (s *readPerfCountingStmt) QueryContext(ctx context.Context, args []driver.NamedValue) (driver.Rows, error) {
	s.counter.executions.Add(1)
	if queryer, ok := s.Stmt.(driver.StmtQueryContext); ok {
		return queryer.QueryContext(ctx, args)
	}
	values := make([]driver.Value, len(args))
	for i, arg := range args {
		values[i] = arg.Value
	}
	return s.Stmt.Query(values)
}

func (s *readPerfCountingStmt) Close() error {
	s.counter.deallocates.Add(1)
	return s.Stmt.Close()
}

// readPerfCountedDB opens the gated MySQL DSN through the counting connector.
func readPerfCountedDB(t *testing.T, dsn string) (*sql.DB, *readPerfCountingConnector) {
	t.Helper()
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil {
		t.Fatalf("parse TEST_MYSQL_DSN: %v", err)
	}
	inner, err := mysql.NewConnector(cfg)
	if err != nil {
		t.Fatalf("mysql connector: %v", err)
	}
	counter := &readPerfCountingConnector{inner: inner}
	db := sql.OpenDB(counter)
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(64)
	db.SetMaxIdleConns(64)
	db.SetConnMaxLifetime(0)
	return db, counter
}

// readPerfLatencyStats is one (endpoint, concurrency) measurement.
type readPerfLatencyStats struct {
	Endpoint    string
	Concurrency int
	Requests    int
	Executions  int64
	Prepares    int64
	MeanMillis  float64
	P50Millis   float64
	P95Millis   float64
	P99Millis   float64
	MinMillis   float64
	MaxMillis   float64
	Errors      int
	// ResponseSize is the JSON byte length of one projection (0 = n/a).
	ResponseSize int
}

// String renders one row for the baseline report.
func (s readPerfLatencyStats) String() string {
	return fmt.Sprintf("%-9s n=%-3d reqs=%-5d queries=%-5d q/req=%-6.2f prepares=%-5d bytes=%-7d p50=%8.2fms p95=%8.2fms p99=%8.2fms mean=%8.2fms min=%8.2fms max=%9.2fms errors=%d",
		s.Endpoint, s.Concurrency, s.Requests, s.Executions, s.QueriesPerRequest(), s.Prepares, s.ResponseSize,
		s.P50Millis, s.P95Millis, s.P99Millis, s.MeanMillis, s.MinMillis, s.MaxMillis, s.Errors)
}

// QueriesPerRequest is the logical SQL statement count per request.
func (s readPerfLatencyStats) QueriesPerRequest() float64 {
	if s.Requests == 0 {
		return 0
	}
	return float64(s.Executions) / float64(s.Requests)
}

// readPerfPercentile computes the nearest-rank percentile over a sorted slice.
func readPerfPercentile(sorted []float64, fraction float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	index := int(fraction*float64(len(sorted))+0.999999) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	return sorted[index]
}

// readPerfBenchConfig is the parsed environment configuration.
type readPerfBenchConfig struct {
	Runs      int
	Warmup    int
	Levels    []int
	Endpoints []string
}

func readPerfEnvInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func readPerfBenchConfigFromEnv() readPerfBenchConfig {
	config := readPerfBenchConfig{
		Runs:   readPerfEnvInt("READPERF_RUNS", 20),
		Warmup: readPerfEnvInt("READPERF_WARMUP", 5),
		Levels: []int{1, 10, 50},
	}
	if raw := strings.TrimSpace(os.Getenv("READPERF_LEVELS")); raw != "" {
		levels := []int{}
		for _, part := range strings.Split(raw, ",") {
			value, err := strconv.Atoi(strings.TrimSpace(part))
			if err == nil && value > 0 {
				levels = append(levels, value)
			}
		}
		if len(levels) > 0 {
			config.Levels = levels
		}
	}
	config.Endpoints = []string{"shell", "openshell", "preview"}
	if raw := strings.TrimSpace(os.Getenv("READPERF_ENDPOINTS")); raw != "" {
		endpoints := []string{}
		for _, part := range strings.Split(raw, ",") {
			value := strings.TrimSpace(part)
			switch value {
			case "shell", "openshell", "preview":
				endpoints = append(endpoints, value)
			}
		}
		if len(endpoints) > 0 {
			config.Endpoints = endpoints
		}
	}
	return config
}

// readPerfEndpoint is one measured call.
type readPerfEndpoint struct {
	name string
	call func(ctx context.Context) (int, error)
}

// readPerfEndpoints builds the three measured calls over one fixture.
func readPerfEndpoints(fixture *readPerfFixture, actorID string) []readPerfEndpoint {
	return []readPerfEndpoint{
		{
			name: "shell",
			call: func(ctx context.Context) (int, error) {
				shell, err := fixture.Service.Shell(ctx, fixture.ExamID)
				if err != nil {
					return 0, err
				}
				return readPerfJSONSize(shell), nil
			},
		},
		{
			name: "openshell",
			call: func(ctx context.Context) (int, error) {
				shell, err := fixture.Service.OpenShell(ctx, fixture.ExamID, actorID)
				if err != nil {
					return 0, err
				}
				return readPerfJSONSize(shell), nil
			},
		},
		{
			name: "preview",
			call: func(ctx context.Context) (int, error) {
				preview, err := fixture.Service.Preview(ctx, fixture.ExamID)
				if err != nil {
					return 0, err
				}
				return readPerfJSONSize(preview), nil
			},
		},
	}
}

// readPerfJSONSize measures the encoded projection size with the same encoder
// httpx.WriteJSON uses (json.Encoder), so the number matches the wire bytes.
func readPerfJSONSize(value any) int {
	var buffer bytes.Buffer
	if err := json.NewEncoder(&buffer).Encode(value); err != nil {
		return 0
	}
	return buffer.Len()
}

// readPerfRunLevel measures one endpoint at one concurrency level.
//
// Each worker performs warmup warmup iterations before the measured
// window and runs measured iterations inside it, so warmup at the
// target concurrency fills the pool and the MySQL prepared-statement cache
// first. Statements are counted only across the measured window.
func readPerfRunLevel(t *testing.T, endpoint readPerfEndpoint, concurrency, runs, warmup int, counter *readPerfCountingConnector) readPerfLatencyStats {
	t.Helper()
	stats := readPerfLatencyStats{Endpoint: endpoint.name, Concurrency: concurrency}

	type result struct {
		millis float64
		size   int
	}

	// onePass runs `iterations` calls per worker and returns every outcome,
	// including failures. Failures are DATA here, never silently dropped: a
	// failed call is reported in stats.Errors and fails the test.
	type passOutcome struct {
		results []result
		errors  []error
	}
	onePass := func(iterations int) passOutcome {
		collected := make([]passOutcome, concurrency)
		start := make(chan struct{})
		var wg sync.WaitGroup
		for workerIndex := 0; workerIndex < concurrency; workerIndex++ {
			wg.Add(1)
			go func(index int) {
				defer wg.Done()
				<-start
				local := passOutcome{results: make([]result, 0, iterations)}
				for i := 0; i < iterations; i++ {
					began := time.Now()
					size, err := endpoint.call(context.Background())
					elapsed := time.Since(began)
					if err != nil {
						local.errors = append(local.errors, err)
						continue
					}
					local.results = append(local.results, result{millis: float64(elapsed.Microseconds()) / 1000.0, size: size})
				}
				collected[index] = local
			}(workerIndex)
		}
		close(start)
		wg.Wait()
		out := passOutcome{results: make([]result, 0, concurrency*iterations)}
		for _, local := range collected {
			out.results = append(out.results, local.results...)
			out.errors = append(out.errors, local.errors...)
		}
		return out
	}

	if warmup > 0 {
		warm := onePass(warmup)
		if len(warm.errors) > 0 {
			t.Fatalf("%s warmup at n=%d failed on %d of %d calls, first error: %v",
				endpoint.name, concurrency, len(warm.errors), concurrency*warmup, warm.errors[0])
		}
	}

	// The measured window: statements are counted from here.
	beforeExecutions := counter.executions.Load()
	beforePrepares := counter.prepares.Load()
	measured := onePass(runs)
	stats.Executions = counter.executions.Load() - beforeExecutions
	stats.Prepares = counter.prepares.Load() - beforePrepares
	stats.Requests = len(measured.results)
	stats.Errors = len(measured.errors)

	// A run with ANY error is invalid: it must never print a success row.
	// Errors are usually the symptom of the fixture being torn down
	// concurrently, which would silently poison the latency percentiles too.
	if stats.Errors > 0 {
		t.Errorf("%s at n=%d: %d of %d measured calls failed (expected 0), first error: %v",
			endpoint.name, concurrency, stats.Errors, concurrency*runs, measured.errors[0])
	}
	if stats.Requests == 0 {
		t.Fatalf("%s at concurrency %d produced no successful runs", endpoint.name, concurrency)
	}

	latencies := make([]float64, 0, len(measured.results))
	total := 0.0
	for _, item := range measured.results {
		latencies = append(latencies, item.millis)
		total += item.millis
	}
	sort.Float64s(latencies)
	stats.MeanMillis = total / float64(len(latencies))
	stats.P50Millis = readPerfPercentile(latencies, 0.50)
	stats.P95Millis = readPerfPercentile(latencies, 0.95)
	stats.P99Millis = readPerfPercentile(latencies, 0.99)
	stats.MinMillis = latencies[0]
	stats.MaxMillis = latencies[len(latencies)-1]
	stats.ResponseSize = measured.results[0].size
	return stats
}

// readPerfRequireBench skips unless the benchmark gate is set.
func readPerfRequireBench(t *testing.T) {
	t.Helper()
	if strings.TrimSpace(os.Getenv("READPERF_BENCH")) != "1" {
		t.Skip("READPERF_BENCH not set; run with READPERF_BENCH=1 to measure the read path")
	}
}

// TestReadPerfBenchmark is the Phase-01 baseline harness. It logs one row per
// (endpoint, concurrency) with p50/p95/p99 and the measured query count.
func TestReadPerfBenchmark(t *testing.T) {
	readPerfRequireBench(t)
	dsn := readPerfDSN(t)
	config := readPerfBenchConfigFromEnv()

	db, counter := readPerfCountedDB(t, dsn)
	fixture := seedReadPerfFixtureWithDB(t, db)

	actorID := "readperf-bench-" + uuid.NewString()
	endpoints := readPerfEndpoints(fixture, actorID)

	selected := map[string]bool{}
	for _, name := range config.Endpoints {
		selected[name] = true
	}

	t.Logf("read-path baseline: runs/worker=%d warmup/worker=%d levels=%v endpoints=%v",
		config.Runs, config.Warmup, config.Levels, config.Endpoints)
	t.Logf("fixture: exam=%s version=%s sections=2 modules=6 questions=%d",
		fixture.ExamID, fixture.VersionID, fixture.QuestionCount)

	for _, endpoint := range endpoints {
		if !selected[endpoint.name] {
			continue
		}
		for _, level := range config.Levels {
			stats := readPerfRunLevel(t, endpoint, level, config.Runs, config.Warmup, counter)
			// Never print a success row for a run that had failures: the numbers
			// would be a partial sample masquerading as a baseline.
			if stats.Errors > 0 {
				t.Logf("INVALID (errors=%d, excluded from baseline): %s", stats.Errors, stats.String())
				continue
			}
			t.Logf("%s", stats.String())
		}
	}
}

// TestReadPerfStatementBudget asserts the Phase-03 per-request query counts
// so a regression (or an "optimization" that adds round trips) fails the
// suite. Phase 01 froze the unoptimized baseline (shell 13 / openshell 15 /
// preview 22); Phase 03 deliberately moves the gate to the bulk shapes below
// (AT-07: shell <= 8, preview <= 12, openshell <= 10).
//
// Counts are driver-level EXECUTEs for ONE request on a warm pool, measured at
// concurrency 1. They include the tx.Runner BEGIN / SET time_zone / COMMIT
// statements that OpenShell issues. Preview runs cache-off here (the fixture
// service wires no preview cache), so the gate pins the direct bulk-build
// cost; the cache-on hit/miss behavior is pinned separately by
// TestPreviewCache* in preview_cache_test.go.
func TestReadPerfStatementBudget(t *testing.T) {
	readPerfRequireBench(t)
	dsn := readPerfDSN(t)

	db, counter := readPerfCountedDB(t, dsn)
	fixture := seedReadPerfFixtureWithDB(t, db)
	actorID := "readperf-budget-" + uuid.NewString()

	type expectation struct {
		name string
		want int64
		call func() error
	}
	cases := []expectation{
		{
			name: "shell",
			// Phase-03 bulk Shell(): 1 identity JOIN + 1 sections + 1
			// modules + 1 routing + 1 questions = 5 (was 13).
			want: 5,
			call: func() error { _, err := fixture.Service.Shell(context.Background(), fixture.ExamID); return err },
		},
		{
			name: "openshell",
			// OpenShell keeps the single write Tx (option (a)): SET
			// time_zone + exam FOR UPDATE + COMMIT, then the bulk Shell's
			// 5. The BEGIN itself is not a statement execution (it is a
			// connection-level transaction start), so it is not counted
			// here; the live count is 7 (measured — one tx leg is not a
			// counted EXECUTE on a warm pool). Documented + proven by
			// TestOpenShellConcurrent*.
			want: 7,
			call: func() error {
				_, err := fixture.Service.OpenShell(context.Background(), fixture.ExamID, actorID)
				return err
			},
		},
		{
			name: "preview",
			// Phase-03 single-build Preview (cache off): 1 identity probe
			// + bulk delivery build (1 sections + 1 modules + 1
			// questions) = 4 (was 22). The discarded authoring tree the
			// old Preview built is gone.
			want: 4,
			call: func() error { _, err := fixture.Service.Preview(context.Background(), fixture.ExamID); return err },
		},
	}
	for _, testCase := range cases {
		// Warm the pool so connect-time statements are excluded.
		if err := testCase.call(); err != nil {
			t.Fatalf("%s warmup: %v", testCase.name, err)
		}
		before := counter.executions.Load()
		if err := testCase.call(); err != nil {
			t.Fatalf("%s: %v", testCase.name, err)
		}
		got := counter.executions.Load() - before
		if got != testCase.want {
			t.Errorf("%s issued %d queries, baseline is %d — update plans/authoring-read-perf/baseline-report.md and the frozen AT thresholds if this change is intentional",
				testCase.name, got, testCase.want)
		}
	}
}

// TestReadPerfSummaryCPU measures the per-question CPU cost of the summary
// projection (readiness.go row.summary(): validateSATQuestion plus the
// per-question json.Unmarshal/Marshal work). It is the "profile summary CPU"
// half of the Phase-01 baseline: the SQL count says how many round trips the
// read makes, this says how much CPU each row costs once it arrives.
//
// Reported as ns/op and allocs/op for one question row, so Phase 03 can prove
// the per-question cost dropped rather than just moved.
func TestReadPerfSummaryCPU(t *testing.T) {
	readPerfRequireBench(t)
	row := questionValidationRow{
		examQuestionID:   "eq-1",
		questionID:       "q-1",
		revisionID:       "rev-1",
		sectionKey:       SectionReadingWriting,
		questionType:     "single_choice",
		displayOrder:     0,
		semanticRevision: 1,
		revision:         4,
		stimulus:         readPerfRichDocument("Seeded rich stimulus with a table and inline math for the CPU baseline."),
		prompt:           readPerfPlainDocument("Which choice best states the main idea of the text?"),
		answer:           readPerfSingleChoiceAnswer("B"),
		rationale:        readPerfPlainDocument("The passage emphasizes the repeated afternoon temperature difference."),
		metadata:         readPerfGoldenMetadata(SectionReadingWriting, "information-and-ideas", "Central Ideas and Details"),
	}
	result := testing.Benchmark(func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = row.summary()
		}
	})
	t.Logf("row.summary() for ONE single_choice question: %8.0f ns/op  %5.0f B/op  %3.0f allocs/op",
		float64(result.NsPerOp()), float64(result.AllocedBytesPerOp()), float64(result.AllocsPerOp()))
	t.Logf("extrapolated for 147 questions: %.2f ms CPU per Shell() projection",
		float64(result.NsPerOp())*147/1e6)

	// A second sample for the SPR shape, whose answer path differs.
	sprRow := row
	sprRow.sectionKey = SectionMath
	sprRow.questionType = "student_produced_response"
	sprRow.stimulus = readPerfEmptyStimulus()
	sprRow.answer = readPerfSPRAnswer("3")
	sprRow.metadata = readPerfGoldenMetadata(SectionMath, "algebra", "Linear Equations in One Variable")
	sprResult := testing.Benchmark(func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = sprRow.summary()
		}
	})
	t.Logf("row.summary() for ONE student_produced_response question: %8.0f ns/op  %5.0f B/op  %3.0f allocs/op",
		float64(sprResult.NsPerOp()), float64(sprResult.AllocedBytesPerOp()), float64(sprResult.AllocsPerOp()))
}
