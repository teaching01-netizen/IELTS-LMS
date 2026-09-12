package main

import (
	"context"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/config"
)

// WS-16: BuildApp version-cache wiring - behavioral divergence (cached tree
// vs full load), not a nil guard. On with a pool must set the Delivery
// VersionCached posture (Bootstrap serves the cached tree on revision hit);
// off must leave VersionCached false (today's N+1 load every bootstrap). A
// wiring that builds the cache but drops SetVersionCache would keep full
// loads while the flag claims cached. Load-bearing lines: main.go
// Versions wiring + deliverySvc.SetVersionCache gate.
func TestAppVersionCacheWiring(t *testing.T) {
	mkTree := func() []delivery.DeliverySection {
		return []delivery.DeliverySection{{ID: "sec-1", SectionKey: "rw", Title: "Reading"}}
	}

	cfg := config.Load()
	cfg.VersionCacheEnabled = false
	off := BuildApp(cfg, nil)
	if off.Versions == nil {
		t.Fatalf("Versions cache must always be non-nil")
	}
	if off.Delivery != nil && off.Delivery.VersionCached() {
		t.Fatalf("version-cache-off must leave Delivery uncached (N+1 path)")
	}

	pool, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = pool.Close() }()
	cfg2 := config.Load()
	cfg2.VersionCacheEnabled = true
	on := BuildApp(cfg2, pool)
	if on.Versions == nil {
		t.Fatalf("Versions cache must always be non-nil")
	}
	if on.Delivery == nil {
		t.Fatalf("pool build must wire the Delivery service")
	}
	if !on.Delivery.VersionCached() {
		t.Fatalf("version-cache-on must set Delivery VersionCached (cached-tree path)")
	}
	ctx := context.Background()
	if _, err := on.Versions.GetChecked(ctx, "v-1", 7, func() ([]delivery.DeliverySection, int64, error) {
		return mkTree(), 7, nil
	}); err != nil {
		t.Fatal(err)
	}
	loaderRuns := 0
	sections, err := on.Versions.GetChecked(ctx, "v-1", 7, func() ([]delivery.DeliverySection, int64, error) {
		loaderRuns++
		return mkTree(), 7, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if loaderRuns != 0 {
		t.Fatalf("revision hit must serve the cached tree without loading, loader ran %d times", loaderRuns)
	}
	if len(sections) != 1 || sections[0].ID != "sec-1" {
		t.Fatalf("cached tree must round-trip, got %+v", sections)
	}
}
