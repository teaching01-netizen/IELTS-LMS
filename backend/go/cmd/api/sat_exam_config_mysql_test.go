package main

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satlearning"
	"example.com/ielts-proctoring/internal/schedules"
)

// Configuration given at creation is persisted in the same transaction as the
// blueprint; an invalid one leaves no exam behind.
func TestSatExamConfigAtCreateMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	ctx := context.Background()
	provider := "sat"
	cfg := exams.DefaultSATExamConfig()
	math := cfg.Sections["math"]
	math.Module1Minutes, math.MinimumCorrectForHigher, math.BreakAfterMinutes = 40, 7, 5
	cfg.Sections["math"] = math
	yes := true
	cfg.ShowClassroomScoreReport = &yes
	slug := "cfg-" + uuid.NewString()
	exam, err := h.exams.Create(ctx, exams.CreateRequest{Slug: slug, Title: "Configured", ExamType: "Academic", Visibility: "private", ProviderKey: &provider, OwnerID: h.actor, SATConfig: &cfg})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.exams.Delete(ctx, exam.ID) })
	if !exam.SatScoreReportEnabled {
		t.Fatal("score report switch not persisted")
	}
	var dur, brk, threshold int
	if err := h.db.QueryRow(`SELECT m.duration_seconds FROM assessment_modules m JOIN assessment_sections s ON s.id=m.section_id JOIN exam_entities e ON e.current_draft_version_id=s.exam_version_id WHERE e.id=? AND m.module_key='math-m1'`, exam.ID).Scan(&dur); err != nil || dur != 2400 {
		t.Fatalf("module1 duration=%d err=%v", dur, err)
	}
	if err := h.db.QueryRow(`SELECT s.break_after_seconds, JSON_EXTRACT(rp.policy_config,'$.minimumCorrectForHigher') FROM assessment_sections s JOIN assessment_routing_policies rp ON rp.section_id=s.id JOIN exam_entities e ON e.current_draft_version_id=s.exam_version_id WHERE e.id=? AND s.section_key='math'`, exam.ID).Scan(&brk, &threshold); err != nil || brk != 300 || threshold != 7 {
		t.Fatalf("break=%d threshold=%d err=%v", brk, threshold, err)
	}
	var sectionSeconds int
	if err := h.db.QueryRow(`SELECT s.duration_seconds FROM assessment_sections s JOIN exam_entities e ON e.current_draft_version_id=s.exam_version_id WHERE e.id=? AND s.section_key='math'`, exam.ID).Scan(&sectionSeconds); err != nil || sectionSeconds != 2400+2100 {
		t.Fatalf("section=%d err=%v", sectionSeconds, err)
	}

	bad := exams.DefaultSATExamConfig()
	b := bad.Sections["reading-writing"]
	b.MinimumCorrectForHigher = 99
	bad.Sections["reading-writing"] = b
	badSlug := "cfg-bad-" + uuid.NewString()
	_, err = h.exams.Create(ctx, exams.CreateRequest{Slug: badSlug, Title: "Bad", ExamType: "Academic", Visibility: "private", ProviderKey: &provider, OwnerID: h.actor, SATConfig: &bad})
	if typed, ok := apperrors.As(err); !ok || typed.Code != apperrors.CodeValidation {
		t.Fatalf("want validation error, got %v", err)
	}
	var n int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM exam_entities WHERE slug=?", badSlug).Scan(&n); err != nil || n != 0 {
		t.Fatalf("invalid config left an exam: %d %v", n, err)
	}
}

func TestSatConfigDefaultsMatchBlueprint(t *testing.T) {
	wasEnabled := exams.SATClassroomCreationEnabled()
	t.Cleanup(func() { exams.SetClassroomCreationEnabled(wasEnabled) })
	for _, classroomEnabled := range []bool{false, true} {
		exams.SetClassroomCreationEnabled(classroomEnabled)
		d := exams.SATConfigDefaultsPayload(exams.SATClassroomCreationEnabled())
		if err := d.Config.Validate(); err != nil {
			t.Fatalf("defaults must validate: %v", err)
		}
		if d.Config.Sections["math"].Module1Minutes != 35 || d.Config.Sections["reading-writing"].Module1Minutes != 32 {
			t.Fatalf("defaults drifted from blueprint: %+v", d.Config.Sections)
		}
		if d.ClassroomCreationEnabled != classroomEnabled {
			t.Fatalf("classroomCreationEnabled=%v, want %v", d.ClassroomCreationEnabled, classroomEnabled)
		}
	}
}

func TestSatExamLearningDefaultsPinNewRoomsMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	ctx := context.Background()
	provider := "sat"
	policy := satlearning.DefaultPolicy()
	policy.UnlimitedRetakes = true
	policy.PauseOnLeave = true
	policy.ReportVisible = true
	policy.IncludeAnswerKeyInPdf = true
	cfg := exams.DefaultSATExamConfig()
	cfg.LearningDefaults = &policy
	exam, err := h.exams.Create(ctx, exams.CreateRequest{
		Slug: "learning-" + uuid.NewString(), Title: "Learning defaults", ExamType: "Academic",
		Visibility: "private", ProviderKey: &provider, OwnerID: h.actor, SATConfig: &cfg,
	})
	if err != nil || exam.SatLearningDefaults == nil || *exam.SatLearningDefaults != policy {
		t.Fatalf("create defaults = %+v err=%v", exam.SatLearningDefaults, err)
	}
	t.Cleanup(func() { _ = h.exams.Delete(ctx, exam.ID) })
	svc := schedules.NewService(h.db, tx.NewRunner(h.db))
	roomCreator := uuid.NewString()
	createRoom := func() string {
		t.Helper()
		now := time.Now().UTC()
		room, err := svc.Create(ctx, schedules.CreateRequest{
			ExamID: exam.ID, PublishedVersionID: *exam.CurrentDraftVersionID, CohortName: "Learning defaults",
			StartTime: now, EndTime: now.Add(time.Hour), CreatedBy: roomCreator,
		})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = h.db.Exec("DELETE FROM exam_schedules WHERE id = ?", room.ID) })
		return room.ID
	}
	firstRoom := createRoom()
	changed := policy
	changed.UnlimitedRetakes = false
	updated, err := h.exams.Update(ctx, exam.ID, exams.UpdateRequest{Revision: exam.Revision, SatLearningDefaults: &changed})
	if err != nil || updated.SatLearningDefaults == nil || *updated.SatLearningDefaults != changed {
		t.Fatalf("update defaults = %+v err=%v", updated.SatLearningDefaults, err)
	}
	secondRoom := createRoom()
	for _, entry := range []struct {
		room string
		want satlearning.Policy
	}{{firstRoom, policy}, {secondRoom, changed}} {
		entry.want.Revision = 1
		got, err := satlearning.LoadPolicyTx(ctx, h.db, entry.room)
		if err != nil || got != entry.want {
			t.Fatalf("room %s policy = %+v err=%v, want %+v", entry.room, got, err, entry.want)
		}
	}
}

func TestSatClassroomRetakesDefaultAndSavedOptOutMySQL(t *testing.T) {
	h := newConcurrencyHarness(t)
	ctx := context.Background()
	previous := exams.SATClassroomCreationEnabled()
	exams.SetClassroomCreationEnabled(true)
	t.Cleanup(func() { exams.SetClassroomCreationEnabled(previous) })
	provider := "sat"
	exam, err := h.exams.Create(ctx, exams.CreateRequest{
		Slug: "classroom-retakes-" + uuid.NewString(), Title: "Classroom retakes", ExamType: "Academic",
		Visibility: "private", ProviderKey: &provider, OwnerID: h.actor,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.exams.Delete(ctx, exam.ID) })
	svc := schedules.NewService(h.db, tx.NewRunner(h.db))
	roomCreator := uuid.NewString()
	checkRoom := func(mode string, wantRetakes bool) {
		t.Helper()
		now := time.Now().UTC()
		room, err := svc.Create(ctx, schedules.CreateRequest{
			ExamID: exam.ID, PublishedVersionID: *exam.CurrentDraftVersionID, CohortName: "Classroom defaults",
			StartTime: now, EndTime: now.Add(time.Hour), CreatedBy: roomCreator, SatSessionMode: mode,
		})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = h.db.Exec("DELETE FROM exam_schedules WHERE id = ?", room.ID) })
		policy, err := satlearning.LoadPolicyTx(ctx, h.db, room.ID)
		if err != nil || policy.UnlimitedRetakes != wantRetakes || policy.ReportVisible || policy.IncludeAnswerKeyInPdf {
			t.Fatalf("%s room policy = %+v, err=%v, want retakes=%t and hidden results", mode, policy, err, wantRetakes)
		}
	}
	checkRoom("classroom", true)
	checkRoom("practice", false)
	optOut := satlearning.DefaultPolicy()
	if _, err := h.exams.Update(ctx, exam.ID, exams.UpdateRequest{Revision: exam.Revision, SatLearningDefaults: &optOut}); err != nil {
		t.Fatal(err)
	}
	checkRoom("classroom", false)
}
