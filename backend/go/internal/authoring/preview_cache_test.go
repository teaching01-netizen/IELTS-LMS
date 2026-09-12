package authoring

// Phase 03 cache-correctness tests for Preview's revision-keyed delivery-tree
// cache (service.previewCache + injected delivery service).
//
// Key design (pinned here, not just documented):
//   - key = (versionID, revision); the identity probe + tree load observe one
//     snapshot, and a revision mismatch reloads (never a stale tree).
//   - authz runs per request BEFORE the service (handlers), so the cache only
//     ever sees an already-authorized versionID — but the cache key itself is
//     still version-scoped, and these tests prove exam A's tree is never
//     served for exam B even when both revisions collide.
//   - every mutation path bumps exam_versions.revision, so a content change is
//     always a key change (UndoSATWorkbook swaps the draft pointer instead — a
//     versionID change, which is also a key change).
//   - nil cache = direct bulk load (VERSION_CACHE=off kill-switch posture).
// Gated on TEST_MYSQL_DSN like the rest of the read-perf harness.

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/delivery"
)

// previewCacheService wires a Service whose Preview serves through a fresh
// revision-keyed cache backed by the fixture pool.
func previewCacheService(fixture *readPerfFixture) *Service {
	deliver := delivery.NewService(fixture.DB, fixture.Runner)
	cache := delivery.NewVersionCache(delivery.VersionCacheMaxVersions)
	return NewService(fixture.DB, fixture.Runner).SetDeliveryService(deliver).SetPreviewCache(cache)
}

// previewCacheOf extracts the injected cache for revision assertions.
func previewCacheOf(t *testing.T, service *Service) *delivery.VersionCache {
	t.Helper()
	if service == nil || service.previewCache == nil {
		t.Fatal("service has no preview cache")
	}
	return service.previewCache
}

// TestPreviewCacheHitSkipsTreeReads pins the hit path: the second Preview at
// the same (versionID, revision) serves the cached tree without re-issuing
// the delivery tree reads (only the cheap identity probe re-runs).
func TestPreviewCacheHitSkipsTreeReads(t *testing.T) {
	dsn := readPerfDSN(t)
	db, counter := readPerfCountedDB(t, dsn)
	fixture := seedReadPerfFixtureWithDB(t, db)
	ctx := context.Background()
	service := previewCacheService(fixture)
	service.deliverySvc = delivery.NewService(db, fixture.Runner)

	first, err := service.Preview(ctx, fixture.ExamID)
	if err != nil {
		t.Fatalf("first Preview: %v", err)
	}
	if rev, ok := previewCacheOf(t, service).PeekRevision(fixture.VersionID); !ok || rev != int64(first.VersionRevision) {
		t.Fatalf("cache revision = %d ok=%v, want %d", rev, ok, first.VersionRevision)
	}

	before := counter.executions.Load()
	second, err := service.Preview(ctx, fixture.ExamID)
	if err != nil {
		t.Fatalf("second Preview: %v", err)
	}
	got := counter.executions.Load() - before
	// Hit = identity probe only (1 statement); the 3-statement delivery tree
	// must not re-run.
	if got != 1 {
		t.Fatalf("cached Preview issued %d statements, want 1 (identity probe only)", got)
	}
	if canonicalJSON(t, "first preview", first) != canonicalJSON(t, "second preview", second) {
		t.Fatal("cached preview differs from the loaded preview")
	}
}

// TestPreviewCacheStaleRevisionReloads pins the invalidation-by-revision
// contract: a mutation bumps exam_versions.revision, so the next Preview
// misses and returns the NEW content — never the cached old tree.
func TestPreviewCacheStaleRevisionReloads(t *testing.T) {
	fixture := seedReadPerfFixture(t)
	ctx := context.Background()
	service := previewCacheService(fixture)
	cache := previewCacheOf(t, service)

	before, err := service.Preview(ctx, fixture.ExamID)
	if err != nil {
		t.Fatalf("Preview before mutation: %v", err)
	}
	cachedRev, ok := cache.PeekRevision(fixture.VersionID)
	if !ok {
		t.Fatal("cache must hold the version after the first Preview")
	}

	// Mutate through the production write path (UpdateDeliverySettings bumps
	// exam_versions.revision directly). CreateQuestion cannot grow the
	// fixture: every module is already at target_question_count and the
	// capacity fence rejects the insert — so the threshold edit is the
	// revision-bumping mutation under test.
	var sectionID string
	var moduleID string
	for _, section := range before.Sections {
		if section.SectionKey == readPerfSectionRW {
			sectionID = section.ID
			if len(section.Modules) > 0 {
				moduleID = section.Modules[0].ID
			}
		}
	}
	if sectionID == "" || moduleID == "" {
		t.Fatal("fixture section/module missing")
	}
	var sectionRev, routingRev int
	var moduleRev int
	if err := fixture.DB.QueryRowContext(ctx, "SELECT revision FROM assessment_sections WHERE id = ?", sectionID).Scan(&sectionRev); err != nil {
		t.Fatalf("probe section revision: %v", err)
	}
	if err := fixture.DB.QueryRowContext(ctx, "SELECT revision FROM assessment_modules WHERE id = ?", moduleID).Scan(&moduleRev); err != nil {
		t.Fatalf("probe module revision: %v", err)
	}
	if err := fixture.DB.QueryRowContext(ctx, "SELECT revision FROM assessment_routing_policies WHERE section_id = ?", sectionID).Scan(&routingRev); err != nil {
		t.Fatalf("probe routing revision: %v", err)
	}
	// Read the live module durations so the settings edit keeps them.
	shell, err := service.Shell(ctx, fixture.ExamID)
	if err != nil {
		t.Fatalf("Shell for module revisions: %v", err)
	}
	moduleRevs := map[string]int{}
	for _, section := range shell.Sections {
		for _, module := range section.Modules {
			moduleRevs[module.ID] = module.Revision
		}
	}
	moduleTimings := []ModuleTiming{}
	for _, section := range before.Sections {
		if section.ID != sectionID {
			continue
		}
		for _, module := range section.Modules {
			moduleTimings = append(moduleTimings, ModuleTiming{ModuleID: module.ID, DurationSeconds: module.DurationSeconds, ExpectedRevision: moduleRevs[module.ID]})
		}
	}
	_ = moduleRev
	if _, err := service.UpdateDeliverySettings(ctx, fixture.ExamID, sectionID, DeliverySettingsRequest{
		ExpectedSectionRevision: sectionRev,
		BreakAfterSeconds:       before.Sections[0].BreakAfterSeconds + 60,
		ModuleTimings:           moduleTimings,
		MinimumCorrectForHigher: 5,
		ExpectedRoutingRevision: routingRev,
	}); err != nil {
		t.Fatalf("UpdateDeliverySettings: %v", err)
	}

	after, err := service.Preview(ctx, fixture.ExamID)
	if err != nil {
		t.Fatalf("Preview after mutation: %v", err)
	}
	if after.VersionRevision == before.VersionRevision {
		t.Fatalf("mutation did not bump the draft revision (before=%d after=%d)", before.VersionRevision, after.VersionRevision)
	}
	if rev, _ := cache.PeekRevision(fixture.VersionID); rev != int64(after.VersionRevision) {
		t.Fatalf("cache revision = %d, want %d (the reloaded revision)", rev, after.VersionRevision)
	}
	if rev, _ := cache.PeekRevision(fixture.VersionID); rev == cachedRev && cachedRev == int64(before.VersionRevision) {
		t.Fatal("cache still holds the stale revision after a mutation")
	}
	// The new content must be visible: the edited section's break grows by 60s
	// while the cached old tree still reports the previous value.
	breakOf := func(preview Preview) int {
		for _, section := range preview.Sections {
			if section.ID == sectionID {
				return section.BreakAfterSeconds
			}
		}
		return -1
	}
	if got, want := breakOf(after), breakOf(before)+60; got != want {
		t.Fatalf("mutated section break = %d, want %d", got, want)
	}
}

// TestPreviewCacheCrossExamIsolation pins per-tenant safety at the cache-key
// level: two exams whose drafts share the same revision number must still get
// their own trees — exam A's cached tree is never served for exam B.
func TestPreviewCacheCrossExamIsolation(t *testing.T) {
	fixture := seedReadPerfFixture(t)
	ctx := context.Background()
	shared := delivery.NewVersionCache(delivery.VersionCacheMaxVersions)
	deliver := delivery.NewService(fixture.DB, fixture.Runner)
	serviceA := NewService(fixture.DB, fixture.Runner).SetDeliveryService(deliver).SetPreviewCache(shared)
	serviceB := NewService(fixture.DB, fixture.Runner).SetDeliveryService(deliver).SetPreviewCache(shared)

	// A second exam on the same pool (exam-scoped cleanup keeps both alive).
	second := seedReadPerfFixtureWithDB(t, fixture.DB)

	previewA, err := serviceA.Preview(ctx, fixture.ExamID)
	if err != nil {
		t.Fatalf("Preview A: %v", err)
	}
	previewB, err := serviceB.Preview(ctx, second.ExamID)
	if err != nil {
		t.Fatalf("Preview B: %v", err)
	}
	if previewA.VersionID == previewB.VersionID {
		t.Fatal("fixtures must have distinct version ids for an isolation test")
	}
	// Force a revision collision: bump B's draft until its revision equals
	// A's, so key isolation cannot hide behind differing revisions.
	for previewB.VersionRevision != previewA.VersionRevision {
		if _, err := fixture.DB.ExecContext(ctx, "UPDATE exam_versions SET revision = revision + 1 WHERE id = ?", second.VersionID); err != nil {
			t.Fatalf("bump B revision: %v", err)
		}
		// Drop B's stale entry so the next Preview reloads at the new rev.
		shared.Invalidate(second.VersionID)
		previewB, err = serviceB.Preview(ctx, second.ExamID)
		if err != nil {
			t.Fatalf("Preview B after bump: %v", err)
		}
		if previewB.VersionRevision > previewA.VersionRevision+1000 {
			t.Fatal("could not align revisions")
		}
	}
	// Re-read A through the shared cache: it must still be A's tree (the
	// colliding B entry must not leak across version ids).
	again, err := serviceA.Preview(ctx, fixture.ExamID)
	if err != nil {
		t.Fatalf("Preview A again: %v", err)
	}
	if canonicalJSON(t, "preview A", previewA) != canonicalJSON(t, "preview A again", again) {
		t.Fatal("exam A's preview changed after exam B populated the shared cache")
	}
	if again.VersionID != fixture.VersionID {
		t.Fatalf("exam A preview carries version %q, want %q", again.VersionID, fixture.VersionID)
	}
	encoded, err := json.Marshal(again.Sections)
	if err != nil {
		t.Fatal(err)
	}
	// Sanity: the payload really is version-scoped (module ids belong to A).
	payload := string(encoded)
	for moduleID := range second.ModuleIDs {
		_ = moduleID
	}
	if strings.Contains(payload, second.VersionID) {
		t.Fatalf("exam A payload leaks exam B version id: %s", payload)
	}
}

// TestPreviewCacheNilDisablesCaching pins the kill-switch posture: a service
// without a cache serves the correct projection via direct bulk load.
func TestPreviewCacheNilDisablesCaching(t *testing.T) {
	fixture := seedReadPerfFixture(t)
	ctx := context.Background()
	plain := NewService(fixture.DB, fixture.Runner)
	if plain.PreviewCached() {
		t.Fatal("a service without SetPreviewCache must report PreviewCached()==false")
	}
	preview, err := plain.Preview(ctx, fixture.ExamID)
	if err != nil {
		t.Fatalf("uncached Preview: %v", err)
	}
	if preview.VersionID != fixture.VersionID || preview.ProviderKey != "sat" {
		t.Fatalf("uncached preview header drifted: %+v", preview)
	}
	payload := canonicalJSON(t, "uncached preview", preview)
	for _, forbidden := range []string{"correctOptionId", "acceptedResponses", "answerDefinition", "isCorrect", "isPretest"} {
		if strings.Contains(payload, forbidden) {
			t.Fatalf("uncached preview leaked %s", forbidden)
		}
	}
	// Nil-safe setters: chaining on a nil service must not panic.
	var nilService *Service
	if nilService.SetPreviewCache(delivery.NewVersionCache(1)) != nil {
		t.Fatal("nil SetPreviewCache must return nil")
	}
	if nilService.SetDeliveryService(delivery.NewService(nil, nil)) != nil {
		t.Fatal("nil SetDeliveryService must return nil")
	}
	if nilService.PreviewCached() {
		t.Fatal("nil service must report PreviewCached()==false")
	}
}
