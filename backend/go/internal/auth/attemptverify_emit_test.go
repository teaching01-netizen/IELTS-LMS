package auth

// Plan A3/E-exam-day: the verify slice (strict vs stateless, accept vs
// reject) proves the zero-SQL migration. RED: routed verifies emit.
import (
	"context"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestVerifyRoutedEmitsModeAndResult(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	cfg := testVerifyConfig()
	now := time.Now().UTC()
	tok := mintVerifyToken(t, cfg, now.Add(time.Hour))
	ctx := context.Background()
	if _, err := VerifyAttemptTokenRouted(ctx, nil, cfg, AttemptVerifyStateless, now.Add(time.Minute), tok); err != nil {
		t.Fatalf("valid stateless token must verify: %v", err)
	}
	if _, err := VerifyAttemptTokenRouted(ctx, nil, cfg, AttemptVerifyStateless, now.Add(time.Minute), tok+"tampered"); err == nil {
		t.Fatalf("tampered token must reject")
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MAttemptVerify, "mode", "stateless", "result", "accept"); got != 1 {
		t.Fatalf("one accept must count 1, got %v", got)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MAttemptVerify, "mode", "stateless", "result", "reject"); got != 1 {
		t.Fatalf("one reject must count 1, got %v", got)
	}
}
