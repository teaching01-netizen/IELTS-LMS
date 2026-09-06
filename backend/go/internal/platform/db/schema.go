// Package db — schema guard. VerifyRuntimeSchema mirrors
// backend/crates/infrastructure/src/migrations.rs: after migrations run,
// startup refuses to serve when the durability-critical columns/indexes
// are missing, so a half-migrated database can never take traffic.
package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// RequiredColumn is one (table, column) pair the runtime depends on.
type RequiredColumn struct {
	Table  string
	Column string
}

// RequiredColumns: 19 durability-critical columns from the Rust
// REQUIRED_COLUMNS guard (student_attempts V2 lifecycle + lease/control +
// deadline/grace + digest, terminalization id, assessment outcome linkage,
// websocket leases, identity scoping, heartbeat mutation id, legacy
// write-id compatibility).
var RequiredColumns = []RequiredColumn{
	{Table: "student_attempts", Column: "active_client_session_id"},
	{Table: "student_attempts", Column: "answer_revision"},
	{Table: "student_attempts", Column: "protocol_version"},
	{Table: "student_attempts", Column: "delivery_status"},
	{Table: "student_attempts", Column: "lease_epoch"},
	{Table: "student_attempts", Column: "control_epoch"},
	{Table: "student_attempts", Column: "response_revision"},
	{Table: "student_attempts", Column: "deadline_at"},
	{Table: "student_attempts", Column: "closing_grace_until"},
	{Table: "student_attempts", Column: "final_response_digest"},
	{Table: "attempt_terminalizations", Column: "terminalization_id"},
	{Table: "assessment_results", Column: "attempt_id"},
	{Table: "assessment_results", Column: "outcome_status"},
	{Table: "assessment_question_revisions", Column: "updated_by"},
	{Table: "exam_session_runtimes", Column: "timing_model"},
	{Table: "websocket_connection_leases", Column: "lease_token"},
	{Table: "users", Column: "organization_id"},
	{Table: "student_heartbeat_events", Column: "mutation_id"},
	{Table: "assessment_question_responses", Column: "client_write_id"},
}

// RequiredIndex is one (table, index) pair the runtime depends on.
type RequiredIndex struct {
	Table string
	Index string
}

// RequiredIndexes: 9 uniqueness/lookup guards from the Rust
// REQUIRED_INDEXES list (mutation idempotency, schedule lookups, terminal
// receipts, provider results, module identity, heartbeat dedupe, V2
// write/version uniqueness, submission receipts).
var RequiredIndexes = []RequiredIndex{
	{Table: "student_attempt_mutations", Index: "idx_student_attempt_mutations_attempt_mutation_id"},
	{Table: "student_attempts", Index: "idx_student_attempts_schedule_submitted_id"},
	{Table: "attempt_terminalizations", Index: "idx_attempt_terminalizations_schedule_recorded"},
	{Table: "assessment_results", Index: "uq_assessment_result_attempt_provider"},
	{Table: "assessment_module_attempts", Index: "module_attempt_identity"},
	{Table: "student_heartbeat_events", Index: "heartbeat_mutation"},
	{Table: "attempt_mutations_v2", Index: "uq_attempt_mutations_v2_write_id"},
	{Table: "attempt_mutations_v2", Index: "uq_attempt_mutations_v2_version"},
	{Table: "attempt_submissions_v2", Index: "uq_attempt_submissions_v2_submission"},
}

// SchemaVerifier queries information_schema for the required lists.
type SchemaVerifier struct {
	DB *sql.DB
}

// VerifyRuntimeSchema checks required columns, required indexes and the
// mutation uniqueness guard. It returns a descriptive error listing every
// missing object so operators know exactly what migration step to run.
func VerifyRuntimeSchema(ctx context.Context, db *sql.DB) error {
	v := &SchemaVerifier{DB: db}
	return v.Verify(ctx)
}

// Verify runs the full runtime schema guard.
func (v *SchemaVerifier) Verify(ctx context.Context) error {
	missingCols, err := v.MissingColumns(ctx)
	if err != nil {
		return fmt.Errorf("db: verify columns: %w", err)
	}
	missingIdx, err := v.MissingIndexes(ctx)
	if err != nil {
		return fmt.Errorf("db: verify indexes: %w", err)
	}
	var missing []string
	missing = append(missing, missingCols...)
	missing = append(missing, missingIdx...)
	if err := v.checkMutationUniquenessGuard(ctx); err != nil {
		return err
	}
	if len(missing) > 0 {
		return fmt.Errorf("db: required schema objects missing: %s; run the database migrator before starting the API", strings.Join(missing, ", "))
	}
	return nil
}

// MissingColumns returns "table.column" entries absent from information_schema.
func (v *SchemaVerifier) MissingColumns(ctx context.Context) ([]string, error) {
	var missing []string
	for _, c := range RequiredColumns {
		var n int64
		err := v.DB.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
			c.Table, c.Column).Scan(&n)
		if err != nil {
			return nil, fmt.Errorf("column %s.%s: %w", c.Table, c.Column, err)
		}
		if n == 0 {
			missing = append(missing, c.Table+"."+c.Column)
		}
	}
	return missing, nil
}

// MissingIndexes returns "table.index" entries absent from information_schema.
func (v *SchemaVerifier) MissingIndexes(ctx context.Context) ([]string, error) {
	var missing []string
	for _, ix := range RequiredIndexes {
		var n int64
		err := v.DB.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
			ix.Table, ix.Index).Scan(&n)
		if err != nil {
			return nil, fmt.Errorf("index %s.%s: %w", ix.Table, ix.Index, err)
		}
		if n == 0 {
			missing = append(missing, ix.Table+"."+ix.Index)
		}
	}
	return missing, nil
}

// checkMutationUniquenessGuard enforces the idempotency invariant:
// student_attempt_mutations must carry a UNIQUE
// idx_student_attempt_mutations_attempt_mutation_id(attempt_id,
// client_mutation_id) so retries can never double-apply a student action.
func (v *SchemaVerifier) checkMutationUniquenessGuard(ctx context.Context) error {
	var n int64
	err := v.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM information_schema.statistics
		 WHERE table_schema = DATABASE()
		   AND table_name = 'student_attempt_mutations'
		   AND index_name = 'idx_student_attempt_mutations_attempt_mutation_id'
		   AND non_unique = 0`).Scan(&n)
	if err != nil {
		return fmt.Errorf("db: verify mutation uniqueness guard: %w", err)
	}
	if n == 0 {
		return fmt.Errorf("db: required idempotency invariant missing: student_attempt_mutations must have UNIQUE idx_student_attempt_mutations_attempt_mutation_id(attempt_id, client_mutation_id)")
	}
	return nil
}

// SchemaVersion returns the newest applied migration filename, or "" when
// the history table is empty. cmd/api reports it on /readyz.
func SchemaVersion(ctx context.Context, db *sql.DB) (string, error) {
	var v sql.NullString
	err := db.QueryRowContext(ctx, `SELECT MAX(filename) FROM schema_migrations`).Scan(&v)
	if err != nil {
		return "", fmt.Errorf("db: schema version: %w", err)
	}
	if !v.Valid {
		return "", nil
	}
	return v.String, nil
}
