package runtime

import (
	"testing"
)

// Fence matrix (plan 111: extend vs advance, pause vs resume, complete vs
// student write). The fence is pure: any stale expectation is a 409 with
// the stable message, regardless of which command raced.
func TestFenceMatrix(t *testing.T) {
	rev1, rev2 := int64(1), int64(2)
	secA, secB := "rw", "math"
	cases := []struct {
		name    string
		actual  int64
		section *string
		fence   RevisionFence
		stale   bool
	}{
		{"fresh revision+section", 1, &secA, RevisionFence{ExpectedRuntimeRevision: &rev1, ExpectedActiveSectionKey: &secA}, false},
		{"no expectations always fresh", 9, &secB, RevisionFence{}, false},
		{"stale revision (pause vs resume)", 2, &secA, RevisionFence{ExpectedRuntimeRevision: &rev1}, true},
		{"stale revision (extend vs advance)", 2, &secA, RevisionFence{ExpectedRuntimeRevision: &rev1, ExpectedActiveSectionKey: &secA}, true},
		{"stale section (complete vs write)", 1, &secB, RevisionFence{ExpectedRuntimeRevision: &rev1, ExpectedActiveSectionKey: &secA}, true},
		{"nil section expectation ignores section", 1, &secB, RevisionFence{ExpectedRuntimeRevision: &rev1}, false},
	}
	_ = rev2
	for _, c := range cases {
		err := CheckFence(c.actual, c.section, c.fence)
		if c.stale && err == nil {
			t.Fatalf("%s: expected stale fence error", c.name)
		}
		if !c.stale && err != nil {
			t.Fatalf("%s: unexpected error %v", c.name, err)
		}
		if err != nil && err.Error() != "CONFLICT: Runtime changed; refresh before retrying." {
			t.Fatalf("%s: wrong message %q", c.name, err.Error())
		}
	}
}
