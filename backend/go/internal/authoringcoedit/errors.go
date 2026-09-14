package authoringcoedit

import (
	"errors"
	"net/http"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// DomainCode is the machine-readable reason surfaced as
// details.coeditReason. The vocabulary is closed: operators alert on it, so
// inventing a new one at a random call site is a review error.
type DomainCode string

const (
	// CodeDisabled: co-editing is not enabled for this deployment.
	CodeDisabled DomainCode = "coedit_disabled"
	// CodeNotEditableDraft: the question is not in the current editable draft.
	CodeNotEditableDraft DomainCode = "coedit_not_editable_draft"
	// CodeDocumentClosed: the document was closed by a destructive lifecycle.
	CodeDocumentClosed DomainCode = "coedit_document_closed"
	// CodeDocumentFrozen: the document is frozen for publish/delete.
	CodeDocumentFrozen DomainCode = "coedit_document_frozen"
	// CodeRevisionConflict: the question revision moved on.
	CodeRevisionConflict DomainCode = "coedit_revision_conflict"
	// CodePreviousHashMismatch: the client's committed hash is not the row's.
	CodePreviousHashMismatch DomainCode = "coedit_previous_hash_mismatch"
	// CodeSeedConflict: the seed revision no longer matches the mapping.
	CodeSeedConflict DomainCode = "coedit_seed_conflict"
	// CodeOversized: binary state or materialized prompt exceeded a limit.
	CodeOversized DomainCode = "coedit_oversized"
	// CodeActiveConflict: a legacy prompt-bearing write hit an active room.
	CodeActiveConflict DomainCode = "coedit_active_conflict"
	// CodeSignatureInvalid: a private service call failed verification.
	CodeSignatureInvalid DomainCode = "coedit_signature_invalid"
	// CodeServiceUnavailable: the Hocuspocus service could not be reached.
	CodeServiceUnavailable DomainCode = "coedit_service_unavailable"
	// CodePermissionDenied: the actor may not write the prompt.
	CodePermissionDenied DomainCode = "coedit_permission_denied"
)

// AllDomainCodes is the frozen vocabulary, used by tests and docs.
var AllDomainCodes = []DomainCode{
	CodeDisabled, CodeNotEditableDraft, CodeDocumentClosed, CodeDocumentFrozen,
	CodeRevisionConflict, CodePreviousHashMismatch, CodeSeedConflict,
	CodeOversized, CodeActiveConflict, CodeSignatureInvalid,
	CodeServiceUnavailable, CodePermissionDenied,
}

// Error is a typed co-edit failure carrying a domain code and a safe message.
// The message never contains question content, tokens, or state.
type Error struct {
	Code    DomainCode
	Message string
	// Retryable marks conditions the client may simply retry (service
	// unavailable, transient conflict). It never marks a size/authorization
	// failure.
	Retryable bool
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

// New builds a typed co-edit error.
func New(code DomainCode, message string) *Error {
	return &Error{Code: code, Message: message}
}

// RetryableErr builds a retryable typed co-edit error.
func RetryableErr(code DomainCode, message string) *Error {
	return &Error{Code: code, Message: message, Retryable: true}
}

// As extracts a typed co-edit error.
func As(err error) (*Error, bool) {
	var target *Error
	if errors.As(err, &target) {
		return target, true
	}
	return nil, false
}

func (c DomainCode) httpStatus() int {
	switch c {
	case CodePermissionDenied:
		return http.StatusForbidden
	case CodeDisabled, CodeServiceUnavailable:
		return http.StatusServiceUnavailable
	case CodeNotEditableDraft, CodeSignatureInvalid:
		return http.StatusNotFound
	case CodeRevisionConflict, CodePreviousHashMismatch, CodeSeedConflict,
		CodeActiveConflict, CodeDocumentFrozen:
		return http.StatusConflict
	case CodeDocumentClosed:
		return http.StatusGone
	case CodeOversized:
		return http.StatusRequestEntityTooLarge
	default:
		return http.StatusInternalServerError
	}
}

func (c DomainCode) appCode() apperrors.Code {
	switch c {
	case CodePermissionDenied:
		return apperrors.CodeForbidden
	case CodeDisabled, CodeServiceUnavailable:
		return apperrors.CodeServiceUnavailable
	case CodeNotEditableDraft, CodeSignatureInvalid, CodeDocumentClosed:
		return apperrors.CodeNotFound
	case CodeRevisionConflict, CodePreviousHashMismatch, CodeSeedConflict,
		CodeActiveConflict, CodeDocumentFrozen:
		return apperrors.CodeAssessmentConflict
	case CodeOversized:
		return apperrors.CodeValidation
	default:
		return apperrors.CodeInternal
	}
}

// ToAppError converts a typed co-edit error into the stable wire envelope,
// preserving the domain reason in Details.coeditReason.
func (e *Error) ToAppError() *apperrors.Error {
	if e == nil {
		return nil
	}
	out := apperrors.New(e.Code.appCode(), e.Message)
	out.HTTPStatus = e.Code.httpStatus()
	if out.Details == nil {
		out.Details = map[string]any{}
	}
	out.Details["coeditReason"] = string(e.Code)
	if e.Retryable {
		out.Details["retryable"] = true
	}
	return out
}
