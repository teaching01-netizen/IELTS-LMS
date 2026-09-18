package authoring

// Phase 02: bulk-vs-nested benchmark on the Phase-01 fixture.
//
// This reuses the Phase-01 harness (readperf_bench_test.go) verbatim — same
// counting connector, same percentile math, same warmup discipline — so the
// before/after numbers are directly comparable. It adds bulk endpoints only;
// the nested endpoints remain the frozen baseline.
//
// RUN IT:
//
//   READPERF_BENCH=1 \
//   TEST_MYSQL_DSN=... \
//     go test ./internal/authoring/ -run TestReadPerfBulkBenchmark -count=1 -v

import (
	"context"
	"fmt"
	"testing"

	"example.com/ielts-proctoring/internal/delivery"
)

// readPerfBulkEndpoints builds the bulk counterparts of the three measured
// calls, each projecting the SAME wire payload as its nested twin.
func readPerfBulkEndpoints(fixture *readPerfFixture) []readPerfEndpoint {
	return []readPerfEndpoint{
		{
			name: "bulk-shell",
			call: func(ctx context.Context) (int, error) {
				result, err := fixture.Service.bulkShell(ctx, fixture.ExamID)
				if err != nil {
					return 0, err
				}
				return readPerfJSONSize(result), nil
			},
		},
		{
			name: "bulk-preview",
			call: func(ctx context.Context) (int, error) {
				// The Phase-03 composition: bulk shell + bulk delivery tree.
				result, err := fixture.Service.bulkShell(ctx, fixture.ExamID)
				if err != nil {
					return 0, err
				}
				if result.Shell == nil {
					return 0, fmt.Errorf("fixture exam %s has no draft", fixture.ExamID)
				}
				shell := *result.Shell
				sections, err := delivery.NewService(fixture.DB, fixture.Runner).LoadSectionsBulk(ctx, shell.VersionID)
				if err != nil {
					return 0, err
				}
				preview := Preview{
					ExamID: shell.ExamID, ProviderKey: shell.ProviderKey,
					VersionID: shell.VersionID, VersionRevision: shell.VersionRevision,
					Sections: sections,
				}
				return readPerfJSONSize(preview), nil
			},
		},
	}
}

// TestReadPerfBulkBenchmark measures the bulk endpoints at the same
// concurrency levels as the frozen baseline so the improvement is directly
// readable. The nested rows are printed alongside for an in-run comparison.
func TestReadPerfBulkBenchmark(t *testing.T) {
	readPerfRequireBench(t)
	dsn := readPerfDSN(t)
	config := readPerfBenchConfigFromEnv()

	db, counter := readPerfCountedDB(t, dsn)
	fixture := seedReadPerfFixtureWithDB(t, db)

	selected := map[string]bool{}
	for _, name := range config.Endpoints {
		selected[name] = true
	}

	t.Logf("bulk read path: runs/worker=%d warmup/worker=%d levels=%v", config.Runs, config.Warmup, config.Levels)
	t.Logf("fixture: exam=%s version=%s sections=2 modules=6 questions=%d",
		fixture.ExamID, fixture.VersionID, fixture.QuestionCount)

	// Nested rows first: same fixture, same run, same counting connector, so
	// the before/after pair is measured under identical machine conditions.
	for _, endpoint := range readPerfEndpoints(fixture, "readperf-bulk-bench") {
		if !selected[endpoint.name] {
			continue
		}
		for _, level := range config.Levels {
			stats := readPerfRunLevel(t, endpoint, level, config.Runs, config.Warmup, counter)
			t.Logf("BEFORE %s", stats.String())
		}
	}
	for _, endpoint := range readPerfBulkEndpoints(fixture) {
		for _, level := range config.Levels {
			stats := readPerfRunLevel(t, endpoint, level, config.Runs, config.Warmup, counter)
			t.Logf("AFTER  %s", stats.String())
		}
	}
}
