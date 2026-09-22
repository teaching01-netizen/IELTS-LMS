package release

// Parity pin for the candidate-length arithmetic inside contentSummary's SQL.
//
// The one owner of the rule is exams.CandidateSectionSeconds (a base plus the
// LONGER branch); contentSummary re-expresses that arithmetic in SQL because it
// must run in the database. This test executes the real read — the real Service
// over an isolated scratch schema — and compares the summary to the owner over
// the same fixtures as the other pins (cmd/migrate/repair_0067_parity_test.go
// for the migration, and
// src/features/exam-authoring/ui/release/__tests__/releaseSelectors.test.ts for
// the client copy). If the SQL drifts — SUM instead of GREATEST, a dropped or
// double-counted break — this fails. The release read path itself is not
// restructured.
//
// Domain note: the release summary adds each section's break to the candidate
// duration and carries no completeness guard (an incomplete adaptive shape
// counts 0 there); those are its display-only semantics. The fixtures below
// stay on complete adaptive shapes, where the two rules must agree.
//
// TEST_MYSQL_DSN-gated: creates and drops its own scratch schema.

import (
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	examdomain "example.com/ielts-proctoring/internal/exams"
	platformdb "example.com/ielts-proctoring/internal/platform/db"
	mysql "github.com/go-sql-driver/mysql"
)

// releaseParityPool opens a pool on a fresh isolated schema holding only the
// tables the content summary queries touch.
func releaseParityPool(t *testing.T) *sql.DB {
	t.Helper()
	raw := os.Getenv("TEST_MYSQL_DSN")
	if raw == "" {
		t.Skip("TEST_MYSQL_DSN not set; candidate-length parity pin requires real MySQL/TiDB")
	}
	dsn, err := platformdb.NormalizeDSN(raw)
	if err != nil {
		t.Fatalf("normalize TEST_MYSQL_DSN: %v", err)
	}
	admin, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { _ = admin.Close() })
	if err := admin.Ping(); err != nil {
		t.Skipf("TEST_MYSQL_DSN unreachable, skipping: %v", err)
	}
	name := fmt.Sprintf("releaseparity_%d", time.Now().UnixNano())
	if _, err := admin.Exec("CREATE DATABASE `" + name + "`"); err != nil {
		t.Fatalf("create scratch schema: %v", err)
	}
	t.Cleanup(func() { _, _ = admin.Exec("DROP DATABASE IF EXISTS `" + name + "`") })

	cfg, err := mysql.ParseDSN(dsn)
	if err != nil {
		t.Fatalf("parse normalized DSN: %v", err)
	}
	cfg.DBName = name
	pool, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatalf("open scratch pool: %v", err)
	}
	t.Cleanup(func() { _ = pool.Close() })
	if err := pool.Ping(); err != nil {
		t.Fatalf("ping scratch pool: %v", err)
	}
	for _, stmt := range []string{
		"CREATE TABLE assessment_sections (id VARCHAR(36) PRIMARY KEY, exam_version_id VARCHAR(64) NOT NULL, break_after_seconds INT NOT NULL DEFAULT 0)",
		"CREATE TABLE assessment_modules (id VARCHAR(36) PRIMARY KEY, section_id VARCHAR(36) NOT NULL, adaptive_role VARCHAR(32) NOT NULL DEFAULT '', duration_seconds INT NOT NULL DEFAULT 0, target_question_count INT NOT NULL DEFAULT 0)",
		"CREATE TABLE assessment_exam_questions (id VARCHAR(36) PRIMARY KEY, module_id VARCHAR(36) NOT NULL)",
	} {
		if _, err := pool.Exec(stmt); err != nil {
			t.Fatalf("create scratch table: %v (%.100q)", err, stmt)
		}
	}
	return pool
}

func TestContentSummaryMatchesTheCandidateLengthOwner(t *testing.T) {
	pool := releaseParityPool(t)
	ctx := t.Context()

	type paritySection struct {
		name                string
		base, lower, higher int
		breakSeconds        int
	}
	sections := []paritySection{
		{name: "equal branches", base: 1920, lower: 1920, higher: 1920, breakSeconds: 600},
		{name: "higher branch longer", base: 2100, lower: 1800, higher: 2400, breakSeconds: 300},
		{name: "lower branch longer", base: 2100, lower: 2700, higher: 2400, breakSeconds: 0},
		{name: "single branch", base: 1920, lower: 1920, higher: 0, breakSeconds: 0},
	}

	var want int64
	for i, section := range sections {
		sectionID := fmt.Sprintf("sec-%d", i)
		if _, err := pool.ExecContext(ctx,
			"INSERT INTO assessment_sections (id, exam_version_id, break_after_seconds) VALUES (?, 'pv-parity', ?)",
			sectionID, section.breakSeconds); err != nil {
			t.Fatalf("fixture section %s: %v", section.name, err)
		}
		modules := []struct {
			role    string
			seconds int
		}{
			{role: "base", seconds: section.base},
			{role: "lower_branch", seconds: section.lower},
			{role: "higher_branch", seconds: section.higher},
		}
		for j, module := range modules {
			if module.seconds == 0 {
				continue // an unauthored branch has no row
			}
			if _, err := pool.ExecContext(ctx,
				"INSERT INTO assessment_modules (id, section_id, adaptive_role, duration_seconds) VALUES (?, ?, ?, ?)",
				fmt.Sprintf("mod-%d-%d", i, j), sectionID, module.role, module.seconds); err != nil {
				t.Fatalf("fixture module %s/%s: %v", section.name, module.role, err)
			}
		}

		seconds, ok := (examdomain.AdaptiveRoleSeconds{
			Base:   section.base,
			Lower:  section.lower,
			Higher: section.higher,
		}).CandidateSeconds()
		if !ok {
			t.Fatalf("fixture %s must be a complete adaptive shape", section.name)
		}
		want += int64(seconds + section.breakSeconds)
	}

	out, err := NewService(pool).contentSummary(ctx, "pv-parity")
	if err != nil {
		t.Fatalf("contentSummary: %v", err)
	}
	if out.CandidateDurationSeconds != want {
		t.Fatalf("release summary computed %d candidate seconds, the owner says %d for the same fixtures",
			out.CandidateDurationSeconds, want)
	}
}
