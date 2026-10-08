package main

import (
 "context"
 "testing"
)

func TestSATPinnedQuestionIdentityMySQL(t *testing.T) {
 db:=staleETagTestDB(t);ctx:=context.Background();_,attempt,base,low,_:=seedStaleETagExam(t,db)
 var exact,alias,revision string
 if err:=db.QueryRow("SELECT id,question_id,question_revision_id FROM assessment_exam_questions WHERE module_id=? ORDER BY display_order LIMIT 1",base).Scan(&exact,&alias,&revision);err!=nil{t.Fatal(err)}
 if _,err:=db.Exec("UPDATE assessment_exam_questions SET question_id=?,question_revision_id=? WHERE module_id=? AND display_order=0",alias,revision,low);err!=nil{t.Fatal(err)}
 txn,err:=db.BeginTx(ctx,nil);if err!=nil{t.Fatal(err)};defer txn.Rollback()
 if _,err:=normalizedQuestionOwners(ctx,txn,attempt,[]string{alias});err==nil{t.Fatal("ambiguous reusable question alias selected an arbitrary sitting slot")}
 owners,err:=normalizedQuestionOwners(ctx,txn,attempt,[]string{exact});if err!=nil{t.Fatal(err)}
 if owners[exact].ModuleID!=base {t.Fatalf("exact pinned ID resolved to wrong module: %+v",owners[exact])}
}
