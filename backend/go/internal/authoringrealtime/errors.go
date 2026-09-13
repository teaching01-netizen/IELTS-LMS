package authoringrealtime

import (
	"net/http"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// DomainCode is the snake_case machine-readable reason (details.authoringReason).
type DomainCode string

const (
	CodeRevisionConflict      DomainCode = "revision_conflict"
	CodeDraftReplaced         DomainCode = "draft_replaced"
	CodeDraftNotEditable      DomainCode = "draft_not_editable"
	CodePermissionDenied      DomainCode = "permission_denied"
	CodeEntityDeleted         DomainCode = "entity_deleted"
	CodeCursorTooOld          DomainCode = "cursor_too_old"
	CodeSubscriptionForbidden DomainCode = "subscription_forbidden"
)

// AllDomainCodes lists the frozen vocabulary (7).
var AllDomainCodes = []DomainCode{
	CodeRevisionConflict, CodeDraftReplaced, CodeDraftNotEditable,
	CodePermissionDenied, CodeEntityDeleted, CodeCursorTooOld,
	CodeSubscriptionForbidden,
}

// httpStatus maps each domain reason to its HTTP status.
func (c DomainCode) httpStatus() int {
	switch c {
	case CodeRevisionConflict, CodeDraftReplaced, CodeDraftNotEditable:
		return http.StatusConflict // 409: fencing / stale-draft failures
	case CodePermissionDenied, CodeSubscriptionForbidden:
		return http.StatusForbidden // 403: ACL failures
	case CodeEntityDeleted:
		return http.StatusGone // 410: tombstone (client must drop + refetch)
	case CodeCursorTooOld:
		return http.StatusGone // 410: replay window exceeded, take snapshot
	default:
		return http.StatusInternalServerError
	}
}

// appCode maps each domain reason to the stable apperrors wire code.
func (c DomainCode) appCode() apperrors.Code {
	switch c {
	case CodeRevisionConflict, CodeDraftReplaced, CodeDraftNotEditable:
		return apperrors.CodeAssessmentConflict // 409 family (existing)
	case CodePermissionDenied, CodeSubscriptionForbidden:
		return apperrors.CodeForbidden
	case CodeEntityDeleted, CodeCursorTooOld:
		return apperrors.CodeNotFound // envelope code stays stable; reason disambiguates
	default:
		return apperrors.CodeInternal
	}
}

// ToAppError builds the typed error: stable wire code + reason in Details.
func (c DomainCode) ToAppError(msg string) *apperrors.Error {
	e := apperrors.New(c.appCode(), msg)
	// Preserve the constructor-mapped status except where the domain reason
	// is intentionally Gone (410): entity_deleted + cursor_too_old.
	if c == CodeEntityDeleted || c == CodeCursorTooOld {
		e.HTTPStatus = http.StatusGone
	}
	if e.Details == nil {
		e.Details = map[string]any{}
	}
	e.Details["authoringReason"] = string(c)
	return e
}
