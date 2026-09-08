package config

import (
	"testing"
)

// C3 RED: STUDENT_WS gates student sockets. allow (default) = dual-serve
// ship state; gone = students get 410 + {use: runtime-poll}. Unknown fails
// closed (never silently drops student sockets).
func TestStudentWSDefaultsAllow(t *testing.T) {
	t.Setenv("STUDENT_WS", "")
	if cfg := Load(); cfg.StudentWS != StudentWSAllow {
		t.Fatalf("STUDENT_WS must default allow, got %q", cfg.StudentWS)
	}
}

func TestStudentWSGoneParses(t *testing.T) {
	t.Setenv("STUDENT_WS", "gone")
	if cfg := Load(); cfg.StudentWS != StudentWSGone {
		t.Fatalf("gone must parse, got %q", cfg.StudentWS)
	}
}

func TestStudentWSUnknownFailsClosed(t *testing.T) {
	t.Setenv("STUDENT_WS", "bogus")
	cfg := Load()
	if cfg.StudentWSGone() {
		t.Fatalf("unknown mode must not report gone")
	}
	if err := cfg.ValidateForRuntime(); err == nil {
		t.Fatalf("unknown STUDENT_WS must fail validation")
	}
}
