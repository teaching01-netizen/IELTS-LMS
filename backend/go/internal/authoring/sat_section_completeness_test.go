package authoring

// Audit finding 5: publish readiness validated every section it was given but
// never proved the SET was complete, so a SAT missing a section (or carrying
// two of one key) could publish. These pin the exact-one invariant.
import (
	"strings"
	"testing"
)

func completenessIssuePaths(issues []ValidationIssue) []string {
	paths := make([]string, 0, len(issues))
	for _, issue := range issues {
		paths = append(paths, issue.Path)
	}
	return paths
}

func TestSATSectionCompletenessAcceptsTheBlueprintTopology(t *testing.T) {
	issues := validateSATSectionCompleteness([]Section{
		{SectionKey: SectionReadingWriting, Title: "Reading & Writing"},
		{SectionKey: SectionMath, Title: "Math"},
	})
	if len(issues) != 0 {
		t.Fatalf("the standard SAT topology must publish, got %+v", issues)
	}
}

func TestSATSectionCompletenessRejectsAMissingSection(t *testing.T) {
	for _, missing := range []string{SectionReadingWriting, SectionMath} {
		present := Section{SectionKey: SectionMath}
		if missing == SectionMath {
			present = Section{SectionKey: SectionReadingWriting}
		}
		issues := validateSATSectionCompleteness([]Section{present})
		if len(issues) != 1 {
			t.Fatalf("missing %s must report exactly one blocking issue, got %+v", missing, issues)
		}
		if !issues[0].Blocking {
			t.Fatalf("missing %s must be blocking", missing)
		}
		if issues[0].Path != missing {
			t.Fatalf("issue must name the missing section %s, got %s", missing, issues[0].Path)
		}
		if !strings.Contains(issues[0].Message, "exactly one") {
			t.Fatalf("message must state the cardinality rule, got %q", issues[0].Message)
		}
	}
}

func TestSATSectionCompletenessRejectsAnEmptyShell(t *testing.T) {
	issues := validateSATSectionCompleteness(nil)
	paths := completenessIssuePaths(issues)
	if len(issues) != 2 {
		t.Fatalf("an empty shell must report both sections missing, got %+v", issues)
	}
	if paths[0] != SectionReadingWriting || paths[1] != SectionMath {
		t.Fatalf("both required keys must be reported, got %v", paths)
	}
}

func TestSATSectionCompletenessRejectsDuplicateSectionKeys(t *testing.T) {
	issues := validateSATSectionCompleteness([]Section{
		{SectionKey: SectionReadingWriting},
		{SectionKey: SectionReadingWriting},
		{SectionKey: SectionMath},
	})
	if len(issues) != 1 {
		t.Fatalf("a duplicated key must report exactly one issue, got %+v", issues)
	}
	if !strings.Contains(issues[0].Message, "exactly one") || !strings.Contains(issues[0].Message, "2 were found") {
		t.Fatalf("message must name the count, got %q", issues[0].Message)
	}

	// A foreign key repeated is also a duplicate, not two valid sections.
	issues = validateSATSectionCompleteness([]Section{
		{SectionKey: SectionReadingWriting},
		{SectionKey: SectionMath},
		{SectionKey: "listening"},
		{SectionKey: "listening"},
	})
	if len(issues) != 1 || issues[0].Path != "listening" {
		t.Fatalf("a repeated non-blueprint key must be reported, got %+v", issues)
	}
}
