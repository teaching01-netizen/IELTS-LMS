package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"

	"example.com/ielts-proctoring/internal/terminalization"
)

// P-1 (verification/lean/sat-result/PRODUCTION_TEST_PLAN.md): several repair
// workers, each on its own pool, sweep many withheld results while staff flip the
// report switch. Invariants: one result row per attempt; nothing released while
// the switch stays off; a practice sitting is never released; every classroom
// result is released exactly once (revision +1) with the recomputed raw score.
func TestSATClassroomRepairSoakMySQL(t *testing.T) {
	const attempts, workers, sweeps, batch = 16, 6, 40, 3
	ctx := context.Background()
	type sitting struct {
		f         satV2CompletionFixture
		classroom bool
		correct   int
		revision  int
	}
	all := make([]*sitting, attempts)
	for i := range all {
		s := &sitting{f: newSATV2CompletionFixture(t), classroom: i%4 != 3, correct: i % 4}
		if s.classroom {
			if _, err := s.f.db.ExecContext(ctx, "UPDATE exam_schedules SET sat_session_mode = 'classroom' WHERE id = ?", s.f.scheduleID); err != nil {
				t.Fatal(err)
			}
		}
		if err := s.f.submit(ctx); err != nil {
			t.Fatal(err)
		}
		if _, err := s.f.db.ExecContext(ctx, "UPDATE assessment_module_attempts SET raw_correct = ?, operational_question_count = 3 WHERE attempt_id = ?", s.correct, s.f.attemptID); err != nil {
			t.Fatal(err)
		}
		all[i] = s
	}
	db := all[0].f.db
	setSwitch := func(i int, on bool) error {
		_, err := db.ExecContext(ctx, "UPDATE exam_entities e JOIN exam_schedules sch ON sch.exam_id = e.id SET e.sat_score_report_enabled = ? WHERE sch.id = ?", on, all[i].f.scheduleID)
		return err
	}
	read := func(s *sitting) (rows int, release string, revision int, payload string) {
		t.Helper()
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_results WHERE attempt_id = ?", s.f.attemptID).Scan(&rows); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRowContext(ctx, "SELECT release_status, revision, CAST(score_payload AS CHAR) FROM assessment_results WHERE attempt_id = ? AND provider_key = 'sat'", s.f.attemptID).Scan(&release, &revision, &payload); err != nil {
			t.Fatal(err)
		}
		return
	}
	for i, s := range all {
		if err := setSwitch(i, false); err != nil {
			t.Fatal(err)
		}
		rows, release, revision, _ := read(s)
		if rows != 1 || release != "pending" {
			t.Fatalf("attempt %d: rows=%d release=%s, want one withheld result", i, rows, release)
		}
		s.revision = revision
	}

	// Production workers log a transient lock error and sweep again next tick.
	var transient atomic.Int64
	run := func(t *testing.T, during func()) {
		t.Helper()
		start := make(chan struct{})
		errs := make(chan error, workers*sweeps)
		var wg sync.WaitGroup
		for w := 0; w < workers; w++ {
			pool := staleETagTestDB(t)
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				for k := 0; k < sweeps; k++ {
					if _, _, err := terminalization.RepairClassroomResults(ctx, pool, batch); err != nil {
						var me *mysql.MySQLError
						if errors.As(err, &me) && (me.Number == 1213 || me.Number == 1205) {
							transient.Add(1)
							continue
						}
						errs <- err
					}
				}
			}()
		}
		close(start)
		if during != nil {
			during()
		}
		wg.Wait()
		close(errs)
		for err := range errs {
			t.Fatalf("repair sweep: %v", err)
		}
	}

	// Switch off everywhere: no sweep may release anything.
	run(t, nil)
	for i, s := range all {
		if _, release, revision, _ := read(s); release != "pending" || revision != s.revision {
			t.Fatalf("attempt %d released or rewritten with the switch off: %s rev %d -> %d", i, release, s.revision, revision)
		}
	}

	// Staff flip switches while the sweeps run, then leave them on.
	run(t, func() {
		for round := 0; round < 30; round++ {
			for i := range all {
				if err := setSwitch(i, (round+i)%2 == 0); err != nil {
					t.Error(err)
				}
			}
		}
	})
	for i := range all {
		if err := setSwitch(i, true); err != nil {
			t.Fatal(err)
		}
	}
	run(t, nil)

	for i, s := range all {
		rows, release, revision, payload := read(s)
		if rows != 1 {
			t.Fatalf("attempt %d has %d result rows", i, rows)
		}
		if !s.classroom {
			if release == "released" || strings.Contains(payload, "classroomRaw") {
				t.Fatalf("practice attempt %d released: %s %s", i, release, payload)
			}
			continue
		}
		if release != "released" || revision != s.revision+1 {
			t.Fatalf("attempt %d: release=%s revision %d -> %d, want released exactly once", i, release, s.revision, revision)
		}
		var doc struct {
			Raw struct{ RawCorrect, Total int } `json:"classroomRaw"`
		}
		if err := json.Unmarshal([]byte(payload), &doc); err != nil || doc.Raw.RawCorrect != 2*s.correct || doc.Raw.Total != 6 {
			t.Fatalf("attempt %d raw = %+v (%v), want %d/6", i, doc.Raw, err, 2*s.correct)
		}
	}
	t.Logf("attempts=%d workers=%d sweeps/worker/phase=%d batch=%d transient lock errors=%d", attempts, workers, sweeps, batch, transient.Load())
}

// LIVE-1 / A-FAIR: a result that can never be released yet (a module is still
// unscored) must not hold a batch slot, or a full batch of them starves every
// newer releasable result forever. Batch 1 makes one withheld row a full batch.
func TestSATClassroomRepairNotStarvedByWithheldMySQL(t *testing.T) {
	ctx := context.Background()
	stuck, ready := newSATV2CompletionFixture(t), newSATV2CompletionFixture(t)
	for i, f := range []satV2CompletionFixture{stuck, ready} {
		if _, err := f.db.ExecContext(ctx, "UPDATE exam_schedules SET sat_session_mode = 'classroom' WHERE id = ?", f.scheduleID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.db.ExecContext(ctx, "UPDATE exam_entities e JOIN exam_schedules sch ON sch.exam_id = e.id SET e.sat_score_report_enabled = TRUE WHERE sch.id = ?", f.scheduleID); err != nil {
			t.Fatal(err)
		}
		if err := f.submit(ctx); err != nil {
			t.Fatal(err)
		}
		// Oldest first in the repair order, ahead of any other scratch rows.
		if _, err := f.db.ExecContext(ctx, "UPDATE assessment_results SET updated_at = ? WHERE attempt_id = ?", time.Date(1990, 1, 1+i, 0, 0, 0, 0, time.UTC), f.attemptID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := ready.db.ExecContext(ctx, "UPDATE assessment_module_attempts SET raw_correct = 2, operational_question_count = 3 WHERE attempt_id = ?", ready.attemptID); err != nil {
		t.Fatal(err)
	}
	for sweep := 0; sweep < 3; sweep++ {
		if _, _, err := terminalization.RepairClassroomResults(ctx, ready.db, 1); err != nil {
			t.Fatal(err)
		}
	}
	status := func(f satV2CompletionFixture) (release string) {
		t.Helper()
		if err := f.db.QueryRowContext(ctx, "SELECT release_status FROM assessment_results WHERE attempt_id = ? AND provider_key = 'sat'", f.attemptID).Scan(&release); err != nil {
			t.Fatal(err)
		}
		return
	}
	if got := status(ready); got != "released" {
		t.Fatalf("releasable result starved behind a withheld one: %s", got)
	}
	if got := status(stuck); got != "pending" {
		t.Fatalf("withheld result with an unscored module = %s, want pending", got)
	}
}
