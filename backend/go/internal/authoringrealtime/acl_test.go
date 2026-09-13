package authoringrealtime

import (
	"context"
	"errors"
	"testing"
)

// fakeLoader injects exam lookups without a DB.
type fakeLoader struct {
	exam ExamView
	err  error
}

func (f fakeLoader) LoadExamForActor(context.Context, string, string, string) (ExamView, error) {
	return f.exam, f.err
}

func ptr(v string) *string { return &v }

func draftExam() ExamView {
	return ExamView{ID: "exam-1", OrganizationID: ptr("org-1"), CurrentDraftVersionID: ptr("draft-7")}
}

func TestVerifySubscriptionReadAdmitsReadRoles(t *testing.T) {
	for _, role := range []string{RoleAdmin, RoleAdminObserver, RoleBuilder} {
		t.Run(role, func(t *testing.T) {
			b, err := VerifySubscriptionRead(context.Background(), fakeLoader{exam: draftExam()}, "user-1", role, "exam-1", SubscriptionConfig{DeliveryEnabled: true})
			if err != nil {
				t.Fatal(err)
			}
			if b.ExamID != "exam-1" || b.DraftVersionID != "draft-7" {
				t.Fatalf("binding must be server-derived: %+v", b)
			}
			if b.OrganizationID == nil || *b.OrganizationID != "org-1" {
				t.Fatal("org must come from the exam row")
			}
		})
	}
}

func TestVerifySubscriptionReadDeniesOtherRoles(t *testing.T) {
	for _, role := range []string{"student", "proctor", "grader", "", "unknown"} {
		t.Run("role="+role, func(t *testing.T) {
			_, err := VerifySubscriptionRead(context.Background(), fakeLoader{exam: draftExam()}, "user-1", role, "exam-1", SubscriptionConfig{})
			denial, ok := Denied(err)
			if !ok {
				t.Fatalf("expected a typed denial for %q, got %v", role, err)
			}
			if denial.Code != CodePermissionDenied {
				t.Fatalf("want permission_denied, got %s", denial.Code)
			}
		})
	}
}

func TestVerifySubscriptionReadRequiresActor(t *testing.T) {
	_, err := VerifySubscriptionRead(context.Background(), fakeLoader{exam: draftExam()}, "  ", RoleAdmin, "exam-1", SubscriptionConfig{})
	if denial, ok := Denied(err); !ok || denial.Code != CodePermissionDenied {
		t.Fatalf("an empty actor must be denied, got %v", err)
	}
}

// TestUnknownExamAndCrossTenantAreIndistinguishable pins the no-oracle rule:
// the socket must not reveal whether an exam exists in another tenant.
func TestUnknownExamAndCrossTenantAreIndistinguishable(t *testing.T) {
	missing := fakeLoader{err: errors.New("Exam not found.")}
	crossTenant := fakeLoader{err: errors.New("Exam not found.")}
	_, errMissing := VerifySubscriptionRead(context.Background(), missing, "user-1", RoleBuilder, "exam-x", SubscriptionConfig{})
	_, errCross := VerifySubscriptionRead(context.Background(), crossTenant, "user-1", RoleBuilder, "exam-x", SubscriptionConfig{})
	dm, ok := Denied(errMissing)
	if !ok {
		t.Fatalf("missing exam must be a typed denial, got %v", errMissing)
	}
	dc, ok := Denied(errCross)
	if !ok {
		t.Fatalf("cross-tenant must be a typed denial, got %v", errCross)
	}
	if dm.Code != dc.Code || dm.Message != dc.Message {
		t.Fatalf("denials must be indistinguishable: %v vs %v", dm, dc)
	}
}

func TestPublishedExamIsDraftNotEditable(t *testing.T) {
	exam := ExamView{ID: "exam-1", OrganizationID: ptr("org-1"), CurrentDraftVersionID: nil}
	_, err := VerifySubscriptionRead(context.Background(), fakeLoader{exam: exam}, "user-1", RoleAdmin, "exam-1", SubscriptionConfig{})
	denial, ok := Denied(err)
	if !ok {
		t.Fatalf("expected a typed denial, got %v", err)
	}
	if denial.Code != CodeDraftNotEditable {
		t.Fatalf("want draft_not_editable, got %s", denial.Code)
	}
}

func TestEmptyDraftIDIsDraftNotEditable(t *testing.T) {
	exam := ExamView{ID: "exam-1", CurrentDraftVersionID: ptr("   ")}
	_, err := VerifySubscriptionRead(context.Background(), fakeLoader{exam: exam}, "user-1", RoleAdmin, "exam-1", SubscriptionConfig{})
	if denial, ok := Denied(err); !ok || denial.Code != CodeDraftNotEditable {
		t.Fatalf("a blank draft id must be draft_not_editable, got %v", err)
	}
}

func TestNilLoaderIsForbiddenNotCrash(t *testing.T) {
	_, err := VerifySubscriptionRead(context.Background(), nil, "user-1", RoleAdmin, "exam-1", SubscriptionConfig{})
	if _, ok := Denied(err); !ok {
		t.Fatalf("a nil loader must be a typed denial, got %v", err)
	}
}

// TestDeliveryFlagIsNotAnACLConcern pins the ordering rule: the ACL admits on
// role + tenant + draft alone, so a flag-off server is indistinguishable from
// a forbidden one and leaks no authorization detail.
func TestDeliveryFlagIsNotAnACLConcern(t *testing.T) {
	_, err := VerifySubscriptionRead(context.Background(), fakeLoader{exam: draftExam()}, "user-1", RoleAdmin, "exam-1", SubscriptionConfig{DeliveryEnabled: false})
	if err != nil {
		t.Fatalf("the ACL must not consult the delivery flag: %v", err)
	}
}

func TestRevalidate(t *testing.T) {
	b := Binding{ExamID: "exam-1", DraftVersionID: "draft-7"}
	if err := b.Revalidate("draft-7"); err != nil {
		t.Fatalf("same draft must pass: %v", err)
	}
	err := b.Revalidate("draft-8")
	denial, ok := Denied(err)
	if !ok {
		t.Fatalf("a replaced draft must be a typed denial, got %v", err)
	}
	if denial.Code != CodeDraftReplaced {
		t.Fatalf("want draft_replaced, got %s", denial.Code)
	}
	if err := b.Revalidate(""); err == nil {
		t.Fatal("a removed draft must fail revalidation")
	}
}

// TestBindingMatchesExamScope pins the routing scope: organization + exam.
func TestBindingMatchesExamScope(t *testing.T) {
	b := Binding{ExamID: "exam-1", DraftVersionID: "draft-7", OrganizationID: ptr("org-1")}
	match := Event{Scope: Scope{OrganizationID: ptr("org-1"), ExamID: "exam-1", DraftVersionID: "draft-7"}}
	if !b.MatchesExamScope(match) {
		t.Fatal("a same-exam event must match")
	}
	otherExam := match
	otherExam.Scope.ExamID = "exam-2"
	if b.MatchesExamScope(otherExam) {
		t.Fatal("another exam must never match")
	}
	otherOrg := match
	otherOrg.Scope.OrganizationID = ptr("org-2")
	if b.MatchesExamScope(otherOrg) {
		t.Fatal("another tenant must never match")
	}
	// The draft is NOT part of the transport scope: a working draft is
	// replaceable, so an event announcing its replacement must reach a
	// subscriber still bound to the old draft.
	otherDraft := match
	otherDraft.Scope.DraftVersionID = "draft-8"
	if !b.MatchesExamScope(otherDraft) {
		t.Fatal("a same-exam event from another draft MUST still be delivered")
	}
	if b.MatchesDraftScope(otherDraft) {
		t.Fatal("MatchesDraftScope must report a different draft")
	}
	if !b.MatchesDraftScope(match) {
		t.Fatal("MatchesDraftScope must report the same draft")
	}
}

// TestPlatformScopeMatchesPlatformBinding pins the nullable-org semantics.
func TestPlatformScopeMatchesPlatformBinding(t *testing.T) {
	b := Binding{ExamID: "exam-1", DraftVersionID: "draft-7", OrganizationID: nil}
	match := Event{Scope: Scope{OrganizationID: nil, ExamID: "exam-1", DraftVersionID: "draft-7"}}
	if !b.MatchesExamScope(match) {
		t.Fatal("platform scope must match a platform binding")
	}
	tenant := match
	tenant.Scope.OrganizationID = ptr("org-1")
	if b.MatchesExamScope(tenant) {
		t.Fatal("a tenant event must not match a platform binding")
	}
}

func TestRoleHelpers(t *testing.T) {
	for _, role := range []string{RoleAdmin, RoleAdminObserver, RoleBuilder} {
		if !CanReadAuthoring(role) {
			t.Fatalf("%s must read", role)
		}
	}
	if CanReadAuthoring("student") {
		t.Fatal("student must not read authoring realtime")
	}
}
