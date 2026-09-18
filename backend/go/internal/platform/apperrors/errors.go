// Package apperrors defines the stable machine-readable error envelope.
// The wire contract preserves every error `code` string of the Rust backend
// so existing clients keep working (plan 12).
package apperrors

import (
	"errors"
	"net/http"
)

// Code is a stable machine-readable error code.
type Code string

const (
	CodeBadRequest                 Code = "BAD_REQUEST"
	CodeValidation                 Code = "VALIDATION_ERROR"
	CodeUnauthorized               Code = "UNAUTHORIZED"
	CodeForbidden                  Code = "FORBIDDEN"
	CodeNotFound                   Code = "NOT_FOUND"
	CodeMethodNotAllowed           Code = "METHOD_NOT_ALLOWED"
	CodeConflict                   Code = "CONFLICT"
	CodeRateLimited                Code = "RATE_LIMITED"
	CodeRateLimitExceeded          Code = "RATE_LIMIT_EXCEEDED"
	CodePayloadTooLarge            Code = "PAYLOAD_TOO_LARGE"
	CodeServiceUnavailable         Code = "SERVICE_UNAVAILABLE"
	CodeInternal                   Code = "INTERNAL"
	CodeCSRF                       Code = "CSRF_FAILED"
	CodeSessionExpired             Code = "SESSION_EXPIRED"
	CodeAttemptTokenInvalid        Code = "ATTEMPT_TOKEN_INVALID"
	CodeAttemptTokenExpired        Code = "ATTEMPT_TOKEN_EXPIRED"
	CodeLeaseFenced                Code = "LEASE_FENCED"
	CodeControlEpochStale          Code = "CONTROL_EPOCH_STALE"
	CodeVersionCollision           Code = "VERSION_COLLISION"
	CodeWriteIDConflict            Code = "WRITE_ID_CONFLICT"
	CodeDeadlineExpired            Code = "DEADLINE_EXPIRED"
	CodeAttemptNotWritable         Code = "ATTEMPT_NOT_WRITABLE"
	CodeAttemptProctorBlocked      Code = "ATTEMPT_PROCTOR_BLOCKED"
	CodeTerminalConflict           Code = "TERMINALIZATION_CONFLICT"
	CodeTerminalInvariant          Code = "TERMINAL_INVARIANT_VIOLATION"
	CodeSubmissionReplayMisuse     Code = "SUBMISSION_ID_MISUSE"
	CodeResponseRevisionMismatch   Code = "RESPONSE_REVISION_MISMATCH"
	CodeRuntimeRevisionStale       Code = "RUNTIME_REVISION_STALE"
	CodeLeaseAcquireFailed         Code = "LEASE_ACQUIRE_FAILED"
	CodeRecoveryFailed             Code = "SERVICE_RECOVERY_FAILED"
	CodeAssessmentConflict         Code = "ASSESSMENT_CONFLICT"
	CodeActiveSessionSuperseded    Code = "ACTIVE_SESSION_SUPERSEDED"
	CodeUnsupportedProvider        Code = "UNSUPPORTED_PROVIDER"
	CodeInvalidAssessment          Code = "INVALID_ASSESSMENT"
	CodeAssessmentReleaseInvariant Code = "ASSESSMENT_RELEASE_INVARIANT"
	// CodeStudentWSRetired marks the plan-C3 student-socket retirement:
	// student WS attempts render 410 + {use: runtime-poll}.
	CodeStudentWSRetired Code = "STUDENT_WS_RETIRED"
)

// Authoring lifecycle codes. These are separate from the block above because
// they exist to keep two states apart that NOT_FOUND used to conflate.
const (
	// CodeExamNotFound distinguishes "no such exam row" from the generic
	// NOT_FOUND. The authoring shell read answers 200 NO_DRAFT for an exam
	// that exists without an editable draft, so a 404 on that route means
	// exactly one thing: the exam does not exist.
	CodeExamNotFound Code = "EXAM_NOT_FOUND"
	// CodeDraftIntegrity marks a dangling current_draft_version_id: the exam
	// row points at a version that is absent, owned by another exam, or not a
	// draft. That is corrupted state, not an empty draft, and must never be
	// reported as the legitimate NO_DRAFT lifecycle state.
	CodeDraftIntegrity Code = "DRAFT_INTEGRITY_VIOLATION"
)

// Error is a typed application error with a stable code.
type Error struct {
	Code       Code
	Message    string
	Details    map[string]any
	HTTPStatus int
	Retryable  bool
}

func (e *Error) Error() string { return string(e.Code) + ": " + e.Message }

// Envelope is the JSON wire shape.
type Envelope struct {
	Code      string         `json:"code"`
	Message   string         `json:"message"`
	Details   map[string]any `json:"details,omitempty"`
	RequestID string         `json:"requestId"`
}

func New(code Code, msg string) *Error {
	return &Error{Code: code, Message: msg, HTTPStatus: statusFor(code)}
}

func statusFor(c Code) int {
	switch c {
	case CodeUnauthorized, CodeAttemptTokenInvalid, CodeAttemptTokenExpired, CodeSessionExpired:
		return http.StatusUnauthorized
	case CodeForbidden, CodeCSRF, CodeLeaseFenced, CodeAttemptProctorBlocked:
		return http.StatusForbidden
	case CodeNotFound, CodeExamNotFound:
		return http.StatusNotFound
	case CodeMethodNotAllowed:
		return http.StatusMethodNotAllowed
	case CodeConflict, CodeControlEpochStale, CodeVersionCollision, CodeWriteIDConflict,
		CodeTerminalConflict, CodeSubmissionReplayMisuse, CodeResponseRevisionMismatch,
		CodeRuntimeRevisionStale, CodeAssessmentConflict, CodeActiveSessionSuperseded:
		return http.StatusConflict
	case CodeDeadlineExpired, CodeAttemptNotWritable:
		return http.StatusUnprocessableEntity
	case CodeRateLimited, CodeRateLimitExceeded, CodeLeaseAcquireFailed:
		return http.StatusTooManyRequests
	case CodePayloadTooLarge:
		return http.StatusRequestEntityTooLarge
	case CodeServiceUnavailable, CodeRecoveryFailed:
		return http.StatusServiceUnavailable
	case CodeStudentWSRetired:
		return http.StatusGone
	case CodeBadRequest:
		return http.StatusBadRequest
	case CodeValidation, CodeUnsupportedProvider, CodeInvalidAssessment:
		return http.StatusUnprocessableEntity
	case CodeInternal, CodeDraftIntegrity:
		return http.StatusInternalServerError
	default:
		return http.StatusInternalServerError
	}
}

// As finds *Error in an err chain, traversing wrappers via errors.As.
func As(err error) (*Error, bool) {
	var e *Error
	if errors.As(err, &e) {
		return e, true
	}
	return nil, false
}
