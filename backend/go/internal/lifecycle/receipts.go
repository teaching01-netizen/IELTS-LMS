// Package lifecycle owns durable, hash-bound lifecycle operation receipts.
package lifecycle

import (
 "context"
 "crypto/sha256"
 "database/sql"
 "encoding/hex"
 "encoding/json"
 "strings"

 "example.com/ielts-proctoring/internal/platform/apperrors"
 "example.com/ielts-proctoring/internal/platform/tx"
)

type Scope struct { ScheduleID, AttemptID string }
func (scope Scope) key()(string,string){if scope.AttemptID!="" {return "attempt",scope.AttemptID};return "schedule",scope.ScheduleID}

func Hash(kind string,payload any)(string,error){
 bytes,err:=json.Marshal(struct{Kind string `json:"kind"`;Payload any `json:"payload"`}{kind,payload});if err!=nil{return "",err}
 digest:=sha256.Sum256(bytes);return hex.EncodeToString(digest[:]),nil
}

// Load requires the caller's owning attempt/schedule lock. A receipt is replayed
// before rechecking changed clocks or stage state, but never before authorization.
func Load(ctx context.Context,q tx.Tx,scope Scope,operationID,kind,hash string)(json.RawMessage,error){
 if strings.TrimSpace(operationID)=="" || len(operationID)>64 {return nil,&apperrors.Error{Code:apperrors.CodeValidation,HTTPStatus:422,Message:"operationId is required and must be at most 64 bytes."}}
 scopeKind,scopeID:=scope.key();var storedKind,storedHash string;var result []byte
 err:=q.QueryRowContext(ctx,"SELECT operation_kind, request_hash, result FROM assessment_lifecycle_receipts WHERE scope_kind = ? AND scope_id = ? AND operation_id = ?",scopeKind,scopeID,operationID).Scan(&storedKind,&storedHash,&result)
 if err==sql.ErrNoRows{return nil,nil};if err!=nil{return nil,err}
 if storedKind!=kind || storedHash!=hash{return nil,&apperrors.Error{Code:apperrors.CodeWriteIDConflict,HTTPStatus:409,Message:"Operation ID was already committed with different content.",Details:map[string]any{"operationId":operationID,"reason":"OPERATION_ID_CONFLICT"}}}
 return json.RawMessage(result),nil
}

func Store(ctx context.Context,q tx.Tx,scope Scope,operationID,kind,hash string,result any)error{
 payload,err:=json.Marshal(result);if err!=nil{return err};scopeKind,scopeID:=scope.key()
 var attempt any;if scope.AttemptID!="" {attempt=scope.AttemptID}
 _,err=q.ExecContext(ctx,"INSERT INTO assessment_lifecycle_receipts (scope_kind, scope_id, operation_id, schedule_id, attempt_id, operation_kind, request_hash, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",scopeKind,scopeID,operationID,scope.ScheduleID,attempt,kind,hash,string(payload))
 return err
}
