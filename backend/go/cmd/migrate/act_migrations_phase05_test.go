package main

// Phase 05 verification: ACT migration-chain pins (AT-11/AT-12).
//
// Static only (no database): verifies the lexical ACT lineage the E2E
// ledger probe (e2e/act-full-cycle.spec.ts AT-12) asserts at runtime:
//   - 0050 (science support), 0052 (provider identity), 0054 (legacy heal),
//     and 0059 (answer fencing) are present and non-empty.
//   - 0054 heals ONLY explicit legacy rows (exam_type='ACT' AND
//     provider_key<>'act'); it never touches genuine IELTS rows.
//   - No ACT migration invokes Rust lineage (Go HEAD is authoritative;
//     the only "Rust" mentions in the tree are a stale 0002 comment and a
//     splitter reference in main.go — neither is an ACT migration).
//   - 0059 stays additive (guarded ADD COLUMNs, no index builds, no
//     deletes); the deep static audit lives in repair_0059_test.go.
//
// The disposable-MySQL double-apply coverage is TestRepair0059CrashRetry
// (TEST_MYSQL_DSN-gated, verified locally 2026-09-12 against MySQL 9.6.0).
// Full fresh/upgrade/interrupted-rerun integration needs CI MySQL with the
// committed seed; see the Phase 05 report for the CI-only list.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var phase05ACTMigrations = []string{
	"0050_act_science_support.sql",
	"0052_act_provider_identity.sql",
	"0054_heal_legacy_act_provider_key.sql",
	"0059_act_phase02_answer_fencing.sql",
}

func TestPhase05ACTMigrationChainPresent(t *testing.T) {
	dir := migDir(t)
	for _, name := range phase05ACTMigrations {
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("ACT migration %s missing: %v", name, err)
		}
		if len(strings.TrimSpace(string(raw))) == 0 {
			t.Fatalf("ACT migration %s is empty", name)
		}
		if len(splitStatements(string(raw))) == 0 {
			t.Fatalf("ACT migration %s has no parseable statements", name)
		}
	}
}

func TestPhase05Heal0054ScopedToLegacyACT(t *testing.T) {
	dir := migDir(t)
	raw, err := os.ReadFile(filepath.Join(dir, "0054_heal_legacy_act_provider_key.sql"))
	if err != nil {
		t.Fatal(err)
	}
	sqlText := string(raw)
	upper := strings.ToUpper(sqlText)
	// The heal predicate must name the explicit legacy marker.
	if !strings.Contains(upper, "EXAM_TYPE = 'ACT'") {
		t.Fatal("0054 must predicate on exam_type='ACT' (explicit legacy marker)")
	}
	if !strings.Contains(sqlText, "provider_key") || !strings.Contains(sqlText, "'act'") {
		t.Fatal("0054 must promote provider_key to 'act'")
	}
	// And must NOT be a broad rewrite: exactly one UPDATE, predicate-scoped,
	// no DELETE/DROP/TRUNCATE.
	if n := strings.Count(upper, "UPDATE "); n != 1 {
		t.Fatalf("0054 must contain exactly one UPDATE, got %d", n)
	}
	if !strings.Contains(upper, "WHERE") {
		t.Fatal("0054 UPDATE must carry a bounding WHERE")
	}
	for _, bad := range []string{"DELETE", "DROP ", "TRUNCATE"} {
		if strings.Contains(upper, bad) {
			t.Fatalf("0054 must not contain %q", bad)
		}
	}
}

func TestPhase05ACTMigrationsInvokeNoRustLineage(t *testing.T) {
	dir := migDir(t)
	for _, name := range phase05ACTMigrations {
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		// Case-sensitive "Rust" (the stale 0002 comment uses capital R;
		// lowercase "trust"/"crust" must not trip the pin).
		if strings.Contains(string(raw), "Rust") || strings.Contains(string(raw), "cargo") {
			t.Fatalf("%s must not invoke Rust lineage (Go HEAD is authoritative)", name)
		}
	}
}
