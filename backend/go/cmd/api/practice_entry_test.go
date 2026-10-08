package main

import (
 "context"
 "testing"

 sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestPracticeEntryCannotSelectAccountByDisplayEmail(t *testing.T) {
 db,mock,err:=sqlmock.New(); if err!=nil {t.Fatal(err)}; defer db.Close()
 secret:="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
 mock.ExpectExec("INSERT INTO users").WithArgs(sqlmock.AnyArg(),sqlmock.AnyArg(),"Practice student").WillReturnResult(sqlmock.NewResult(0,1))
 mock.ExpectQuery("SELECT id, role, state").WithArgs(sqlmock.AnyArg()).WillReturnRows(sqlmock.NewRows([]string{"id","role","state","display_name"}).AddRow("isolated","student","active","Practice student"))
 id,_,err:=practiceEntryPrincipal(context.Background(),db,"sitting",secret,"Practice student")
 if err!=nil || id!="isolated" {t.Fatalf("principal=%s err=%v",id,err)}
 if err:=mock.ExpectationsWereMet();err!=nil {t.Fatal(err)}
}

func TestPracticeEntryRejectsMissingOrGuessableRecoveryCapability(t *testing.T) {
 for _,secret:=range []string{"","w123456","alice@example.test","0123456789abcdef"} {
  _,_,err:=practiceEntryPrincipal(context.Background(),nil,"sitting",secret,"Alice")
  if err==nil {t.Fatalf("accepted unsafe recovery capability %q",secret)}
 }
}
