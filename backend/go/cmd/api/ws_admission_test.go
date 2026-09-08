package main

import (
	"context"
	"testing"

	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/config"
)

func memoryApp() *App {
	cfg := config.Load()
	cfg.WSAdmission = config.WSAdmissionMemory
	return &App{
		Config:    cfg,
		Admission: liveupdates.NewAdmission(liveupdates.AdmissionCaps{Total: 2, PerUser: 1, PerSchedule: 2}),
	}
}

// C2: memory acquire admits without any DB handle (zero SQL by construction:
// App.DB is nil here, so any SQL attempt would nil-panic).
func TestWSAdmissionMemoryAcquireNoDB(t *testing.T) {
	app := memoryApp()
	tok, ok, err := app.acquireWSLease(context.Background(), "api", "u1", wsStrptr("s1"))
	if err != nil || !ok || tok == "" {
		t.Fatalf("memory acquire must admit with no DB: ok=%v err=%v", ok, err)
	}
	if err := app.wsHeartbeatFunc()(context.Background(), tok, "api", "u1"); err != nil {
		t.Fatalf("heartbeat must extend: %v", err)
	}
	app.releaseWSLease(context.Background(), tok, "api", "u1")
	if got := app.Admission.Active(); got != 0 {
		t.Fatalf("release must drain, active=%d", got)
	}
}

// C2: cap rejection surfaces admitted=false (handler renders the 429 shape).
func TestWSAdmissionMemoryCapRejects(t *testing.T) {
	app := memoryApp()
	if _, ok, _ := app.acquireWSLease(context.Background(), "api", "u1", wsStrptr("s1")); !ok {
		t.Fatalf("first must admit")
	}
	if _, ok, err := app.acquireWSLease(context.Background(), "api", "u1", wsStrptr("s1")); err != nil || ok {
		t.Fatalf("user cap must reject with admitted=false, got ok=%v err=%v", ok, err)
	}
}

// C2: db mode without a repo fails closed (503), not permissive.
func TestWSAdmissionDBNeedsRepo(t *testing.T) {
	app := &App{Config: config.Load()}
	if _, _, err := app.acquireWSLease(context.Background(), "api", "u1", nil); err == nil {
		t.Fatalf("db mode without repo must fail closed")
	}
	if app.wsGateReady() {
		t.Fatalf("gate must report unready without repo")
	}
	if !memoryApp().wsGateReady() {
		t.Fatalf("memory gate must report ready")
	}
}

func wsStrptr(s string) *string { return &s }
