package main

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
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
	d := exams.SATConfigDefaultsPayload()
	if err := d.Config.Validate(); err != nil {
		t.Fatalf("defaults must validate: %v", err)
	}
	if d.Config.Sections["math"].Module1Minutes != 35 || d.Config.Sections["reading-writing"].Module1Minutes != 32 {
		t.Fatalf("defaults drifted from blueprint: %+v", d.Config.Sections)
	}
}
