package main

// Phase 2 SAT authoring co-edit migration coverage.
//
// The static checks keep the schema contract and additive-only policy visible
// without a database. The MySQL test is intentionally DSN-gated: it applies
// 0063 to 4096-byte columns, retries it after widening, applies 0064 twice,
// and verifies both metadata and untouched binary/materialized values.

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

const (
	authoringCoeditStateVectorMigration = "0063_authoring_coedit_state_vector_width.sql"
	authoringCoeditLifecycleMigration   = "0064_authoring_coedit_lifecycle_epoch.sql"
)

func readAuthoringCoeditMigration(t *testing.T, filename string) string {
	t.Helper()
	path := filepath.Join(migDir(t), filename)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", filename, err)
	}
	if len(splitStatements(string(raw))) == 0 {
		t.Fatalf("%s has no parseable statements", filename)
	}
	return string(raw)
}

func TestAuthoringCoeditStateVectorMigrationStatic(t *testing.T) {
	sqlText := readAuthoringCoeditMigration(t, authoringCoeditStateVectorMigration)
	upper := strings.ToUpper(sqlText)
	if got := strings.Count(upper, "VARBINARY(8192)"); got < 2 {
		t.Fatalf("%s must target both state_vector columns at VARBINARY(8192), found %d targets", authoringCoeditStateVectorMigration, got)
	}
	for _, table := range []string{"authoring_coedit_documents", "authoring_coedit_workspaces"} {
		if !strings.Contains(sqlText, table) {
			t.Fatalf("%s missing table %s", authoringCoeditStateVectorMigration, table)
		}
	}
	for _, required := range []string{"information_schema.columns", "PREPARE", "EXECUTE", "DEALLOCATE PREPARE"} {
		if !strings.Contains(upper, strings.ToUpper(required)) {
			t.Fatalf("%s missing re-run guard component %q", authoringCoeditStateVectorMigration, required)
		}
	}
	assertAuthoringCoeditMigrationAdditive(t, authoringCoeditStateVectorMigration, sqlText)
}

func TestAuthoringCoeditLifecycleMigrationStatic(t *testing.T) {
	sqlText := readAuthoringCoeditMigration(t, authoringCoeditLifecycleMigration)
	upper := strings.ToUpper(sqlText)
	for _, definition := range []string{
		"state_epoch BIGINT UNSIGNED NOT NULL DEFAULT 0",
		"commit_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0",
		"freeze_operation_id CHAR(36) NULL",
		"freeze_expires_at DATETIME(6) NULL",
	} {
		if got := strings.Count(upper, strings.ToUpper(definition)); got != 2 {
			t.Fatalf("%s must define %q once per co-edit table, found %d", authoringCoeditLifecycleMigration, definition, got)
		}
	}
	for _, index := range []string{
		"ix_authoring_coedit_lifecycle_expiry ON authoring_coedit_documents(lifecycle_state, freeze_expires_at)",
		"ix_authoring_coedit_workspace_lifecycle_expiry ON authoring_coedit_workspaces(lifecycle_state, freeze_expires_at)",
	} {
		if !strings.Contains(strings.ToLower(sqlText), strings.ToLower(index)) {
			t.Fatalf("%s missing lifecycle/expiry index %q", authoringCoeditLifecycleMigration, index)
		}
	}
	if got := strings.Count(upper, "INFORMATION_SCHEMA.COLUMNS"); got != 8 {
		t.Fatalf("%s must guard all eight column additions, found %d column probes", authoringCoeditLifecycleMigration, got)
	}
	if got := strings.Count(upper, "INFORMATION_SCHEMA.STATISTICS"); got != 2 {
		t.Fatalf("%s must guard both index additions, found %d index probes", authoringCoeditLifecycleMigration, got)
	}
	assertAuthoringCoeditMigrationAdditive(t, authoringCoeditLifecycleMigration, sqlText)
}

func assertAuthoringCoeditMigrationAdditive(t *testing.T, filename, sqlText string) {
	t.Helper()
	for _, statement := range splitStatements(sqlText) {
		upper := strings.ToUpper(stripRepairComments(statement))
		for _, bad := range []string{"DROP TABLE", "DROP COLUMN", "TRUNCATE", "DELETE FROM", "UPDATE "} {
			if strings.HasPrefix(strings.TrimSpace(upper), bad) {
				t.Fatalf("%s must not contain destructive/data-rewrite operation %q", filename, bad)
			}
		}
	}
}

func authoringCoeditMigrationConn(t *testing.T) *sql.Conn {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN not set; Phase 2 migration test requires real MySQL")
	}
	pool, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("open TEST_MYSQL_DSN: %v", err)
	}
	t.Cleanup(func() { _ = pool.Close() })
	ctx := t.Context()
	if err := pool.PingContext(ctx); err != nil {
		t.Skipf("TEST_MYSQL_DSN unreachable, skipping: %v", err)
	}
	var version string
	if err := pool.QueryRowContext(ctx, "SELECT VERSION()").Scan(&version); err != nil {
		t.Fatalf("read MySQL version: %v", err)
	}
	lowerVersion := strings.ToLower(version)
	if strings.Contains(lowerVersion, "mariadb") || strings.Contains(lowerVersion, "tidb") {
		t.Skipf("Phase 2 migration test requires MySQL, got %q", version)
	}

	name := fmt.Sprintf("authoring_coedit_phase2_%d", time.Now().UnixNano())
	if _, err := pool.ExecContext(ctx, "CREATE DATABASE `"+name+"`"); err != nil {
		t.Fatalf("create isolated schema: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.ExecContext(context.Background(), "DROP DATABASE IF EXISTS `"+name+"`") })
	conn, err := pool.Conn(ctx)
	if err != nil {
		t.Fatalf("acquire isolated connection: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if _, err := conn.ExecContext(ctx, "USE `"+name+"`"); err != nil {
		t.Fatalf("use isolated schema: %v", err)
	}
	return conn
}

func applyAuthoringCoeditMigration(t *testing.T, conn *sql.Conn, filename string) {
	t.Helper()
	for _, statement := range splitStatements(readAuthoringCoeditMigration(t, filename)) {
		if strings.TrimSpace(statement) == "" {
			continue
		}
		if _, err := conn.ExecContext(t.Context(), statement); err != nil {
			t.Fatalf("apply %s: %v (%s)", filename, err, statement)
		}
	}
}

func TestAuthoringCoeditMigrationsMySQLCrashRetryAndBytePreservation(t *testing.T) {
	conn := authoringCoeditMigrationConn(t)
	ctx := t.Context()
	for _, statement := range []string{
		`CREATE TABLE authoring_coedit_documents (
			id CHAR(36) NOT NULL PRIMARY KEY,
			lifecycle_state VARCHAR(16) NOT NULL,
			ydoc_state LONGBLOB NULL,
			state_vector VARBINARY(4096) NULL,
			materialized_prompt MEDIUMTEXT NULL
		)`,
		`CREATE TABLE authoring_coedit_workspaces (
			id CHAR(36) NOT NULL PRIMARY KEY,
			lifecycle_state VARCHAR(16) NOT NULL,
			ydoc_state LONGBLOB NULL,
			state_vector VARBINARY(4096) NULL,
			workspace_json MEDIUMTEXT NULL
		)`,
	} {
		if _, err := conn.ExecContext(ctx, statement); err != nil {
			t.Fatalf("create scratch co-edit table: %v", err)
		}
	}
	docHistory := []byte{0, 1, 2, 255, 10}
	docVector := []byte{9, 8, 7, 0, 255}
	workspaceHistory := []byte{3, 4, 5, 250}
	workspaceVector := []byte{6, 0, 254, 1}
	if _, err := conn.ExecContext(ctx, `INSERT INTO authoring_coedit_documents
		(id, lifecycle_state, ydoc_state, state_vector, materialized_prompt)
		VALUES ('doc-1', 'active', ?, ?, 'prompt sentinel')`, docHistory, docVector); err != nil {
		t.Fatalf("seed document: %v", err)
	}
	if _, err := conn.ExecContext(ctx, `INSERT INTO authoring_coedit_workspaces
		(id, lifecycle_state, ydoc_state, state_vector, workspace_json)
		VALUES ('workspace-1', 'active', ?, ?, '{"sentinel":true}')`, workspaceHistory, workspaceVector); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}

	// First pass upgrades the existing 4096-byte schema. The second pass
	// exercises 0063's already-widened branch and 0064's complete retry path.
	applyAuthoringCoeditMigration(t, conn, authoringCoeditStateVectorMigration)
	applyAuthoringCoeditMigration(t, conn, authoringCoeditLifecycleMigration)
	applyAuthoringCoeditMigration(t, conn, authoringCoeditStateVectorMigration)
	applyAuthoringCoeditMigration(t, conn, authoringCoeditLifecycleMigration)

	for _, table := range []string{"authoring_coedit_documents", "authoring_coedit_workspaces"} {
		if got := authoringCoeditColumnLength(t, conn, table, "state_vector"); got != 8192 {
			t.Fatalf("%s.state_vector length = %d, want 8192", table, got)
		}
		for _, column := range []string{"state_epoch", "commit_sequence", "freeze_operation_id", "freeze_expires_at"} {
			if !authoringCoeditColumnExists(t, conn, table, column) {
				t.Fatalf("missing %s.%s after migration", table, column)
			}
		}
	}
	assertAuthoringCoeditColumn(t, conn, "authoring_coedit_documents", "state_epoch", "bigint unsigned", "NO", "0", "")
	assertAuthoringCoeditColumn(t, conn, "authoring_coedit_documents", "commit_sequence", "bigint unsigned", "NO", "0", "")
	assertAuthoringCoeditColumn(t, conn, "authoring_coedit_documents", "freeze_operation_id", "char(36)", "YES", "<NULL>", "")
	assertAuthoringCoeditColumn(t, conn, "authoring_coedit_documents", "freeze_expires_at", "datetime(6)", "YES", "<NULL>", "6")
	assertAuthoringCoeditColumn(t, conn, "authoring_coedit_workspaces", "state_epoch", "bigint unsigned", "NO", "0", "")
	assertAuthoringCoeditColumn(t, conn, "authoring_coedit_workspaces", "commit_sequence", "bigint unsigned", "NO", "0", "")
	assertAuthoringCoeditColumn(t, conn, "authoring_coedit_workspaces", "freeze_operation_id", "char(36)", "YES", "<NULL>", "")
	assertAuthoringCoeditColumn(t, conn, "authoring_coedit_workspaces", "freeze_expires_at", "datetime(6)", "YES", "<NULL>", "6")

	assertAuthoringCoeditIndex(t, conn, "authoring_coedit_documents", "ix_authoring_coedit_lifecycle_expiry", []string{"lifecycle_state", "freeze_expires_at"})
	assertAuthoringCoeditIndex(t, conn, "authoring_coedit_workspaces", "ix_authoring_coedit_workspace_lifecycle_expiry", []string{"lifecycle_state", "freeze_expires_at"})

	var gotDocHistory, gotDocVector []byte
	var gotPrompt string
	if err := conn.QueryRowContext(ctx, `SELECT ydoc_state, state_vector, materialized_prompt
		FROM authoring_coedit_documents WHERE id = 'doc-1'`).Scan(&gotDocHistory, &gotDocVector, &gotPrompt); err != nil {
		t.Fatalf("read document sentinel: %v", err)
	}
	if !bytes.Equal(gotDocHistory, docHistory) || !bytes.Equal(gotDocVector, docVector) || gotPrompt != "prompt sentinel" {
		t.Fatalf("document bytes/projection changed: history=%v vector=%v prompt=%q", gotDocHistory, gotDocVector, gotPrompt)
	}
	var gotWorkspaceHistory, gotWorkspaceVector []byte
	var gotJSON string
	if err := conn.QueryRowContext(ctx, `SELECT ydoc_state, state_vector, workspace_json
		FROM authoring_coedit_workspaces WHERE id = 'workspace-1'`).Scan(&gotWorkspaceHistory, &gotWorkspaceVector, &gotJSON); err != nil {
		t.Fatalf("read workspace sentinel: %v", err)
	}
	if !bytes.Equal(gotWorkspaceHistory, workspaceHistory) || !bytes.Equal(gotWorkspaceVector, workspaceVector) || gotJSON != `{"sentinel":true}` {
		t.Fatalf("workspace bytes/projection changed: history=%v vector=%v json=%q", gotWorkspaceHistory, gotWorkspaceVector, gotJSON)
	}
}

func authoringCoeditColumnLength(t *testing.T, conn *sql.Conn, table, column string) int64 {
	t.Helper()
	var length sql.NullInt64
	err := conn.QueryRowContext(t.Context(), `SELECT CHARACTER_OCTET_LENGTH
		FROM information_schema.columns
		WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, table, column).Scan(&length)
	if err != nil {
		t.Fatalf("read %s.%s length: %v", table, column, err)
	}
	if !length.Valid {
		t.Fatalf("%s.%s has no character octet length", table, column)
	}
	return length.Int64
}

func authoringCoeditColumnExists(t *testing.T, conn *sql.Conn, table, column string) bool {
	t.Helper()
	var count int
	if err := conn.QueryRowContext(t.Context(), `SELECT COUNT(*)
		FROM information_schema.columns
		WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, table, column).Scan(&count); err != nil {
		t.Fatalf("probe %s.%s: %v", table, column, err)
	}
	return count == 1
}

func assertAuthoringCoeditColumn(t *testing.T, conn *sql.Conn, table, column, wantType, wantNullable, wantDefault, wantPrecision string) {
	t.Helper()
	var columnType, nullable, columnDefault, precision string
	err := conn.QueryRowContext(t.Context(), `SELECT column_type, is_nullable,
		COALESCE(column_default, '<NULL>'), COALESCE(CAST(datetime_precision AS CHAR), '')
		FROM information_schema.columns
		WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, table, column).Scan(&columnType, &nullable, &columnDefault, &precision)
	if err != nil {
		t.Fatalf("read %s.%s contract: %v", table, column, err)
	}
	if columnType != wantType || nullable != wantNullable || columnDefault != wantDefault || precision != wantPrecision {
		t.Fatalf("%s.%s = type=%q nullable=%q default=%q precision=%q, want type=%q nullable=%q default=%q precision=%q", table, column, columnType, nullable, columnDefault, precision, wantType, wantNullable, wantDefault, wantPrecision)
	}
}

func assertAuthoringCoeditIndex(t *testing.T, conn *sql.Conn, table, index string, wantColumns []string) {
	t.Helper()
	rows, err := conn.QueryContext(t.Context(), `SELECT column_name
		FROM information_schema.statistics
		WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
		ORDER BY seq_in_index`, table, index)
	if err != nil {
		t.Fatalf("read %s.%s: %v", table, index, err)
	}
	defer func() { _ = rows.Close() }()
	var got []string
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			t.Fatalf("scan %s.%s: %v", table, index, err)
		}
		got = append(got, column)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate %s.%s: %v", table, index, err)
	}
	if fmt.Sprint(got) != fmt.Sprint(wantColumns) {
		t.Fatalf("%s.%s columns = %v, want %v", table, index, got, wantColumns)
	}
}
