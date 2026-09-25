package main

// Migration-guard pins for 0072_assessment_results_nullable_submission.sql
// (P0: SAT completion failing with MySQL 1048 "Column 'submission_id' cannot
// be null").
//
//   - TestMigration0072StatementsGuarded is a static audit (no database): the
//     file relaxes exactly one column through an information_schema-guarded
//     prepared ALTER, so a crash mid-file can be retried, and it must not
//     re-point submission_id at attempt identity (0044 and the terminalization
//     service own attempt linkage through attempt_id).
//   - TestMigration0072NullableSubmissionMySQL applies the file twice against
//     real MySQL (TEST_MYSQL_DSN-gated, isolated scratch schema) on the 0032
//     NOT NULL shape and asserts the end contract: is_nullable = 'YES', the FK
//     and the uq_assessment_result_submission UNIQUE survive, the legacy
//     submission-keyed row is untouched, an attempt-owned NULL row inserts, and
//     the FK still rejects an unknown submission id.
//
// Without TEST_MYSQL_DSN the DB test skips cleanly.

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

const nullableSubmissionFile = "0072_assessment_results_nullable_submission.sql"

var nullableSubmissionAlterRe = regexp.MustCompile(`ALTER TABLE assessment_results MODIFY COLUMN submission_id VARCHAR\(36\) NULL`)

func loadNullableSubmission(t *testing.T) string {
	t.Helper()
	dir := migDir(t)
	b, err := os.ReadFile(filepath.Join(dir, nullableSubmissionFile))
	if err != nil {
		t.Fatalf("read %s: %v", nullableSubmissionFile, err)
	}
	if len(strings.TrimSpace(string(b))) == 0 {
		t.Fatalf("%s is empty", nullableSubmissionFile)
	}
	return string(b)
}

func TestMigration0072StatementsGuarded(t *testing.T) {
	raw := loadNullableSubmission(t)
	stmts := make([]string, 0, 8)
	for _, st := range splitStatements(raw) {
		stmt := strings.TrimSpace(stripSQLComments(st))
		if stmt != "" {
			stmts = append(stmts, stmt)
		}
	}
	if len(stmts) == 0 {
		t.Fatal("no statements found")
	}

	assigns := map[string]string{}
	for _, stmt := range stmts {
		if m := sqlSetVarRe.FindStringSubmatch(stmt); m != nil {
			assigns[m[1]] = stmt
		}
	}

	// No DDL may appear as a bare statement: the relaxation is either
	// idempotent by construction or the body of a conditional prepared
	// statement.
	for _, stmt := range stmts {
		upper := strings.ToUpper(stmt)
		for _, verb := range sqlBareDDLVerbs {
			if strings.HasPrefix(upper, verb) {
				t.Fatalf("%s: unprepared DDL is not crash-retry safe: %.140q", nullableSubmissionFile, stmt)
			}
		}
	}

	prepared := 0
	alteredColumn := false
	for _, stmt := range stmts {
		m := sqlPrepareRe.FindStringSubmatch(stmt)
		if m == nil {
			continue
		}
		sqlVar := m[1]
		assign, ok := assigns[sqlVar]
		if !ok {
			t.Fatalf("%s: PREPARE from an unassigned %s", nullableSubmissionFile, sqlVar)
		}
		if !strings.Contains(assign, "IF(") {
			t.Fatalf("%s: %s must be conditional: %.140q", nullableSubmissionFile, sqlVar, assign)
		}
		guards := sqlGuardRefRe.FindAllStringSubmatch(assign, -1)
		if len(guards) == 0 {
			t.Fatalf("%s: %s branches on no guard: %.140q", nullableSubmissionFile, sqlVar, assign)
		}
		for _, guardMatch := range guards {
			guardVar := guardMatch[0]
			guard, ok := assigns[guardVar]
			if !ok {
				t.Fatalf("%s: %s branches on unassigned %s", nullableSubmissionFile, sqlVar, guardVar)
			}
			if !strings.Contains(strings.ToUpper(guard), "INFORMATION_SCHEMA.COLUMNS") {
				t.Fatalf("%s: %s must read information_schema.columns: %.140q", nullableSubmissionFile, guardVar, guard)
			}
		}
		// The only DDL branch is the one exact relaxation.
		if nullableSubmissionAlterRe.MatchString(assign) {
			alteredColumn = true
		}
		prepared++
	}
	if !alteredColumn {
		t.Fatalf("%s must relax submission_id with %q", nullableSubmissionFile, nullableSubmissionAlterRe.String())
	}
	if prepared < 1 {
		t.Fatalf("expected the guarded column relaxation, found %d prepared statements", prepared)
	}
	executes, deallocs := 0, 0
	for _, stmt := range stmts {
		if sqlExecuteRe.MatchString(stmt) {
			executes++
		}
		if sqlDeallocRe.MatchString(stmt) {
			deallocs++
		}
	}
	if executes != prepared || deallocs != prepared {
		t.Fatalf("prepare/execute/deallocate counts must match: %d/%d/%d", prepared, executes, deallocs)
	}

	// The repair must not re-point submission_id at attempt identity: the FK to
	// student_submissions(id) still exists, so an attempt id would trade the
	// NULL violation for a foreign-key violation, and 0044 owns attempt linkage
	// through attempt_id. Check the code only — the comments explain attempt_id
	// on purpose.
	code := strings.ToLower(strings.Join(stmts, "\n"))
	if strings.Contains(code, "attempt_id") {
		t.Fatalf("%s must not rewrite submission_id to attempt identity", nullableSubmissionFile)
	}
	for _, bad := range []string{"drop column", "drop foreign key", "drop index", "truncate", "delete from", "set submission_id ="} {
		if strings.Contains(code, bad) {
			t.Fatalf("%s must not contain %q", nullableSubmissionFile, bad)
		}
	}
	// The column contract the delivery/terminalization code reads.
	if !strings.Contains(code, "varchar(36) null") {
		t.Fatalf("%s must keep the VARCHAR(36) type and relax it to NULL", nullableSubmissionFile)
	}
}

// nullableSubmissionConn opens TEST_MYSQL_DSN on a fresh isolated scratch schema.
func nullableSubmissionConn(t *testing.T) *sql.Conn {
	t.Helper()
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN not set; 0072 migration test requires real MySQL/TiDB")
	}
	pool, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { _ = pool.Close() })
	if err := pool.Ping(); err != nil {
		t.Skipf("TEST_MYSQL_DSN unreachable, skipping: %v", err)
	}
	name := fmt.Sprintf("nullable0072_%d", time.Now().UnixNano())
	if _, err := pool.Exec("CREATE DATABASE `" + name + "`"); err != nil {
		t.Fatalf("create scratch schema: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec("DROP DATABASE IF EXISTS `" + name + "`") })
	conn, err := pool.Conn(t.Context())
	if err != nil {
		t.Fatalf("acquire conn: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if _, err := conn.ExecContext(t.Context(), "USE `"+name+"`"); err != nil {
		t.Fatalf("use scratch schema: %v", err)
	}
	return conn
}

func applyNullableSubmission(t *testing.T, conn *sql.Conn) {
	t.Helper()
	for _, st := range splitStatements(loadNullableSubmission(t)) {
		if strings.TrimSpace(st) == "" {
			continue
		}
		if _, err := conn.ExecContext(t.Context(), st); err != nil {
			t.Fatalf("apply 0072 statement: %v (%.150q)", err, st)
		}
	}
}

func TestMigration0072NullableSubmissionMySQL(t *testing.T) {
	conn := nullableSubmissionConn(t)
	ctx := t.Context()

	// The pre-0072 shape, verbatim from 0032: NOT NULL, one result per
	// submission, FK to student_submissions(id).
	fixture := []string{
		`CREATE TABLE student_submissions (id VARCHAR(36) PRIMARY KEY)`,
		`CREATE TABLE assessment_results (
			id VARCHAR(36) PRIMARY KEY,
			submission_id VARCHAR(36) NOT NULL,
			provider_key VARCHAR(32) NOT NULL,
			total_score INT,
			score_payload JSON NOT NULL,
			release_status VARCHAR(32) NOT NULL DEFAULT 'ready_to_release',
			created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
			CONSTRAINT uq_assessment_result_submission UNIQUE (submission_id),
			FOREIGN KEY (submission_id) REFERENCES student_submissions(id) ON DELETE CASCADE
		)`,
		`INSERT INTO student_submissions (id) VALUES ('sub-legacy')`,
		`INSERT INTO assessment_results (id, submission_id, provider_key, score_payload)
			VALUES ('ar-legacy', 'sub-legacy', 'ielts', '{"providerKey":"ielts"}')`,
	}
	for _, stmt := range fixture {
		if _, err := conn.ExecContext(ctx, stmt); err != nil {
			t.Fatalf("fixture statement failed: %v (%.140q)", err, stmt)
		}
	}

	// The exact production failure: an attempt-owned SAT outcome cannot insert
	// while the legacy NOT NULL contract is in place.
	if _, err := conn.ExecContext(ctx,
		`INSERT INTO assessment_results (id, submission_id, provider_key, score_payload)
			VALUES ('ar-pre', NULL, 'sat', '{"providerKey":"sat"}')`); err == nil {
		t.Fatal("the 0032 shape must reject a NULL submission_id; fixture is not the production contract")
	}

	applyNullableSubmission(t, conn)
	// The crash-retry contract: a second pass over a partially applied file
	// must be a clean no-op rather than an error.
	applyNullableSubmission(t, conn)

	var nullable string
	if err := conn.QueryRowContext(ctx,
		`SELECT is_nullable FROM information_schema.columns
		 WHERE table_schema = DATABASE() AND table_name = 'assessment_results' AND column_name = 'submission_id'`,
	).Scan(&nullable); err != nil {
		t.Fatalf("read submission_id nullability: %v", err)
	}
	if nullable != "YES" {
		t.Fatalf("assessment_results.submission_id is_nullable = %q, want YES (SAT completion depends on it)", nullable)
	}

	// The relaxation must not drop the two constraints that keep submitted
	// results honest.
	var fkCount, uniqueCount int
	if err := conn.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM information_schema.table_constraints
		 WHERE table_schema = DATABASE() AND table_name = 'assessment_results'
		   AND constraint_name = 'assessment_results_ibfk_1' AND constraint_type = 'FOREIGN KEY'`,
	).Scan(&fkCount); err != nil {
		t.Fatalf("probe FK: %v", err)
	}
	if err := conn.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM information_schema.table_constraints
		 WHERE table_schema = DATABASE() AND table_name = 'assessment_results'
		   AND constraint_name = 'uq_assessment_result_submission' AND constraint_type = 'UNIQUE'`,
	).Scan(&uniqueCount); err != nil {
		t.Fatalf("probe UNIQUE: %v", err)
	}
	if fkCount != 1 || uniqueCount != 1 {
		t.Fatalf("MODIFY must preserve the submission FK and UNIQUE, got fk=%d unique=%d", fkCount, uniqueCount)
	}

	// The legacy submission-keyed row survives untouched.
	var legacyProvider, legacySubmission string
	if err := conn.QueryRowContext(ctx,
		`SELECT provider_key, submission_id FROM assessment_results WHERE id = 'ar-legacy'`,
	).Scan(&legacyProvider, &legacySubmission); err != nil {
		t.Fatalf("read legacy result: %v", err)
	}
	if legacyProvider != "ielts" || legacySubmission != "sub-legacy" {
		t.Fatalf("legacy result changed: provider=%q submission=%q", legacyProvider, legacySubmission)
	}

	// The repair's whole point: an attempt-owned SAT outcome inserts with no
	// student_submissions row.
	if _, err := conn.ExecContext(ctx,
		`INSERT INTO assessment_results (id, submission_id, provider_key, total_score, score_payload, release_status)
			VALUES ('ar-sat', NULL, 'sat', NULL, '{"providerKey":"sat","outcomeStatus":"pending"}', 'pending')`); err != nil {
		t.Fatalf("attempt-owned SAT result must insert after 0072: %v", err)
	}
	var satSubmission sql.NullString
	if err := conn.QueryRowContext(ctx,
		`SELECT submission_id FROM assessment_results WHERE id = 'ar-sat'`).Scan(&satSubmission); err != nil {
		t.Fatalf("read SAT result: %v", err)
	}
	if satSubmission.Valid {
		t.Fatalf("the attempt-owned SAT result must keep submission_id NULL, got %q", satSubmission.String)
	}

	// The FK still rejects an unknown submission id (attempt ids are not
	// submission ids, which is why the repair must not re-point the column).
	if _, err := conn.ExecContext(ctx,
		`INSERT INTO assessment_results (id, submission_id, provider_key, score_payload)
			VALUES ('ar-bad-fk', 'attempt-1', 'sat', '{}')`); err == nil {
		t.Fatal("the submission FK must still reject an id that is not a student_submissions row")
	}
	// Multiple NULL keys are fine, but the UNIQUE still holds for real keys.
	if _, err := conn.ExecContext(ctx,
		`INSERT INTO assessment_results (id, submission_id, provider_key, score_payload)
			VALUES ('ar-dup', 'sub-legacy', 'ielts', '{}')`); err == nil {
		t.Fatal("uq_assessment_result_submission must still reject a second result for one submission")
	}

	// Invalidation (the terminalization service's "SET submission_id = NULL")
	// must be able to detach an already-scored row without deleting it.
	if _, err := conn.ExecContext(ctx,
		`UPDATE assessment_results SET submission_id = NULL, release_status = 'invalidated' WHERE id = 'ar-legacy'`); err != nil {
		t.Fatalf("invalidating a scored result must be able to null submission_id: %v", err)
	}
}
