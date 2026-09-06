package auth

import (
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// Authorization matrix (plan 131): every role against the route families
// it may and may not touch. The matrix pins the RequireOneOf decisions
// handlers must make; it fails closed on unknown roles.
func TestAuthorizationMatrix(t *testing.T) {
	admin := NewActorContext("u-admin", RoleAdmin)
	observer := NewActorContext("u-obs", RoleAdminObserver)
	builder := NewActorContext("u-builder", RoleBuilder)
	proctor := NewActorContext("u-proctor", RoleProctor)
	grader := NewActorContext("u-grader", RoleGrader)
	student := NewActorContext("u-student", RoleStudent)
	ghost := NewActorContext("u-ghost", "ghost")

	cases := []struct {
		name  string
		actor ActorContext
		roles []string
		allow bool
	}{
		{"admin writes exams", admin, []string{RoleAdmin}, true},
		{"observer cannot write exams", observer, []string{RoleAdmin}, false},
		{"builder writes authoring", builder, []string{RoleAdmin, RoleBuilder}, true},
		{"student cannot write authoring", student, []string{RoleAdmin, RoleBuilder}, false},
		{"proctor controls attempts", proctor, []string{RoleAdmin, RoleProctor}, true},
		{"grader cannot control attempts", grader, []string{RoleAdmin, RoleProctor}, false},
		{"grader reviews writing", grader, []string{RoleAdmin, RoleGrader}, true},
		{"student cannot review writing", student, []string{RoleAdmin, RoleGrader}, false},
		{"observer reads grading", observer, []string{RoleAdmin, RoleAdminObserver, RoleGrader}, true},
		{"student reads own results", student, []string{RoleStudent}, true},
		{"proctor cannot read as student", proctor, []string{RoleStudent}, false},
		{"unknown role denied everywhere", ghost, AllRoles, false},
	}
	for _, c := range cases {
		err := RequireOneOf(c.actor, c.roles...)
		if c.allow && err != nil {
			t.Fatalf("%s: expected allow, got %v", c.name, err)
		}
		if !c.allow {
			if err == nil {
				t.Fatalf("%s: expected FORBIDDEN, got allow", c.name)
			}
			if err.Code != apperrors.CodeForbidden {
				t.Fatalf("%s: expected FORBIDDEN, got %s", c.name, err.Code)
			}
		}
	}
}

// Tenant boundary (plan 131): organization scope is carried on the actor,
// never on the command payload. Platform roles ignore tenant fences;
// tenant actors are pinned to their org; actors without scope see nothing.
func TestTenantBoundary(t *testing.T) {
	admin := NewActorContext("u-admin", RoleAdmin)
	if !admin.IsPlatformWrite() {
		t.Fatal("admin must hold platform write scope")
	}
	if !admin.IsPlatformRead() {
		t.Fatal("admin must hold platform read scope")
	}
	observer := NewActorContext("u-obs", RoleAdminObserver)
	if observer.IsPlatformWrite() {
		t.Fatal("observer must not hold platform write scope")
	}
	if !observer.IsPlatformRead() {
		t.Fatal("observer must hold platform read scope")
	}
	builder := NewActorContext("u-builder", RoleBuilder).WithOrgID("org-1")
	if builder.OrgID == nil || *builder.OrgID != "org-1" {
		t.Fatal("tenant actor must carry its org id")
	}
	if builder.IsPlatformWrite() || builder.IsPlatformRead() {
		t.Fatal("tenant actor must not hold platform scope")
	}
	// With* copies are immutable: the base actor keeps no org.
	base := NewActorContext("u-builder", RoleBuilder)
	if base.OrgID != nil {
		t.Fatal("WithOrgID must not mutate the base actor")
	}
	// Schedule scope is additive and copy-safe.
	scoped := base.WithScheduleScope("sched-1", "sched-2")
	if len(scoped.ScheduleScope) != 2 || len(base.ScheduleScope) != 0 {
		t.Fatal("WithScheduleScope must copy, not mutate")
	}
}
