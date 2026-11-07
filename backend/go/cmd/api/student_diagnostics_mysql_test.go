package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestStudentDiagnosticReplayIsOneAuditEventMySQL(t *testing.T) {
	f, _ := readyContinuityIELTS(t)
	c := f.candidates[0]
	app := continuityApp(f)
	router := BuildRouter(app)
	eventID := uuid.NewString()
	payload := map[string]any{"eventId": eventID, "event": "mounted", "pageId": uuid.NewString(), "occurredAt": "2026-11-05T13:46:25Z", "version": "test"}
	post := func(body map[string]any, want int) {
		t.Helper()
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/student/sessions/"+f.scheduleID+"/audit", bytes.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+c.Token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Fatalf("status=%d want=%d body=%s", rec.Code, want, rec.Body.String())
		}
	}
	body := map[string]any{"actionType": "STUDENT_DIAGNOSTIC", "payload": payload}
	post(body, 200)
	post(body, 200)
	rows, err := app.Student.Audit(context.Background(), f.scheduleID, 200)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, row := range rows {
		if row.ActionType == "STUDENT_DIAGNOSTIC" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("replayed diagnostic produced %d events", count)
	}
	payload["answers"] = map[string]string{"q1": "B"}
	post(body, 422)
}
