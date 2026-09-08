package auth

// Plan E-honesty, round 73 (live rehearsal): IssueAttemptToken's wide
// upsert (organization_id/lease_epoch) fails on schemas predating those
// columns — that case MUST fall back to the base upsert. But the old
// code fell back on ANY error, hiding the real failure (FK 1452, dup
// key, conn loss) behind a second doomed insert; both errors escaped
// as unknown→500. This test pins: only missing-column (1054) falls
// back; every other wide-insert failure surfaces immediately.
import (
	"errors"
	"testing"
)

func TestIsMissingColumnClassifier(t *testing.T) {
	if !isMissingColumn(errors.New("Error 1054 (42S22): Unknown column 'organization_id' in 'field list'")) {
		t.Fatalf("1054 must classify as missing-column")
	}
	if !isMissingColumn(errors.New("unknown column 'lease_epoch'")) {
		t.Fatalf("unknown-column text must classify as missing-column")
	}
	if isMissingColumn(errors.New("Error 1452: foreign key constraint fails")) {
		t.Fatalf("FK violation must NOT classify as missing-column")
	}
	if isMissingColumn(errors.New("Duplicate entry 'x' for key 'PRIMARY'")) {
		t.Fatalf("dup-key must NOT classify as missing-column")
	}
	if isMissingColumn(nil) {
		t.Fatalf("nil must NOT classify as missing-column")
	}
}
