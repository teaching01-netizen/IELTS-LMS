package delivery

// Revision contract guard.
//
// The client's stale-payload guard orders candidate state by per-row revision
// (assessment_module_attempts.revision / assessment_attempt_breaks.revision).
// That ordering is only meaningful if EVERY mutation of those rows bumps the
// counter: two payloads carrying the same revision could otherwise be applied
// in either order and a stale module could win.
//
// This is a source scan, not a runtime test: the invariant is a property of
// the SQL text, and a future statement that forgets the bump would otherwise
// only be caught by a race in production.

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

var revisionBumpPattern = regexp.MustCompile(`(?i)\b\w*\.?revision\s*=\s*\w*\.?revision\s*\+\s*1\b`)
var guardedUpdatePattern = regexp.MustCompile(`(?i)\bUPDATE\s+assessment_(?:module_attempts|attempt_breaks)\b`)
var setClausePattern = regexp.MustCompile(`(?i)\bSET\b`)
var whereClausePattern = regexp.MustCompile(`(?i)\bWHERE\b`)

func updateBumpsRevision(statement string) bool {
	set := setClausePattern.FindStringIndex(statement)
	if set == nil {
		return false
	}
	assignments := statement[set[1]:]
	if where := whereClausePattern.FindStringIndex(assignments); where != nil {
		assignments = assignments[:where[0]]
	}
	return revisionBumpPattern.MatchString(assignments)
}

func TestRevisionGuardDoesNotBorrowAnotherUpdatesBump(t *testing.T) {
	first := "UPDATE assessment_module_attempts SET state = 'active' WHERE id = ?"
	second := "UPDATE assessment_attempt_breaks SET revision = revision + 1 WHERE id = ?"
	if updateBumpsRevision(first) || !updateBumpsRevision(second) {
		t.Fatal("each UPDATE must prove its own revision bump")
	}
}

func TestEveryModuleAttemptAndBreakUpdateBumpsRevision(t *testing.T) {
	root := "../.." // internal/delivery -> backend/go
	var scanned int
	fset := token.NewFileSet()
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			name := info.Name()
			// ".." is the root itself (filepath.Base of the walk root), so it
			// must not be treated as a hidden directory.
			if name != ".." && (name == "testdata" || name == "vendor" || strings.HasPrefix(name, ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		file, err := parser.ParseFile(fset, path, raw, 0)
		if err != nil {
			return err
		}
		ast.Inspect(file, func(node ast.Node) bool {
			literal, ok := node.(*ast.BasicLit)
			if !ok || literal.Kind != token.STRING {
				return true
			}
			sql, err := strconv.Unquote(literal.Value)
			if err != nil {
				t.Errorf("%s: decode SQL literal: %v", fset.Position(literal.Pos()), err)
				return true
			}
			updates := guardedUpdatePattern.FindAllStringIndex(sql, -1)
			for i, start := range updates {
				end := len(sql)
				if i+1 < len(updates) {
					end = updates[i+1][0]
				}
				statement := sql[start[0]:end]
				if terminator := strings.IndexByte(statement, ';'); terminator >= 0 {
					statement = statement[:terminator]
				}
				scanned++
				if !updateBumpsRevision(statement) {
					t.Errorf("%s: UPDATE %s must bump revision in its SET clause", fset.Position(literal.Pos()), sql[start[0]:start[1]])
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatalf("walk backend/go: %v", err)
	}
	if scanned < 20 {
		t.Fatalf("scan found only %d statements; the walk root is probably wrong", scanned)
	}
}
