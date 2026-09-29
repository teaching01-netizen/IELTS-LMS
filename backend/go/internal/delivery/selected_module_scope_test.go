package delivery

// Content-by-id fence (SEV-1 follow-up).
//
// selectedModuleSection is the cold-snapshot fallback that hands a client ONE
// module's content by id. The delivery payload and media authorization are
// already narrowed to the modules the attempt was routed into, so this path
// must be too: an adaptive branch with no assessment_module_attempts row is not
// the candidate's to read, however the request is phrased.

import (
	"context"
	"database/sql"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

const selectedModuleScopeQuery = "SELECT module_id FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?"

func TestSelectedModuleSectionHidesAnUnassignedModule(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	// The unassigned branch has no row at all: the read must stop here rather
	// than fall through to the version tree.
	mock.ExpectQuery(regexp.QuoteMeta(selectedModuleScopeQuery)).
		WithArgs("att-1", "mod-lower").
		WillReturnError(sql.ErrNoRows)

	_, err = deliverySvc(db).selectedModuleSection(context.Background(), "att-1", "sched-1", "ver-1", "mod-lower")
	if deliveryCodeOf(err) != apperrors.CodeNotFound {
		t.Fatalf("an unassigned module must be NOT_FOUND, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
