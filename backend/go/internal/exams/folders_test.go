package exams

import (
	"context"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/auth"
)

func TestValidateFolderNameAcceptsNormal(t *testing.T) {
	for _, name := range []string{"Math drills", "  Trimmed  ", "Unicode runes test", "a.b", "a..b", "0"} {
		if err := ValidateFolderName(name); err != nil {
			t.Fatalf("expected %q to be valid, got %v", name, err)
		}
	}
}

func TestValidateFolderNameRejects(t *testing.T) {
	cases := map[string]string{
		"":                       "empty",
		"   ":                    "blank",
		".":                      "dot",
		"..":                     "dotdot",
		"a/b":                    "slash",
		`a\b`:                    "backslash",
		"a\x00b":                 "control",
		"a\nb":                   "newline",
		strings.Repeat("x", 256): "too long",
	}
	for name, why := range cases {
		if err := ValidateFolderName(name); err == nil {
			t.Fatalf("expected %q (%s) to be rejected", name, why)
		}
	}
	if err := ValidateFolderName(strings.Repeat("e", 255)); err != nil {
		t.Fatalf("255 runes must be accepted, got %v", err)
	}
}

func TestLibraryScopeKeyDerivation(t *testing.T) {
	org := "org-123"
	builderScope := LibraryScopeKey("sat", &org)
	if builderScope == LibraryScopeKey("sat", nil) {
		t.Fatal("builder scope must not collide with platform scope")
	}
	platformNamed := "platform"
	platformOrgScope := LibraryScopeKey("sat", &platformNamed)
	if platformOrgScope == LibraryScopeKey("sat", nil) {
		t.Fatalf("explicit org %q must not collide with nil platform scope (got %q)", platformNamed, platformOrgScope)
	}
	blank := "   "
	if got := LibraryScopeKey("SAT", &blank); got != LibraryScopeKey("sat", nil) {
		t.Fatalf("blank org collapses to platform, got %q", got)
	}
	lower := "Org-1"
	upper := "org-1"
	// Case-sensitive org identity: distinct org spellings hash distinctly even
	// when the DB collation would compare them equal.
	if LibraryScopeKey("sat", &lower) == LibraryScopeKey("sat", &upper) {
		t.Fatal("org identity must be case-sensitive")
	}
	if LibraryScopeKey("sat", &org) != builderScope {
		t.Fatal("scope derivation must be stable")
	}
}

func TestParentKeyForRoot(t *testing.T) {
	if parentKeyFor(nil) != "" {
		t.Fatal("nil parent must map to empty key")
	}
	blank := "   "
	if parentKeyFor(&blank) != "" {
		t.Fatal("blank parent must map to empty key")
	}
	id := "folder-1"
	if parentKeyFor(&id) != "folder-1" {
		t.Fatal("non-empty parent must pass through")
	}
}

func TestMoveExamsValidationGuards(t *testing.T) {
	svc := &Service{}
	admin := auth.NewActorContext("u-admin", auth.RoleAdmin)
	ctx := context.Background()
	if _, err := svc.MoveExamsForActor(ctx, admin, nil, nil); err == nil {
		t.Fatal("empty bulk move must be rejected")
	}
	big := make([]MoveExamItem, MaxMoveBulkItems+1)
	for i := range big {
		big[i] = MoveExamItem{ExamID: "e", Revision: 0}
	}
	if _, err := svc.MoveExamsForActor(ctx, admin, big, nil); err == nil {
		t.Fatal("oversize bulk move must be rejected")
	}
	dup := []MoveExamItem{{ExamID: "e1"}, {ExamID: "e1"}}
	if _, err := svc.MoveExamsForActor(ctx, admin, dup, nil); err == nil {
		t.Fatal("duplicate exam ids must be rejected")
	}
}

func TestListLibraryRejectsNonSAT(t *testing.T) {
	svc := &Service{}
	admin := auth.NewActorContext("u-admin", auth.RoleAdmin)
	if _, _, err := svc.ListLibraryForActor(context.Background(), admin, "ielts"); err == nil {
		t.Fatal("non-SAT library must be rejected")
	}
}
