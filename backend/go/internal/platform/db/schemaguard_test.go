package db

// Plan invariant I6: VerifyRuntimeSchema refuses to serve on a
// half-migrated database. The guard lists (19 columns, 9 indexes) + the
// mutation-uniqueness check + both call sites (api serve gate, migrate
// validate) had ZERO tests — a list edit that drops an entry silently
// weakens the gate. RED: list sizes + missing-object fail-closed +
// uniqueness-guard fail-closed, all via sqlmock (no live DB).
import (
	"context"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestVerifyFailsClosedOnMissingTable(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("information_schema.tables").WillReturnRows(sqlmock.NewRows([]string{"COUNT"}).AddRow(0))
	for range RequiredTables[1:] {
		mock.ExpectQuery("information_schema.tables").WillReturnRows(sqlmock.NewRows([]string{"COUNT"}).AddRow(1))
	}
	v := &SchemaVerifier{DB: db}
	missing, err := v.MissingTables(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(missing) != 1 || missing[0] != "authoring_operation_keys" {
		t.Fatalf("must name the missing 0058 table, got %v", missing)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSchemaGuardListSizes(t *testing.T) {
	if len(RequiredTables) != 13 {
		t.Fatalf("RequiredTables must include the authoring table, 3 existing SAT start-code tables, the 0081 slot table, the 3 0087 score-conversion tables, the 0088 room-operation receipt, the 0092 PDF export table, the 0101 form-response table, and the 0105/0108 recovery tables; got %d", len(RequiredTables))
	}
	if len(RequiredIndexes) != 17 {
		t.Fatalf("RequiredIndexes must include the 10 existing guards, 3 SAT slot indexes, 2 PDF export indexes, and the recovery grant/submission guards, got %d", len(RequiredIndexes))
	}
	seen := map[string]bool{}
	for _, c := range RequiredColumns {
		k := c.Table + "." + c.Column
		if seen[k] {
			t.Fatalf("duplicate required column %s", k)
		}
		seen[k] = true
	}
	if !seen["exam_entities.sat_section_scope"] {
		t.Fatal("SAT exam section scope must be required before serving")
	}
	// Recovery is fail-closed: a database without the writer-authority or
	// generation columns must never accept traffic that could reopen a sitting.
	for _, required := range []string{
		"student_attempts.recovery_control",
		"student_attempts.terminal_generation",
		"attempt_terminalizations.terminal_generation",
		"student_submissions.terminal_generation",
		"assessment_module_attempts.run_generation",
		"user_sessions.recovery_attempt_id",
	} {
		if !seen[required] {
			t.Fatalf("recovery schema guard is missing %s", required)
		}
	}
}

func allPresentColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(1)
}

func TestVerifyFailsClosedOnMissingColumn(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	// sqlmock with default (ordered) matching: first column present,
	// second missing -> MissingColumns stops only at the end, so expect
	// one present row + one zero row then assert the named entry.
	// Simpler and order-proof: expect all 19 queries; the second
	// returns 0 (missing), the rest 1.
	for i := range RequiredColumns {
		n := 1
		if i == 1 {
			n = 0
		}
		mock.ExpectQuery("information_schema.columns").WillReturnRows(sqlmock.NewRows([]string{"COUNT"}).AddRow(n))
	}
	v := &SchemaVerifier{DB: db}
	missing, err := v.MissingColumns(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(missing) != 1 || missing[0] != "student_attempts.answer_revision" {
		t.Fatalf("must name exactly the missing object, got %v", missing)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyFailsClosedOnMissingUniquenessGuard(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("non_unique = 0").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	v := &SchemaVerifier{DB: db}
	if err := v.checkMutationUniquenessGuard(context.Background()); err == nil {
		t.Fatalf("non-unique mutation index must fail the guard")
	}
}

func TestVerifyPassesWhenAllPresent(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for range RequiredTables {
		mock.ExpectQuery("information_schema.tables").WillReturnRows(allPresentColumns())
	}
	for range RequiredColumns {
		mock.ExpectQuery("information_schema.columns").WillReturnRows(allPresentColumns())
	}
	for range RequiredIndexes {
		mock.ExpectQuery("information_schema.statistics").WillReturnRows(allPresentColumns())
	}
	mock.ExpectQuery("non_unique = 0").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(1))
	mock.ExpectQuery("information_schema.check_constraints").WillReturnRows(allPresentColumns())
	v := &SchemaVerifier{DB: db}
	if err := v.Verify(context.Background()); err != nil {
		t.Fatalf("full schema must verify, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSectionFormVocabularyFailsClosed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("information_schema.check_constraints").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	if err := (&SchemaVerifier{DB: db}).checkSectionFormVocabulary(context.Background()); err == nil {
		t.Fatal("0101-only vocabulary must refuse traffic")
	}
}
