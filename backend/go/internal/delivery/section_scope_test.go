package delivery

// Student Access section scope (migration 0066) at the delivery boundary: a
// narrowed link must never ship the section it dropped to the browser, must
// seed the first module of the section the run actually starts with, and must
// not advance into a dropped section when the current one ends.

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func sectionFixture(key string) DeliverySection {
	return DeliverySection{
		ID: key + "-sec", SectionKey: key, Title: key, DisplayOrder: 0,
		DurationSeconds: 3840,
		Modules:         []DeliveryModule{{ID: key + "-mod", ModuleKey: key + "-m1", AdaptiveRole: "base", DurationSeconds: 3840}},
	}
}

// The scoped tree is a fresh slice — the version cache's tree is shared across
// schedules and must never be mutated in place — and an unscoped link keeps
// every section.
func TestDeliverySectionsForScopeNarrowsTree(t *testing.T) {
	cached := []DeliverySection{sectionFixture("reading-writing"), sectionFixture("math")}

	all := deliverySectionsForScope(cached, nil)
	if len(all) != 2 {
		t.Fatalf("an unscoped link must keep every section, got %d", len(all))
	}
	verbalOnly := deliverySectionsForScope(cached, map[string]bool{"reading-writing": true})
	if len(verbalOnly) != 1 || verbalOnly[0].SectionKey != "reading-writing" {
		t.Fatalf("expected only reading-writing, got %+v", verbalOnly)
	}
	if len(cached) != 2 {
		t.Fatalf("the cached tree must not be mutated, got %d sections", len(cached))
	}
}

// The schedule-scoped read used by Bootstrap/assembleBootstrap resolves the
// link's stored scope; no link and no schedule id both mean "no narrowing".
func TestLinkSectionScopeResolvesStoredScope(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)

	mock.ExpectQuery(regexp.QuoteMeta("SELECT enabled_sections FROM assessment_access_links WHERE schedule_id = ?")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"enabled_sections"}).AddRow(`["math"]`))
	scope, err := svc.linkSectionScope(context.Background(), "sched-1")
	if err != nil {
		t.Fatalf("linkSectionScope must succeed: %v", err)
	}
	if !scope["math"] || len(scope) != 1 {
		t.Fatalf("expected a math-only scope, got %v", scope)
	}

	mock.ExpectQuery(regexp.QuoteMeta("SELECT enabled_sections FROM assessment_access_links WHERE schedule_id = ?")).
		WithArgs("sched-2").
		WillReturnError(sql.ErrNoRows)
	scope, err = svc.linkSectionScope(context.Background(), "sched-2")
	if err != nil {
		t.Fatalf("a schedule with no link must not error: %v", err)
	}
	if scope != nil {
		t.Fatalf("a schedule with no link must not narrow, got %v", scope)
	}

	if scope, err := svc.linkSectionScope(context.Background(), "  "); err != nil || scope != nil {
		t.Fatalf("an empty schedule id must skip the read, got %v / %v", scope, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func nextModuleSectionRows(rows ...[]driver.Value) *sqlmock.Rows {
	out := sqlmock.NewRows([]string{"id", "section_key", "display_order", "adaptive_role", "exam_version_id"})
	for _, row := range rows {
		out.AddRow(row...)
	}
	return out
}

// A verbal-only run ends after Reading & Writing: the next-section lookup is
// filtered to the scoped sections, so Math is never opened.
func TestNextModuleTxSkipsSectionDroppedByLinkScope(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	mock.ExpectBegin()
	txn, txerr := db.BeginTx(context.Background(), nil)
	if txerr != nil {
		t.Fatal(txerr)
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-rw").
		WillReturnRows(nextModuleSectionRows([]driver.Value{"sec-rw", "reading-writing", 0, "lower_branch", "pv-1"}))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT l.enabled_sections, v.sat_publish_scope FROM student_attempts a JOIN exam_versions v")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"enabled_sections", "sat_publish_scope"}).AddRow(`["reading-writing"]`, nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM assessment_sections WHERE exam_version_id = ? AND display_order > ? AND section_key IN (?) ORDER BY display_order LIMIT 1")).
		WithArgs("pv-1", 0, "reading-writing").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	next, err := svc.nextModuleTx(context.Background(), txn, "att-1", "ma-rw", "mod-rw", 20, 27)
	if err != nil {
		t.Fatalf("nextModuleTx must succeed: %v", err)
	}
	if next != nil {
		t.Fatalf("a verbal-only run must have no follow-up section, got %+v", next)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Without a link the lookup keeps its original shape — no IN clause, no extra
// argument — so an unscoped run advances exactly as it did before this feature.
func TestNextModuleTxWithoutLinkScopeKeepsOriginalQuery(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	mock.ExpectBegin()
	txn, txerr := db.BeginTx(context.Background(), nil)
	if txerr != nil {
		t.Fatal(txerr)
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-rw").
		WillReturnRows(nextModuleSectionRows([]driver.Value{"sec-rw", "reading-writing", 0, "lower_branch", "pv-1"}))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT l.enabled_sections, v.sat_publish_scope FROM student_attempts a JOIN exam_versions v")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"enabled_sections", "sat_publish_scope"}).AddRow(nil, nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM assessment_sections WHERE exam_version_id = ? AND display_order > ? ORDER BY display_order LIMIT 1")).
		WithArgs("pv-1", 0).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("sec-math"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.section_id = ? AND m.adaptive_role = 'base'")).
		WithArgs("sec-math").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_id", "section_key", "module_key", "duration_seconds", "adaptive_role", "tool_policy"}).
			AddRow("mod-math", "sec-math", "math", "math-m1", 4200, "base", nil))

	next, err := svc.nextModuleTx(context.Background(), txn, "att-1", "ma-rw", "mod-rw", 20, 27)
	if err != nil {
		t.Fatalf("nextModuleTx must succeed: %v", err)
	}
	if next == nil || next.id != "mod-math" {
		t.Fatalf("an unscoped run must still advance to math, got %+v", next)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A schedule with no Student Access link still cannot advance beyond the
// section pinned into a partial SAT release.
func TestNextModuleTxHonorsPublishedScopeWithoutLink(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	mock.ExpectBegin()
	txn, txerr := db.BeginTx(context.Background(), nil)
	if txerr != nil {
		t.Fatal(txerr)
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-rw").
		WillReturnRows(nextModuleSectionRows([]driver.Value{"sec-rw", "reading-writing", 0, "lower_branch", "pv-1"}))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT l.enabled_sections, v.sat_publish_scope FROM student_attempts a JOIN exam_versions v")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"enabled_sections", "sat_publish_scope"}).AddRow(nil, "reading-writing"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM assessment_sections WHERE exam_version_id = ? AND display_order > ? AND section_key IN (?) ORDER BY display_order LIMIT 1")).
		WithArgs("pv-1", 0, "reading-writing").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	next, err := svc.nextModuleTx(context.Background(), txn, "att-1", "ma-rw", "mod-rw", 20, 27)
	if err != nil {
		t.Fatalf("nextModuleTx must succeed: %v", err)
	}
	if next != nil {
		t.Fatalf("a partial release must end after its published section, got %+v", next)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// An empty release/link intersection is an empty run. It must not omit the
// section predicate and accidentally become an unrestricted lookup.
func TestNextModuleTxStopsForEmptyScopeIntersection(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	mock.ExpectBegin()
	txn, txerr := db.BeginTx(context.Background(), nil)
	if txerr != nil {
		t.Fatal(txerr)
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-rw").
		WillReturnRows(nextModuleSectionRows([]driver.Value{"sec-rw", "reading-writing", 0, "lower_branch", "pv-1"}))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT l.enabled_sections, v.sat_publish_scope FROM student_attempts a JOIN exam_versions v")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"enabled_sections", "sat_publish_scope"}).AddRow(`["math"]`, "reading-writing"))

	next, err := svc.nextModuleTx(context.Background(), txn, "att-1", "ma-rw", "mod-rw", 20, 27)
	if err != nil {
		t.Fatalf("nextModuleTx must succeed: %v", err)
	}
	if next != nil {
		t.Fatalf("an empty scope intersection must not advance, got %+v", next)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
