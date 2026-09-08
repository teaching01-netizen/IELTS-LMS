package main

import (
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
)

// B3: BuildApp surfaces the row-first posture from config so the V2 write
// path, V1 readers, and seal behavior stay consistent per deploy.
func TestAppRowFirstWiring(t *testing.T) {
	cfg := config.Load()
	cfg.RowFirstWrites = false
	app := BuildApp(cfg, nil)
	if app.RowFirst() {
		t.Fatalf("flag-off must keep legacy write path")
	}
	cfg2 := config.Load()
	cfg2.RowFirstWrites = true
	app2 := BuildApp(cfg2, nil)
	if !app2.RowFirst() {
		t.Fatalf("flag-on must select row-first write path")
	}
}
