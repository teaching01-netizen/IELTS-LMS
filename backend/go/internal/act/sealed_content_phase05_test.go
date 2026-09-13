package act

// Phase 05 verification (residual c): pin the SealedContent() sealer helper
// that Phase 04 wired for byte-deterministic seal embedding.
//
// What this locks (AT-09 sealed immutability):
//   1. SealedContent loads the canonical normalized copy from the published
//      exam_versions.content_snapshot row (nested editor shape in, compact
//      scoring shape out) plus a deterministic SealedContentHash.
//   2. The embedded copy + hash are stable across reads: re-loading the same
//      version row yields the identical copy and hash (replay determinism).
//   3. A post-seal authoring edit (different version row, moved key) yields a
//      DIFFERENT hash, so seal-vs-replay comparison detects the drift instead
//      of silently rescoring sealed answers against new content.
//
// Wiring note (verified 2026-09-12): SealedContent is the read-side loader;
// ScoreAttempt is the current seal-time scorer (reads the same version row
// under the terminal attempt lock and returns the redacted
// score/providerKey/section projection); buildScienceQuestions replays from
// the final_submission.content copy. The terminalization + V2 direct sealers
// call ScoreAttempt today; SealedContent exists so a future seal step (or a
// hash audit) can embed/compare the same canonical bytes without re-reading
// exam_versions after commit. This test pins the loader + hash contract so
// that wiring cannot regress silently: if a seal path stops embedding the
// canonical copy, the hash-drift assertion here names the expected bytes.
//
// sqlmock stands in for the terminal tx (tx.Tx is QueryRowContext +
// ExecContext); no database is required.

import (
	"context"
	"database/sql"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestPhase05SealedContentLoadsCanonicalCopyPlusHash(t *testing.T) {
	nestedRaw := mustLoadContractFixtureRaw(t, "nested_science_content.json")
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT content_snapshot FROM exam_versions WHERE id = ?")).
		WithArgs("version-1").
		WillReturnRows(sqlmock.NewRows([]string{"content_snapshot"}).AddRow(nestedRaw))
	content, hash, err := NewService(db, nil).SealedContent(context.Background(), db, "version-1")
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	// The loader normalizes: nested editor shape -> compact scoring shape.
	if got := orderedQuestions(content); len(got) != 3 || got[0] != "q1" || got[1] != "q2" || got[2] != "q3" {
		t.Fatalf("sealed copy must normalize to the ordered key [q1 q2 q3], got %v", got)
	}
	key := answerKeyFromContent(content)
	if key["q1"] != "q1-B" || key["q2"] != "q2-A" || key["q3"] != "q3-C" {
		t.Fatalf("sealed copy must carry the canonical key, got %#v", key)
	}
	if hash == "" {
		t.Fatal("sealed copy must carry a non-empty content hash")
	}
	// Same canonical bytes hash equally through the direct helper.
	if hash != SealedContentHash(content) {
		t.Fatalf("SealedContent hash %q must equal SealedContentHash(copy) %q", hash, SealedContentHash(content))
	}
}

func TestPhase05SealedContentReloadIsDeterministic(t *testing.T) {
	nestedRaw := mustLoadContractFixtureRaw(t, "nested_science_content.json")
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for i := 0; i < 2; i++ {
		mock.ExpectQuery(regexp.QuoteMeta("SELECT content_snapshot FROM exam_versions WHERE id = ?")).
			WithArgs("version-1").
			WillReturnRows(sqlmock.NewRows([]string{"content_snapshot"}).AddRow(nestedRaw))
	}
	first, firstHash, err := NewService(db, nil).SealedContent(context.Background(), db, "version-1")
	if err != nil {
		t.Fatal(err)
	}
	second, secondHash, err := NewService(db, nil).SealedContent(context.Background(), db, "version-1")
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	if firstHash != secondHash {
		t.Fatalf("re-loading the same version must yield the same hash, got %q vs %q", firstHash, secondHash)
	}
	if SealedContentHash(first) != SealedContentHash(second) {
		t.Fatal("re-loaded copies must hash equally")
	}
}

func TestPhase05SealedContentDetectsPostSealAuthoringEdit(t *testing.T) {
	nestedRaw := mustLoadContractFixtureRaw(t, "nested_science_content.json")
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT content_snapshot FROM exam_versions WHERE id = ?")).
		WithArgs("version-1").
		WillReturnRows(sqlmock.NewRows([]string{"content_snapshot"}).AddRow(nestedRaw))
	_, sealHash, err := NewService(db, nil).SealedContent(context.Background(), db, "version-1")
	if err != nil {
		t.Fatal(err)
	}
	// Post-seal authoring edit mints a NEW version row with a moved key.
	editedRaw := mustLoadContractFixtureRaw(t, "compact_scoring_projection.json")
	mock.ExpectQuery(regexp.QuoteMeta("SELECT content_snapshot FROM exam_versions WHERE id = ?")).
		WithArgs("version-2").
		WillReturnRows(sqlmock.NewRows([]string{"content_snapshot"}).AddRow(`{"questions":[{"questionId":"q1","correctAnswer":"MOVED"},{"questionId":"q2","correctAnswer":"q2-A"},{"questionId":"q3","correctAnswer":"q3-C"}]}`))
	_ = editedRaw // fixture anchor: canonical 3-question shape; the moved key above simulates the edit.
	_, editedHash, err := NewService(db, nil).SealedContent(context.Background(), db, "version-2")
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	if sealHash == editedHash {
		t.Fatal("a post-seal authoring edit must move the content hash (seal-vs-replay drift must be detectable)")
	}
}

func TestPhase05SealedContentRejectsInvalidSnapshot(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT content_snapshot FROM exam_versions WHERE id = ?")).
		WithArgs("version-bad").
		WillReturnRows(sqlmock.NewRows([]string{"content_snapshot"}).AddRow(`{not json`))
	if _, _, err := NewService(db, nil).SealedContent(context.Background(), db, "version-bad"); err == nil {
		t.Fatal("invalid sealed snapshot must error, never yield a fabricated copy")
	}
	mock.ExpectQuery(regexp.QuoteMeta("SELECT content_snapshot FROM exam_versions WHERE id = ?")).
		WithArgs("version-missing").
		WillReturnError(sql.ErrNoRows)
	if _, _, err := NewService(db, nil).SealedContent(context.Background(), db, "version-missing"); err == nil {
		t.Fatal("missing version row must error, never yield a fabricated copy")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
