package main

// Audit finding 3: the answer-write decision must be authoritative in the
// transaction the write commits in, in BOTH locker modes.
//
// These drive a real single-command SaveResponses through the production
// lockers: with RUNTIME_SNAPSHOT off (runtime + section rows read FOR UPDATE)
// and on (the same rows read lock-free on the same transaction). A write whose
// section is paused, still locked (planned but not opened), completed, or
// missing must be refused; the ordinary in-section write must still land its
// projection row, ledger entry and revision bump.
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
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/runtime"
)

// sectionGateQuerier is one locker mode plus the runtime-state staging that mode
// issues: v2Locker takes FOR UPDATE locks and reads db time before the section
// row; snapshotLocker reads the runtime header, the section row, then db time.
type sectionGateQuerier struct {
	name   string
	locker attempts.RuntimeLocker
	stage  func(mock sqlmock.Sqlmock, sectionStatus *string)
}

// sectionGateModes are the two production configurations of RuntimeLockerFor.
func sectionGateModes() []sectionGateQuerier {
	return []sectionGateQuerier{
		{
			name:   "snapshot off (v2Locker, FOR UPDATE)",
			locker: v2Locker{},
			stage: func(mock sqlmock.Sqlmock, sectionStatus *string) {
				mock.ExpectQuery(regexp.QuoteMeta("SELECT id, status, timing_model, active_section_key, waiting_for_next_section FROM exam_session_runtimes")).
					WithArgs("sched-1").
					WillReturnRows(sqlmock.NewRows([]string{"id", "status", "timing_model", "active_section_key", "waiting_for_next_section"}).
						AddRow("rt-1", "live", "legacy_section_v1", "rw", false))
				mock.ExpectQuery("SELECT UTC_TIMESTAMP").
					WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(time.Now().UTC()))
				sectionRow(mock, sectionStatus)
			},
		},
		{
			name:   "snapshot on (snapshotLocker, lock-free reads)",
			locker: snapshotLocker{},
			stage: func(mock sqlmock.Sqlmock, sectionStatus *string) {
				mock.ExpectQuery(regexp.QuoteMeta("COALESCE(timing_model")).
					WithArgs("sched-1").
					WillReturnRows(sqlmock.NewRows([]string{"id", "status", "active_section_key", "revision", "timing_model", "waiting_for_next_section"}).
						AddRow("rt-1", "live", "rw", 4, "legacy_section_v1", false))
				snapshotSectionRow(mock, sectionStatus)
				mock.ExpectQuery("SELECT UTC_TIMESTAMP").
					WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(time.Now().UTC()))
			},
		},
	}
}

func sectionRow(mock sqlmock.Sqlmock, status *string) {
	exp := mock.ExpectQuery("FROM exam_session_runtime_sections").WithArgs("rt-1", "rw")
	if status == nil {
		exp.WillReturnError(sql.ErrNoRows)
		return
	}
	exp.WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow(*status))
}

// writeGateResolver is the question resolver for the gate tests: it keeps the
// test on the runtime gate instead of the question→module projection.
type writeGateResolver struct {
	moduleDeadlineAt *time.Time
}

func (r writeGateResolver) Resolve(context.Context, tx.Tx, string, string) (attempts.QuestionOwner, error) {
	return attempts.QuestionOwner{ModuleID: "mod-rw", SectionKey: "rw", ModuleState: "active", ModuleDeadlineAt: r.moduleDeadlineAt}, nil
}

// TestResponseWriteSectionLiveness is the matrix the audit asked for: a real
// write, both modes, every section state.
func TestResponseWriteSectionLiveness(t *testing.T) {
	live, paused, locked, completed := "live", "paused", "locked", "completed"
	scenarios := []struct {
		name           string
		section        *string
		moduleDeadline *time.Time
		wantMessage    string
		wantWritable   bool
		wantErrStatus  int
		wantErrCode    apperrors.Code
	}{
		{name: "live section admits the write", section: &live, wantWritable: true},
		{name: "paused section refuses", section: &paused, wantMessage: "Exam section is paused.", wantErrStatus: 422, wantErrCode: apperrors.CodeAttemptNotWritable},
		{name: "planned but not opened section refuses", section: &locked, wantMessage: "Exam section has not started.", wantErrStatus: 422, wantErrCode: apperrors.CodeAttemptNotWritable},
		{name: "completed section refuses", section: &completed, wantMessage: "Exam section is not live.", wantErrStatus: 422, wantErrCode: apperrors.CodeAttemptNotWritable},
		{name: "missing section row refuses", section: nil, wantMessage: "Exam section has not started.", wantErrStatus: 422, wantErrCode: apperrors.CodeAttemptNotWritable},
		{name: "expired SAT personal module clock refuses before worker reconciliation", section: &live, moduleDeadline: func() *time.Time { deadline := time.Now().UTC().Add(-time.Second); return &deadline }(), wantMessage: "Response deadline has passed.", wantErrStatus: 422, wantErrCode: apperrors.CodeDeadlineExpired},
	}
	for _, mode := range sectionGateModes() {
		for _, sc := range scenarios {
			t.Run(mode.name+"/"+sc.name, func(t *testing.T) {
				db, mock, err := sqlmock.New()
				if err != nil {
					t.Fatal(err)
				}
				defer db.Close()
				secret := []byte(submitTestSecret)
				svc := attempts.NewService(tx.NewRunner(db), clock.FixedAt(time.Now().UTC()), secret).SetRowFirst(true)

				mock.ExpectBegin()
				mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
				mock.ExpectQuery("FROM student_attempts WHERE id").WithArgs("att-1").WillReturnRows(submitAttemptRows())
				mock.ExpectQuery("FROM attempt_sessions WHERE token_id").
					WillReturnRows(sqlmock.NewRows([]string{"attempt_id", "client_session_id", "revoked_at", "expires_at"}).
						AddRow("att-1", "sess-1", nil, nil))
				// Exact-replay probe: nothing stored for this write id.
				mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").WillReturnError(sql.ErrNoRows)
				mock.ExpectQuery("SELECT active_client_session_id").
					WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
				mode.stage(mock, sc.section)
				if sc.wantWritable {
					// The write itself: probes, projection row, ledger row,
					// revision bump, audit row.
					mock.ExpectQuery("SELECT request_hash, response_hash").
						WillReturnError(sql.ErrNoRows)
					mock.ExpectQuery("SELECT client_write_id FROM attempt_mutations_v2 WHERE attempt_id").
						WillReturnError(sql.ErrNoRows)
					mock.ExpectQuery("SELECT lease_epoch, client_version, server_revision FROM attempt_responses_v2").
						WillReturnError(sql.ErrNoRows)
					mock.ExpectExec("INSERT INTO attempt_responses_v2").WillReturnResult(sqlmock.NewResult(1, 1))
					mock.ExpectExec("INSERT INTO attempt_mutations_v2").WillReturnResult(sqlmock.NewResult(1, 1))
					mock.ExpectExec("UPDATE student_attempts SET response_revision").WillReturnResult(sqlmock.NewResult(0, 1))
					mock.ExpectExec("INSERT INTO session_audit_logs").WillReturnResult(sqlmock.NewResult(1, 1))
					mock.ExpectCommit()
				} else {
					// The per-command idempotency probe runs BEFORE ensureWritable
					// (new-write branch), so the refusal path still probes once.
					mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").
						WillReturnError(sql.ErrNoRows)
					mock.ExpectRollback()
				}

				cmd := attempts.SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
					Commands: []attempts.ResponseCommand{{WriteID: "w-gate", QuestionID: "q-1", ClientVersion: 10, Response: attempts.ResponsePayload{Answer: "A"}}}}
				res, err := svc.SaveResponses(context.Background(), writeBearer(t), cmd, writeGateResolver{moduleDeadlineAt: sc.moduleDeadline}, mode.locker)
				if sc.wantWritable {
					if err != nil {
						t.Fatalf("in-section write must succeed, got %v", err)
					}
					if res.ResponseRevision != 10 || len(res.Acks) != 1 || res.Acks[0].Outcome != "applied" {
						t.Fatalf("write must apply: %+v", res)
					}
				} else {
					appErr, ok := apperrors.As(err)
					if !ok {
						t.Fatalf("write must be refused with a typed error, got %v", err)
					}
					if appErr.Code != sc.wantErrCode || appErr.HTTPStatus != sc.wantErrStatus {
						t.Fatalf("want %s/%d, got %s/%d", sc.wantErrCode, sc.wantErrStatus, appErr.Code, appErr.HTTPStatus)
					}
					if appErr.Message != sc.wantMessage {
						t.Fatalf("want message %q, got %q", sc.wantMessage, appErr.Message)
					}
				}
				if err := mock.ExpectationsWereMet(); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

// A warm snapshot cache can no longer authorize anything: this is the stale-view
// window the audit found. The cache holds a LIVE view of the schedule (as the
// poll path leaves it), while the current runtime rows say the section is
// paused — the write must still be refused, and no projection row written.
func TestResponseWriteIgnoresWarmLiveSnapshotCache(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte(submitTestSecret)
	svc := attempts.NewService(tx.NewRunner(db), clock.FixedAt(time.Now().UTC()), secret).SetRowFirst(true)

	// Warm the app's snapshot cache exactly as the student poll path does.
	live := "rw"
	cache := runtime.NewSnapshotCache(runtime.SnapshotTTL)
	if _, err := cache.Get("sched-1", time.Now().UTC(), func() (runtime.Snapshot, error) {
		return runtime.Snapshot{Status: runtime.StatusLive, ActiveSectionKey: &live, Revision: 4,
			TimingModel: "legacy_section_v1", SectionLive: true, SectionStarted: true, LoadedAt: time.Now().UTC()}, nil
	}); err != nil {
		t.Fatal(err)
	}
	if cache.Len() != 1 {
		t.Fatalf("cache must hold the seeded live view, got %d", cache.Len())
	}

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").WithArgs("att-1").WillReturnRows(submitAttemptRows())
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").
		WillReturnRows(sqlmock.NewRows([]string{"attempt_id", "client_session_id", "revoked_at", "expires_at"}).
			AddRow("att-1", "sess-1", nil, nil))
	mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT active_client_session_id").
		WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	// Current committed state: the section is paused.
	paused := "paused"
	sectionGateModes()[1].stage(mock, &paused)
	// Per-command idempotency probe: nothing stored, so no replay path exists
	// that could bypass the gate.
	mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	cmd := attempts.SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
		Commands: []attempts.ResponseCommand{{WriteID: "w-stale", QuestionID: "q-1", ClientVersion: 11, Response: attempts.ResponsePayload{Answer: "B"}}}}
	_, err = svc.SaveResponses(context.Background(), writeBearer(t), cmd, writeGateResolver{}, snapshotLocker{})
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeAttemptNotWritable {
		t.Fatalf("a warm live cache must not authorize a write against a paused section, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func writeBearer(t *testing.T) string {
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
