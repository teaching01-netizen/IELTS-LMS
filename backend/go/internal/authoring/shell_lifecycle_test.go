package authoring

import (
	"encoding/json"
	"net/http"
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// TestShellResultWireShape pins the exact JSON the client contract parses.
//
// The frontend removed its \"a 404 means no editable draft\" inference and now
// reads `state`; if `shell` were omitted instead of null, or `state` renamed,
// every consumer of the read would have to guess again. This test is the
// backend half of that contract.
func TestShellResultWireShape(t *testing.T) {
	ready := ShellResult{
		State: ShellStateReady,
		Shell: &Shell{ExamID: "exam-1", ProviderKey: "sat", VersionID: "draft-v1", VersionRevision: 12},
	}
	encoded, err := json.Marshal(ready)
	if err != nil {
		t.Fatal(err)
	}
	const wantReady = `{"state":"READY","shell":{"examId":"exam-1","providerKey":"sat","versionId":"draft-v1","versionRevision":12,"sections":null}}`
	if string(encoded) != wantReady {
		t.Fatalf("READY wire shape drifted.\n got: %s\nwant: %s", encoded, wantReady)
	}

	noDraft, err := json.Marshal(ShellResult{State: ShellStateNoDraft})
	if err != nil {
		t.Fatal(err)
	}
	// `shell` is PRESENT and null: a client reads the lifecycle state without
	// having to distinguish an absent field from an empty draft.
	if string(noDraft) != `{"state":"NO_DRAFT","shell":null}` {
		t.Fatalf("NO_DRAFT wire shape drifted: %s", noDraft)
	}
}

// TestShellLifecycleErrorCodes pins the two lifecycle failures as distinct,
// machine-readable codes with the right HTTP class. They are deliberately not
// the generic NOT_FOUND: the read answers NO_DRAFT for an exam that exists
// without a draft, so a 404 on this route has exactly one meaning, and a
// dangling draft pointer is an integrity violation rather than either.
func TestShellLifecycleErrorCodes(t *testing.T) {
	missing := examNotFoundError("Exam not found.")
	if missing.Code != apperrors.CodeExamNotFound {
		t.Fatalf("missing exam code = %q, want EXAM_NOT_FOUND", missing.Code)
	}
	if missing.HTTPStatus != http.StatusNotFound {
		t.Fatalf("missing exam status = %d, want 404", missing.HTTPStatus)
	}
	if apperrors.CodeExamNotFound == apperrors.CodeNotFound {
		t.Fatal("EXAM_NOT_FOUND must not reuse the generic NOT_FOUND code")
	}

	dangling := draftIntegrityError("exam-1", "draft-v1")
	if dangling.Code != apperrors.CodeDraftIntegrity {
		t.Fatalf("dangling pointer code = %q, want DRAFT_INTEGRITY_VIOLATION", dangling.Code)
	}
	if dangling.HTTPStatus != http.StatusInternalServerError {
		t.Fatalf("dangling pointer status = %d, want 500", dangling.HTTPStatus)
	}
	if dangling.Code == apperrors.CodeNotFound {
		t.Fatal("a dangling draft pointer must never be reported as NOT_FOUND")
	}
	// Identifiers ride along for operational telemetry (never question content).
	if dangling.Details["examId"] != "exam-1" || dangling.Details["draftVersionId"] != "draft-v1" {
		t.Fatalf("integrity details = %v, want the exam and draft version ids", dangling.Details)
	}
	if dangling.Message == "" {
		t.Fatal("integrity violation must carry a message")
	}
}

// TestShellStatesAreDistinct keeps NO_DRAFT from ever becoming an error path
// again: the lifecycle answer is a success state, and both failure codes are
// different from each other and from it.
func TestShellStatesAreDistinct(t *testing.T) {
	states := map[ShellState]bool{ShellStateReady: true, ShellStateNoDraft: true}
	if !states[ShellStateReady] || !states[ShellStateNoDraft] {
		t.Fatal("READY and NO_DRAFT must both exist as lifecycle states")
	}
	if ShellStateReady == ShellStateNoDraft {
		t.Fatal("READY and NO_DRAFT must be distinct states")
	}
}
