package main

// Plan E1: EVERY hot read path enforces the query budget — poll,
// bootstrap, roster. Slow-DB pile-ups become bounded 503s (retryable),
// never unbounded goroutine/conn growth. Poll already wraps; bootstrap +
// roster must too.
import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHotReadsEnforceQueryBudget(t *testing.T) {
	fset := token.NewFileSet()
	want := map[string]string{
		"runtimePollHandler":       "handlers_runtime_poll.go",
		"deliveryBootstrapHandler": "handlers_delivery.go",
		"proctorRosterHandler":     "proctor_roster.go",
		"v1SessionHandler":         "handlers_domain.go",
		"v1StaticHandler":          "handlers_domain.go",
		"v1LiveHandler":            "handlers_domain.go",
		"v1BootstrapHandler":       "handlers_domain.go",
	}
	found := map[string]bool{}
	err := filepath.Walk(".", func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		if path != "handlers_runtime_poll.go" && path != "handlers_delivery.go" && path != "proctor_roster.go" && path != "handlers_domain.go" {
			return nil
		}
		src, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			return err
		}
		ast.Inspect(src, func(n ast.Node) bool {
			fn, ok := n.(*ast.FuncDecl)
			if !ok {
				return true
			}
			if _, ok := want[fn.Name.Name]; !ok {
				return true
			}
			var hasBudget bool
			ast.Inspect(fn.Body, func(m ast.Node) bool {
				call, ok := m.(*ast.CallExpr)
				if !ok {
					return true
				}
				if ident, ok := call.Fun.(*ast.Ident); ok && ident.Name == "withQueryTimeout" {
					hasBudget = true
					return false
				}
				return true
			})
			if hasBudget {
				found[fn.Name.Name] = true
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for name := range want {
		if !found[name] {
			t.Errorf("hot read %s must enforce withQueryTimeout (plan E1)", name)
		}
	}
}
