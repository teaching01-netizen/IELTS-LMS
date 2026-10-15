package main

import (
	"context"
	"encoding/json"
	"testing"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/results"
	"example.com/ielts-proctoring/internal/sat"
	"example.com/ielts-proctoring/internal/satconvert"
	"example.com/ielts-proctoring/internal/satscoring"
	"example.com/ielts-proctoring/internal/terminalization"
)

// Global score conversion end to end (global policy SPEC.md G-6 and prior plan
// cases TC-7, TC-13, TC-16): a classroom result released before any policy
// existed shows the estimate from a policy published afterward on both read
// surfaces: the student bootstrap's SAT result loader and staff result detail.
// The stored row remains unchanged; release-gate behavior is covered separately.
func TestSATGlobalScoreConversionIsRetroactiveMySQL(t *testing.T) {
	f := newSATV2CompletionFixture(t)
	ctx := context.Background()
	for _, stmt := range []string{
		"UPDATE exam_schedules SET sat_session_mode = 'classroom' WHERE id = ?",
		"UPDATE exam_entities e JOIN exam_schedules sch ON sch.exam_id = e.id SET e.sat_score_report_enabled = TRUE WHERE sch.id = ?",
	} {
		if _, err := f.db.ExecContext(ctx, stmt, f.scheduleID); err != nil {
			t.Fatal(err)
		}
	}
	if err := f.submit(ctx); err != nil {
		t.Fatal(err)
	}
	// Base 2/3 + higher 2/3.
	if _, err := f.db.ExecContext(ctx, "UPDATE assessment_module_attempts SET raw_correct = 2, operational_question_count = 3 WHERE attempt_id = ?", f.attemptID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := terminalization.RepairClassroomResults(ctx, f.db, 50); err != nil {
		t.Fatal(err)
	}
	// Each test run leaves published revisions behind (they are append-only);
	// resetting the pointer keeps the other suites in a "no policy" world.
	svc := satscoring.NewService(f.db, tx.NewRunner(f.db))
	t.Cleanup(func() {
		_, _ = f.db.ExecContext(context.Background(), "UPDATE sat_score_conversion_active SET revision_id = NULL, activated_at = NULL, activated_by = NULL WHERE id = 1")
		satscoring.ResetCacheForTest()
	})
	if _, err := f.db.ExecContext(ctx, "UPDATE sat_score_conversion_active SET revision_id = NULL WHERE id = 1"); err != nil {
		t.Fatal(err)
	}
	satscoring.ResetCacheForTest()

	var resultID, storedBefore string
	if err := f.db.QueryRowContext(ctx, "SELECT id, CAST(score_payload AS CHAR) FROM assessment_results WHERE attempt_id = ? AND provider_key = 'sat'", f.attemptID).Scan(&resultID, &storedBefore); err != nil {
		t.Fatal(err)
	}

	type reportDoc struct {
		Conversion *struct {
			ConverterVersion string `json:"converterVersion"`
		} `json:"conversion"`
		Sections []struct {
			ConversionStatus string `json:"conversionStatus"`
			Topology         string `json:"topology"`
			Scaled           *satconvert.Score
		} `json:"sections"`
		RawCorrect int `json:"rawCorrect"`
	}
	read := func(t *testing.T, payload any) reportDoc {
		t.Helper()
		raw, _ := json.Marshal(payload)
		var doc struct {
			Report reportDoc `json:"classroomRaw"`
		}
		if err := json.Unmarshal(raw, &doc); err != nil {
			t.Fatal(err)
		}
		return doc.Report
	}
	studentDelivery := delivery.NewService(f.db, tx.NewRunner(f.db))
	student := func(t *testing.T) reportDoc {
		t.Helper()
		bootstrap, err := studentDelivery.Bootstrap(ctx, f.scheduleID, f.attemptID, f.scheduleID)
		if err != nil || bootstrap == nil {
			t.Fatalf("load student bootstrap: %v", err)
		}
		res, ok := bootstrap.Result.(*sat.AssessmentResult)
		if !ok || res == nil {
			t.Fatalf("bootstrap result = %#v", bootstrap.Result)
		}
		return read(t, res.ScorePayload)
	}
	staff := func(t *testing.T) reportDoc {
		t.Helper()
		detail, err := results.NewService(f.db).GetSATResult(ctx, auth.NewActorContext("admin-1", auth.RoleAdmin), resultID)
		if err != nil {
			t.Fatal(err)
		}
		return read(t, detail.Payload)
	}

	// Before any policy: raw only on both surfaces.
	for name, r := range map[string]reportDoc{"student": student(t), "staff": staff(t)} {
		if r.RawCorrect != 4 || r.Conversion != nil || len(r.Sections) != 1 || r.Sections[0].Scaled != nil {
			t.Fatalf("%s before a policy = %+v", name, r)
		}
	}

	// Publish a global policy after the result was released.
	d, err := svc.CreateDraft(ctx, "admin-1", "req", nil)
	if err != nil {
		t.Fatal(err)
	}
	policy := satconvert.EmptyContent()
	cells := make([][]*int, 4)
	for r := range cells {
		cells[r] = make([]*int, 4)
		for c := range cells[r] {
			v := 200 + 10*(r+c)
			cells[r][c] = &v
		}
	}
	policy.Sections[satconvert.SectionReadingWriting].Tables["t"] = &satconvert.PolicyTable{Kind: satconvert.KindMatrix, M1Operational: 3, M2Operational: 3, Cells: cells}
	policy.Sections[satconvert.SectionReadingWriting].Assign["full_higher"] = []string{"t"}
	body, _ := policy.Canonical()
	d, err = svc.SaveDraft(ctx, "admin-1", "req", d.ID, d.Version, body, "staff approved", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Publish(ctx, "admin-1", "req", d.ID); err != nil {
		t.Fatal(err)
	}

	// Module 1 raw 2 x Module 2 raw 2 -> 200 + 10*(2+2) = 240, full_higher.
	for name, r := range map[string]reportDoc{"student": student(t), "staff": staff(t)} {
		if r.Conversion == nil || len(r.Sections) != 1 || r.Sections[0].ConversionStatus != "converted" ||
			r.Sections[0].Topology != "full_higher" || r.Sections[0].Scaled == nil || r.Sections[0].Scaled.Low != 240 {
			t.Fatalf("%s after publish = %+v", name, r)
		}
		if r.RawCorrect != 4 {
			t.Fatalf("%s raw score changed: %+v", name, r)
		}
	}

	// Evidence is untouched: the stored row is byte-identical.
	var storedAfter string
	if err := f.db.QueryRowContext(ctx, "SELECT CAST(score_payload AS CHAR) FROM assessment_results WHERE id = ?", resultID).Scan(&storedAfter); err != nil || storedAfter != storedBefore {
		t.Fatalf("publish rewrote the stored result: %v\n%s\n%s", err, storedBefore, storedAfter)
	}

	// The real student bootstrap keeps the release switch in front of the
	// student-safe projection even with an active conversion policy.
	if _, err := f.db.ExecContext(ctx, "UPDATE exam_entities e JOIN exam_schedules sch ON sch.exam_id = e.id SET e.sat_score_report_enabled = FALSE WHERE sch.id = ?", f.scheduleID); err != nil {
		t.Fatal(err)
	}
	bootstrap, err := studentDelivery.Bootstrap(ctx, f.scheduleID, f.attemptID, f.scheduleID)
	if err != nil || bootstrap == nil {
		t.Fatalf("load withheld student bootstrap: %v", err)
	}
	withheld, ok := bootstrap.Result.(*sat.AssessmentResult)
	if !ok || withheld == nil || withheld.ReleaseStatus != "released" || withheld.ScoreKind != "" ||
		withheld.TotalScore != nil || withheld.ScorePayload != nil || len(withheld.Sections) != 0 {
		t.Fatalf("active policy bypassed the student release gate: %#v", bootstrap.Result)
	}
}
