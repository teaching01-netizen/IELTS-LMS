package exams

// Parity vectors: the checked-in, owner-computed numbers every non-Go copy of
// the candidate-section-length rule is held to.
//
// This package is the one owner of the rule (base module plus the LONGER
// adaptive branch, and only for a complete adaptive shape). Copies that cannot
// call Go — migration 0067's SQL, the release summary's SQL and the client's
// releaseSelectors.candidateSecondsForSection — must not be trusted to
// re-derive it, so the client's test reads these vectors instead of carrying
// frozen literals.
//
// The direction is the point: a copy-side check that compares the copy against
// the owner in-process catches a copy that moves, while a frozen literal only
// ever catches the copy. Because this artifact is checked in and consumed by
// releaseSelectors.test.ts, an owner change regenerated here turns that test
// red until the client copy moves with it. Precisely: an owner drift fails THIS
// test first; the client test reddens only once the artifact is regenerated.
//
// The vectors pin the numbers for complete adaptive shapes in the authored
// (lowercase) vocabulary; the owner's collation behavior for case-variant roles
// is pinned by section_time_test.go, and the client copy is out of scope there
// by design.
//
// Regenerate after an intentional owner change with the "regenerate" command in
// the artifact itself; that command is also printed by every failure below.

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

const parityVectorPath = "testdata/candidate_section_length_vectors.json"

const parityVectorRegenerate = "cd backend/go && UPDATE_PARITY_VECTORS=1 go test ./internal/exams -run TestCandidateSectionLengthParityVectors -count=1"

const parityVectorOwner = "internal/exams/section_time.go (CandidateSectionSeconds + AdaptiveRoleSeconds)"

type parityVectorModule struct {
	AdaptiveRole    string `json:"adaptiveRole"`
	DurationSeconds int    `json:"durationSeconds"`
}

type parityVector struct {
	Name                      string               `json:"name"`
	BreakAfterSeconds         int                  `json:"breakAfterSeconds"`
	Modules                   []parityVectorModule `json:"modules"`
	CandidateSeconds          int                  `json:"candidateSeconds"`
	CandidateSecondsWithBreak int                  `json:"candidateSecondsWithBreak"`
}

type parityVectorArtifact struct {
	Owner      string         `json:"owner"`
	Regenerate string         `json:"regenerate"`
	Vectors    []parityVector `json:"vectors"`
}

// parityVectorInputs are the authored shapes the client copy is pinned to. The
// expected numbers are deliberately NOT written here: they are computed from
// the owner below, so this list cannot drift from the rule it checks.
func parityVectorInputs() []parityVector {
	return []parityVector{
		{
			Name:              "equal branches",
			BreakAfterSeconds: 600,
			Modules: []parityVectorModule{
				{AdaptiveRole: "base", DurationSeconds: 1920},
				{AdaptiveRole: "lower_branch", DurationSeconds: 1920},
				{AdaptiveRole: "higher_branch", DurationSeconds: 1920},
			},
		},
		{
			Name:              "higher branch longer",
			BreakAfterSeconds: 300,
			Modules: []parityVectorModule{
				{AdaptiveRole: "base", DurationSeconds: 2100},
				{AdaptiveRole: "lower_branch", DurationSeconds: 1800},
				{AdaptiveRole: "higher_branch", DurationSeconds: 2400},
			},
		},
		{
			Name:              "lower branch longer",
			BreakAfterSeconds: 0,
			Modules: []parityVectorModule{
				{AdaptiveRole: "base", DurationSeconds: 2100},
				{AdaptiveRole: "lower_branch", DurationSeconds: 2700},
				{AdaptiveRole: "higher_branch", DurationSeconds: 2400},
			},
		},
		{
			Name:              "single branch",
			BreakAfterSeconds: 0,
			Modules: []parityVectorModule{
				{AdaptiveRole: "base", DurationSeconds: 1920},
				{AdaptiveRole: "lower_branch", DurationSeconds: 1920},
			},
		},
	}
}

// ownerNumbers folds the vector's authored rows through the owner exactly as
// every reader does and returns the candidate length with and without the
// section's break. ok is false for a shape the owner refuses to prove.
func (v parityVector) ownerNumbers() (candidate, withBreak int, ok bool) {
	var clock AdaptiveRoleSeconds
	for _, module := range v.Modules {
		clock.AddModule(module.AdaptiveRole, module.DurationSeconds)
	}
	candidate, ok = clock.CandidateSeconds()
	if !ok {
		return 0, 0, false
	}
	return candidate, candidate + v.BreakAfterSeconds, true
}

func TestCandidateSectionLengthParityVectors(t *testing.T) {
	vectors := parityVectorInputs()
	for i := range vectors {
		candidate, withBreak, ok := vectors[i].ownerNumbers()
		if !ok {
			t.Fatalf("vector %q is not a complete adaptive shape; parity vectors exist to pin lengths the owner can prove", vectors[i].Name)
		}
		vectors[i].CandidateSeconds = candidate
		vectors[i].CandidateSecondsWithBreak = withBreak
	}
	want := parityVectorArtifact{
		Owner:      parityVectorOwner,
		Regenerate: parityVectorRegenerate,
		Vectors:    vectors,
	}

	if os.Getenv("UPDATE_PARITY_VECTORS") == "1" {
		raw, err := json.MarshalIndent(want, "", "  ")
		if err != nil {
			t.Fatalf("marshal parity vectors: %v", err)
		}
		if err := os.WriteFile(parityVectorPath, append(raw, '\n'), 0o644); err != nil {
			t.Fatalf("write %s: %v", parityVectorPath, err)
		}
		t.Logf("rewrote %s with %d owner-computed vectors", parityVectorPath, len(want.Vectors))
		return
	}

	raw, err := os.ReadFile(parityVectorPath)
	if err != nil {
		t.Fatalf("read %s: %v (regenerate: %s)", parityVectorPath, err, parityVectorRegenerate)
	}
	var got parityVectorArtifact
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("parse %s: %v (regenerate: %s)", parityVectorPath, err, parityVectorRegenerate)
	}
	if got.Owner != want.Owner || got.Regenerate != want.Regenerate {
		t.Fatalf("artifact header = owner %q / regenerate %q, the owner test expects %q / %q (regenerate: %s)",
			got.Owner, got.Regenerate, want.Owner, want.Regenerate, parityVectorRegenerate)
	}
	if len(got.Vectors) != len(want.Vectors) {
		t.Fatalf("artifact holds %d vectors, the owner test defines %d (regenerate: %s)",
			len(got.Vectors), len(want.Vectors), parityVectorRegenerate)
	}
	for i := range want.Vectors {
		have, expected := got.Vectors[i], want.Vectors[i]
		if have.Name != expected.Name {
			t.Fatalf("artifact vector %d is %q, the owner test defines %q (regenerate: %s)",
				i, have.Name, expected.Name, parityVectorRegenerate)
		}
		if have.BreakAfterSeconds != expected.BreakAfterSeconds || !reflect.DeepEqual(have.Modules, expected.Modules) {
			t.Fatalf("artifact vector %q pins different authored inputs than the owner test (regenerate: %s)",
				expected.Name, parityVectorRegenerate)
		}
		if have.CandidateSeconds != expected.CandidateSeconds || have.CandidateSecondsWithBreak != expected.CandidateSecondsWithBreak {
			t.Fatalf("artifact vector %q says candidateSeconds=%d (with break %d), the owner computes %d (with break %d) — the artifact is stale; regenerate with: %s",
				expected.Name, have.CandidateSeconds, have.CandidateSecondsWithBreak,
				expected.CandidateSeconds, expected.CandidateSecondsWithBreak, parityVectorRegenerate)
		}
	}
}
