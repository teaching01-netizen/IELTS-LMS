package release

import (
	"database/sql"
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// rowForClassify builds a releaseRow for the pure classify tests (mirrors the
// Rust test helper: published toggles the published pointer, draftRevision
// toggles the draft pointer, parentMatches parents the draft on published).
func rowForClassify(published bool, draftRevision *int64, parentMatches bool) *releaseRow {
	row := &releaseRow{
		examID:      "exam",
		providerKey: "sat",
	}
	if published {
		row.publishedID = sql.NullString{String: "published", Valid: true}
		row.publishedVersion = sql.NullInt64{Int64: 4, Valid: true}
		row.publishedRevision = sql.NullInt64{Int64: 1, Valid: true}
		row.publishedIsPublished = sql.NullBool{Bool: true, Valid: true}
	}
	if draftRevision != nil {
		row.draftID = sql.NullString{String: "draft", Valid: true}
		if parentMatches && published {
			row.draftParentVersionID = sql.NullString{String: "published", Valid: true}
		} else {
			row.draftParentVersionID = sql.NullString{}
		}
		row.draftVersion = sql.NullInt64{Int64: 5, Valid: true}
		row.draftRevision = sql.NullInt64{Int64: *draftRevision, Valid: true}
		row.draftIsDraft = sql.NullBool{Bool: true, Valid: true}
	}
	return row
}

func int64ptr(v int64) *int64 { return &v }

// TestClassifyReleaseState mirrors the Rust lifecycle test: never_published
// without a published pointer, published_current without a draft or with a
// clean draft parented on published at revision 0, unpublished_changes
// otherwise.
func TestClassifyReleaseState(t *testing.T) {
	cases := []struct {
		name      string
		published bool
		revision  *int64
		parent    bool
		want      LifecycleState
	}{
		{"never published with draft", false, int64ptr(0), false, LifecycleNeverPublished},
		{"published current without draft", true, nil, false, LifecyclePublishedCurrent},
		{"published current with clean draft", true, int64ptr(0), true, LifecyclePublishedCurrent},
		{"unpublished changes with revised draft", true, int64ptr(1), true, LifecycleUnpublishedChanges},
		{"unpublished changes with detached draft", true, int64ptr(0), false, LifecycleUnpublishedChanges},
	}
	for _, c := range cases {
		got, err := classifyReleaseState(rowForClassify(c.published, c.revision, c.parent))
		if err != nil {
			t.Fatalf("%s: unexpected error: %v", c.name, err)
		}
		if got != c.want {
			t.Fatalf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

// TestClassifySameIDInvariant pins the same-id guard: published and draft
// pointers must never alias.
func TestClassifySameIDInvariant(t *testing.T) {
	row := rowForClassify(true, int64ptr(0), true)
	row.draftID = sql.NullString{String: "published", Valid: true}
	row.draftParentVersionID = sql.NullString{String: "published", Valid: true}
	_, err := classifyReleaseState(row)
	if err == nil {
		t.Fatal("expected invariant error, got nil")
	}
	appErr, ok := apperrors.As(err)
	if !ok {
		t.Fatalf("expected *apperrors.Error, got %T", err)
	}
	if appErr.Code != apperrors.CodeAssessmentReleaseInvariant {
		t.Fatalf("expected ASSESSMENT_RELEASE_INVARIANT, got %s", appErr.Code)
	}
}
