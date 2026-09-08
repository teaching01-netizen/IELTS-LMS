package main

import (
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
)

// C1: the forwarder runs only in db mode (direct has no peers/rows).
func TestLiveForwarderEnabledMatrix(t *testing.T) {
	db := config.Load()
	if !liveForwarderEnabled(db) {
		t.Fatalf("db mode must run the forwarder")
	}
	direct := config.Load()
	direct.LiveBus = config.LiveBusDirect
	if liveForwarderEnabled(direct) {
		t.Fatalf("direct mode must keep the forwarder down")
	}
}
