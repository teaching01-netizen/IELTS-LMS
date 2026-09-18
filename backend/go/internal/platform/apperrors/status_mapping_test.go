package apperrors

import (
	"net/http"
	"testing"
)

// WS-16 P2: every Code maps to its expected HTTP status. statusFor is the
// single choke point behind New, so pinning the full table here keeps a
// future code from silently defaulting to 500 (or leaking a wrong class).
func TestStatusForMapsEveryCode(t *testing.T) {
	cases := []struct {
		code Code
		want int
	}{
		{CodeBadRequest, http.StatusBadRequest},
		{CodeValidation, http.StatusUnprocessableEntity},
		{CodeUnauthorized, http.StatusUnauthorized},
		{CodeForbidden, http.StatusForbidden},
		{CodeNotFound, http.StatusNotFound},
		{CodeExamNotFound, http.StatusNotFound},
		{CodeDraftIntegrity, http.StatusInternalServerError},
		{CodeMethodNotAllowed, http.StatusMethodNotAllowed},
		{CodeConflict, http.StatusConflict},
		{CodeRateLimited, http.StatusTooManyRequests},
		{CodeRateLimitExceeded, http.StatusTooManyRequests},
		{CodePayloadTooLarge, http.StatusRequestEntityTooLarge},
		{CodeServiceUnavailable, http.StatusServiceUnavailable},
		{CodeInternal, http.StatusInternalServerError},
		{CodeCSRF, http.StatusForbidden},
		{CodeSessionExpired, http.StatusUnauthorized},
		{CodeAttemptTokenInvalid, http.StatusUnauthorized},
		{CodeAttemptTokenExpired, http.StatusUnauthorized},
		{CodeLeaseFenced, http.StatusForbidden},
		{CodeControlEpochStale, http.StatusConflict},
		{CodeVersionCollision, http.StatusConflict},
		{CodeWriteIDConflict, http.StatusConflict},
		{CodeDeadlineExpired, http.StatusUnprocessableEntity},
		{CodeAttemptNotWritable, http.StatusUnprocessableEntity},
		{CodeAttemptProctorBlocked, http.StatusForbidden},
		{CodeTerminalConflict, http.StatusConflict},
		{CodeTerminalInvariant, http.StatusInternalServerError},
		{CodeSubmissionReplayMisuse, http.StatusConflict},
		{CodeResponseRevisionMismatch, http.StatusConflict},
		{CodeRuntimeRevisionStale, http.StatusConflict},
		{CodeLeaseAcquireFailed, http.StatusTooManyRequests},
		{CodeRecoveryFailed, http.StatusServiceUnavailable},
		{CodeAssessmentConflict, http.StatusConflict},
		{CodeActiveSessionSuperseded, http.StatusConflict},
		{CodeUnsupportedProvider, http.StatusUnprocessableEntity},
		{CodeInvalidAssessment, http.StatusUnprocessableEntity},
		{CodeAssessmentReleaseInvariant, http.StatusInternalServerError},
		{CodeStudentWSRetired, http.StatusGone},
	}
	for _, tc := range cases {
		if got := statusFor(tc.code); got != tc.want {
			t.Errorf("statusFor(%q) = %d, want %d", tc.code, got, tc.want)
		}
		if got := New(tc.code, "msg").HTTPStatus; got != tc.want {
			t.Errorf("New(%q).HTTPStatus = %d, want %d", tc.code, got, tc.want)
		}
	}
}

// Unknown codes fail closed to 500 (never a misleading 2xx/4xx class).
func TestStatusForUnknownCodeDefaultsToInternal(t *testing.T) {
	if got := statusFor(Code("NO_SUCH_CODE")); got != http.StatusInternalServerError {
		t.Fatalf("unknown code must map to 500, got %d", got)
	}
}

// Lane F2 known-literal (from Lane G WS-05-PILOT-DONE):
// cmd/api/handlers_grading.go writeGradingResultError constructs
// Error{Code: Code("CORRUPT_PROJECTION"), HTTPStatus: 502} literally -
// no named Code constant exists and errors.go is owned by Lane B, so this
// test documents the literal as-is: statusFor (the New choke point) has no
// entry for it and fails closed to 500, while the handler path carries the
// explicit 502 on the constructed Error (covered end-to-end in
// cmd/api/corruptprojection_wiring_test.go). If Lane B later adds a named
// constant, update this test to assert it.
func TestKnownLiteralCorruptProjection(t *testing.T) {
	const literal Code = Code("CORRUPT_PROJECTION")
	if got := statusFor(literal); got != http.StatusInternalServerError {
		t.Fatalf("statusFor(CORRUPT_PROJECTION literal) must fail closed to 500 today, got %d", got)
	}
	wired := &Error{Code: literal, Message: "Grading result projection is corrupt.", HTTPStatus: http.StatusBadGateway}
	if wired.HTTPStatus != http.StatusBadGateway {
		t.Fatalf("handler-constructed literal must carry explicit 502, got %d", wired.HTTPStatus)
	}
	if e, ok := As(wired); !ok || e.Code != literal {
		t.Fatalf("As must round-trip the literal code")
	}
}
