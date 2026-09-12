package main

// Lane F2 (from Lane G WS-05-PILOT-DONE): handlers_grading.go
// writeGradingResultError constructs apperrors.Error{Code:
// apperrors.Code("CORRUPT_PROJECTION"), HTTPStatus: 502} literally - no
// named Code constant exists (apperrors/errors.go is owned by Lane B, do
// not add one here). This test covers the behavior as-is through the real
// handler path: a corrupt projection must render the 502 envelope with the
// literal code, and any other error must keep the stable envelope.
import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"example.com/ielts-proctoring/internal/grading"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func TestWriteGradingResultErrorCorruptProjectionRenders502(t *testing.T) {
	corrupt := &grading.ResultProjectionCorruptError{
		Column:       "answers",
		SubmissionID: "sub-1",
		Err:          errors.New("bad json"),
	}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	writeGradingResultError(rec, req, "sub-1", corrupt)
	res := rec.Result()
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadGateway {
		t.Fatalf("corrupt projection must render 502, got %d", res.StatusCode)
	}
	var env apperrors.Envelope
	if err := json.NewDecoder(res.Body).Decode(&env); err != nil {
		t.Fatal(err)
	}
	if env.Code != "CORRUPT_PROJECTION" {
		t.Fatalf("envelope code must be the CORRUPT_PROJECTION literal, got %q", env.Code)
	}
	if env.Message == "" {
		t.Fatalf("envelope message must be set")
	}
	if env.Details["column"] != "answers" {
		t.Fatalf("envelope details must carry the column, got %v", env.Details)
	}
	if env.Details["submissionId"] != "sub-1" {
		t.Fatalf("envelope details must carry the submission id, got %v", env.Details)
	}
}

func TestWriteGradingResultErrorOtherKeepsStableEnvelope(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	writeGradingResultError(rec, req, "sub-1", apperrors.New(apperrors.CodeNotFound, "nope"))
	res := rec.Result()
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("non-corrupt error must keep its stable status, got %d", res.StatusCode)
	}
	var env apperrors.Envelope
	if err := json.NewDecoder(res.Body).Decode(&env); err != nil {
		t.Fatal(err)
	}
	if env.Code != string(apperrors.CodeNotFound) {
		t.Fatalf("envelope code must stay NOT_FOUND, got %q", env.Code)
	}
}
