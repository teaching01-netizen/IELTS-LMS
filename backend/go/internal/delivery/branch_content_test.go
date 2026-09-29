package delivery

// SEV-1 content fence: both adaptive branches live in one immutable published
// version tree, so the delivery payload must narrow to the branch the attempt
// was actually routed into. "Has an assessment_module_attempts row" is exactly
// "was assigned" (nextModuleTx inserts the selected branch's row in the same
// transaction as the route decision).

import (
	"os"
	"strings"
	"testing"
)

// Both payload-assembly paths must apply the fence. A new one that copies the
// loader chain without the call would silently ship the other branch again —
// which is exactly the miss this guard exists for (the StartModule /
// EnterModule payload is built by assembleBootstrap, not by Bootstrap).
func TestBothBootstrapAssembliesApplyTheBranchFence(t *testing.T) {
	raw, err := os.ReadFile("start_submit.go")
	if err != nil {
		t.Fatal(err)
	}
	src := string(raw)
	guard := "filterModuleAttemptsForSections(moduleAttempts, sections)"
	fence := "deliverySectionsForAttempt(sections, moduleAttempts)"
	guards := strings.Count(src, guard)
	fences := strings.Count(src, fence)
	if guards == 0 {
		t.Fatalf("assembleBootstrap no longer contains %q; update this guard", guard)
	}
	if fences < guards {
		t.Fatalf("assembleBootstrap loads module attempts (%d) but applies the branch fence only %d times", guards, fences)
	}

	// The read path (Bootstrap) is in the other file.
	serviceRaw, err := os.ReadFile("service.go")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(serviceRaw), fence) == 0 {
		t.Fatalf("Bootstrap no longer applies the branch fence (%q)", fence)
	}
}

func branchSectionFixture() []DeliverySection {
	return []DeliverySection{
		{
			ID: "sec-rw", SectionKey: "reading-writing",
			Modules: []DeliveryModule{
				{ID: "rw-m1", ModuleKey: "rw-m1", AdaptiveRole: "base"},
				{ID: "rw-m2-lower", ModuleKey: "rw-m2", AdaptiveRole: "lower_branch"},
				{ID: "rw-m2-higher", ModuleKey: "rw-m2", AdaptiveRole: "higher_branch"},
			},
		},
		{
			ID: "sec-math", SectionKey: "math",
			Modules: []DeliveryModule{
				{ID: "math-m1", ModuleKey: "math-m1", AdaptiveRole: "base"},
				{ID: "math-m2-lower", ModuleKey: "math-m2", AdaptiveRole: "lower_branch"},
				{ID: "math-m2-higher", ModuleKey: "math-m2", AdaptiveRole: "higher_branch"},
				{ID: "math-drill", ModuleKey: "math-drill", AdaptiveRole: "none"},
			},
		},
	}
}

func moduleIDs(sections []DeliverySection) []string {
	var out []string
	for _, section := range sections {
		for _, module := range section.Modules {
			out = append(out, module.ID)
		}
	}
	return out
}

func TestDeliverySectionsForAttemptKeepsOnlyOpenedBranch(t *testing.T) {
	for _, test := range []struct {
		name    string
		attempt []ModuleAttempt
		want    []string
	}{
		{
			name:    "pre-routing keeps base modules only",
			attempt: []ModuleAttempt{{ModuleID: "rw-m1"}},
			want:    []string{"rw-m1", "math-m1", "math-drill"},
		},
		{
			name: "routed higher keeps higher and never lower",
			attempt: []ModuleAttempt{
				{ModuleID: "rw-m1"},
				{ModuleID: "rw-m2-higher"},
			},
			want: []string{"rw-m1", "rw-m2-higher", "math-m1", "math-drill"},
		},
		{
			name: "routed lower keeps lower and never higher",
			attempt: []ModuleAttempt{
				{ModuleID: "rw-m1"},
				{ModuleID: "rw-m2-lower"},
			},
			want: []string{"rw-m1", "rw-m2-lower", "math-m1", "math-drill"},
		},
		{
			name: "second section routes independently",
			attempt: []ModuleAttempt{
				{ModuleID: "rw-m1"},
				{ModuleID: "rw-m2-higher"},
				{ModuleID: "math-m1"},
				{ModuleID: "math-m2-lower"},
			},
			want: []string{"rw-m1", "rw-m2-higher", "math-m1", "math-m2-lower", "math-drill"},
		},
		{
			name:    "no attempts at all drops both branches",
			attempt: nil,
			want:    []string{"rw-m1", "math-m1", "math-drill"},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := moduleIDs(deliverySectionsForAttempt(branchSectionFixture(), test.attempt))
			if len(got) != len(test.want) {
				t.Fatalf("delivered modules = %v, want %v", got, test.want)
			}
			for i := range got {
				if got[i] != test.want[i] {
					t.Fatalf("delivered modules = %v, want %v", got, test.want)
				}
			}
		})
	}
}

// The version cache's tree is shared across schedules; the fence must copy
// rather than mutate it.
func TestDeliverySectionsForAttemptDoesNotMutateInput(t *testing.T) {
	cached := branchSectionFixture()
	before := moduleIDs(cached)

	deliverySectionsForAttempt(cached, []ModuleAttempt{{ModuleID: "rw-m1"}})

	after := moduleIDs(cached)
	if len(after) != len(before) {
		t.Fatalf("cached tree was mutated: %v -> %v", before, after)
	}
	for i := range before {
		if before[i] != after[i] {
			t.Fatalf("cached tree was mutated: %v -> %v", before, after)
		}
	}
}
