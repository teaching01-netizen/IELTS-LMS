package main

// The delivery bootstrap endpoint is LIVE attempt state, not a static version
// payload: it carries module attempts, the adaptive Higher/Lower route,
// responses, timers, proctor state and the result. A conditional read keyed on
// the published exam version (W/"v{versionId}-{revision}") is therefore wrong —
// routing a candidate from Module 1 into Module 2 Higher does not move the
// version revision, so the server answered 304 and the client kept the module
// it had. The handler must always assemble, and must never be cached.
//
// This pins the source contract because the behaviour is a non-call: with no
// database fixture that can produce "version unchanged, route changed" the
// strongest cheap guard is that the conditional path cannot come back.
import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strings"
	"testing"
)

func TestDeliveryBootstrapNeverConditionalOnExamVersion(t *testing.T) {
	raw, err := os.ReadFile("handlers_delivery.go")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	src, err := parser.ParseFile(fset, "handlers_delivery.go", raw, 0)
	if err != nil {
		t.Fatal(err)
	}
	var body string
	ast.Inspect(src, func(n ast.Node) bool {
		fn, ok := n.(*ast.FuncDecl)
		if !ok || fn.Name.Name != "deliveryBootstrapInner" || fn.Body == nil {
			return true
		}
		start := fset.Position(fn.Body.Pos()).Offset
		end := fset.Position(fn.Body.End()).Offset
		body = string(raw[start:end])
		return false
	})
	if body == "" {
		t.Fatal("deliveryBootstrapInner not found in handlers_delivery.go")
	}

	for _, forbidden := range []string{"writeETagOrNotModified", "VersionETag", "VersionTag", "If-None-Match"} {
		if strings.Contains(body, forbidden) {
			t.Errorf("dynamic bootstrap must not use %s: the payload is live attempt state, and an exam-version validator answers 304 while the adaptive route has already changed", forbidden)
		}
	}
	if !strings.Contains(body, "no-store") {
		t.Error("dynamic bootstrap must send Cache-Control: no-store — an attempt projection is safe to re-send but never safe to reuse")
	}
	if !strings.Contains(body, "app.Delivery.Bootstrap") {
		t.Error("dynamic bootstrap must always assemble the payload")
	}
}
