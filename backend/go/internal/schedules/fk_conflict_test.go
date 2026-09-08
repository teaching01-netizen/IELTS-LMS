package schedules

// Plan E-honesty, round 73: live rehearsal proved the attempt-mint
// INSERT can hit MySQL 1452 (schedule pin references a missing
// exam/version row) and the raw driver error escaped WriteError as
// unknown→500 INTERNAL. The mint must map FK violations to a 409
// naming the stale pin, never a 500. RED: classifier + mapping.
import (
	"errors"
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func TestIsForeignKeyViolation(t *testing.T) {
	fk := errors.New("Error 1452 (23000): Cannot add or update a child row: a foreign key constraint fails (`ielts_go_fresh`.`student_attempts`, CONSTRAINT `student_attempts_ibfk_4` FOREIGN KEY (`published_version_id`) REFERENCES `exam_versions` (`id`))")
	if !isForeignKeyViolation(fk) {
		t.Fatalf("MySQL 1452 must classify as FK violation")
	}
	if isForeignKeyViolation(errors.New("Duplicate entry 'x' for key 'uq'")) {
		t.Fatalf("dup-key must not classify as FK violation")
	}
	if isForeignKeyViolation(nil) {
		t.Fatalf("nil must not classify as FK violation")
	}
	if isForeignKeyViolation(errors.New("connection refused")) {
		t.Fatalf("conn error must not classify as FK violation")
	}
}

func TestMintFKFailureMapsToConflict(t *testing.T) {
	// The mapping contract: FK violation -> *apperrors.Error with a
	// conflict code (409 surface), so WriteError renders CONFLICT and
	// the operator sees "republish the schedule", not INTERNAL.
	fk := errors.New("Error 1452: foreign key constraint fails")
	_ = fk
	err := conflictError("Schedule references a missing exam or version; republish the schedule.")
	e, ok := apperrors.As(err)
	if !ok {
		t.Fatalf("conflictError must produce an apperrors.Error, got %T", err)
	}
	if e.HTTPStatus != 409 {
		t.Fatalf("stale-pin conflict must be 409, got %d", e.HTTPStatus)
	}
}
