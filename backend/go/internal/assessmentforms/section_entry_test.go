package assessmentforms

import (
	"example.com/ielts-proctoring/internal/assessmentforms/definition"
	"testing"
)

func TestSectionEntryDecisions(t *testing.T) {
	f := definition.DefaultSectionSATForms()
	c := attemptContext{Forms: &f, ScheduleStatus: "live", ProctorStatus: "active", VersionID: "v"}
	for _, test := range []struct {
		name, module string
		pending      bool
		want         string
	}{
		{"future section", "", false, "waiting"}, {"break active", "m", true, "waiting"}, {"math ready", "m", false, "required"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := sectionEntryDecision(c, "math", test.module, "not_started", test.pending, nil)
			if got.State != test.want {
				t.Fatalf("got %s want %s", got.State, test.want)
			}
		})
	}
	got := sectionEntryDecision(c, "reading-writing", "rw", "not_started", false, nil)
	if got.State != "not_applicable" {
		t.Fatal("empty Verbal form must skip")
	}
	c.ScheduleStatus = "completed"
	if got := sectionEntryDecision(c, "math", "m", "not_started", false, nil); got.CanSubmit {
		t.Fatal("closed room must not collect section answers")
	}
}
