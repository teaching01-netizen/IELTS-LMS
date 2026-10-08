package main

import (
 "context"
 "database/sql"
 "testing"
 "time"

 "example.com/ielts-proctoring/internal/delivery"
 "example.com/ielts-proctoring/internal/proctor"
 "example.com/ielts-proctoring/internal/platform/tx"
 examruntime "example.com/ielts-proctoring/internal/runtime"
 "github.com/google/uuid"
)

func TestSATPauseUnionMySQL(t *testing.T) {
 for _, roomFirst:=range []bool{false,true} {t.Run(map[bool]string{false:"individual-first",true:"room-first"}[roomFirst],func(t *testing.T){
  db:=staleETagTestDB(t);ctx:=context.Background()
  schedule,attempt,base,_,_:=seedStaleETagExam(t,db)
  exec:=func(query string,args ...any){t.Helper();if _,err:=db.ExecContext(ctx,query,args...);err!=nil{t.Fatal(err)}}
  exec("UPDATE exam_session_runtimes SET timing_model='sat_personal_v1', active_section_key='reading-writing' WHERE schedule_id=?",schedule)
  exec("INSERT INTO exam_session_runtime_sections (id,runtime_id,section_key,label,section_order,planned_duration_minutes,status,actual_start_at) SELECT ?,id,'reading-writing','Reading',0,60,'live',UTC_TIMESTAMP(6) FROM exam_session_runtimes WHERE schedule_id=?",uuid.NewString(),schedule)
  breakID:=uuid.NewString()
  exec("INSERT INTO assessment_attempt_breaks (id,attempt_id,after_section_id,duration_seconds,state,starts_at,deadline_at) SELECT ?,?,section_id,600,'active',UTC_TIMESTAMP(6),DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 600 SECOND) FROM assessment_modules WHERE id=?",breakID,attempt,base)
  runner:=tx.NewRunner(db); room:=examruntime.NewService(runner,nil); staff:=proctor.NewService(runner,db,nil,nil,nil);actor:=proctor.Actor{ID:"pause-auditor",Role:"admin",CSRFVerified:true}
  pauseIndividual:=func(){t.Helper();if err:=staff.Pause(ctx,actor,schedule,attempt,proctor.AttemptCommand{});err!=nil{t.Fatal(err)}}
  pauseRoom:=func(){t.Helper();if err:=room.Pause(ctx,schedule,examruntime.RevisionFence{},nil,actor.ID);err!=nil{t.Fatal(err)}}
  if roomFirst {pauseRoom();pauseIndividual()} else {pauseIndividual();pauseRoom()}
  // Simulate an elapsed frozen interval without sleeping or trusting a client clock.
  exec("UPDATE assessment_module_attempts SET paused_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 300 SECOND) WHERE attempt_id=? AND state='active'",attempt)
  exec("UPDATE assessment_attempt_breaks SET paused_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 300 SECOND), deadline_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE id=?",breakID)
  if err:=staff.Warn(ctx,actor,schedule,attempt,proctor.AttemptCommand{});err!=nil{t.Fatal(err)}
  var status string
  if err:=db.QueryRow("SELECT proctor_status FROM student_attempts WHERE id=?",attempt).Scan(&status);err!=nil{t.Fatal(err)}
  if status!="paused" {t.Fatalf("warning cleared individual pause: %s",status)}
  if _,err:=delivery.NewService(db,runner).ReconcileAttemptTimeout(ctx,schedule,attempt,time.Now().UTC());err!=nil{t.Fatal(err)}
  if err:=db.QueryRow("SELECT state FROM assessment_attempt_breaks WHERE id=?",breakID).Scan(&status);err!=nil{t.Fatal(err)}
  if status!="active" {t.Fatalf("paused break completed: %s",status)}
  if err:=room.Resume(ctx,schedule,examruntime.RevisionFence{},actor.ID);err!=nil{t.Fatal(err)}
  var paused sql.NullTime
  if err:=db.QueryRow("SELECT paused_at FROM assessment_module_attempts WHERE attempt_id=? AND module_id=?",attempt,base).Scan(&paused);err!=nil{t.Fatal(err)}
  if !paused.Valid {t.Fatal("room resume cleared outstanding individual pause")}
  if err:=staff.Resume(ctx,actor,schedule,attempt,proctor.AttemptCommand{});err!=nil{t.Fatal(err)}
  var seconds int
  if err:=db.QueryRow("SELECT paused_at,accumulated_paused_seconds FROM assessment_attempt_breaks WHERE id=?",breakID).Scan(&paused,&seconds);err!=nil{t.Fatal(err)}
  if paused.Valid || seconds<300 || seconds>305 {t.Fatalf("break credit paused=%v seconds=%d",paused.Valid,seconds)}
 })}
}
