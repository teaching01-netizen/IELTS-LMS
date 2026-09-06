package answerhistory

import (
	"context"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestAnswerHistoryTargetValidation(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db)

	if _, _, _, err := svc.ExportTarget(context.Background(), "sub-1", "bogus", "q1", FormatJSON); err == nil {
		t.Fatal("bogus target type must fail validation")
	}
	if _, _, _, err := svc.ExportTarget(context.Background(), "sub-1", TargetObjective, "q1", "yaml"); err == nil {
		t.Fatal("bogus format must fail validation")
	}
	if _, _, _, err := svc.ExportTarget(context.Background(), "sub-1", TargetObjective, "  ", FormatJSON); err == nil {
		t.Fatal("blank target id must fail validation")
	}
	if _, err := svc.GetOverview(context.Background(), "  "); err == nil {
		t.Fatal("blank submission id must fail validation")
	}
	if _, err := svc.ResolveSubmissionIDFromAttempt(context.Background(), "  "); err == nil {
		t.Fatal("blank attempt id must fail validation")
	}
}
