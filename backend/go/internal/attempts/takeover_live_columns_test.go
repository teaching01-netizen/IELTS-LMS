package attempts

// Round 168: the takeover INSERT/UPDATE must name the live attempt_sessions
// columns (PK `id`, `revoked_at`/`revocation_reason` — no `reason`). Live
// proved the old shape 500s: `Error 1364: Field 'id' doesn't have a
// default value` on POST /api/v2/student/attempts/{id}/takeover.
import (
	"context"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func TestTakeoverUsesLiveSessionColumns(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.MatchExpectationsInOrder(true)
	secret := []byte("0123456789abcdef0123456789abcdef")
	svc := NewService(tx.NewRunner(db), clock.FixedAt(time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)), secret)
	lease := uint64(1)
	bearer, err := crypto.SignAttemptToken(secret, crypto.AttemptClaims{
		TokenID: "tok-take-1", UserID: "u-1", ScheduleID: "sched-1",
		AttemptID: "att-1", ClientSessionID: "cs-new", LeaseEpoch: &lease,
		Exp: time.Date(2026, 9, 8, 13, 0, 0, 0, time.UTC).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id=? FOR UPDATE")).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "schedule_id", "user_id", "organization_id", "protocol_version",
			"delivery_status", "phase", "lease_epoch", "control_epoch", "response_revision",
			"deadline_at", "closing_grace_until", "submitted_at", "final_submission", "proctor_status",
		}).AddRow("att-1", "sched-1", "u-1", nil, 2, "running", "exam", 1, 2, 0, nil, nil, nil, nil, "active"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_sessions WHERE token_id=? FOR UPDATE")).
		WillReturnRows(sqlmock.NewRows([]string{"attempt_id", "client_session_id", "revoked_at", "expires_at"}).
			AddRow("att-1", "cs-new", nil, time.Date(2026, 9, 8, 13, 0, 0, 0, time.UTC)))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)))
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id=?")).
		WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("cs-old"))
	// Live-column INSERT: names id + revocation_reason, never `reason`.
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO attempt_sessions (id, token_id, attempt_id")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE attempt_sessions SET revoked_at=?, revocation_reason=")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET lease_epoch=")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	res, err := svc.Takeover(context.Background(), bearer, "att-1", "cs-new", "r168-race")
	if err != nil {
		t.Fatalf("takeover on live columns must succeed: %v", err)
	}
	if res.LeaseEpoch != 2 {
		t.Fatalf("takeover from a superseded session must bump lease, got %+v", res)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
