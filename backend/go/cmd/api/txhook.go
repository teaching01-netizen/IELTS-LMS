package main

// Plan E3: retry observability wiring. The tx retry loop absorbs transient
// InnoDB failures (deadlock/lock-wait) via an injectable hook; this file
// wires it to db_deadlocks_total in serving binaries. Without it, a wave
// that deadlocks 500x and retries clean looks identical to zero
// contention on the dashboard. Labels stay low-cardinality (I5): kind is
// deadlock | lockwait | conntransient, never raw SQL text.
import (
	"errors"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/go-sql-driver/mysql"
)

// installTxRetryHook reports each absorbed transient. Returns a restore
// func (tests). Called once per process (api main + worker main).
func installTxRetryHook() func() {
	return tx.SetRetryHook(func(err error) {
		telemetry.IncCounter(telemetry.MDeadlocks, "kind", retryKind(err))
	})
}

// installTxDurationHook exports transaction-attempt latency to db_tx_duration_seconds.
// Outcomes are fixed by internal/platform/tx; no statement, attempt, or user
// identifiers are attached to the series.
func installTxDurationHook() func() {
	return tx.SetDurationHook(func(duration time.Duration, outcome string) {
		telemetry.ObserveSeconds(telemetry.MTxDur, duration.Seconds(), "outcome", outcome)
	})
}

// retryKind classifies the absorbed transient for the dashboard slice.
func retryKind(err error) string {
	var dbErr *mysql.MySQLError
	if !errors.As(err, &dbErr) {
		return "unknown"
	}
	switch dbErr.Number {
	case 1213:
		return "deadlock"
	case 1205:
		return "lockwait"
	default:
		return "unknown"
	}
}
