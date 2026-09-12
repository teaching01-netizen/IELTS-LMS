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
	if len(RequiredTables) != 1 {
		t.Fatalf("RequiredTables must hold 1 entry (0058), got %d", len(RequiredTables))
	}
	if len(RequiredColumns) != 19 {
		t.Fatalf("RequiredColumns must hold 19 entries (I6), got %d", len(RequiredColumns))
	}
	if len(RequiredIndexes) != 9 {
		t.Fatalf("RequiredIndexes must hold 9 entries (I6), got %d", len(RequiredIndexes))
	}
	seen := map[string]bool{}
	for _, c := range RequiredColumns {
		k := c.Table + "." + c.Column
		if seen[k] {
			t.Fatalf("duplicate required column %s", k)
		}
		seen[k] = true
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
	v := &SchemaVerifier{DB: db}
	if err := v.Verify(context.Background()); err != nil {
		t.Fatalf("full schema must verify, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
