package app

// WS-04b pins: API and worker resolve the same provider switch and the
// same presence posture from one graph; the worker gate input (schema
// verifier) covers the operation-key table so a DB missing 0058 fails.
import (
	"context"
	"os"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/db"
)

func TestBuildNilPoolYieldsZeroServices(t *testing.T) {
	s := Build(config.Load(), nil, Deps{})
	if s.SAT != nil || s.ACT != nil || s.Terminal != nil || s.Delivery != nil {
		t.Fatal("nil pool must yield zero services (callers degrade, never crash)")
	}
}

func TestCompleterIsSharedProviderSwitch(t *testing.T) {
	// Both mains must construct domain services from the shared graph
	// (the provider switch lives inside shared.Build): assert the two
	// call sites reference shared.Build (grep-level drift pin).
	for _, f := range []string{"../../cmd/api/main.go", "../../cmd/worker/main.go"} {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(raw), "shared.Build") {
			t.Fatalf("%s must construct services via shared.Build", f)
		}
	}
	// And the worker must not paste its own timeout provider switch: the
	// SAT/ACT completion routing (ReconcileAdapter vs Terminalize) may
	// exist only inside internal/app.
	raw, err := os.ReadFile("../../cmd/worker/main.go")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "ReconcileAdapter") || strings.Contains(string(raw), "case \"sat\":") {
		t.Fatal("worker must not contain its own provider switch (lives in shared.Completer)")
	}
}

func TestSchemaGuardCoversOperationKeys(t *testing.T) {
	found := false
	for _, tbl := range db.RequiredTables {
		if tbl == "authoring_operation_keys" {
			found = true
		}
	}
	if !found {
		t.Fatal("VerifyRuntimeSchema must cover authoring_operation_keys (0058)")
	}
	_ = context.Background
}
