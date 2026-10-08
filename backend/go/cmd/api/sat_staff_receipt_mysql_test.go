package main

import (
 "context"
 "testing"

 "example.com/ielts-proctoring/internal/platform/tx"
 "example.com/ielts-proctoring/internal/proctor"
)

func TestSATExtensionReceiptMySQL(t *testing.T){
 db:=staleETagTestDB(t);ctx:=context.Background();schedule,attempt,base,_,_:=seedStaleETagExam(t,db)
 if _,err:=db.Exec("UPDATE exam_session_runtimes SET timing_model='sat_personal_v1' WHERE schedule_id=?",schedule);err!=nil{t.Fatal(err)}
 staff:=proctor.NewService(tx.NewRunner(db),db,nil,nil,nil);actor:=proctor.Actor{ID:"receipt-auditor",Role:"admin",CSRFVerified:true};cmd:=proctor.AttemptCommand{OperationID:"grant-1",ModuleID:base}
 for range 2 {if err:=staff.ExtendAttempt(ctx,actor,schedule,attempt,5,cmd);err!=nil{t.Fatal(err)}}
 var seconds int
 if err:=db.QueryRow("SELECT extension_seconds FROM assessment_module_attempts WHERE attempt_id=? AND module_id=?",attempt,base).Scan(&seconds);err!=nil{t.Fatal(err)}
 if seconds!=300{t.Fatalf("lost-ACK retry granted time twice: seconds=%d",seconds)}
 if err:=staff.ExtendAttempt(ctx,actor,schedule,attempt,6,cmd);err==nil{t.Fatal("same operation ID accepted changed grant")}
}
