package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// FR7: retained drafts become immutable evidence under a live exam credential
// without touching the answer set; staff classify each item exactly once; a
// revoked credential cannot add evidence.
func TestDraftEvidenceIsImmutableUnscoredAndReviewedOnceMySQL(t *testing.T) {
	f, _ := readyContinuityIELTS(t)
	c := f.candidates[0]
	question := f.questions["reading"][0]
	t.Cleanup(func() { _, _ = f.db.Exec(`DELETE FROM attempt_draft_evidence WHERE attempt_id = ?`, c.AttemptID) })
	app := continuityApp(f)
	router := BuildRouter(app)
	send := func(token string, items ...attempts.DraftEvidenceItem) *httptest.ResponseRecorder {
		t.Helper()
		raw, err := json.Marshal(map[string]any{"items": items})
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPost, "/api/v2/student/attempts/"+c.AttemptID+"/draft-evidence", bytes.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	lease := uint64(1)
	claimed := time.Date(2026, 10, 30, 1, 2, 3, 0, time.UTC)
	item := attempts.DraftEvidenceItem{WriteID: "evidence-" + uuid.NewString(), QuestionID: question, ClientVersion: 3,
		Response: attempts.ResponsePayload{Answer: "late-draft"}, OriginLeaseEpoch: &lease, ClaimedClientAt: &claimed, Reason: "SECTION_NOT_ACTIVE"}

	var ack attempts.DraftEvidenceAck
	if rec := send(c.Token, item); rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &ack) != nil || ack.Recorded != 1 {
		t.Fatalf("record evidence: %d %s", rec.Code, rec.Body.String())
	}
	if rec := send(c.Token, item); rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &ack) != nil || ack.Recorded != 0 || ack.Replayed != 1 {
		t.Fatalf("exact replay: %d %s", rec.Code, rec.Body.String())
	}
	changed := item
	changed.Response = attempts.ResponsePayload{Answer: "different"}
	if rec := send(c.Token, changed); rec.Code != http.StatusConflict {
		t.Fatalf("same write id with different content: %d %s", rec.Code, rec.Body.String())
	}
	future := uint64(9)
	ahead := item
	ahead.WriteID, ahead.OriginLeaseEpoch = "evidence-"+uuid.NewString(), &future
	if rec := send(c.Token, ahead); rec.Code < 400 || rec.Code >= 500 {
		t.Fatalf("future lease accepted: %d %s", rec.Code, rec.Body.String())
	}

	var answered int
	if err := f.db.QueryRow(`SELECT COUNT(*) FROM attempt_responses_v2 WHERE attempt_id = ? AND question_id = ?`, c.AttemptID, question).Scan(&answered); err != nil {
		t.Fatal(err)
	}
	if answered != 0 {
		t.Fatalf("evidence changed the answer set: %d rows", answered)
	}
	evidence, err := app.Attempts.ListDraftEvidence(context.Background(), c.ScheduleID, c.AttemptID)
	if err != nil || len(evidence) != 1 {
		t.Fatalf("list: %+v %v", evidence, err)
	}
	e := evidence[0]
	if e.Response.Answer != "late-draft" || e.ClaimedClientAt == nil || !e.ClaimedClientAt.Equal(claimed) || e.OriginLeaseEpoch == nil || *e.OriginLeaseEpoch != 1 || e.Disposition != attempts.DispositionPending {
		t.Fatalf("provenance not preserved: %+v", e)
	}

	reviewer := c.UserID
	if err := app.Attempts.ReviewDraftEvidence(context.Background(), c.ScheduleID, c.AttemptID, e.ID, reviewer, attempts.DispositionRelevant, "seen"); err != nil {
		t.Fatal(err)
	}
	if err := app.Attempts.ReviewDraftEvidence(context.Background(), c.ScheduleID, c.AttemptID, e.ID, reviewer, attempts.DispositionRelevant, "retry"); err != nil {
		t.Fatalf("exact review retry: %v", err)
	}
	err = app.Attempts.ReviewDraftEvidence(context.Background(), c.ScheduleID, c.AttemptID, e.ID, reviewer, attempts.DispositionNotRelevant, "")
	if known, ok := apperrors.As(err); !ok || known.Code != apperrors.CodeConflict {
		t.Fatalf("review decision overwritten: %v", err)
	}

	if _, err := f.db.Exec(`UPDATE attempt_sessions SET revoked_at = UTC_TIMESTAMP(6), revocation_reason = 'logout_all' WHERE attempt_id = ?`, c.AttemptID); err != nil {
		t.Fatal(err)
	}
	revoked := item
	revoked.WriteID = "evidence-" + uuid.NewString()
	if rec := send(c.Token, revoked); rec.Code != http.StatusUnauthorized && rec.Code != http.StatusForbidden {
		t.Fatalf("revoked credential recorded evidence: %d %s", rec.Code, rec.Body.String())
	}
}
