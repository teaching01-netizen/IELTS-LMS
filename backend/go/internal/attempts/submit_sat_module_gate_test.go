package attempts

// Audit finding 1 (SEV-1): the SAT provisional submit is only legal once the
// attempt holds the complete SAT module topology — a terminal module attempt in
// each required section — and every row is terminal.
//
// The claim itself flips the attempt to submitted/post-exam, which blocks module
// work (delivery.ensureAttemptCanWorkTx -> ATTEMPT_TERMINAL) and further answer
// writes (ensureWritable), while sat.scoreAndPersist refuses to score anything
// less than the full topology and the provisional reconciler only selects
// attempts whose modules are ALL terminal. Accepting the claim on a partial
// topology (for example a single terminal module) therefore dead-ends the
// attempt: no module can be submitted, the scorer refuses, and the watchdog
// cannot repair it. The gate runs under the attempt row lock, in submitInTx.
import (
	"context"
	"database/sql"
	"database/sql/driver"
	"strings"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// satModuleRows stages the (section_key, state) projection the topology gate
// reads.
func satModuleRows(rows ...[]driver.Value) *sqlmock.Rows {
	out := sqlmock.NewRows([]string{"section_key", "state"})
	for _, row := range rows {
		out.AddRow(row...)
	}
	return out
}

func satRW(state string) []driver.Value { return []driver.Value{SATSectionReadingWriting, state} }
func satMath(state string) []driver.Value {
	return []driver.Value{SATSectionMath, state}
}

// submitPrefixStubs stages the shared prefix every submit walks before the
// provider branch: tx begin, attempt lock, session binding, receipt probes,
// writer-session check, and the (empty) response digest read.
func submitPrefixStubs(mock sqlmock.Sqlmock) {
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").WillReturnRows(attemptRows())
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WillReturnRows(sessionRows())
	mock.ExpectQuery("FROM attempt_submissions_v2 WHERE attempt_id").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT attempt_id FROM attempt_submissions_v2 WHERE submission_id").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT active_client_session_id").
		WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	mock.ExpectQuery("FROM attempt_responses_v2").
		WillReturnRows(sqlmock.NewRows([]string{"question_id", "response_hash"}))
}

// satTopologyRefusal runs one SAT submit whose module topology is `rows` and
// returns the wire error. A refused submit must leave nothing behind: no claim
// UPDATE and no receipt are staged, so a torn transaction fails the test.
func satTopologyRefusal(t *testing.T, rows *sqlmock.Rows) *apperrors.Error {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())
	qr, rl := liveStubs()

	submitPrefixStubs(mock)
	mock.ExpectQuery("FROM assessment_module_attempts").WithArgs("att-1").WillReturnRows(rows)
	mock.ExpectRollback()

	cmd := SubmitCommand{AttemptID: "att-1", LeaseEpoch: 3, SubmissionID: "sub-early"}
	res, err := svc.Submit(context.Background(), bearer, cmd, qr, rl, providerStub(ProviderSAT), nil)
	if err == nil {
		t.Fatalf("incomplete SAT topology must refuse the provisional claim, got %+v", res)
	}
	e := durabilityErr(t, err)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	return e
}

// A one-module SAT attempt (no module in the other section) is refused with a
// conflict that names the missing section, instead of claiming a submit it can
// never finish.
func TestSubmitSATRefusesSingleModuleTopology(t *testing.T) {
	e := satTopologyRefusal(t, satModuleRows(satRW(SATModuleSubmitted)))
	if e.Code != apperrors.CodeConflict || e.HTTPStatus != 409 {
		t.Fatalf("want CONFLICT/409, got %s/%d", e.Code, e.HTTPStatus)
	}
	if !strings.Contains(e.Message, SATSectionMath) {
		t.Fatalf("refusal must name the missing section, got %q", e.Message)
	}
	missing, ok := e.Details["missingSections"].([]string)
	if !ok || len(missing) != 1 || missing[0] != SATSectionMath {
		t.Fatalf("refusal must report missingSections=[%s], got %v", SATSectionMath, e.Details)
	}
}

// An open (or not-yet-started) module is refused even when both sections are
// present.
func TestSubmitSATRefusesUnfinishedModules(t *testing.T) {
	cases := []struct {
		name string
		rows *sqlmock.Rows
	}{
		{"active module beside a terminal one", satModuleRows(satRW(SATModuleSubmitted), satMath("active"))},
		{"not started module", satModuleRows(satRW(SATModuleSubmitted), satMath("not_started"))},
		{"locked is terminal, active is not", satModuleRows(satRW(SATModuleLocked), satMath("active"))},
		{"both modules open", satModuleRows(satRW("review"), satMath("active"))},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := satTopologyRefusal(t, tc.rows)
			if e.Code != apperrors.CodeConflict || e.HTTPStatus != 409 {
				t.Fatalf("want CONFLICT/409, got %s/%d", e.Code, e.HTTPStatus)
			}
			if unfinished, ok := e.Details["unfinishedModules"].(int); !ok || unfinished < 1 {
				t.Fatalf("refusal must report unfinishedModules, got %v", e.Details)
			}
		})
	}
}

// A SAT attempt with no module rows at all is exactly the case the reconciler
// skips (it requires EXISTS(module attempt)): refusing here is what keeps the
// attempt out of the stranded submitted/post-exam state.
func TestSubmitSATRefusesAttemptWithoutModules(t *testing.T) {
	if e := satTopologyRefusal(t, satModuleRows()); e.Code != apperrors.CodeConflict {
		t.Fatalf("want CONFLICT for a module-less SAT attempt, got %s", e.Code)
	}
}

// A module row the joins cannot resolve to a section must be refused rather
// than ignored, or an orphan could hide an unfinished module behind the gate.
func TestSubmitSATRefusesUnresolvedModuleRow(t *testing.T) {
	e := satTopologyRefusal(t, satModuleRows(
		satRW(SATModuleSubmitted), satMath(SATModuleSubmitted), []driver.Value{"", SATModuleSubmitted}))
	if e.Code != apperrors.CodeConflict {
		t.Fatalf("want CONFLICT for an unresolved module row, got %s", e.Code)
	}
	if unresolved, ok := e.Details["unresolvedModules"].(int); !ok || unresolved != 1 {
		t.Fatalf("refusal must report unresolvedModules=1, got %v", e.Details)
	}
}

// The topology validator is the rule the finalizer shares: every terminal-state
// verdict comes from SATModuleTerminal, so the two boundaries cannot disagree.
func TestSATModuleTopologyValidate(t *testing.T) {
	complete := SATModuleTopology{Terminal: 2, Sections: map[string]int{SATSectionReadingWriting: 1, SATSectionMath: 1}}
	if err := complete.Validate(); err != nil {
		t.Fatalf("two-section terminal topology must validate, got %v", err)
	}
	// Extra routed modules per section stay legal: the SAT blueprint is
	// base + routed, and the gate must not forbid a fourth row.
	full := SATModuleTopology{Terminal: 4, Sections: map[string]int{SATSectionReadingWriting: 2, SATSectionMath: 2}}
	if err := full.Validate(); err != nil {
		t.Fatalf("base+routed topology must validate, got %v", err)
	}

	cases := []struct {
		name     string
		topology SATModuleTopology
		wantCode apperrors.Code
	}{
		{"empty attempt", SATModuleTopology{Sections: map[string]int{}}, apperrors.CodeConflict},
		{"missing math", SATModuleTopology{Terminal: 1, Sections: map[string]int{SATSectionReadingWriting: 1}}, apperrors.CodeConflict},
		{"missing reading-writing", SATModuleTopology{Terminal: 1, Sections: map[string]int{SATSectionMath: 1}}, apperrors.CodeConflict},
		{"unfinished row", SATModuleTopology{Terminal: 2, Unfinished: 1, Sections: map[string]int{SATSectionReadingWriting: 1, SATSectionMath: 1}}, apperrors.CodeConflict},
		{"unresolved row", SATModuleTopology{Terminal: 2, Unresolved: 1, Sections: map[string]int{SATSectionReadingWriting: 1, SATSectionMath: 1}}, apperrors.CodeConflict},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.topology.Validate()
			if err == nil {
				t.Fatal("expected a refusal")
			}
			if e, ok := apperrors.As(err); !ok || e.Code != tc.wantCode {
				t.Fatalf("want %s, got %v", tc.wantCode, err)
			}
		})
	}
}

// The gate is SAT-only: the IELTS/ACT direct-seal path must not pay a module
// query (those providers seal through terminalization, which owns its own
// invariant set).
func TestSubmitIELTSDoesNotQueryModules(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())
	qr, rl := liveStubs()

	// sqlmock is ordered and strict: any query after the digest read other than
	// the sealer's writes fails ExpectationsWereMet.
	submitPrefixStubs(mock)
	mock.ExpectExec("UPDATE student_attempts SET response_revision=").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO attempt_submissions_v2").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	cmd := SubmitCommand{AttemptID: "att-1", LeaseEpoch: 3, SubmissionID: "sub-ielts"}
	if _, err := svc.Submit(context.Background(), bearer, cmd, qr, rl, providerStub(ProviderIELTS), fakeSealer{}); err != nil {
		t.Fatalf("IELTS submit must not touch the SAT module gate, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
