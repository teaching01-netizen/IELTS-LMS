package library

import (
	"context"
	"database/sql"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func libraryActor() auth.ActorContext {
	return auth.NewActorContext("user-1", auth.RoleAdmin)
}

func librarySvc(db *sql.DB) *Service { return NewService(db, nil) }

func libraryCodeOf(err error) apperrors.Code {
	if e, ok := apperrors.As(err); ok {
		return e.Code
	}
	return ""
}

// Revision fence: a stale update loses with 409, never silently overwrites.
func TestLibraryUpdatePassageRevisionFence(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := librarySvc(db)
	actor := libraryActor()

	passageRows := sqlmock.NewRows([]string{
		"id", "organization_id", "title", "passage_snapshot", "difficulty", "topic",
		"tags", "word_count", "estimated_time_minutes", "usage_count", "created_by",
		"created_at", "updated_at", "revision",
	}).AddRow("p-1", nil, "Title", []byte("{}"), "easy", "topic", []byte("[]"), 10, 5, 0, "user-1", nil, nil, 3)
	mock.ExpectQuery(regexp.QuoteMeta("FROM passage_library_items WHERE id")).WillReturnRows(passageRows)

	_, err = svc.UpdatePassage(context.Background(), actor, "p-1", UpdatePassageRequest{Revision: 2})
	if libraryCodeOf(err) != apperrors.CodeConflict {
		t.Fatalf("expected CONFLICT on stale revision, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Read scope: a tenant actor cannot see foreign-org rows (404, not 403 leak).
func TestLibraryUpdatePassageForeignOrgNotFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := librarySvc(db)
	actor := auth.NewActorContext("user-9", auth.RoleBuilder).WithOrgID("org-a")

	// SQL scope is bypassed by the mock, so the row comes back foreign-org;
	// the Go-side writable guard must still refuse with NOT_FOUND (never 403).
	passageRows := sqlmock.NewRows([]string{
		"id", "organization_id", "title", "passage_snapshot", "difficulty", "topic",
		"tags", "word_count", "estimated_time_minutes", "usage_count", "created_by",
		"created_at", "updated_at", "revision",
	}).AddRow("p-2", "org-b", "Foreign", []byte("{}"), "easy", "topic", []byte("[]"), 10, 5, 0, "user-2", nil, nil, 0)
	mock.ExpectQuery(regexp.QuoteMeta("FROM passage_library_items WHERE id")).WillReturnRows(passageRows)

	_, err = svc.UpdatePassage(context.Background(), actor, "p-2", UpdatePassageRequest{Revision: 0})
	if libraryCodeOf(err) != apperrors.CodeNotFound {
		t.Fatalf("expected NOT_FOUND on foreign-org write, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Validation: export profile names are required and snapshots must be objects.
func TestLibraryCreateExportProfileValidation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := librarySvc(db)
	actor := libraryActor()

	if _, err := svc.CreateExportProfile(context.Background(), actor, CreateExportProfileRequest{ProfileName: "  ", ConfigSnapshot: []byte("{}")}); libraryCodeOf(err) != apperrors.CodeBadRequest {
		t.Fatalf("expected BAD_REQUEST on blank name, got %v", err)
	}
	if _, err := svc.CreateExportProfile(context.Background(), actor, CreateExportProfileRequest{ProfileName: "P", ConfigSnapshot: []byte("[1,2]")}); libraryCodeOf(err) != apperrors.CodeBadRequest {
		t.Fatalf("expected BAD_REQUEST on array snapshot, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
