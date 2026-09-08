package main

// Plan E3: the retry hook must be wired in the serving binary — an
// unwired hook keeps db_deadlocks_total blind during the wave.
import (
	"errors"
	"testing"
)

func TestRetryKindLabels(t *testing.T) {
	if got := retryKind(errors.New("Error 1213: Deadlock found")); got != "deadlock" {
		t.Fatalf("deadlock kind, got %q", got)
	}
	if got := retryKind(errors.New("Lock wait timeout exceeded; try restarting transaction")); got != "lockwait" {
		t.Fatalf("lockwait kind, got %q", got)
	}
	if got := retryKind(errors.New("bad connection")); got != "conntransient" {
		t.Fatalf("conntransient kind, got %q", got)
	}
	if got := retryKind(nil); got != "unknown" {
		t.Fatalf("nil kind, got %q", got)
	}
}
