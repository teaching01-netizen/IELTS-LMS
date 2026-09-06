package schedules

import "testing"

func TestProtocolVersionDefaultsToV2(t *testing.T) {
	if ProtocolVersionV2 != 2 {
		t.Fatalf("ProtocolVersionV2 = %d, want 2 (V1 retirement stage 1)", ProtocolVersionV2)
	}
}

func TestNormalizeAccessCode(t *testing.T) {
	cases := map[string]string{
		"W123456":        "W123456",
		"w123456":        "W123456",
		"  W123456  ":    "W123456",
		"guest-alpha_01": "guest-alpha_01",
	}
	for in, want := range cases {
		if got := NormalizeAccessCode(in); got != want {
			t.Fatalf("NormalizeAccessCode(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestValidateWcodeAndEmail(t *testing.T) {
	if err := ValidateWcode("W123456"); err != nil {
		t.Fatalf("valid wcode rejected: %v", err)
	}
	if err := ValidateWcode("   "); err == nil {
		t.Fatal("expected empty wcode to fail")
	}
	if err := ValidateEmail("student@example.com"); err != nil {
		t.Fatalf("valid email rejected: %v", err)
	}
	for _, bad := range []string{"", "no-at-sign", "a@b"} {
		if err := ValidateEmail(bad); err == nil {
			t.Fatalf("expected email %q to fail", bad)
		}
	}
}

func TestNormalizeRuntimeCommandActionAcceptsFrontendAliases(t *testing.T) {
	cases := map[string]string{
		"start":            CommandStart,
		"start_runtime":    CommandStart,
		"pause":            CommandPause,
		"pause_runtime":    CommandPause,
		"resume":           CommandResume,
		"resume_runtime":   CommandResume,
		"complete":         CommandComplete,
		"complete_runtime": CommandComplete,
		"unknown":          "unknown",
	}
	for input, want := range cases {
		if got := normalizeRuntimeCommandAction(input); got != want {
			t.Fatalf("normalizeRuntimeCommandAction(%q) = %q, want %q", input, got, want)
		}
	}
}
