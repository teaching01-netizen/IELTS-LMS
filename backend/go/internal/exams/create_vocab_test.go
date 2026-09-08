package exams

// Plan E-honesty + round-58 pre-read gating audit (fail-fast series):
// Create validates BEFORE any tx (service.go:555), so validateCreate is
// the envelope gate. The existing test pins 3 bad rows; this table pins
// the full vocabulary: every required field, every enum value, and the
// valid matrix — so a widened enum without gate support fails here.
//
// NOTE: all pass today (no drift) — verified the test executes
// (9 good rows + 8 bad rows each asserted). The test is the pin: a
// widened enum without gate support fails the build.
import (
	"testing"
)

func TestValidateCreateVocabulary(t *testing.T) {
	good := func() CreateRequest {
		return CreateRequest{Slug: "slug-1", Title: "Title", ExamType: ExamTypeACT, Visibility: VisibilityPrivate, OwnerID: "u-1"}
	}
	if err := validateCreate(good()); err != nil {
		t.Fatalf("valid create must pass, got %v", err)
	}
	for _, typ := range []string{ExamTypeAcademic, ExamTypeGeneralTraining, ExamTypeACT} {
		req := good()
		req.ExamType = typ
		if err := validateCreate(req); err != nil {
			t.Fatalf("exam type %q must pass, got %v", typ, err)
		}
	}
	for _, vis := range []string{VisibilityPrivate, VisibilityOrganization, VisibilityPublic} {
		req := good()
		req.Visibility = vis
		if err := validateCreate(req); err != nil {
			t.Fatalf("visibility %q must pass, got %v", vis, err)
		}
	}
	for _, key := range []string{ProviderIELTS, ProviderSAT, ProviderACT} {
		req := good()
		req.ProviderKey = &key
		if err := validateCreate(req); err != nil {
			t.Fatalf("provider %q must pass, got %v", key, err)
		}
	}
	badProvider := "toefl"
	bad := []struct {
		name string
		mut  func(*CreateRequest)
	}{
		{"empty slug", func(r *CreateRequest) { r.Slug = "   " }},
		{"empty title", func(r *CreateRequest) { r.Title = "" }},
		{"bad exam type", func(r *CreateRequest) { r.ExamType = "SAT" }},
		{"empty exam type", func(r *CreateRequest) { r.ExamType = "" }},
		{"bad visibility", func(r *CreateRequest) { r.Visibility = "secret" }},
		{"empty visibility", func(r *CreateRequest) { r.Visibility = "" }},
		{"bad provider", func(r *CreateRequest) { r.ProviderKey = &badProvider }},
		{"empty owner", func(r *CreateRequest) { r.OwnerID = "  " }},
	}
	for _, tc := range bad {
		req := good()
		tc.mut(&req)
		if err := validateCreate(req); err == nil {
			t.Fatalf("%s must fail validation", tc.name)
		}
	}
}
