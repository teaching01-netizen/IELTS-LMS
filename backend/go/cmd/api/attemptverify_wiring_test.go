package main

import (
	"testing"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
)

// A3 RED: the app exposes the attempt-verify posture from config so every
// bearer handler routes identically (no per-handler drift).
func TestAppAttemptVerifyModeWiring(t *testing.T) {
	cfg := config.Load()
	cfg.AttemptVerify = config.AttemptVerifyStrict
	app := BuildApp(cfg, nil)
	if app.AttemptVerifyMode() != auth.AttemptVerifyStrict {
		t.Fatalf("strict config must surface strict mode, got %q", app.AttemptVerifyMode())
	}
	cfg2 := config.Load()
	cfg2.AttemptVerify = config.AttemptVerifyStateless
	app2 := BuildApp(cfg2, nil)
	if app2.AttemptVerifyMode() != auth.AttemptVerifyStateless {
		t.Fatalf("stateless config must surface stateless mode, got %q", app2.AttemptVerifyMode())
	}
}
