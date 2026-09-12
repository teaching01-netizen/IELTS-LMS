// Package migrate_test pins the migration lineage contract (plan 112):
// exact file count + max sequence with no gaps (except explicitly reserved
// in-flight lane numbers) and no duplicates, every file non-empty with
// parseable statements, and the Go loader seeing exactly the same file set
// as the directory scan.
// These run without a database; the DB-backed lineage cases (empty,
// shared-0031, epic, ACT fork, hybrid, production snapshot) stay in the
// TEST_MYSQL_DSN-gated integration suite.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"
)

var seqRe = regexp.MustCompile(`^(\d{4})_[a-z0-9_]+\.sql$`)

func migDir(t *testing.T) string {
	t.Helper()
	// Resolve backend/go/migrations independent of the test working
	// directory: runtime.Callers gives this file's dir even when go test
	// runs from backend/go (where "../migrations" would miss).
	_, thisFile, _, ok := runtime.Caller(0)
	if ok {
		if dir := filepath.Join(filepath.Dir(thisFile), "..", "..", "migrations"); dirExists(dir) {
			return dir
		}
	}
	// cmd/migrate -> go -> migrations (relative fallback when run with the
	// package dir as working directory).
	dir := filepath.Join("..", "..", "migrations")
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		t.Fatalf("migrations dir not found (tried %s and %s): failing closed so the lineage pin cannot silently skip", dir, filepath.Join("..", "migrations"))
	}
	return dir
}

// Pinned lineage: update these numbers if and only if a migration file is
// added or removed. WS-09 lane D landed 0055 (outbox DLQ) + 0056 (receipt
// immutability), previously reserved for lanes B/D — count bumped 55->57
// and the reservation cleared. SAT authoring lane landed 0058 (operation
// keys) — count/max bumped 57->58. Any other count/max/gap change fails
// loudly.
const (
	pinnedMigrationFiles = 58
	pinnedMigrationMax   = 58
)

// reservedSequences holds sequence numbers claimed by concurrent lanes but
// not yet present in the tree. Gaps are tolerated ONLY at these numbers.
// Empty: no lane currently holds a reservation.
var reservedSequences = map[int]string{}

func TestMigrationSequenceContinuous(t *testing.T) {
	dir := migDir(t)
	files, err := loadMigrations(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != pinnedMigrationFiles {
		t.Fatalf("migration lineage drift: expected exactly %d files, got %d (update pinnedMigrationFiles iff a migration was added/removed)", pinnedMigrationFiles, len(files))
	}
	seen := map[int]bool{}
	max := 0
	for _, f := range files {
		m := seqRe.FindStringSubmatch(f.name)
		if m == nil {
			t.Fatalf("migration %q violates NNNN_name.sql convention", f.name)
		}
		var n int
		if _, err := fmt.Sscanf(m[1], "%d", &n); err != nil {
			t.Fatal(err)
		}
		if seen[n] {
			t.Fatalf("duplicate migration sequence %04d (%s)", n, f.name)
		}
		seen[n] = true
		if n > max {
			max = n
		}
	}
	if max != pinnedMigrationMax {
		t.Fatalf("migration lineage drift: expected max sequence %04d, got %04d (update pinnedMigrationMax iff a migration was added/removed)", pinnedMigrationMax, max)
	}
	var missing []int
	for n := 1; n <= max; n++ {
		if !seen[n] {
			if _, ok := reservedSequences[n]; ok {
				continue
			}
			missing = append(missing, n)
		}
	}
	if len(missing) > 0 {
		t.Fatalf("migration sequence gaps: %v (max %04d)", missing, max)
	}
	for n := range reservedSequences {
		if seen[n] {
			t.Fatalf("reserved sequence %04d (%s) has landed: bump pinnedMigrationFiles and remove it from reservedSequences", n, reservedSequences[n])
		}
	}
}

func TestIsTriggerStatement(t *testing.T) {
	cases := []struct {
		name string
		sql  string
		want bool
	}{
		{name: "create", sql: "CREATE TRIGGER example AFTER INSERT ON table_name FOR EACH ROW SET @x = 1", want: true},
		{name: "drop", sql: "/* cleanup */ DROP TRIGGER IF EXISTS example", want: true},
		{name: "line comment", sql: "-- old trigger\nCREATE TRIGGER example AFTER INSERT ON table_name FOR EACH ROW SET @x = 1", want: true},
		{name: "alter", sql: "ALTER TABLE table_name ADD COLUMN value TEXT", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isTriggerStatement(tc.sql); got != tc.want {
				t.Fatalf("isTriggerStatement(%q) = %v, want %v", tc.sql, got, tc.want)
			}
		})
	}
}

func TestMigrationFilesNonEmpty(t *testing.T) {
	dir := migDir(t)
	files, err := loadMigrations(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		stmts := splitStatements(f.sql)
		if len(stmts) == 0 {
			t.Fatalf("migration %s has no parseable statements", f.name)
		}
	}
}

func TestMigrationLoaderMatchesDirScan(t *testing.T) {
	dir := migDir(t)
	files, err := loadMigrations(dir)
	if err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var onDisk []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		onDisk = append(onDisk, e.Name())
	}
	sort.Strings(onDisk)
	if len(files) != len(onDisk) {
		t.Fatalf("loader saw %d files, dir has %d", len(files), len(onDisk))
	}
	for i := range files {
		if files[i].name != onDisk[i] {
			t.Fatalf("loader order differs at %d: %s vs %s", i, files[i].name, onDisk[i])
		}
	}
}
