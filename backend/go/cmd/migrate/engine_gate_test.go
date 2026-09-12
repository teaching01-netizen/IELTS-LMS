package main

// Engine-gate pins: the migrator refuses engines the tree cannot serve
// (MariaDB, MySQL < 8.0.16, unparseable versions) before touching DDL.
// TiDB stays allowed here (non-prod dev/test); production TiDB is refused
// by refuseTiDBProduction, pinned in its own tests.
import "testing"

func TestRequireSupportedEnginePins(t *testing.T) {
	allow := []string{
		"8.4.0", "8.4.3-enterprise", "8.0.16", "8.0.36", "8.1.0", "9.0.1",
		"5.7.44-TiDB-v7.5.0", // dev/test TiDB: allowed here, fenced in prod elsewhere
	}
	for _, v := range allow {
		if err := requireSupportedEngine(v); err != nil {
			t.Errorf("version %q must be allowed, got %v", v, err)
		}
	}
	deny := []string{
		"5.7.44", "8.0.15", "8.0.11", "10.11.7-MariaDB", "11.4.2-MariaDB", "not-a-version",
	}
	for _, v := range deny {
		if err := requireSupportedEngine(v); err == nil {
			t.Errorf("version %q must be refused, got nil", v)
		}
	}
}
