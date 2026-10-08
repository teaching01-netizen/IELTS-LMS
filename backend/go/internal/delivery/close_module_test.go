package delivery

import (
 "context"
 "database/sql"
 "testing"

 "example.com/ielts-proctoring/internal/platform/apperrors"
 sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestCloseRequiresExactDurableWrite(t *testing.T) {
 for _, tc := range []struct{name string; write string; version int64; lease int64; hash string; ledgerWrite any; ledgerVersion any; ledgerLease any; ledgerHash any; pending int}{
  {"exact", "wanted", 1, 2, "hash", "wanted", int64(1), int64(2), "hash", 0},
  {"old writer high version", "old", 20, 1, "oldhash", "old", int64(20), int64(1), "oldhash", 1},
  {"projection without ledger", "wanted", 1, 2, "hash", nil, nil, nil, nil, 1},
  {"hash disagreement", "wanted", 1, 2, "hash", "wanted", int64(1), int64(2), "other", 1},
  {"lease disagreement", "wanted", 1, 2, "hash", "wanted", int64(1), int64(1), "hash", 1},
 } { t.Run(tc.name,func(t *testing.T){
  db,mock,err:=sqlmock.New(); if err!=nil {t.Fatal(err)}; defer db.Close()
  mock.ExpectBegin(); tr,err:=db.BeginTx(context.Background(), &sql.TxOptions{}); if err!=nil {t.Fatal(err)}
  mock.ExpectQuery("FROM assessment_exam_questions eq LEFT JOIN attempt_responses_v2").WithArgs("a1","m1","q1").WillReturnRows(sqlmock.NewRows([]string{"id","client_version","lease_epoch","client_write_id","response_hash","ledger_write_id","ledger_version","ledger_lease","ledger_hash"}).AddRow("q1",tc.version,tc.lease,tc.write,tc.hash,tc.ledgerWrite,tc.ledgerVersion,tc.ledgerLease,tc.ledgerHash))
  pending,err:=pendingCloseWritesTx(context.Background(),tr,"a1","m1",[]ModuleCloseAnswer{{QuestionID:"q1",WriteID:"wanted",ClientVersion:1}})
  if err!=nil || len(pending)!=tc.pending {t.Fatalf("pending=%v err=%v",pending,err)}
  mock.ExpectRollback(); _=tr.Rollback(); if err:=mock.ExpectationsWereMet();err!=nil {t.Fatal(err)}
 }) }
}

func TestPendingCloseWritesRejectsDuplicateAndInvalidEntries(t *testing.T) {
 for _, entries := range [][]ModuleCloseAnswer{
  {{QuestionID:"q1",WriteID:"w1",ClientVersion:0}},
  {{QuestionID:"",WriteID:"w1",ClientVersion:1}},
  {{QuestionID:"q1",ClientVersion:1}},
  {{QuestionID:"q1",WriteID:"w1",ClientVersion:1},{QuestionID:"q1",WriteID:"w2",ClientVersion:2}},
 } {
  _,err:=pendingCloseWritesTx(context.Background(),nil,"a1","m1",entries)
  e,ok:=apperrors.As(err); if !ok || e.Code!=apperrors.CodeValidation {t.Fatalf("expected validation, got %v",err)}
 }
}
