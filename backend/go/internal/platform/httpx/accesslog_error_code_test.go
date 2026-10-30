package httpx

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// A refused request must say which gate refused it: the access line carries
// the envelope code and details.reason, and nothing else from the error.
func TestAccessLogRecordsErrorCodeAndReason(t *testing.T) {
	var buf bytes.Buffer
	oldOut, oldFlags := log.Writer(), log.Flags()
	log.SetOutput(&buf)
	log.SetFlags(0)
	defer func() { log.SetOutput(oldOut); log.SetFlags(oldFlags) }()

	h := AccessLog(WithRoute(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		WriteError(w, r, &apperrors.Error{Code: apperrors.CodeDeadlineExpired, Message: "secret-ish text", HTTPStatus: 422,
			Details: map[string]any{"reason": "IELTS_SECTION_CLOSED", "questionId": "q-1"}})
	}), "POST /{attemptID}/submit"))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/a1/submit", nil))

	line := findRequestLine(t, buf.String())
	if line["error_code"] != string(apperrors.CodeDeadlineExpired) || line["error_reason"] != "IELTS_SECTION_CLOSED" {
		t.Fatalf("error fields missing: %v", line)
	}
	if strings.Contains(buf.String(), "secret-ish") || strings.Contains(buf.String(), "q-1") {
		t.Fatalf("access log must not carry message or other details: %s", buf.String())
	}

	buf.Reset()
	ok := AccessLog(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))
	ok.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/ok", nil))
	if line := findRequestLine(t, buf.String()); line["error_code"] != nil || line["error_reason"] != nil {
		t.Fatalf("success line must not carry error fields: %v", line)
	}
}

func findRequestLine(t *testing.T, out string) map[string]any {
	t.Helper()
	for _, raw := range strings.Split(strings.TrimSpace(out), "\n") {
		var m map[string]any
		if json.Unmarshal([]byte(raw), &m) == nil && m["msg"] == "request" {
			return m
		}
	}
	t.Fatalf("no request line in %q", out)
	return nil
}
