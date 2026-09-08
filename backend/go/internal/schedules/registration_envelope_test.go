package schedules

// Plan E-honesty + round-63 fail-fast series (entry-wave hot path):
// ValidateRegistrationRequest is the registration envelope gate —
// CreateRegistration runs it before any tx, so a malformed wcode/email
// fails with zero SQL under the entry wave. Returns the normalized
// wcode on success (single normalization point). The schedule
// existence/status gate necessarily stays in-tx (locked read).
// RED: table on the exported gate.
import (
	"testing"
)

func TestValidateRegistrationRequestEnvelope(t *testing.T) {
	good := func() RegistrationRequest {
		return RegistrationRequest{Wcode: "W123456", Email: "student@example.com", StudentName: "Ada", UserID: "u-1"}
	}
	wcode, err := ValidateRegistrationRequest(good())
	if err != nil {
		t.Fatalf("valid registration must pass, got %v", err)
	}
	if wcode != "W123456" {
		t.Fatalf("must return normalized wcode, got %q", wcode)
	}
	// Lowercase wcode normalizes (entry clients send mixed case).
	lower := good()
	lower.Wcode = "w123456"
	if wcode, err := ValidateRegistrationRequest(lower); err != nil || wcode != "W123456" {
		t.Fatalf("lowercase wcode must normalize, got %q/%v", wcode, err)
	}
	bad := []struct {
		name string
		mut  func(*RegistrationRequest)
	}{
		// NOTE: ValidateWcode only requires non-empty after normalization
		// (guest codes like "guest-alpha_01" are legal) — so the wcode
		// rows pin emptiness, not shape.
		{"empty wcode", func(r *RegistrationRequest) { r.Wcode = "   " }},
		{"empty wcode 2", func(r *RegistrationRequest) { r.Wcode = "" }},
		{"empty email", func(r *RegistrationRequest) { r.Email = "" }},
		{"bad email", func(r *RegistrationRequest) { r.Email = "no-at-sign" }},
		{"empty name", func(r *RegistrationRequest) { r.StudentName = "  " }},
		{"empty user", func(r *RegistrationRequest) { r.UserID = "" }},
	}
	for _, tc := range bad {
		req := good()
		tc.mut(&req)
		if _, err := ValidateRegistrationRequest(req); err == nil {
			t.Fatalf("%s must fail validation", tc.name)
		}
	}
}
