package delivery

// Decision D2 pins: under cohort_section_v3 the SECTION clock is the only
// server-side expirer. The personal module clock stays the student-facing
// allotment (the client submits at min(personal, section)), but a module must
// never be force-closed on it — closing early would consume the student's
// remaining section time without the section having ended.

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

const (
	moduleSectionLookup = "SELECT s.section_key FROM assessment_modules m JOIN assessment_sections s"
	sectionClockLock    = "FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = ? FOR UPDATE"
)

// cohortSectionModuleExpired runs the cohort_section_v3 expiry branch against a
// programmed section clock row.
func cohortSectionModuleExpired(t *testing.T, mod *reconcileRow, stageStatus string, stageStart *time.Time, stagePausedAt *time.Time, planned int64, asOf time.Time) bool {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(moduleSectionLookup)).
		WithArgs("mod-1").
		WillReturnRows(sqlmock.NewRows([]string{"section_key"}).AddRow("reading-writing"))
	mock.ExpectQuery(regexp.QuoteMeta(sectionClockLock)).
		WithArgs("rt-1", "reading-writing").
		WillReturnRows(sqlmock.NewRows([]string{
			"section_order", "status", "actual_start_at", "paused_at",
			"planned_duration_minutes", "extension_minutes", "accumulated_paused_seconds",
		}).AddRow(int64(1), stageStatus, stageStart, stagePausedAt, planned, int64(0), int64(0)))

	order := 1
	expired, err := reconcileModuleExpiredTx(context.Background(), db, "rt-1", "live", "cohort_section_v3",
		sql.NullString{String: "reading-writing", Valid: true}, &order, mod, asOf.UTC())
	if err != nil {
		t.Fatalf("expiry branch: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	return expired
}

// A module whose personal clock is long exhausted but whose section is still
// live with time on the clock is NOT finalized.
func TestCohortSectionModuleIsNotExpiredOnPersonalClock(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	startedAt := now.Add(-40 * time.Minute)
	stageStart := now.Add(-10 * time.Minute)
	mod := &reconcileRow{
		id: "ma-1", moduleID: "mod-1", state: "active",
		allocatedSeconds: 30 * 60, startedAt: &startedAt,
	}
	if cohortSectionModuleExpired(t, mod, "live", &stageStart, nil, 64, now) {
		t.Fatal("the personal module clock must not expire a module while its section is live")
	}
}

// The same module is finalized once its section clock has run out.
func TestCohortSectionModuleExpiresWhenSectionDeadlinePassed(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	startedAt := now.Add(-40 * time.Minute)
	stageStart := now.Add(-70 * time.Minute)
	mod := &reconcileRow{
		id: "ma-1", moduleID: "mod-1", state: "active",
		allocatedSeconds: 30 * 60, startedAt: &startedAt,
	}
	if !cohortSectionModuleExpired(t, mod, "live", &stageStart, nil, 64, now) {
		t.Fatal("a module past its section deadline must be finalized")
	}
}

// A section that already completed expires its remaining modules.
func TestCohortSectionModuleExpiresOnCompletedSection(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	startedAt := now.Add(-5 * time.Minute)
	stageStart := now.Add(-10 * time.Minute)
	mod := &reconcileRow{
		id: "ma-1", moduleID: "mod-1", state: "active",
		allocatedSeconds: 30 * 60, startedAt: &startedAt,
	}
	if !cohortSectionModuleExpired(t, mod, "completed", &stageStart, nil, 64, now) {
		t.Fatal("a completed section must finalize its remaining modules")
	}
}

// A paused section clock is frozen: nothing expires while the room is paused.
func TestCohortSectionModuleStaysOpenWhileSectionPaused(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	startedAt := now.Add(-40 * time.Minute)
	stageStart := now.Add(-70 * time.Minute)
	pausedAt := now.Add(-5 * time.Minute)
	mod := &reconcileRow{
		id: "ma-1", moduleID: "mod-1", state: "active",
		allocatedSeconds: 30 * 60, startedAt: &startedAt,
	}
	if cohortSectionModuleExpired(t, mod, "live", &stageStart, &pausedAt, 64, now) {
		t.Fatal("a paused section clock must not expire modules")
	}
}
