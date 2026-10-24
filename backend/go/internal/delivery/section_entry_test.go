package delivery

import (
	"context"
	"errors"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
	"time"
)

func TestSectionEntryRefusalRollsBackActivation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE assessment_module_attempts SET state = 'active'").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()
	q, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	s := &Service{}
	_, _, _, err = s.activatePersonalModuleWithPolicyTx(context.Background(), q, "room", "attempt", saveActiveModule{id: "ma", moduleID: "m", allocatedSeconds: 60}, time.Now(), true, nil)
	_ = q.Rollback()
	var e *apperrors.Error
	if !errors.As(err, &e) || e.Details["reason"] != "SECTION_FORM_REQUIRED" {
		t.Fatalf("missing form must refuse activation with stable reason, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
