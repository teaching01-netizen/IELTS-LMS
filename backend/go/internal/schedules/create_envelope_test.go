package schedules

// Plan E-honesty + round-59 fail-fast series: ValidateCreateRequest is
// the schedule-create envelope gate — Create runs it before any tx, so a
// malformed request (empty ids, inverted window) fails with zero SQL.
// This test pins the full envelope table on the exported gate.
// RED: table (behavior already correct — extraction preserves errors).
import (
	"testing"
	"time"
)

func TestValidateCreateRequestEnvelope(t *testing.T) {
	start := time.Now().UTC().Add(time.Hour)
	good := func() CreateRequest {
		return CreateRequest{ExamID: "exam-1", PublishedVersionID: "ver-1", CohortName: "cohort-a", StartTime: start, EndTime: start.Add(3 * time.Hour), CreatedBy: "u-1"}
	}
	if err := ValidateCreateRequest(good()); err != nil {
		t.Fatalf("valid create must pass, got %v", err)
	}
	bad := []struct {
		name string
		mut  func(*CreateRequest)
	}{
		{"empty exam id", func(r *CreateRequest) { r.ExamID = "  " }},
		{"empty version id", func(r *CreateRequest) { r.PublishedVersionID = "" }},
		{"empty cohort", func(r *CreateRequest) { r.CohortName = "" }},
		{"end before start", func(r *CreateRequest) { r.EndTime = r.StartTime.Add(-time.Hour) }},
		{"end equals start", func(r *CreateRequest) { r.EndTime = r.StartTime }},
		{"zero times", func(r *CreateRequest) { r.StartTime = time.Time{}; r.EndTime = time.Time{} }},
	}
	for _, tc := range bad {
		req := good()
		tc.mut(&req)
		if err := ValidateCreateRequest(req); err == nil {
			t.Fatalf("%s must fail validation", tc.name)
		}
	}
}
