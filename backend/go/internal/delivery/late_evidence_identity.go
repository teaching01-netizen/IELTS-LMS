package delivery

import (
 "bytes"
 "context"
 "crypto/sha256"
 "database/sql"
 "encoding/hex"
 "encoding/json"
 "strings"
 "time"

 "example.com/ielts-proctoring/internal/attempts"
 "example.com/ielts-proctoring/internal/platform/apperrors"
 "example.com/ielts-proctoring/internal/platform/tx"
)

type preparedEvidence struct {
 id string
 answer LateEvidenceAnswer
 responseHash,requestHash string
}

type evidenceFrontier struct {
 id string
 lease,version *int64
 hash,unknownHash string
 response json.RawMessage
 conflict,wouldChangeRoute bool
}

func lateEvidenceIdentityConflict() error {
 return &apperrors.Error{Code:apperrors.CodeWriteIDConflict,HTTPStatus:409,Message:"A late-evidence write id was reused with different immutable content.",Details:map[string]any{"reason":"LATE_EVIDENCE_WRITE_ID_CONFLICT","retryable":false}}
}

func canonicalEvidenceResponse(raw json.RawMessage) (json.RawMessage,string,error) {
 if !json.Valid(raw) {return nil,"",apperrors.New(apperrors.CodeValidation,"Evidence response must be valid JSON.")}
 decoder:=json.NewDecoder(bytes.NewReader(raw));decoder.UseNumber()
 var value any
 if err:=decoder.Decode(&value);err!=nil {return nil,"",err}
 canonical,err:=attempts.CanonicalJSON(value)
 if err!=nil {return nil,"",err}
 sum:=sha256.Sum256(canonical)
 return canonical,hex.EncodeToString(sum[:]),nil
}

func evidenceRequestHash(moduleID string,answer LateEvidenceAnswer) (string,error) {
 return attempts.HashResponse(struct {
  ModuleID string `json:"moduleId"`
  Answer LateEvidenceAnswer `json:"answer"`
 }{moduleID,answer})
}

func prepareLateEvidence(req LateEvidenceRequest) ([]preparedEvidence,error) {
 if strings.TrimSpace(req.ModuleID)=="" || len(req.Answers)==0 || len(req.Answers)>maxCloseManifest {return nil,apperrors.New(apperrors.CodeValidation,"moduleId and a bounded non-empty evidence batch are required.")}
 prepared:=make([]preparedEvidence,0,len(req.Answers))
 seen:=make(map[string]string,len(req.Answers))
 for _,answer:=range req.Answers {
  if strings.TrimSpace(answer.QuestionID)=="" || strings.TrimSpace(answer.WriteID)=="" || len(answer.WriteID)>64 {return nil,apperrors.New(apperrors.CodeValidation,"Each evidence answer needs a question id and a write id of at most 64 bytes.")}
  if (answer.OriginLeaseEpoch!=nil && *answer.OriginLeaseEpoch<=0) || (answer.ClientVersion!=nil && *answer.ClientVersion<=0) {return nil,apperrors.New(apperrors.CodeValidation,"Declared evidence lease and version must be positive; unknown values must be null.")}
  if answer.ClientReceivedAt!=nil {utc:=answer.ClientReceivedAt.UTC();answer.ClientReceivedAt=&utc}
  canonical,responseHash,err:=canonicalEvidenceResponse(answer.Response)
  if err!=nil {return nil,err}
  answer.Response=canonical
  requestHash,err:=evidenceRequestHash(req.ModuleID,answer)
  if err!=nil {return nil,err}
  if old,ok:=seen[answer.WriteID];ok {if old!=requestHash {return nil,lateEvidenceIdentityConflict()};continue}
  seen[answer.WriteID]=requestHash
  prepared=append(prepared,preparedEvidence{answer:answer,responseHash:responseHash,requestHash:requestHash})
 }
 return prepared,nil
}

// The exact declaration is in client_metadata and the request hash. This
// nullable timestamp is only a display projection, not an ordering authority.
func evidenceTimestampProjection(at *time.Time) *time.Time {
 if at==nil || at.Before(time.Unix(1,0)) || at.After(time.Unix(2147483647,0)) {return nil}
 projected:=at.UTC().Truncate(time.Microsecond);return &projected
}

func nullableEvidenceCounter(value sql.NullInt64) *int64 {if !value.Valid {return nil};n:=value.Int64;return &n}

func loadExistingLateEvidence(ctx context.Context,q tx.Tx,attemptID string,prepared []preparedEvidence) (map[string]string,error) {
 args:=make([]any,1,len(prepared)+1);args[0]=attemptID
 placeholders:=make([]string,len(prepared))
 for i,entry:=range prepared {args=append(args,entry.answer.WriteID);placeholders[i]="?"}
 rows,err:=q.QueryContext(ctx,`SELECT module_id, question_id, write_id, CAST(response AS CHAR), origin_lease_epoch, client_version, client_received_at, request_hash, CAST(client_metadata AS CHAR) FROM assessment_late_answer_evidence WHERE attempt_id = ? AND write_id IN (`+strings.Join(placeholders,",")+`)`,args...)
 if err!=nil {return nil,err};defer rows.Close()
 existing:=make(map[string]string,len(prepared))
 for rows.Next() {
  var moduleID string
  var answer LateEvidenceAnswer
  var response string
  var lease,version sql.NullInt64
  var at sql.NullTime
  var hash,metadata sql.NullString
  if err:=rows.Scan(&moduleID,&answer.QuestionID,&answer.WriteID,&response,&lease,&version,&at,&hash,&metadata);err!=nil {return nil,err}
  if hash.Valid {existing[answer.WriteID]=hash.String;continue}
  // Only historical rows lack a request hash. Reconstruct what is actually
  // stored, preserving unknown provenance rather than assigning a new era.
  answer.OriginLeaseEpoch=nullableEvidenceCounter(lease);answer.ClientVersion=nullableEvidenceCounter(version)
  if at.Valid {utc:=at.Time.UTC();answer.ClientReceivedAt=&utc}
  if metadata.Valid {
   var declared struct {ClientReceivedAt *time.Time `json:"clientReceivedAt"`}
   if err:=json.Unmarshal([]byte(metadata.String),&declared);err!=nil {return nil,err}
   answer.ClientReceivedAt=declared.ClientReceivedAt
  }
  canonical,_,err:=canonicalEvidenceResponse(json.RawMessage(response));if err!=nil {return nil,err}
  answer.Response=canonical
  reconstructed,err:=evidenceRequestHash(moduleID,answer);if err!=nil {return nil,err}
  existing[answer.WriteID]=reconstructed
 }
 return existing,rows.Err()
}

func loadEvidenceFrontiers(ctx context.Context,q tx.Tx,moduleAttemptID string) (map[string]evidenceFrontier,error) {
 rows,err:=q.QueryContext(ctx,`SELECT f.question_id, f.latest_evidence_id, f.origin_lease_epoch, f.client_version, f.response_hash, f.unknown_response_hash, f.provenance_conflict, f.would_change_route, CAST(e.response AS CHAR), e.module_attempt_id, e.question_id, e.origin_lease_epoch, e.client_version FROM assessment_late_evidence_frontiers f JOIN assessment_late_answer_evidence e ON e.id = f.latest_evidence_id WHERE f.module_attempt_id = ?`,moduleAttemptID)
 if err!=nil {return nil,err};defer rows.Close()
 frontiers:=make(map[string]evidenceFrontier)
 for rows.Next() {
  var question,response,sourceModule,sourceQuestion string
  var frontier evidenceFrontier
  var lease,version,sourceLease,sourceVersion sql.NullInt64
  var hash,unknownHash sql.NullString
  if err:=rows.Scan(&question,&frontier.id,&lease,&version,&hash,&unknownHash,&frontier.conflict,&frontier.wouldChangeRoute,&response,&sourceModule,&sourceQuestion,&sourceLease,&sourceVersion);err!=nil {return nil,err}
  if sourceModule!=moduleAttemptID || sourceQuestion!=question || lease!=sourceLease || version!=sourceVersion {
   return nil,assessmentConflict("LATE_EVIDENCE_FRONTIER_INVALID","Evidence review frontier does not match its immutable source.")
  }
  if (lease.Valid && lease.Int64<=0) || (version.Valid && version.Int64<=0) {
   return nil,assessmentConflict("LATE_EVIDENCE_PROVENANCE_INVALID","Stored evidence provenance is invalid.")
  }
  frontier.lease=nullableEvidenceCounter(lease);frontier.version=nullableEvidenceCounter(version)
  canonical,actualHash,err:=canonicalEvidenceResponse(json.RawMessage(response));if err!=nil {return nil,err}
  if hash.Valid && hash.String!=actualHash {return nil,assessmentConflict("LATE_EVIDENCE_HASH_MISMATCH","Stored evidence does not match its immutable response hash.")}
  frontier.hash=actualHash;frontier.response=canonical
  if unknownHash.Valid {frontier.unknownHash=unknownHash.String}
  if (frontier.lease==nil || frontier.version==nil) && frontier.unknownHash=="" {frontier.unknownHash=actualHash}
  frontiers[question]=frontier
 }
 return frontiers,rows.Err()
}

func advanceEvidenceFrontier(old evidenceFrontier,entry preparedEvidence) evidenceFrontier {
 answer:=entry.answer
 if old.id=="" {
  next:=evidenceFrontier{id:entry.id,lease:answer.OriginLeaseEpoch,version:answer.ClientVersion,hash:entry.responseHash,response:answer.Response}
  if answer.OriginLeaseEpoch==nil || answer.ClientVersion==nil {next.unknownHash=entry.responseHash}
  return next
 }
 if answer.OriginLeaseEpoch==nil || answer.ClientVersion==nil {
  if old.unknownHash=="" {old.unknownHash=entry.responseHash}
  if old.unknownHash!=entry.responseHash || old.hash!=entry.responseHash {old.conflict=true}
  return old
 }
 if old.unknownHash!="" && old.unknownHash!=entry.responseHash {old.conflict=true}
 known:=old.lease!=nil && old.version!=nil
 newer:=!known || *answer.OriginLeaseEpoch>*old.lease || (*answer.OriginLeaseEpoch==*old.lease && *answer.ClientVersion>*old.version)
 equal:=known && *answer.OriginLeaseEpoch==*old.lease && *answer.ClientVersion==*old.version
 if equal && old.hash!=entry.responseHash {old.conflict=true}
 if newer {old.id=entry.id;old.lease=answer.OriginLeaseEpoch;old.version=answer.ClientVersion;old.hash=entry.responseHash;old.response=answer.Response}
 return old
}

func storeEvidenceFrontier(ctx context.Context,q tx.Tx,moduleAttemptID,questionID string,frontier evidenceFrontier) error {
 _,err:=q.ExecContext(ctx,`INSERT INTO assessment_late_evidence_frontiers (module_attempt_id, question_id, latest_evidence_id, origin_lease_epoch, client_version, response_hash, unknown_response_hash, provenance_conflict, would_change_route) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE latest_evidence_id = VALUES(latest_evidence_id), origin_lease_epoch = VALUES(origin_lease_epoch), client_version = VALUES(client_version), response_hash = VALUES(response_hash), unknown_response_hash = VALUES(unknown_response_hash), provenance_conflict = VALUES(provenance_conflict), would_change_route = VALUES(would_change_route)`,moduleAttemptID,questionID,frontier.id,frontier.lease,frontier.version,frontier.hash,nullableEvidenceHash(frontier.unknownHash),frontier.conflict,frontier.wouldChangeRoute)
 return err
}

func nullableEvidenceHash(hash string) any {if hash=="" {return nil};return hash}
