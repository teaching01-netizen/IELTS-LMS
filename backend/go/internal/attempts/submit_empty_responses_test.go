package attempts

// Audit finding 1 (release blocker): an attempt whose student answered nothing
// must still be terminalizable. FinalDigest/ComputeDigestInTx previously
// refused the empty response set with a bare 400, which stranded every retry —
// retrying cannot create a response. The fix is a deterministic digest of the
// empty set, not synthetic placeholder rows.
import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// The empty set hashes as canonical JSON "[]", computed here from first
// principles rather than through FinalDigest so the expectation is independent.
func TestFinalDigestEmptySetIsDeterministic(t *testing.T) {
	sum := sha256.Sum256([]byte("[]"))
	want := hex.EncodeToString(sum[:])

	fromNil, err := FinalDigest(nil)
	if err != nil {
		t.Fatalf("empty set must be legal, got %v", err)
	}
	fromEmpty, err := FinalDigest(map[string]string{})
	if err != nil {
		t.Fatalf("empty map must be legal, got %v", err)
	}
	if fromNil != want || fromEmpty != want {
		t.Fatalf("empty digest mismatch: nil=%s empty=%s want=%s", fromNil, fromEmpty, want)
	}
	// An empty attempt must not collide with any answered attempt.
	answered, err := FinalDigest(map[string]string{"q1": "ab"})
	if err != nil {
		t.Fatal(err)
	}
	if answered == want {
		t.Fatal("empty digest collides with a one-response digest")
	}
}

// The SAT provisional two-phase path runs ComputeDigestInTx before the claim.
// With zero stored responses the claim must still commit and a receipt must be
// written, so finalization proceeds instead of looping on a 400.
func TestSubmitZeroResponsesClaimsSATProvisionalSubmit(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())
	qr, rl := liveStubs()

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").WillReturnRows(attemptRows())
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WillReturnRows(sessionRows())
	// No receipt yet, and the submission id is unowned.
	mock.ExpectQuery("FROM attempt_submissions_v2 WHERE attempt_id").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT attempt_id FROM attempt_submissions_v2 WHERE submission_id").WillReturnError(sql.ErrNoRows)
	// Active-session / writer-lease check.
	mock.ExpectQuery("SELECT active_client_session_id").
		WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	// The defect's trigger: the projection is genuinely empty.
	mock.ExpectQuery("FROM attempt_responses_v2").
		WillReturnRows(sqlmock.NewRows([]string{"question_id", "response_hash"}))
	// Audit finding 1: zero ANSWERS is legal, an incomplete MODULE topology is
	// not — the claim is gated on a terminal module attempt in each SAT section.
	mock.ExpectQuery("FROM assessment_module_attempts").WithArgs("att-1").
		WillReturnRows(satModuleRows(satRW(SATModuleSubmitted), satMath(SATModuleLocked)))
	// SAT provisional claim (never sets submitted_at/final_submission).
	mock.ExpectExec("delivery_status='submitted', phase='post-exam'").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO attempt_submissions_v2").
		WithArgs("att-1", "sub-zero", uint64(3), uint64(7), sqlmock.AnyArg(), sqlmock.AnyArg(), uint64(9), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	cmd := SubmitCommand{AttemptID: "att-1", LeaseEpoch: 3, SubmissionID: "sub-zero"}
	res, err := svc.Submit(context.Background(), bearer, cmd, qr, rl, providerStub(ProviderSAT), nil)
	if err != nil {
		t.Fatalf("zero-response SAT submit must terminate, got %v", err)
	}
	if !res.Provisional {
		t.Fatal("SAT zero-response submit must take the provisional path")
	}
	sum := sha256.Sum256([]byte("[]"))
	if want := hex.EncodeToString(sum[:]); res.FinalDigest != want {
		t.Fatalf("final digest = %s, want the empty-set digest %s", res.FinalDigest, want)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
