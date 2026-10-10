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

const selectedModuleScopeQuery = "SELECT v.revision, v.sat_publish_scope, l.enabled_sections FROM assessment_module_attempts m JOIN student_attempts a ON a.id = m.attempt_id JOIN exam_schedules s ON s.id = ? JOIN exam_versions v ON v.id = ? LEFT JOIN assessment_access_links l ON l.schedule_id = s.id WHERE m.attempt_id = ? AND m.module_id = ? AND a.schedule_id = s.id AND a.published_version_id = v.id"

func TestSelectedModuleSectionHidesAnUnassignedModule(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	// An unassigned branch has no joined attempt/module/version/schedule row;
	// the combined ownership and current-scope read must stop before loading
	// the cached version tree.
	mock.ExpectQuery(regexp.QuoteMeta(selectedModuleScopeQuery)).
		WithArgs("sched-1", "ver-1", "att-1", "mod-lower").
		WillReturnError(sql.ErrNoRows)

	_, err = deliverySvc(db).selectedModuleSection(context.Background(), "att-1", "sched-1", "ver-1", "mod-lower")
	if deliveryCodeOf(err) != apperrors.CodeNotFound {
		t.Fatalf("an unassigned module must be NOT_FOUND, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
