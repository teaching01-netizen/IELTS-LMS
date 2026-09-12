package config

// Wave-5 pin: malformed env values must self-report (loud default) instead
// of booting with wrong budgets invisibly. Boot is preserved (legacy
// safety); the deploy log carries the signal.
import (
	"os"
	"testing"
)

func TestMalformedEnvKeepsDefault(t *testing.T) {
	t.Setenv("DB_POOL_MAX_CONNECTIONS", "not-a-number")
	if got := getenvInt("DB_POOL_MAX_CONNECTIONS", 20); got != 20 {
		t.Fatalf("malformed int must keep default, got %d", got)
	}
	t.Setenv("DB_POOL_MAX_CONNECTIONS", "10x")
	if got := getenvInt("DB_POOL_MAX_CONNECTIONS", 20); got != 20 {
		t.Fatalf("trailing-garbage int must keep default, got %d", got)
	}
	os.Unsetenv("SOME_BOOL_KEY_FOR_TEST")
	t.Setenv("SOME_BOOL_KEY_FOR_TEST", "maybe")
	if got := getenvBool("SOME_BOOL_KEY_FOR_TEST", true); got != true {
		t.Fatalf("malformed bool must keep default, got %v", got)
	}
	t.Setenv("SOME_RATE_KEY_FOR_TEST", "fast")
	if got := entryRateFromEnv("SOME_RATE_KEY_FOR_TEST", 1.5); got != 1.5 {
		t.Fatalf("malformed rate must keep default, got %v", got)
	}
}
