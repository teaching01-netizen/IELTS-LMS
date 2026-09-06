package results

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestListDashboardRejectsUnknownProviderBeforeDatabaseAccess(t *testing.T) {
	svc := NewService(nil)

	_, err := svc.ListDashboard(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "toefl", 25)
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("expected VALIDATION_ERROR, got %v", err)
	}
}

func TestListDashboardTrimsProviderBeforeDispatch(t *testing.T) {
	// The normalized provider is validated and dispatched consistently. The
	// query expectation proves the trimmed value is bound instead of silently
	// returning an empty result set.
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	queryErr := errors.New("query reached")
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results ar")).
		WithArgs("act", 25).
		WillReturnError(queryErr)
	svc := NewService(db)

	_, err = svc.ListDashboard(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), " act ", 25)
	if !errors.Is(err, queryErr) {
		t.Fatalf("expected dispatch to reach the database with the trimmed provider, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestResultScopeFailsClosedWithoutTenant(t *testing.T) {
	scope, args := resultScope("sch", auth.NewActorContext("grader-1", auth.RoleGrader))
	if scope != " AND 1 = 0" {
		t.Fatalf("expected fail-closed scope, got %q", scope)
	}
	if args != nil {
		t.Fatalf("expected no bind arguments for fail-closed scope, got %#v", args)
	}
}

func TestResultScopeUsesPlatformReadWithoutPredicate(t *testing.T) {
	scope, args := resultScope("sch", auth.NewActorContext("observer-1", auth.RoleAdminObserver))
	if scope != "" || args != nil {
		t.Fatalf("expected platform read to avoid tenant predicate, got %q %#v", scope, args)
	}
}

func TestResultScopeBindsTenantAndAssignment(t *testing.T) {
	actor := auth.NewActorContext("grader-1", auth.RoleGrader).WithOrgID("org-1")
	scope, args := resultScope("sch", actor)
	if !strings.Contains(scope, "sch.organization_id = ?") {
		t.Fatalf("expected organization predicate, got %q", scope)
	}
	if !strings.Contains(scope, "assignment.user_id = ?") || !strings.Contains(scope, "assignment.role = ?") {
		t.Fatalf("expected assignment predicate, got %q", scope)
	}
	if len(args) != 3 || args[0] != "org-1" || args[1] != "grader-1" || args[2] != auth.RoleGrader {
		t.Fatalf("unexpected scope arguments: %#v", args)
	}
}

func TestResultValueDecoders(t *testing.T) {
	if got := parseIntPtr(" 40 "); got == nil || *got != 40 {
		t.Fatalf("expected integer decoder to return 40, got %v", got)
	}
	if got := parseIntPtr("not-a-number"); got != nil {
		t.Fatalf("expected invalid integer to return nil, got %v", *got)
	}
	if got := parseFloatPtr(" 82.5 "); got == nil || *got != 82.5 {
		t.Fatalf("expected float decoder to return 82.5, got %v", got)
	}
	if got := parseFloatPtr("not-a-number"); got != nil {
		t.Fatalf("expected invalid float to return nil, got %v", *got)
	}

	sectionBands := decodeSectionBands(sql.NullString{String: `{"reading":7.5}`, Valid: true})
	if sectionBands["reading"] != 7.5 {
		t.Fatalf("expected decoded reading band, got %#v", sectionBands)
	}
	if decodeSectionBands(sql.NullString{String: "not-json", Valid: true}) != nil {
		t.Fatal("expected invalid section bands JSON to fail closed")
	}
}
