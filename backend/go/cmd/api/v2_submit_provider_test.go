package main

// Full submit path (production resolver + production sealer, only the client
// transport is absent): the outage fix has to be proven at the boundary that
// broke, not just in the resolver's table.
import (
	"context"
	"database/sql"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
)

const submitTestSecret = "test-secret-32-bytes-long--------"

// submitAttemptRows is the attempt lock projection lockAttempt scans
// (16 columns + the runtime timing model).
func submitAttemptRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "schedule_id", "user_id", "organization_id", "protocol_version",
		"delivery_status", "phase", "lease_epoch", "control_epoch",
		"response_revision", "deadline_at", "closing_grace_until",
		"submitted_at", "final_submission", "proctor_status", "provider_key", "timing_model",
	}).AddRow("att-1", "sched-1", "u-1", nil, 2, "running", "exam", 3, 7, 9, nil, nil, nil, nil, "active", "", "")
}

func submitBearer(t *testing.T) string {
	t.Helper()
	lease := uint64(3)
	tok, err := crypto.SignAttemptToken([]byte(submitTestSecret), crypto.AttemptClaims{
		TokenID: "tok-1", UserID: "u-1", ScheduleID: "sched-1", AttemptID: "att-1",
		ClientSessionID: "sess-1", LeaseEpoch: &lease, Exp: time.Now().Add(15 * time.Minute).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

// A legacy IELTS exam whose provider_key is NULL (nullable in the pre-provider
// schema) must still submit: the resolver reports ielts and the attempt seals
// through the direct path instead of being refused on the wire.
func TestV2SubmitLegacyNullProviderKeySeals(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").WithArgs("att-1").WillReturnRows(submitAttemptRows())
	// The provider decision, inside this transaction, after the attempt lock.
	mock.ExpectQuery("FROM student_attempts a JOIN exam_entities e").WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key", "exam_type"}).AddRow(nil, "Academic"))
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").
		WillReturnRows(sqlmock.NewRows([]string{"attempt_id", "client_session_id", "revoked_at", "expires_at"}).
			AddRow("att-1", "sess-1", nil, nil))
	mock.ExpectQuery("FROM attempt_submissions_v2 WHERE attempt_id").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT attempt_id FROM attempt_submissions_v2 WHERE submission_id").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT active_client_session_id").
		WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	// Runtime locker is nil here, so the gate takes its own db time.
	mock.ExpectQuery("SELECT UTC_TIMESTAMP").WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(time.Now().UTC()))
	mock.ExpectQuery("FROM attempt_responses_v2").
		WillReturnRows(sqlmock.NewRows([]string{"question_id", "response_hash"}))
	// terminalSealer (production type, scorer/materializer unwired): receipt
	// probe, projection read, terminal receipt, terminal claim.
	mock.ExpectQuery("FROM attempt_terminalizations").
		WillReturnRows(sqlmock.NewRows([]string{"outcome"}))
	mock.ExpectQuery("SELECT answer_revision, revision, organization_id FROM student_attempts").
		WillReturnRows(sqlmock.NewRows([]string{"answer_revision", "revision", "organization_id"}).AddRow(0, 5, nil))
	mock.ExpectExec("INSERT INTO attempt_terminalizations").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE student_attempts SET phase = 'post-exam'").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE student_attempts SET response_revision=").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO attempt_submissions_v2").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	svc := attempts.NewService(tx.NewRunner(db), clock.FixedAt(time.Now().UTC()), []byte(submitTestSecret))
	res, err := svc.Submit(context.Background(), submitBearer(t),
		attempts.SubmitCommand{AttemptID: "att-1", LeaseEpoch: 3, SubmissionID: "sub-legacy"},
		nil, nil, v2ProviderResolver{}, terminalSealer{outboxExecOnly: true})
	if err != nil {
		t.Fatalf("legacy NULL-provider IELTS attempt must seal, got %v", err)
	}
	if res.Provisional {
		t.Fatalf("legacy IELTS must not take the SAT provisional path: %+v", res)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The same path with a SAT exam row keeps its module gate and then seals.
func TestV2SubmitSATSealsAfterTopologyGate(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").WithArgs("att-1").WillReturnRows(submitAttemptRows())
	mock.ExpectQuery("FROM student_attempts a JOIN exam_entities e").WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key", "exam_type"}).AddRow("sat", "Academic"))
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").
		WillReturnRows(sqlmock.NewRows([]string{"attempt_id", "client_session_id", "revoked_at", "expires_at"}).
			AddRow("att-1", "sess-1", nil, nil))
	mock.ExpectQuery("FROM attempt_submissions_v2 WHERE attempt_id").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT attempt_id FROM attempt_submissions_v2 WHERE submission_id").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT active_client_session_id").
		WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	mock.ExpectQuery("SELECT UTC_TIMESTAMP").WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(time.Now().UTC()))
	mock.ExpectQuery("SELECT l.enabled_sections FROM assessment_access_links").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("FROM assessment_module_attempts").
		WillReturnRows(sqlmock.NewRows([]string{"section_key", "state"}).
			AddRow("reading-writing", "submitted").AddRow("math", "locked"))
	mock.ExpectQuery("FROM attempt_responses_v2").
		WillReturnRows(sqlmock.NewRows([]string{"question_id", "response_hash"}))
	mock.ExpectQuery("FROM attempt_terminalizations").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT answer_revision, revision, organization_id FROM student_attempts").
		WillReturnRows(sqlmock.NewRows([]string{"answer_revision", "revision", "organization_id"}).AddRow(0, 5, nil))
	mock.ExpectExec("INSERT INTO attempt_terminalizations").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE student_attempts SET phase = 'post-exam'").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE student_attempts SET response_revision=").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO attempt_submissions_v2").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	svc := attempts.NewService(tx.NewRunner(db), clock.FixedAt(time.Now().UTC()), []byte(submitTestSecret))
	res, err := svc.Submit(context.Background(), submitBearer(t),
		attempts.SubmitCommand{AttemptID: "att-1", LeaseEpoch: 3, SubmissionID: "sub-sat"},
		nil, nil, v2ProviderResolver{}, terminalSealer{outboxExecOnly: true})
	if err != nil {
		t.Fatalf("SAT submit must seal after its topology check, got %v", err)
	}
	if res.Provisional {
		t.Fatalf("SAT submit must return a terminal receipt, got %+v", res)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// An unrecognised provider_key stops the submit before any terminal write, and
// the wire error is the 422 the client can retry against a fixed exam row.
func TestV2SubmitUnknownProviderRefused(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").WithArgs("att-1").WillReturnRows(submitAttemptRows())
	mock.ExpectQuery("FROM student_attempts a JOIN exam_entities e").WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key", "exam_type"}).AddRow("toefl", "Academic"))
	mock.ExpectRollback()

	svc := attempts.NewService(tx.NewRunner(db), clock.FixedAt(time.Now().UTC()), []byte(submitTestSecret))
	_, err = svc.Submit(context.Background(), submitBearer(t),
		attempts.SubmitCommand{AttemptID: "att-1", LeaseEpoch: 3, SubmissionID: "sub-unknown"},
		nil, nil, v2ProviderResolver{}, terminalSealer{outboxExecOnly: true})
	if err == nil {
		t.Fatal("an unknown provider identity must refuse the submit")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
