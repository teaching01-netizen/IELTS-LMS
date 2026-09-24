package main

// Regression: the single-operation SAT module entry flow writes the module as
// active with started_at = DB NOW and NEVER writes entry_confirmed_at. The
// answer write gate must accept responses on that row shape, otherwise the
// student can see the exam while every autosave returns
// 422 ATTEMPT_NOT_WRITABLE ("SAT module entry is not confirmed.").
//
// These drive the PRODUCTION per-question resolver (v2Resolver.Resolve, the
// path an interactive 1–2 answer autosave takes — below the bulk threshold) and
// the PRODUCTION SaveResponses loop, with the exact row shape both entry
// producers leave behind:
//
//   - StartModuleOfferAck (client-driven M1): UPDATE ... SET state='active',
//     started_at=DB NOW;
//   - insertActiveModuleAttemptTx (server-driven M1->M2): INSERT ...
//     state='active', started_at=DB NOW.
//
// Neither writes entry_confirmed_at, so it stays NULL in both cases.
import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// satPersonalAttemptRows is lockAttempt's projection for a sat_personal_v1
// attempt: protocol 2, running/exam, current lease/control, provider sat.
func satPersonalAttemptRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "schedule_id", "user_id", "organization_id", "protocol_version",
		"delivery_status", "phase", "lease_epoch", "control_epoch",
		"response_revision", "deadline_at", "closing_grace_until",
		"submitted_at", "final_submission", "proctor_status", "provider_key", "timing_model",
	}).AddRow("att-1", "sched-1", "u-1", nil, 2, "running", "exam", 3, 7, 9, nil, nil, nil, nil, "active", "sat", "sat_personal_v1")
}

// satPersonalRuntime stages v2Locker.Lock for a live personal runtime with no
// active section cursor: the runtime row (lock-free section liveness is skipped
// because active_section_key is NULL) followed by the authoritative DB clock.
func satPersonalRuntime(mock sqlmock.Sqlmock, now time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id, status, timing_model, active_section_key, waiting_for_next_section FROM exam_session_runtimes")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "timing_model", "active_section_key", "waiting_for_next_section"}).
			AddRow("rt-1", "live", "sat_personal_v1", nil, false))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(now))
}

// satPersonalOwnerRow stages v2Resolver.Resolve for an active SAT module: the
// module has started_at and an allotment, but entry_confirmed_at is NULL —
// exactly what StartModuleOfferAck and insertActiveModuleAttemptTx leave.
func satPersonalOwnerRow(mock sqlmock.Sqlmock, questionID string, startedAt time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq")).
		WithArgs("att-1", "att-1", questionID, questionID, questionID).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "section_key", "state", "provider_key",
			"started_at", "allocated_seconds", "extension_seconds", "accumulated_paused_seconds",
			"timing_model", "entry_confirmed_at", "entry_entered_at",
		}).AddRow("mod-1", "reading-writing", "active", "sat", startedAt, 120, 0, 0, "sat_personal_v1", nil, nil))
}

func TestSATModuleActiveWithoutEntryConfirmationAcceptsBatchWrite(t *testing.T) {
	now := time.Now().UTC()
	started := now.Add(-10 * time.Second)

	for _, tc := range []struct {
		name       string
		questionID string
		provenance string
	}{
		{
			name:       "client-driven M1 after StartModuleOfferAck",
			questionID: "q-m1",
			provenance: "state=active + started_at=DB NOW, entry_confirmed_at never written",
		},
		{
			name:       "server-driven M2 inserted active",
			questionID: "q-m2",
			provenance: "insertActiveModuleAttemptTx: state=active + started_at=DB NOW, no entry confirmation",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			svc := attempts.NewService(tx.NewRunner(db), clock.FixedAt(now), []byte(submitTestSecret)).SetRowFirst(true)

			mock.ExpectBegin()
			mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
			mock.ExpectQuery("FROM student_attempts WHERE id").WithArgs("att-1").WillReturnRows(satPersonalAttemptRows())
			mock.ExpectQuery("FROM attempt_sessions WHERE token_id").
				WillReturnRows(sqlmock.NewRows([]string{"attempt_id", "client_session_id", "revoked_at", "expires_at"}).
					AddRow("att-1", "sess-1", nil, nil))
			// Exact-replay probe: nothing stored for this write id.
			mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").WillReturnError(sql.ErrNoRows)
			mock.ExpectQuery("SELECT active_client_session_id").
				WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
			satPersonalRuntime(mock, now)
			// Per-command loop: ledger probe, then writability, then owner
			// resolution (the production resolver), then the write.
			mock.ExpectQuery("SELECT request_hash, response_hash").
				WillReturnError(sql.ErrNoRows)
			satPersonalOwnerRow(mock, tc.questionID, started)
			mock.ExpectQuery("SELECT client_write_id FROM attempt_mutations_v2 WHERE attempt_id").
				WillReturnError(sql.ErrNoRows)
			mock.ExpectQuery("SELECT lease_epoch, client_version, server_revision FROM attempt_responses_v2").
				WillReturnError(sql.ErrNoRows)
			mock.ExpectExec("INSERT INTO attempt_responses_v2").WillReturnResult(sqlmock.NewResult(1, 1))
			// Best-effort "first accepted response closes the rearm window" stamp.
			// Its `entry_confirmed_at IS NOT NULL` predicate no longer matches under
			// the single-operation flow, so it affects 0 rows (rearm safety is
			// independently enforced by the arm path's accepted-response probe).
			mock.ExpectExec("UPDATE assessment_module_attempts SET entry_entered_at").WillReturnResult(sqlmock.NewResult(0, 0))
			mock.ExpectExec("INSERT INTO attempt_mutations_v2").WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectExec("UPDATE student_attempts SET response_revision").WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectExec("INSERT INTO session_audit_logs").WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectCommit()

			cmd := attempts.SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
				Commands: []attempts.ResponseCommand{{WriteID: "w-entry", QuestionID: tc.questionID, ClientVersion: 10,
					Response: attempts.ResponsePayload{Answer: "A"}}}}
			res, err := svc.SaveResponses(context.Background(), writeBearer(t), cmd, v2Resolver{}, v2Locker{})
			if err != nil {
				t.Fatalf("%s: an active SAT module with started_at and NULL entry_confirmed_at must accept an answer: %v", tc.provenance, err)
			}
			if res.ResponseRevision != 10 || len(res.Acks) != 1 || res.Acks[0].Outcome != "applied" {
				t.Fatalf("expected one applied acknowledgement, got %+v", res)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// Guardrail the fix must NOT reintroduce: a module that has not started yet
// (started_at NULL, or a started_at in the future) still refuses, and the
// refusal stays terminal rather than becoming a retry signal.
func TestSATModuleWithoutStartedAtStillRefuses(t *testing.T) {
	now := time.Now().UTC()
	for _, tc := range []struct {
		name  string
		start *time.Time
	}{
		{name: "started_at NULL"},
		{name: "started_at in the future", start: func() *time.Time { t := now.Add(time.Minute); return &t }()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			svc := attempts.NewService(tx.NewRunner(db), clock.FixedAt(now), []byte(submitTestSecret)).SetRowFirst(true)

			mock.ExpectBegin()
			mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
			mock.ExpectQuery("FROM student_attempts WHERE id").WithArgs("att-1").WillReturnRows(satPersonalAttemptRows())
			mock.ExpectQuery("FROM attempt_sessions WHERE token_id").
				WillReturnRows(sqlmock.NewRows([]string{"attempt_id", "client_session_id", "revoked_at", "expires_at"}).
					AddRow("att-1", "sess-1", nil, nil))
			mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").WillReturnError(sql.ErrNoRows)
			mock.ExpectQuery("SELECT active_client_session_id").
				WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
			satPersonalRuntime(mock, now)
			mock.ExpectQuery("SELECT request_hash, response_hash").WillReturnError(sql.ErrNoRows)
			// Owner row: active module, but not yet started.
			mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq")).
				WithArgs("att-1", "att-1", "q-m1", "q-m1", "q-m1").
				WillReturnRows(sqlmock.NewRows([]string{
					"id", "section_key", "state", "provider_key",
					"started_at", "allocated_seconds", "extension_seconds", "accumulated_paused_seconds",
					"timing_model", "entry_confirmed_at", "entry_entered_at",
				}).AddRow("mod-1", "reading-writing", "active", "sat", tc.start, 120, 0, 0, "sat_personal_v1", nil, nil))
			mock.ExpectRollback()

			cmd := attempts.SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
				Commands: []attempts.ResponseCommand{{WriteID: "w-entry", QuestionID: "q-m1", ClientVersion: 10,
					Response: attempts.ResponsePayload{Answer: "A"}}}}
			_, err = svc.SaveResponses(context.Background(), writeBearer(t), cmd, v2Resolver{}, v2Locker{})
			appErr, ok := apperrors.As(err)
			if !ok || appErr.Code != apperrors.CodeAttemptNotWritable || appErr.HTTPStatus != 422 {
				t.Fatalf("an unstarted SAT module must refuse with 422 ATTEMPT_NOT_WRITABLE, got %v", err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
