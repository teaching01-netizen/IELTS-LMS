package main

import (
	"testing"

	"example.com/ielts-proctoring/internal/auth"
)

// Free entry by default: any ACTIVE account may check in to any exam with any
// non-empty access code. Only the account state gates entry (disabled /
// locked / pending_activation stay blocked); the role never does.
func TestIsStudentEntryAccountAllowed(t *testing.T) {
	cases := []struct {
		name  string
		role  string
		state string
		want  bool
	}{
		{"new student active", auth.RoleStudent, "active", true},
		{"staff admin active freely", auth.RoleAdmin, "active", true},
		{"staff builder active freely", auth.RoleBuilder, "active", true},
		{"staff proctor active freely", auth.RoleProctor, "active", true},
		{"staff grader active freely", auth.RoleGrader, "active", true},
		{"student disabled blocked", auth.RoleStudent, "disabled", false},
		{"student locked blocked", auth.RoleStudent, "locked", false},
		{"student pending blocked", auth.RoleStudent, "pending_activation", false},
		{"staff disabled blocked", auth.RoleAdmin, "disabled", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isStudentEntryAccountAllowed(tc.role, tc.state); got != tc.want {
				t.Fatalf("isStudentEntryAccountAllowed(%q, %q) = %v, want %v", tc.role, tc.state, got, tc.want)
			}
		})
	}
}
