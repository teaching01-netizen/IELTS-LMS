package assessmentforms

import (
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/assessmentforms/definition"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// StatusSQL is the reporting seam: it must expose exactly the staff list's
// expression, rebound to a caller-chosen response alias.
func TestStatusSQLKeepsTheStaffListExpression(t *testing.T) {
	for _, formKey := range []string{
		definition.FormRegistration,
		definition.FormVerbalEntry,
		definition.FormMathEntry,
		definition.FormEvaSim,
	} {
		expression, err := StatusSQL(formKey, "r")
		if err != nil {
			t.Fatalf("%s: %v", formKey, err)
		}
		if expression != statusSQL(formKey) {
			t.Fatalf("%s: StatusSQL diverged from the staff list expression", formKey)
		}
	}
}

func TestStatusSQLBindsTheResponseAlias(t *testing.T) {
	for _, formKey := range []string{
		definition.FormRegistration,
		definition.FormVerbalEntry,
		definition.FormMathEntry,
		definition.FormEvaSim,
	} {
		expression, err := StatusSQL(formKey, "r_report")
		if err != nil {
			t.Fatalf("%s: %v", formKey, err)
		}
		if !strings.Contains(expression, "r_report.attempt_id") {
			t.Fatalf("%s: alias not bound:\n%s", formKey, expression)
		}
		if strings.Contains(expression, "r.attempt_id") {
			t.Fatalf("%s: stale r. reference left behind:\n%s", formKey, expression)
		}
	}
}

func TestStatusSQLRejectsUnknownFormKeyAndAlias(t *testing.T) {
	cases := []struct {
		name    string
		formKey string
		alias   string
	}{
		{"unknown key", "unknown", "r"},
		{"empty key", "", "r"},
		{"upper-case alias", definition.FormRegistration, "R"},
		{"injection", definition.FormRegistration, "r; DROP TABLE student_attempts"},
		{"qualified alias", definition.FormRegistration, "a.r"},
		{"empty alias", definition.FormRegistration, ""},
		{"too long", definition.FormRegistration, "r" + strings.Repeat("0", 40)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := StatusSQL(c.formKey, c.alias); err == nil {
				t.Fatal("expected a validation error")
			} else if appErr, ok := apperrors.As(err); !ok || appErr.Code != apperrors.CodeValidation {
				t.Fatalf("expected VALIDATION_ERROR, got %v", err)
			}
		})
	}
}
