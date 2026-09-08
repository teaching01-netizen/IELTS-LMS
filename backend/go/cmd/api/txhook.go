package main

// Plan E3: retry observability wiring. The tx retry loop absorbs transient
// InnoDB failures (deadlock/lock-wait) via an injectable hook; this file
// wires it to db_deadlocks_total in serving binaries. Without it, a wave
// that deadlocks 500x and retries clean looks identical to zero
// contention on the dashboard. Labels stay low-cardinality (I5): kind is
// deadlock | lockwait | conntransient, never raw SQL text.
import (
	"strings"

	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// installTxRetryHook reports each absorbed transient. Returns a restore
// func (tests). Called once per process (api main + worker main).
func installTxRetryHook() func() {
	return tx.SetRetryHook(func(err error) {
		telemetry.IncCounter(telemetry.MDeadlocks, "kind", retryKind(err))
	})
}

// retryKind classifies the absorbed transient for the dashboard slice.
func retryKind(err error) string {
	if err == nil {
		return "unknown"
	}
	s := strings.ToLower(err.Error())
	if strings.Contains(s, "deadlock") {
		return "deadlock"
	}
	if strings.Contains(s, "lock wait timeout") || strings.Contains(s, "try restarting transaction") {
		return "lockwait"
	}
	return "conntransient"
}
