package delivery

import (
	"context"
	"encoding/json"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func deliverySaveProtocolVersion(mock sqlmock.Sqlmock, version int) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COALESCE(protocol_version, 1) FROM student_attempts WHERE id = ?")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"protocol_version"}).AddRow(version))
}

// D1/F4: the compatibility answer save writes assessment_question_responses,
// which scoring does not read for a protocol-2 attempt. Acknowledging the write
// would hand the candidate a success whose answer the scorer, the route decision
// and every result projection then ignore, so the transport must refuse with a
// stable, non-retryable conflict BEFORE it opens the mutation transaction.
func TestDeliverySaveResponseRefusesProtocolTwoAttempt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	deliverySaveBinding(mock)
	deliverySaveProtocolVersion(mock, 2)
	// No ExpectBegin and no write expectations: any attempt to enter the
	// mutation transaction or touch assessment_question_responses surfaces as
	// an unexpected-call failure and changes the returned error.

	req := SaveResponseRequest{Revision: 0, Response: json.RawMessage(`"A"`), EliminatedOptions: []string{}, Annotations: json.RawMessage(`{}`)}
	_, err = svc.SaveResponse(context.Background(), "sched-1", "att-1", "sched-1", "eq-1", req, "sess-test", "tok-1")
	if deliveryCodeOf(err) != apperrors.CodeProtocolUpgradeRequired {
		t.Fatalf("expected PROTOCOL_UPGRADE_REQUIRED for a protocol-2 attempt, got %v", err)
	}
	appErr, ok := apperrors.As(err)
	if !ok {
		t.Fatalf("expected *apperrors.Error, got %T", err)
	}
	if appErr.HTTPStatus != 409 {
		t.Fatalf("protocol fence must be a 409 conflict, got %d", appErr.HTTPStatus)
	}
	if appErr.Retryable {
		t.Fatal("the protocol fence is a permanent contract change and must not be retryable")
	}
	if appErr.Details["reason"] != "PROTOCOL_UPGRADE_REQUIRED" {
		t.Fatalf("expected a stable reason detail, got %v", appErr.Details)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A protocol-1 attempt keeps the legacy contract: for it
// assessment_question_responses is genuinely canonical, so the fence must not
// touch it.
func TestDeliverySaveResponseAllowsProtocolOneAttempt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	deliverySaveBinding(mock)
	deliverySaveProtocolVersion(mock, 1)
	deliverySaveBegin(mock)
	// Prove the fence let the request through: the next statement sqlmock sees
	// is the mutation transaction's first read, which this test lets fail. A
	// refused request would never reach Begin at all.
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WithArgs("att-1", "sched-1").
		WillReturnError(context.DeadlineExceeded)
	mock.ExpectRollback()

	req := SaveResponseRequest{Revision: 0, Response: json.RawMessage(`"A"`), EliminatedOptions: []string{}, Annotations: json.RawMessage(`{}`)}
	_, err = svc.SaveResponse(context.Background(), "sched-1", "att-1", "sched-1", "eq-1", req, "sess-test", "tok-1")
	if deliveryCodeOf(err) == apperrors.CodeProtocolUpgradeRequired {
		t.Fatal("protocol-1 attempts must keep the legacy answer transport")
	}
	if err == nil {
		t.Fatal("expected the injected transaction failure to surface")
	}
}
