package main

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/terminalization"
	"github.com/google/uuid"
)

// This is an HTTP + MySQL scenario: an immutable final frontier larger than
// one student request is registered once, uploaded in bounded V2 chunks, and
// routed only after every registered write is durable.
func TestSATFrozenFrontierUsesBoundedChunksAndSettlesOnceMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()
	schedule, attempt, base, low, high := seedStaleETagExam(t, db)
	for _, query := range []string{
		"UPDATE exam_session_runtimes SET timing_model = 'sat_personal_v1' WHERE schedule_id = ?",
		"UPDATE exam_schedules SET sat_timing_model = 'sat_personal_v1', sat_delivery_policy = CAST(? AS JSON) WHERE id = ?",
	} {
		args := []any{schedule}
		if strings.Contains(query, "sat_delivery_policy") {
			args = []any{`{"version":"sat_recovery_v1","recoverySeconds":120,"entryRecoverySeconds":120,"lateAnswerPolicy":"frozen_arrival_window"}`, schedule}
		}
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	var moduleAttempt string
	if err := db.QueryRowContext(ctx,
		"SELECT id FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?", attempt, base,
	).Scan(&moduleAttempt); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
		UPDATE assessment_module_attempts
		SET started_at = TIMESTAMPADD(SECOND, -allocated_seconds - extension_seconds - accumulated_paused_seconds - 1, UTC_TIMESTAMP(6))
		WHERE id = ?`, moduleAttempt); err != nil {
		t.Fatal(err)
	}
	rows, err := db.QueryContext(ctx,
		"SELECT id FROM assessment_exam_questions WHERE module_id = ? ORDER BY display_order LIMIT 3", base)
	if err != nil {
		t.Fatal(err)
	}
	var questions []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		questions = append(questions, id)
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	if len(questions) != 3 {
		t.Fatalf("fixture needs three SAT questions, got %d", len(questions))
	}
	bearer := boundaryBearer(t, db, schedule, attempt)
	closeID := uuid.NewString()
	largeAnswer := strings.Repeat("A", 60<<10)
	manifest := make([]map[string]any, 0, len(questions))
	commands := make([]attempts.ResponseCommand, 0, len(questions))
	for _, questionID := range questions {
		command := attempts.ResponseCommand{
			WriteID: uuid.NewString(), QuestionID: questionID, ClientVersion: 2,
			Response: attempts.ResponsePayload{Answer: []string{largeAnswer, largeAnswer}, EliminatedOptions: []string{}, Annotations: []attempts.Annotation{}},
		}
		hash, err := attempts.HashResponsePayload(command.Response)
		if err != nil {
			t.Fatal(err)
		}
		commands = append(commands, command)
		manifest = append(manifest, map[string]any{
			"questionId": questionID, "writeId": command.WriteID,
			"clientVersion": command.ClientVersion, "contentHash": hash,
		})
	}
	client := &http.Client{Timeout: 10 * time.Second}
	_, apiURL := startBoundaryAPI(t, false)
	closeIntentURL := apiURL + "/api/v1/assessment-delivery/schedules/" + schedule + "/modules/close-intent"
	tooManyAnswers := make([]map[string]any, 201)
	for i := range tooManyAnswers {
		tooManyAnswers[i] = map[string]any{
			"questionId": "oversized-frontier-" + uuid.NewString(), "writeId": uuid.NewString(),
			"clientVersion": 1, "contentHash": strings.Repeat("0", 64),
		}
	}
	tooManyRequest := map[string]any{
		"protocol": "sat_recovery_v1", "moduleId": base, "moduleAttemptId": moduleAttempt,
		"registrationId": uuid.NewString(), "leaseEpoch": 1, "controlEpoch": 1, "answers": tooManyAnswers,
	}
	if err := boundaryHTTP(client, http.MethodPost, closeIntentURL, bearer, tooManyRequest, nil); err == nil {
		t.Fatal("a frontier larger than one SAT module was accepted")
	}
	oversizedBodyRequest := map[string]any{
		"protocol": "sat_recovery_v1", "moduleId": base, "moduleAttemptId": moduleAttempt,
		"registrationId": uuid.NewString(), "leaseEpoch": 1, "controlEpoch": 1,
		"answers": []map[string]any{{
			"questionId": strings.Repeat("q", 257<<10), "writeId": uuid.NewString(),
			"clientVersion": 1, "contentHash": strings.Repeat("0", 64),
		}},
	}
	if err := boundaryHTTP(client, http.MethodPost, closeIntentURL, bearer, oversizedBodyRequest, nil); err == nil {
		t.Fatal("an oversized close-intent body was accepted")
	}
	var rejectedIntents int
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM assessment_module_close_intents WHERE module_attempt_id = ?", moduleAttempt,
	).Scan(&rejectedIntents); err != nil {
		t.Fatal(err)
	}
	if rejectedIntents != 0 {
		t.Fatalf("rejected registration mutated the frontier table: %d intents", rejectedIntents)
	}
	intentRequest := map[string]any{
		"protocol": "sat_recovery_v1", "moduleId": base, "moduleAttemptId": moduleAttempt,
		"registrationId": closeID, "leaseEpoch": 1, "controlEpoch": 1, "answers": manifest,
	}
	var registration struct {
		RegistrationID string `json:"registrationId"`
		ManifestHash   string `json:"manifestHash"`
		BoundaryPhase  string `json:"boundaryPhase"`
	}
	if err := boundaryHTTP(client, http.MethodPost, closeIntentURL, bearer, intentRequest, &registration); err != nil {
		t.Fatalf("register frozen frontier: %v", err)
	}
	if registration.RegistrationID != closeID || registration.ManifestHash == "" || registration.BoundaryPhase != "collecting" {
		t.Fatalf("unexpected frontier registration: %+v", registration)
	}
	// MySQL rejects legacy writers that try to create an already-active module
	// or terminalize the collecting module without settling its boundary.
	if _, err := db.ExecContext(ctx, `
		INSERT INTO assessment_module_attempts
			(id, attempt_id, module_id, state, allocated_seconds, started_at, tool_state, revision)
		VALUES (?, ?, ?, 'active', 3600, UTC_TIMESTAMP(6), '{}', 0)`,
		uuid.NewString(), attempt, low); err == nil || !strings.Contains(err.Error(), "chk_module_attempt_state") {
		t.Fatalf("active-row insert bypassed SAT recovery fence: %v", err)
	}
	if _, err := db.ExecContext(ctx,
		"UPDATE assessment_module_attempts SET state = 'locked' WHERE id = ? AND state = 'active'", moduleAttempt,
	); err == nil || !strings.Contains(err.Error(), "chk_module_attempt_state") {
		t.Fatalf("terminal transition bypassed SAT recovery fence: %v", err)
	}
	// An altered payload with a registered write identity must be rejected
	// before any response mutation is committed.
	changed := commands[0]
	changed.Response.Answer = "different"
	badChunk := map[string]any{
		"leaseEpoch": 1, "controlEpoch": 1,
		"moduleClose": map[string]any{"moduleAttemptId": moduleAttempt, "manifestHash": registration.ManifestHash},
		"commands":    []attempts.ResponseCommand{changed},
	}
	if err := boundaryHTTP(client, http.MethodPost,
		apiURL+"/api/v2/student/attempts/"+attempt+"/responses:batch", bearer, badChunk, nil); err == nil {
		t.Fatal("a chunk with content different from the registered frontier was accepted")
	}
	foreignCommand := attempts.ResponseCommand{
		WriteID: uuid.NewString(), QuestionID: "outside-frontier-" + uuid.NewString(), ClientVersion: 1,
		Response: attempts.ResponsePayload{Answer: "A", EliminatedOptions: []string{}, Annotations: []attempts.Annotation{}},
	}
	foreignChunk := map[string]any{
		"leaseEpoch": 1, "controlEpoch": 1,
		"moduleClose": map[string]any{"moduleAttemptId": moduleAttempt, "manifestHash": registration.ManifestHash},
		"commands":    []attempts.ResponseCommand{foreignCommand},
	}
	if err := boundaryHTTP(client, http.MethodPost,
		apiURL+"/api/v2/student/attempts/"+attempt+"/responses:batch", bearer, foreignChunk, nil); err == nil {
		t.Fatal("a registered frontier accepted an extra question")
	}
	var foreignMutations int
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM attempt_mutations_v2 WHERE attempt_id = ? AND client_write_id = ?",
		attempt, foreignCommand.WriteID,
	).Scan(&foreignMutations); err != nil {
		t.Fatal(err)
	}
	if foreignMutations != 0 {
		t.Fatalf("out-of-frontier command mutated the response ledger: %d rows", foreignMutations)
	}
	for start := 0; start < len(commands); start++ {
		end := start + 1
		if end > len(commands) {
			end = len(commands)
		}
		chunk := map[string]any{
			"leaseEpoch": 1, "controlEpoch": 1,
			"moduleClose": map[string]any{"moduleAttemptId": moduleAttempt, "manifestHash": registration.ManifestHash},
			"commands":    commands[start:end],
		}
		if err := boundaryHTTP(client, http.MethodPost,
			apiURL+"/api/v2/student/attempts/"+attempt+"/responses:batch", bearer, chunk, nil); err != nil {
			t.Fatalf("upload chunk %d: %v", start+1, err)
		}
	}
	closeRequest := map[string]any{
		"protocol": "sat_recovery_v1", "moduleId": base, "moduleAttemptId": moduleAttempt,
		"closeId": closeID, "leaseEpoch": 1, "controlEpoch": 1,
		"answers": manifest, "finalCommands": []attempts.ResponseCommand{},
	}
	var ack delivery.SatModuleCloseAck
	closeURL := apiURL + "/api/v1/assessment-delivery/schedules/" + schedule + "/modules/close"
	if _, err := db.ExecContext(ctx, "UPDATE student_attempts SET control_epoch = control_epoch + 1 WHERE id = ?", attempt); err != nil {
		t.Fatal(err)
	}
	if err := boundaryHTTP(client, http.MethodPost, closeURL, bearer, closeRequest, nil); err == nil || !strings.Contains(err.Error(), "CONTROL_EPOCH_STALE") {
		t.Fatalf("close with a stale control epoch = %v; want CONTROL_EPOCH_STALE", err)
	}
	var moduleState, boundaryPhase string
	if err := db.QueryRowContext(ctx, `SELECT ma.state, b.phase
		FROM assessment_module_attempts ma
		JOIN assessment_module_boundaries b ON b.module_attempt_id = ma.id
		WHERE ma.id = ?`, moduleAttempt).Scan(&moduleState, &boundaryPhase); err != nil {
		t.Fatal(err)
	}
	if moduleState != "active" || boundaryPhase != "collecting" {
		t.Fatalf("stale close mutated the module boundary: state=%s phase=%s", moduleState, boundaryPhase)
	}
	if _, err := db.ExecContext(ctx, "UPDATE student_attempts SET control_epoch = 1 WHERE id = ?", attempt); err != nil {
		t.Fatal(err)
	}
	if err := boundaryHTTP(client, http.MethodPost, closeURL, bearer, closeRequest, &ack); err != nil {
		t.Fatalf("settle registered frontier: %v", err)
	}
	if !ack.Closed || ack.NextModuleID == nil || (*ack.NextModuleID != low && *ack.NextModuleID != high) {
		t.Fatalf("unexpected close outcome: %+v", ack)
	}
	var responseCount, routeCount, receiptCount int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM attempt_mutations_v2 WHERE attempt_id = ? AND client_write_id IN (?, ?, ?)",
		attempt, commands[0].WriteID, commands[1].WriteID, commands[2].WriteID,
	).Scan(&responseCount); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_route_decisions WHERE attempt_id = ? AND base_module_id = ?", attempt, base).Scan(&routeCount); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_lifecycle_receipts WHERE attempt_id = ? AND operation_id = ?", attempt, closeID).Scan(&receiptCount); err != nil {
		t.Fatal(err)
	}
	var phase string
	if err := db.QueryRowContext(ctx, "SELECT phase FROM assessment_module_boundaries WHERE module_attempt_id = ?", moduleAttempt).Scan(&phase); err != nil {
		t.Fatal(err)
	}
	if responseCount != len(commands) || routeCount != 1 || receiptCount != 1 || phase != "settled" {
		t.Fatalf("frontier did not settle once: responses=%d routes=%d receipts=%d phase=%s", responseCount, routeCount, receiptCount, phase)
	}
	var replay delivery.SatModuleCloseAck
	if err := boundaryHTTP(client, http.MethodPost, closeURL, bearer, closeRequest, &replay); err != nil {
		t.Fatalf("replay settled close: %v", err)
	}
	if replay.NextModuleID == nil || *replay.NextModuleID != *ack.NextModuleID {
		t.Fatalf("close replay changed the route: first=%+v replay=%+v", ack, replay)
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM attempt_mutations_v2 WHERE attempt_id = ? AND client_write_id IN (?, ?, ?)",
		attempt, commands[0].WriteID, commands[1].WriteID, commands[2].WriteID,
	).Scan(&responseCount); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_route_decisions WHERE attempt_id = ? AND base_module_id = ?", attempt, base).Scan(&routeCount); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_lifecycle_receipts WHERE attempt_id = ? AND operation_id = ?", attempt, closeID).Scan(&receiptCount); err != nil {
		t.Fatal(err)
	}
	if responseCount != len(commands) || routeCount != 1 || receiptCount != 1 {
		t.Fatalf("close replay duplicated durable work: responses=%d routes=%d receipts=%d", responseCount, routeCount, receiptCount)
	}
	var entry delivery.SatModuleEntryAck
	if err := boundaryHTTP(client, http.MethodPost,
		apiURL+"/api/v1/assessment-delivery/schedules/"+schedule+"/modules/start", bearer,
		map[string]any{"moduleId": *ack.NextModuleID, "controlEpoch": ack.ControlEpoch}, &entry); err != nil {
		t.Fatalf("activate routed module through its working boundary: %v", err)
	}
	if entry.State != "active" {
		t.Fatalf("routed module did not activate: %+v", entry)
	}
	if err := db.QueryRowContext(ctx,
		"SELECT phase FROM assessment_module_boundaries WHERE module_attempt_id = ?", entry.ModuleAttemptID,
	).Scan(&phase); err != nil {
		t.Fatal(err)
	}
	if phase != "working" {
		t.Fatalf("activation did not establish a working boundary: %s", phase)
	}
	actorID := "sat-policy-fence-test"
	terminalizer := terminalization.NewService(tx.NewRunner(db), terminalization.SQLTerminalizationRepository{}, terminalization.SQLOutboxEnqueuer{})
	terminated, err := terminalizer.Terminalize(ctx, terminalization.SealCommand{
		AttemptID: attempt, ScheduleID: schedule, Outcome: terminalization.OutcomeTerminated,
		Reason: terminalization.ReasonProctorTerminate, ActorKind: terminalization.ActorProctor,
		ActorID: &actorID, RequestID: uuid.NewString(),
	})
	if err != nil {
		t.Fatalf("terminate a recovery-policy attempt: %v", err)
	}
	if terminated == nil || !terminated.Created {
		t.Fatalf("expected one terminal receipt, got %+v", terminated)
	}
	var terminalState string
	if err := db.QueryRowContext(ctx,
		"SELECT m.state, b.phase FROM assessment_module_attempts m JOIN assessment_module_boundaries b ON b.module_attempt_id = m.id WHERE m.id = ?",
		entry.ModuleAttemptID,
	).Scan(&terminalState, &phase); err != nil {
		t.Fatal(err)
	}
	if terminalState != "locked" || phase != "ended" {
		t.Fatalf("terminalization did not persist an authorizing ended boundary: state=%s phase=%s", terminalState, phase)
	}
}
