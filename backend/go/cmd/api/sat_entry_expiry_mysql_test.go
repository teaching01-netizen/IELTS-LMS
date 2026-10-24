package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"github.com/google/uuid"
)

func TestSATNextModuleEntryAfterEligibilityWindowExpiresAndRevocationIsFencedMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	scheduleID, attemptID, baseModuleID, _, nextModuleID := seedStaleETagExam(t, db)
	policy := `{"version":"sat_recovery_v1","recoverySeconds":120,"entryRecoverySeconds":120,"lateAnswerPolicy":"frozen_arrival_window"}`
	if _, err := db.Exec(`UPDATE exam_schedules
		SET sat_timing_model = 'sat_personal_v1', sat_delivery_policy = CAST(? AS JSON)
		WHERE id = ?`, policy, scheduleID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE exam_session_runtimes SET timing_model = 'sat_personal_v1' WHERE schedule_id = ?`, scheduleID); err != nil {
		t.Fatal(err)
	}

	var baseAttemptID, sectionID string
	if err := db.QueryRow(`SELECT ma.id, m.section_id
		FROM assessment_module_attempts ma
		JOIN assessment_modules m ON m.id = ma.module_id
		WHERE ma.attempt_id = ? AND ma.module_id = ?`, attemptID, baseModuleID).Scan(&baseAttemptID, &sectionID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO assessment_module_boundaries
		(module_attempt_id, attempt_id, phase, policy_version)
		VALUES (?, ?, 'settled', 'sat_recovery_v1')`, baseAttemptID, attemptID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE assessment_module_attempts SET state = 'locked' WHERE id = ?`, baseAttemptID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO assessment_route_decisions
		(id, attempt_id, section_id, base_module_attempt_id, base_module_id,
		 selected_module_id, selected_route, raw_correct, operational_question_count,
		 policy_key, policy_revision, policy_config, route_basis, late_answer_count)
		VALUES (?, ?, ?, ?, ?, ?, 'higher', 3, 3, 'threshold', 1,
		 CAST('{"minimumCorrectForHigher":2}' AS JSON), 'client_confirmed', 0)`,
		uuid.NewString(), attemptID, sectionID, baseAttemptID, baseModuleID, nextModuleID); err != nil {
		t.Fatal(err)
	}
	nextAttemptID := uuid.NewString()
	if _, err := db.Exec(`INSERT INTO assessment_module_attempts
		(id, attempt_id, module_id, state, allocated_seconds, available_at, started_at, tool_state, revision)
		VALUES (?, ?, ?, 'not_started', 3600, UTC_TIMESTAMP(6) - INTERVAL 121 SECOND, NULL, '{}', 1)`,
		nextAttemptID, attemptID, nextModuleID); err != nil {
		t.Fatal(err)
	}

	bearer := boundaryBearer(t, db, scheduleID, attemptID)
	_, apiURL := startBoundaryAPI(t, false)
	requestBody, err := json.Marshal(map[string]any{
		"moduleId":     nextModuleID,
		"controlEpoch": 1,
		"needContent":  false,
	})
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	postStart := func() (*http.Response, error) {
		request, err := http.NewRequest(http.MethodPost,
			apiURL+"/api/v1/assessment-delivery/schedules/"+scheduleID+"/modules/start",
			bytes.NewReader(requestBody))
		if err != nil {
			return nil, err
		}
		request.Header.Set("Authorization", "Bearer "+bearer)
		request.Header.Set("Content-Type", "application/json")
		return client.Do(request)
	}
	for replay := 0; replay < 2; replay++ {
		response, err := postStart()
		if err != nil {
			t.Fatal(err)
		}
		var envelope struct {
			Code    string         `json:"code"`
			Details map[string]any `json:"details"`
		}
		decodeErr := json.NewDecoder(response.Body).Decode(&envelope)
		_ = response.Body.Close()
		if decodeErr != nil {
			t.Fatalf("decode entry response: %v", decodeErr)
		}
		if response.StatusCode != http.StatusConflict || envelope.Code != string(apperrors.CodeAssessmentConflict) || envelope.Details["reason"] != "SAT_ENTRY_WINDOW_EXPIRED" {
			t.Fatalf("expired entry response = HTTP %d %+v; want stable SAT_ENTRY_WINDOW_EXPIRED conflict", response.StatusCode, envelope)
		}
	}
	var tokenID string
	if err := db.QueryRow(`SELECT token_id FROM attempt_sessions WHERE attempt_id = ? AND revoked_at IS NULL`, attemptID).Scan(&tokenID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE attempt_sessions SET lease_epoch = 1 WHERE token_id = ?`, tokenID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE student_attempts SET lease_epoch = 2 WHERE id = ?`, attemptID); err != nil {
		t.Fatal(err)
	}
	staleLeaseResponse, err := postStart()
	if err != nil {
		t.Fatal(err)
	}
	var staleLeaseEnvelope struct {
		Code string `json:"code"`
	}
	decodeErr := json.NewDecoder(staleLeaseResponse.Body).Decode(&staleLeaseEnvelope)
	_ = staleLeaseResponse.Body.Close()
	if decodeErr != nil {
		t.Fatalf("decode stale-lease entry response: %v", decodeErr)
	}
	if staleLeaseResponse.StatusCode != http.StatusUnauthorized || staleLeaseEnvelope.Code != string(apperrors.CodeAttemptTokenInvalid) {
		t.Fatalf("stale-lease response = HTTP %d %+v; want 401 ATTEMPT_TOKEN_INVALID", staleLeaseResponse.StatusCode, staleLeaseEnvelope)
	}
	if _, err := db.Exec(`UPDATE student_attempts SET lease_epoch = 1 WHERE id = ?`, attemptID); err != nil {
		t.Fatal(err)
	}
	assertAttemptSessionShareLockBlocksRevocation(t, db, attemptID)
	revokedResponse, err := postStart()
	if err != nil {
		t.Fatal(err)
	}
	var revokedEnvelope struct {
		Code string `json:"code"`
	}
	decodeErr = json.NewDecoder(revokedResponse.Body).Decode(&revokedEnvelope)
	_ = revokedResponse.Body.Close()
	if decodeErr != nil {
		t.Fatalf("decode revoked entry response: %v", decodeErr)
	}
	if revokedResponse.StatusCode != http.StatusUnauthorized || revokedEnvelope.Code != string(apperrors.CodeAttemptTokenInvalid) {
		t.Fatalf("revoked token response = HTTP %d %+v; want 401 ATTEMPT_TOKEN_INVALID", revokedResponse.StatusCode, revokedEnvelope)
	}

	var state string
	var startedAt sql.NullTime
	if err := db.QueryRow(`SELECT state, started_at FROM assessment_module_attempts WHERE id = ?`, nextAttemptID).Scan(&state, &startedAt); err != nil {
		t.Fatal(err)
	}
	if state != "not_started" || startedAt.Valid {
		t.Fatalf("expired entry started the module: state=%q startedAt=%v", state, startedAt)
	}
	var phase string
	var entryDeadline time.Time
	if err := db.QueryRow(`SELECT phase, entry_deadline_at FROM assessment_module_boundaries WHERE module_attempt_id = ?`, nextAttemptID).Scan(&phase, &entryDeadline); err != nil {
		t.Fatal(err)
	}
	if phase != "blocked" || !entryDeadline.Before(time.Now().UTC()) {
		t.Fatalf("expired entry boundary phase=%q deadline=%s; want blocked with expired cutoff", phase, entryDeadline.UTC())
	}
}

// The mutation fence must hold a shared lock through commit: an overlapping
// revocation waits, so it cannot slip between token validation and the write.
func assertAttemptSessionShareLockBlocksRevocation(t *testing.T, db *sql.DB, attemptID string) {
	t.Helper()
	var tokenID string
	if err := db.QueryRow(`SELECT token_id FROM attempt_sessions WHERE attempt_id = ? AND revoked_at IS NULL`, attemptID).Scan(&tokenID); err != nil {
		t.Fatal(err)
	}

	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	var scheduleID, lockedAttemptID, clientSessionID string
	var expiresAt time.Time
	var sessionLease sql.NullInt64
	if err := tx.QueryRowContext(context.Background(), `
		SELECT schedule_id, attempt_id, client_session_id, expires_at, lease_epoch
		FROM attempt_sessions
		WHERE token_id = ? AND revoked_at IS NULL
		FOR SHARE`, tokenID).Scan(&scheduleID, &lockedAttemptID, &clientSessionID, &expiresAt, &sessionLease); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if scheduleID == "" || lockedAttemptID != attemptID || clientSessionID == "" || !expiresAt.After(time.Now().UTC()) {
		_ = tx.Rollback()
		t.Fatalf("writer token row is not live and bound: schedule=%q attempt=%q session=%q expires=%s", scheduleID, lockedAttemptID, clientSessionID, expiresAt.UTC())
	}

	revocationDone := make(chan error, 1)
	go func() {
		result, err := db.ExecContext(context.Background(), `
			UPDATE attempt_sessions SET revoked_at = UTC_TIMESTAMP(6)
			WHERE token_id = ? AND revoked_at IS NULL`, tokenID)
		if err != nil {
			revocationDone <- err
			return
		}
		if affected, err := result.RowsAffected(); err != nil {
			revocationDone <- err
		} else if affected != 1 {
			revocationDone <- sql.ErrNoRows
		} else {
			revocationDone <- nil
		}
	}()

	select {
	case err := <-revocationDone:
		_ = tx.Rollback()
		t.Fatalf("revocation completed while the writer transaction held FOR SHARE: %v", err)
	case <-time.After(150 * time.Millisecond):
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-revocationDone:
		if err != nil {
			t.Fatalf("revocation did not complete after writer commit: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("revocation did not unblock after writer commit")
	}
}
