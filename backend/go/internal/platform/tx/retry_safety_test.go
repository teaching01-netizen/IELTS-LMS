package tx

import (
 "context"
 "database/sql/driver"
 "errors"
 "fmt"
 "testing"

 sqlmock "github.com/DATA-DOG/go-sqlmock"
 "github.com/go-sql-driver/mysql"
)

func TestTransientRequiresDatabaseCode(t *testing.T) {
 for _, tc := range []struct { err error; retry bool }{
  {&mysql.MySQLError{Number:1213, Message:"victim"}, true},
  {fmt.Errorf("wrapped: %w", &mysql.MySQLError{Number:1205}), true},
  {&mysql.MySQLError{Number:1062, Message:"deadlock"}, false},
  {errors.New("deadlock in an external dependency"), false},
  {driver.ErrBadConn, false},
 } {
  if got := transient(tc.err); got != tc.retry { t.Errorf("%v: retry=%v want %v", tc.err, got, tc.retry) }
 }
}

func TestUnknownCommitDoesNotExecuteCommandAgain(t *testing.T) {
 db, mock, err := sqlmock.New()
 if err != nil { t.Fatal(err) }
 defer db.Close()
 mock.ExpectBegin()
 mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0,0))
 commitErr := errors.New("broken pipe")
 mock.ExpectCommit().WillReturnError(commitErr)
 calls := 0
 err = NewRunner(db).WithTxRetry(context.Background(), 3, func(context.Context, Tx) error { calls++; return nil })
 if !errors.Is(err, commitErr) || calls != 1 { t.Fatalf("unknown commit err=%v executions=%d",err,calls) }
 if err := mock.ExpectationsWereMet(); err != nil { t.Fatal(err) }
}
