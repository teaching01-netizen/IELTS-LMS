// Package migrate_test pins the migration lineage contract (plan 112):
// lexically continuous 0001..0052 numbering with no gaps or
// duplicates, every file non-empty with parseable statements, and the
// Go loader seeing exactly the same file set as the directory scan.
// These run without a database; the DB-backed lineage cases (empty,
// shared-0031, epic, ACT fork, hybrid, production snapshot) stay in the
// TEST_MYSQL_DSN-gated integration suite.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

var seqRe = regexp.MustCompile(`^(\d{4})_[a-z0-9_]+\.sql$`)

func migDir(t *testing.T) string {
	t.Helper()
	// cmd/migrate -> go/migrations.
	dir := filepath.Join("..", "migrations")
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		t.Skip("migrations dir not found from cmd/migrate")
	}
	return dir
}

func TestMigrationSequenceContinuous(t *testing.T) {
	dir := migDir(t)
	files, err := loadMigrations(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) < 52 {
		t.Fatalf("expected >=52 migration files, got %d", len(files))
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
	var missing []int
	for n := 1; n <= max; n++ {
		if !seen[n] {
			missing = append(missing, n)
		}
	}
	if len(missing) > 0 {
		t.Fatalf("migration sequence gaps: %v (max %04d)", missing, max)
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
