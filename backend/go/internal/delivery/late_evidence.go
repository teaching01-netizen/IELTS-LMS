package delivery

import (
 "context"
 "database/sql"
 "encoding/json"
 "time"

 "github.com/google/uuid"

 "example.com/ielts-proctoring/internal/assessscore"
 "example.com/ielts-proctoring/internal/platform/apperrors"
 "example.com/ielts-proctoring/internal/platform/telemetry"
 "example.com/ielts-proctoring/internal/platform/tx"
)

// Evidence never changes canonical responses, scores, or a selected route.
// Unknown provenance fields stay null; no writer era or version is invented.
type LateEvidenceRequest struct {
 ModuleID string `json:"moduleId"`
 Answers []LateEvidenceAnswer `json:"answers"`
}

type LateEvidenceAnswer struct {
 QuestionID string `json:"questionId"`
 WriteID string `json:"writeId"`
 Response json.RawMessage `json:"response"`
 OriginLeaseEpoch *int64 `json:"originLeaseEpoch"`
 ClientVersion *int64 `json:"clientVersion"`
 ClientReceivedAt *time.Time `json:"clientReceivedAt,omitempty"`
}

type LateEvidenceAck struct { Recorded int `json:"recorded"` }

const lateEvidenceAuditAction = "SAT_LATE_ANSWER_ROUTE_RISK"
const lateEvidenceConflictAction = "SAT_LATE_EVIDENCE_PROVENANCE_CONFLICT"

func (s *Service) RecordLateEvidence(ctx context.Context, bearerScheduleID, bearerAttemptID, urlScheduleID string, req LateEvidenceRequest, writerBinding ...string) (*LateEvidenceAck,error) {
 if urlScheduleID!=bearerScheduleID {return nil,apperrors.New(apperrors.CodeForbidden,"Attempt credential does not match the schedule.")}
 prepared,err:=prepareLateEvidence(req)
 if err!=nil {return nil,err}
 scheduleID,examID,providerKey,_,err:=s.startScheduleBinding(ctx,bearerScheduleID)
 if err!=nil {return nil,err}
 if providerKey!="sat" {return nil,apperrors.New(apperrors.CodeUnsupportedProvider,"The assessment provider is not supported.")}
 if err:=s.saveAttemptBinding(ctx,scheduleID,bearerAttemptID,examID);err!=nil {return nil,err}
 recorded,flipped:=0,false
 err=s.runner.WithTxRCRetry(ctx,3,func(ctx context.Context,t tx.Tx) error {
  recorded,flipped=0,false
  var lockedID string
  var currentLease int64
  if err:=t.QueryRowContext(ctx,"SELECT id, lease_epoch FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE",bearerAttemptID,scheduleID).Scan(&lockedID,&currentLease);err!=nil {
   if err==sql.ErrNoRows {return apperrors.New(apperrors.CodeNotFound,"Attempt not found.")};return err
  }
  if err:=enforceWriterSessionTx(ctx,t,scheduleID,bearerAttemptID,writerBinding...);err!=nil {return err}
  module,err:=lockModuleAttemptTx(ctx,t,bearerAttemptID,req.ModuleID)
  if err!=nil {return err}
  if module.state!="locked" && module.state!="submitted" {return assessmentConflict("MODULE_NOT_CLOSED","Answers for an open module are saved normally, not as evidence.")}
  scoring,_,err:=queryScoringRowsV2FirstTx(ctx,t,module.id,module.moduleID)
  if err!=nil {return err}
  inModule:=make(map[string]bool,len(scoring))
  for _,row:=range scoring {inModule[row.examQuestionID]=true}
  for _,entry:=range prepared {
   if !inModule[entry.answer.QuestionID] {return apperrors.New(apperrors.CodeValidation,"An evidence answer names a question outside this module.")}
   if entry.answer.OriginLeaseEpoch!=nil && *entry.answer.OriginLeaseEpoch>currentLease {return apperrors.New(apperrors.CodeValidation,"Evidence cannot originate from a future writer lease.")}
  }
  existing,err:=loadExistingLateEvidence(ctx,t,bearerAttemptID,prepared)
  if err!=nil {return err}
  frontiers,err:=loadEvidenceFrontiers(ctx,t,module.id)
  if err!=nil {return err}
  beforeRoute,beforeConflict:=false,false
  for question,frontier:=range frontiers {
   if !inModule[question] {return assessmentConflict("LATE_EVIDENCE_TOPOLOGY_INVALID","Evidence review topology does not match the pinned module.")}
   beforeRoute=beforeRoute || frontier.wouldChangeRoute
   beforeConflict=beforeConflict || frontier.conflict
  }
  for _,entry:=range prepared {
   if prior,ok:=existing[entry.answer.WriteID];ok {
    if prior!=entry.requestHash {return lateEvidenceIdentityConflict()}
    continue
   }
   entry.id=uuid.NewString()
   metadata,err:=json.Marshal(struct {
    OriginLeaseEpoch *int64 `json:"originLeaseEpoch"`
    ClientVersion *int64 `json:"clientVersion"`
    ClientReceivedAt *time.Time `json:"clientReceivedAt"`
   }{entry.answer.OriginLeaseEpoch,entry.answer.ClientVersion,entry.answer.ClientReceivedAt})
   if err!=nil {return err}
   if _,err:=t.ExecContext(ctx,`INSERT INTO assessment_late_answer_evidence (id, attempt_id, module_attempt_id, module_id, question_id, write_id, response, client_received_at, origin_lease_epoch, client_version, response_hash, request_hash, client_metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,entry.id,bearerAttemptID,module.id,module.moduleID,entry.answer.QuestionID,entry.answer.WriteID,string(entry.answer.Response),evidenceTimestampProjection(entry.answer.ClientReceivedAt),entry.answer.OriginLeaseEpoch,entry.answer.ClientVersion,entry.responseHash,entry.requestHash,string(metadata));err!=nil {return err}
   existing[entry.answer.WriteID]=entry.requestHash
   frontiers[entry.answer.QuestionID]=advanceEvidenceFrontier(frontiers[entry.answer.QuestionID],entry)
   recorded++
  }
  if recorded==0 {return nil}
  wouldChange,scoredRoute,evidenceRoute,err:=s.evidenceWouldChangeRouteTx(ctx,t,bearerAttemptID,module,scoring,frontiers)
  if err!=nil {return err}
  conflicted:=false
  for question,frontier:=range frontiers {
   frontier.wouldChangeRoute=frontier.wouldChangeRoute || wouldChange
   conflicted=conflicted || frontier.conflict
   frontiers[question]=frontier
   if err:=storeEvidenceFrontier(ctx,t,module.id,question,frontier);err!=nil {return err}
  }
  flipped=wouldChange
  payload,err:=json.Marshal(map[string]any{"moduleId":module.moduleID,"moduleAttemptId":module.id,"scoredRoute":scoredRoute,"evidenceRoute":evidenceRoute,"provenanceConflict":conflicted})
  if err!=nil {return err}
  audit:=func(action string) error {
   _,err:=t.ExecContext(ctx,"INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, target_student_id, payload, created_at) VALUES (?, ?, 'system', ?, ?, ?, UTC_TIMESTAMP(6))",uuid.NewString(),scheduleID,action,bearerAttemptID,string(payload));return err
  }
  if wouldChange && !beforeRoute {if err:=audit(lateEvidenceAuditAction);err!=nil {return err}}
  if conflicted && !beforeConflict {if err:=audit(lateEvidenceConflictAction);err!=nil {return err}}
  return nil
 })
 if err!=nil {return nil,err}
 if recorded>0 {telemetry.IncCounter(telemetry.MSATLateAnswerEvidenceTotal,"would_change_route",boolLabel(flipped))}
 return &LateEvidenceAck{Recorded:recorded},nil
}

// Only a strictly ordered known writer era/version can supersede another
// known piece of evidence. Conflicting/unknown order stays a review signal;
// timestamps never choose an answer, and canonical responses are unchanged.
func (s *Service) evidenceWouldChangeRouteTx(ctx context.Context,t tx.Tx,attemptID string,module saveActiveModule,scoring []scoringRow,frontiers map[string]evidenceFrontier) (bool,string,string,error) {
 var scoredRoute,policyConfig string
 err:=t.QueryRowContext(ctx,"SELECT selected_route, CAST(policy_config AS CHAR) FROM assessment_route_decisions WHERE attempt_id = ? AND base_module_attempt_id = ?",attemptID,module.id).Scan(&scoredRoute,&policyConfig)
 if err==sql.ErrNoRows {return false,"","",nil};if err!=nil {return false,"","",err}
 overlaid:=make([]scoringRow,len(scoring));copy(overlaid,scoring)
 for i:=range overlaid {
  frontier,ok:=frontiers[overlaid[i].examQuestionID]
  if !ok || frontier.conflict {continue}
  input,answered:=assessscore.V2ResponseToScorerInput(string(frontier.response))
  overlaid[i].response=sql.NullString{String:input,Valid:answered}
 }
 rawCorrect,operationalCount:=scoreScoringRows(overlaid)
 evidenceRoute,err:=chooseAdaptiveRoute(rawCorrect,operationalCount,policyConfig)
 if err!=nil {return false,"","",err}
 return evidenceRoute!=scoredRoute,scoredRoute,evidenceRoute,nil
}

func boolLabel(v bool) string {if v {return "true"};return "false"}
