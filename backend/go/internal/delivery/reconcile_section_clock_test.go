package delivery

// cohort_section_v3 pins TWO expiry anchors, matching the student's clock:
// min(personal module allotment, section clock). The module's own allotment
// closes it (the reconciler then routes it to its adaptive successor), and the
// shared section clock still caps it — a module never outlives its section.
//
// The header this file replaced pinned the earlier D2 decision (section clock
// only, personal clock never expires). That was true while the shared section
// clock was also the student-facing countdown; the visible clock is now the
// module's allotment, so the server backstop has to close on the same anchor.

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
// programmed runtime + section clock row.
func cohortSectionModuleExpired(t *testing.T, mod *reconcileRow, runtimeStatus, stageStatus string, stageStart *time.Time, stagePausedAt *time.Time, planned int64, asOf time.Time, satClosing ...bool) bool {
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
	expired, err := reconcileModuleExpiredTx(context.Background(), db, "rt-1", runtimeStatus, "cohort_section_v3",
		sql.NullString{String: "reading-writing", Valid: true}, &order, mod, asOf.UTC(), satClosing...)
	if err != nil {
		t.Fatalf("expiry branch: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	return expired
}

// The module's own allotment closes it even though its section is still live:
// this is the module clock the student is reading.
func TestCohortSectionModuleExpiresOnItsOwnAllotment(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	startedAt := now.Add(-40 * time.Minute)
	stageStart := now.Add(-10 * time.Minute)
	mod := &reconcileRow{
		id: "ma-1", moduleID: "mod-1", state: "active",
		allocatedSeconds: 30 * 60, startedAt: &startedAt,
	}
	if !cohortSectionModuleExpired(t, mod, "live", "live", &stageStart, nil, 64, now) {
		t.Fatal("a module past its own allotment must be finalized")
	}
}

// Inside its allotment the module stays open while the section has time left.
func TestCohortSectionModuleStaysOpenInsideItsAllotment(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	startedAt := now.Add(-5 * time.Minute)
	stageStart := now.Add(-10 * time.Minute)
	mod := &reconcileRow{
		id: "ma-1", moduleID: "mod-1", state: "active",
		allocatedSeconds: 30 * 60, startedAt: &startedAt,
	}
	if cohortSectionModuleExpired(t, mod, "live", "live", &stageStart, nil, 64, now) {
		t.Fatal("a module inside its allotment must not be finalized")
	}
}

// The section clock still caps: a module outlives neither anchor.
func TestCohortSectionModuleExpiresWhenSectionDeadlinePassed(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	startedAt := now.Add(-5 * time.Minute)
	stageStart := now.Add(-70 * time.Minute)
	mod := &reconcileRow{
		id: "ma-1", moduleID: "mod-1", state: "active",
		allocatedSeconds: 30 * 60, startedAt: &startedAt,
	}
	if !cohortSectionModuleExpired(t, mod, "live", "live", &stageStart, nil, 64, now) {
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
	if !cohortSectionModuleExpired(t, mod, "live", "completed", &stageStart, nil, 64, now) {
		t.Fatal("a completed section must finalize its remaining modules")
	}
}

func TestSATCompletedSectionWaitsForSaveOnlyGrace(t *testing.T) {
	deadline := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	stageStart := deadline.Add(-time.Minute)
	startedAt := deadline.Add(-30 * time.Second)
	mod := &reconcileRow{id: "ma-1", moduleID: "mod-1", state: "active", allocatedSeconds: 120, startedAt: &startedAt}
	// The reconciler passes the authoritative time minus SATSaveGrace. A
	// completed section must keep its module open until that shifted instant
	// reaches the section deadline, then score it exactly once.
	if cohortSectionModuleExpired(t, mod, "live", "completed", &stageStart, nil, 1, deadline.Add(-time.Second), true) {
		t.Fatal("SAT section must remain open during its save-only window")
	}
	if !cohortSectionModuleExpired(t, mod, "live", "completed", &stageStart, nil, 1, deadline, true) {
		t.Fatal("SAT section must finalize after its save-only window")
	}
}

func TestSATEarlyProctorSectionEndDoesNotWaitForScheduledDeadline(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	stageStart := now.Add(-10 * time.Minute)
	startedAt := now.Add(-5 * time.Minute)
	mod := &reconcileRow{id: "ma-1", moduleID: "mod-1", state: "active", allocatedSeconds: 30 * 60, startedAt: &startedAt}
	if !cohortSectionModuleExpired(t, mod, "live", "completed", &stageStart, nil, 64, now.Add(-3*time.Second), true) {
		t.Fatal("an authorized early section end must finalize without waiting for its scheduled clock")
	}
}

// A paused section clock is frozen: neither anchor expires while the room is
// paused, even with the personal allotment long spent.
func TestCohortSectionModuleStaysOpenWhileSectionPaused(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	startedAt := now.Add(-40 * time.Minute)
	stageStart := now.Add(-70 * time.Minute)
	pausedAt := now.Add(-5 * time.Minute)
	mod := &reconcileRow{
		id: "ma-1", moduleID: "mod-1", state: "active",
		allocatedSeconds: 30 * 60, startedAt: &startedAt,
	}
	if cohortSectionModuleExpired(t, mod, "live", "live", &stageStart, &pausedAt, 64, now) {
		t.Fatal("a paused section clock must not expire modules")
	}
	if cohortSectionModuleExpired(t, mod, "paused", "live", &stageStart, nil, 64, now) {
		t.Fatal("a paused runtime must not expire modules")
	}
}

// A per-student pause freezes that student's module clock: the reconciler must
// not close a module the student's own screen is holding.
func TestCohortSectionModuleStaysOpenWhileModulePaused(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	startedAt := now.Add(-40 * time.Minute)
	stageStart := now.Add(-10 * time.Minute)
	pausedAt := now.Add(-5 * time.Minute)
	mod := &reconcileRow{
		id: "ma-1", moduleID: "mod-1", state: "active",
		allocatedSeconds: 30 * 60, startedAt: &startedAt, pausedAt: &pausedAt,
	}
	if cohortSectionModuleExpired(t, mod, "live", "live", &stageStart, nil, 64, now) {
		t.Fatal("a paused module must not be finalized on the personal clock")
	}
}

// A module the student has not opened yet keeps its full allocation: the
// personal anchor only starts once the module does.
func TestCohortSectionModuleNotStartedKeepsItsAllotment(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	stageStart := now.Add(-10 * time.Minute)
	mod := &reconcileRow{
		id: "ma-1", moduleID: "mod-1", state: "not_started",
		allocatedSeconds: 30 * 60,
	}
	if cohortSectionModuleExpired(t, mod, "live", "live", &stageStart, nil, 64, now) {
		t.Fatal("an unstarted module must keep its full allocation")
	}
}

// Extensions land on the module allotment, so an extended module stays open.
func TestCohortSectionModuleHonoursItsExtension(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	startedAt := now.Add(-40 * time.Minute)
	stageStart := now.Add(-10 * time.Minute)
	mod := &reconcileRow{
		id: "ma-1", moduleID: "mod-1", state: "active",
		allocatedSeconds: 30 * 60, extensionSeconds: 15 * 60, startedAt: &startedAt,
	}
	if cohortSectionModuleExpired(t, mod, "live", "live", &stageStart, nil, 64, now) {
		t.Fatal("an extended module must not be finalized before its extended allotment")
	}
}
