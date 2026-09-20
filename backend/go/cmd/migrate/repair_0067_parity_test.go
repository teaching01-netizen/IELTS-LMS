package main

// Owner-parity pin for 0067's SQL.
//
// The one owner of the candidate-section length is exams.CandidateSectionSeconds
// (a base plus the LONGER branch, and only when a base and a branch exist). A
// migration cannot call Go, so 0067 re-expresses that arithmetic in SQL; this
// test executes the shipped file against real MySQL and compares every row it
// touches to the owner over a matrix of module shapes — including duplicate
// role rows, where the SQL takes MAX per role and the owner's
// AdaptiveRoleSeconds takes the largest too. If the SQL's arithmetic drifts
// (SUM instead of GREATEST, the completeness guard loosened, a wrong ceiling)
// this fails. The migration text is not otherwise restructured.
//
// TEST_MYSQL_DSN-gated, on the same isolated scratch schema helpers as the
// other 0067 tests; without a DSN it skips cleanly.

import (
	"fmt"
	"testing"

	examdomain "example.com/ielts-proctoring/internal/exams"
)

type parityModule struct {
	role    string
	seconds int
}

func TestRepair0067MatchesTheCandidateLengthOwner(t *testing.T) {
	conn := repair0067Conn(t)
	ctx := t.Context()

	tables := []string{
		"CREATE TABLE exam_schedules (id VARCHAR(36) PRIMARY KEY, published_version_id VARCHAR(36))",
		"CREATE TABLE exam_session_runtimes (id VARCHAR(36) PRIMARY KEY, schedule_id VARCHAR(36))",
		"CREATE TABLE exam_session_runtime_sections (id VARCHAR(36) PRIMARY KEY, runtime_id VARCHAR(36), section_key VARCHAR(32), planned_duration_minutes INT, status VARCHAR(16))",
		"CREATE TABLE assessment_sections (id VARCHAR(36) PRIMARY KEY, exam_version_id VARCHAR(36), section_key VARCHAR(32), duration_seconds INT)",
		"CREATE TABLE assessment_modules (id VARCHAR(36) PRIMARY KEY, section_id VARCHAR(36), adaptive_role VARCHAR(16), duration_seconds INT)",
		"INSERT INTO exam_schedules (id, published_version_id) VALUES ('sched-parity', 'pv-parity')",
		"INSERT INTO exam_session_runtimes (id, schedule_id) VALUES ('rt-parity', 'sched-parity')",
	}
	for _, stmt := range tables {
		if _, err := conn.ExecContext(ctx, stmt); err != nil {
			t.Fatalf("fixture statement failed: %v (%.120q)", err, stmt)
		}
	}

	// Every complete shape must be repaired to the owner's length; every
	// incomplete shape must be left exactly alone, because the owner refuses to
	// prove a candidate length from it (and so does the migration's HAVING).
	shapes := []struct {
		name    string
		modules []parityModule
	}{
		{name: "equal branches", modules: []parityModule{
			{"base", 1920}, {"lower_branch", 1920}, {"higher_branch", 1920},
		}},
		{name: "higher branch longer", modules: []parityModule{
			{"base", 2100}, {"lower_branch", 1800}, {"higher_branch", 2400},
		}},
		{name: "lower branch longer", modules: []parityModule{
			{"base", 2100}, {"lower_branch", 2700}, {"higher_branch", 2400},
		}},
		{name: "single branch", modules: []parityModule{
			{"base", 1920}, {"lower_branch", 1920},
		}},
		{name: "duplicate base rows keep the largest", modules: []parityModule{
			{"base", 1800}, {"base", 2100}, {"lower_branch", 1920},
		}},
		{name: "duplicate lower rows keep the largest", modules: []parityModule{
			{"base", 2100}, {"lower_branch", 1800}, {"lower_branch", 2400},
		}},
		{name: "base only", modules: []parityModule{{"base", 1920}}},
		{name: "branches only", modules: []parityModule{{"lower_branch", 1920}, {"higher_branch", 1920}}},
		{name: "zero durations", modules: []parityModule{{"base", 0}, {"lower_branch", 0}}},
		{name: "legacy role", modules: []parityModule{{"none", 3600}}},
	}

	const untouched = 999
	for i, shape := range shapes {
		sectionID := fmt.Sprintf("sec-%d", i)
		sectionKey := fmt.Sprintf("shape-%d", i)
		if _, err := conn.ExecContext(ctx,
			"INSERT INTO assessment_sections (id, exam_version_id, section_key, duration_seconds) VALUES (?, 'pv-parity', ?, 0)",
			sectionID, sectionKey); err != nil {
			t.Fatalf("fixture section %s: %v", shape.name, err)
		}
		for j, module := range shape.modules {
			if _, err := conn.ExecContext(ctx,
				"INSERT INTO assessment_modules (id, section_id, adaptive_role, duration_seconds) VALUES (?, ?, ?, ?)",
				fmt.Sprintf("mod-%d-%d", i, j), sectionID, module.role, module.seconds); err != nil {
				t.Fatalf("fixture module %s/%s: %v", shape.name, module.role, err)
			}
		}
		if _, err := conn.ExecContext(ctx,
			"INSERT INTO exam_session_runtime_sections (id, runtime_id, section_key, planned_duration_minutes, status) VALUES (?, 'rt-parity', ?, ?, 'locked')",
			fmt.Sprintf("rs-%d", i), sectionKey, untouched); err != nil {
			t.Fatalf("fixture runtime section %s: %v", shape.name, err)
		}
	}

	applyRepair0067(t, conn)
	applyRepair0067(t, conn) // re-runnable: the second pass must write nothing

	repaired := 0
	for i, shape := range shapes {
		var clock examdomain.AdaptiveRoleSeconds
		for _, module := range shape.modules {
			clock.AddModule(module.role, module.seconds)
		}
		wantSeconds, complete := clock.CandidateSeconds()

		var got int
		if err := conn.QueryRowContext(ctx,
			"SELECT planned_duration_minutes FROM exam_session_runtime_sections WHERE id = ?",
			fmt.Sprintf("rs-%d", i)).Scan(&got); err != nil {
			t.Fatalf("read %s: %v", shape.name, err)
		}

		if !complete {
			if got != untouched {
				t.Errorf("%s: an incomplete adaptive shape cannot prove a candidate length; the migration must leave %d, got %d",
					shape.name, untouched, got)
			}
			continue
		}
		want := (wantSeconds + 59) / 60
		if got != want {
			t.Errorf("%s: migration repaired to %d minutes, the owner says %d seconds -> %d minutes",
				shape.name, got, wantSeconds, want)
		}
		if got != untouched {
			repaired++
		}
	}
	if repaired == 0 {
		t.Fatal("no fixture row was actually repaired — the parity matrix proved nothing")
	}
}
