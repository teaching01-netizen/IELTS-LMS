package attempts

// Provider identity is a decision of the submit transaction, not of the HTTP
// edge: Submit takes a ProviderResolver instead of a Provider, and submitInTx
// asks it on the transaction that already holds the attempt row lock. These
// tests pin the three properties that matter — the decision is taken after the
// lock, it is the ONLY source of the terminalization branch, and a missing or
// failing resolver fails closed.
import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// markerResolver records its call and executes one marker statement on the
// transaction it is handed. Because sqlmock expectations below are ordered and
// strict, the marker can only be consumed if the resolver ran AFTER the attempt
// lock query on the same connection.
type markerResolver struct {
	provider Provider
	calls    int
}

func (m *markerResolver) ResolveProvider(ctx context.Context, q tx.Tx, _ string) (Provider, error) {
	m.calls++
	var marker string
	if err := q.QueryRowContext(ctx, `SELECT 'resolver-marker'`).Scan(&marker); err != nil {
		return "", err
	}
	return m.provider, nil
}

// submitPrefixStubsWithResolverMarker is submitPrefixStubs plus one ordered
// expectation between the attempt lock and the session probe: the marker
// statement markerResolver issues on the transaction it is handed. If the
// resolver ran before the lock, sqlmock would consume the marker expectation
// too early and the run would fail.
func submitPrefixStubsWithResolverMarker(mock sqlmock.Sqlmock) {
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").WillReturnRows(attemptRows())
	mock.ExpectQuery("SELECT 'resolver-marker'").WillReturnRows(sqlmock.NewRows([]string{"marker"}).AddRow("resolver-marker"))
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WillReturnRows(sessionRows())
	mock.ExpectQuery("FROM attempt_submissions_v2 WHERE attempt_id").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT attempt_id FROM attempt_submissions_v2 WHERE submission_id").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT active_client_session_id").
		WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	mock.ExpectQuery("FROM attempt_responses_v2").
		WillReturnRows(sqlmock.NewRows([]string{"question_id", "response_hash"}))
}

type recordingSealer struct{ calls int }

func (s *recordingSealer) SealSubmitted(_ context.Context, _ tx.Tx, _, _, _, _, _, _ string, _ time.Time) error {
	s.calls++
	return nil
}

// The resolver runs on the submit transaction, after the attempt row lock: the
// marker query sits between the attempt lock and the session probe in the
// ordered expectation list.
func TestSubmitResolvesProviderOnLockedTransaction(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())
	qr, rl := liveStubs()
	pr := &markerResolver{provider: ProviderIELTS}
	sealer := &recordingSealer{}

	// The marker query sits where the attempt lock's expectation ends, so a
	// resolver that ran before the lock would consume it out of order and fail.
	submitPrefixStubsWithResolverMarker(mock)
	mock.ExpectExec("UPDATE student_attempts SET response_revision=").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO attempt_submissions_v2").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	cmd := SubmitCommand{AttemptID: "att-1", LeaseEpoch: 3, SubmissionID: "sub-resolver"}
	if _, err := svc.Submit(context.Background(), bearer, cmd, qr, rl, pr, sealer); err != nil {
		t.Fatalf("submit with an IELTS resolver must seal, got %v", err)
	}
	if pr.calls != 1 {
		t.Fatalf("provider must be resolved exactly once, got %d resolutions", pr.calls)
	}
	if sealer.calls != 1 {
		t.Fatalf("IELTS provider must take the seal branch, got %d seal calls", sealer.calls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// SAT keeps its topology gate, then uses the shared terminal seal path.
func TestSubmitSATResolverSealsAfterTerminalTopology(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())
	qr, rl := liveStubs()
	sealer := &recordingSealer{}

	submitPrefixStubs(mock)
	satScopeUnscoped(mock)
	mock.ExpectQuery("FROM assessment_module_attempts").
		WillReturnRows(satModuleRows(satRW(SATModuleSubmitted), satMath(SATModuleSubmitted)))
	mock.ExpectQuery("FROM attempt_responses_v2").
		WillReturnRows(sqlmock.NewRows([]string{"question_id", "response_hash"}))
	mock.ExpectExec("UPDATE student_attempts SET response_revision=").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO attempt_submissions_v2").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	cmd := SubmitCommand{AttemptID: "att-1", LeaseEpoch: 3, SubmissionID: "sub-sat"}
	res, err := svc.Submit(context.Background(), bearer, cmd, qr, rl, providerStub(ProviderSAT), sealer)
	if err != nil {
		t.Fatalf("SAT resolver must take the terminal seal path, got %v", err)
	}
	if res.Provisional {
		t.Fatalf("SAT resolver must produce a final receipt, got %+v", res)
	}
	if sealer.calls != 1 {
		t.Fatalf("SAT must seal once after the topology check, got %d seal calls", sealer.calls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A nil resolver is a wiring defect, not a default: the submit must stop before
// any receipt, digest, or terminal write.
func TestSubmitWithoutProviderResolverFailsClosed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())
	qr, rl := liveStubs()
	sealer := &recordingSealer{}

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").WillReturnRows(attemptRows())
	mock.ExpectRollback()

	cmd := SubmitCommand{AttemptID: "att-1", LeaseEpoch: 3, SubmissionID: "sub-nil"}
	_, err = svc.Submit(context.Background(), bearer, cmd, qr, rl, nil, sealer)
	if err == nil {
		t.Fatal("a missing provider resolver must refuse the submit")
	}
	if sealer.calls != 0 {
		t.Fatalf("no branch may run without a provider, got %d seal calls", sealer.calls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// An unresolvable provider (unknown key, missing exam row, read failure) stops
// the submit and writes nothing — the guarantee the HTTP edge can no longer
// provide, since it no longer decides.
func TestSubmitSurfacesProviderResolutionFailure(t *testing.T) {
	wantErr := errors.New("provider identity unreadable")
	cases := []struct {
		name string
		pr   *stubProviders
	}{
		{"read failure", &stubProviders{err: wantErr}},
		{"empty provider", &stubProviders{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			secret := []byte("test-secret-32-bytes-long--------")
			svc := testService(db, secret)
			bearer := mintToken(t, secret, baseClaims())
			qr, rl := liveStubs()
			sealer := &recordingSealer{}

			mock.ExpectBegin()
			mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
			mock.ExpectQuery("FROM student_attempts WHERE id").WillReturnRows(attemptRows())
			mock.ExpectRollback()

			cmd := SubmitCommand{AttemptID: "att-1", LeaseEpoch: 3, SubmissionID: "sub-bad"}
			_, err = svc.Submit(context.Background(), bearer, cmd, qr, rl, tc.pr, sealer)
			if tc.name == "read failure" {
				if !errors.Is(err, wantErr) {
					t.Fatalf("resolver error must propagate, got %v", err)
				}
			} else if err == nil {
				t.Fatal("an empty provider must not reach a terminalization branch")
			}
			if sealer.calls != 0 {
				t.Fatalf("no branch may run, got %d seal calls", sealer.calls)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
