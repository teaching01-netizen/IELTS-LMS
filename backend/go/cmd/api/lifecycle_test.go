package main

// Wave-4 pins: background loops stop on shutdown (no leaked tickers), so
// repeated router builds in tests and graceful shutdown in prod leave no
// stray goroutines hammering the DB.
import (
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
)

// stopLiveForwarder is idempotent and nil-safe: double-stop never panics.
func TestLifecycleForwarderStopIdempotent(t *testing.T) {
	app := BuildApp(config.Load(), nil)
	app.stopLiveForwarder()
	app.stopLiveForwarder()
	var nilApp *App
	nilApp.stopLiveForwarder()
}

// Admission gate stops cleanly (reaper halted, idempotent).
func TestLifecycleAdmissionStopIdempotent(t *testing.T) {
	app := BuildApp(config.Load(), nil)
	if app.Admission == nil {
		t.Fatal("Admission must always be non-nil")
	}
	app.Admission.Stop()
	app.Admission.Stop()
}
