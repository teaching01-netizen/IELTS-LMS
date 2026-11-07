package student

import (
	"bytes"
	"encoding/json"
	"io"
	"time"

	"github.com/google/uuid"
)

// Client diagnostics are untrusted incident clues, never integrity violations
// or authority to change an attempt. Keep the payload free of arbitrary text.
type diagnosticPayload struct {
	EventID              string `json:"eventId"`
	Event                string `json:"event"`
	OccurredAt           string `json:"occurredAt"`
	Version              string `json:"version"`
	PageID               string `json:"pageId"`
	ProviderKey          string `json:"providerKey,omitempty"`
	Reason               string `json:"reason,omitempty"`
	NavigationType       string `json:"navigationType,omitempty"`
	StatusCode           *int   `json:"statusCode,omitempty"`
	PendingMutationCount *int   `json:"pendingMutationCount,omitempty"`
}

func validateDiagnostic(raw json.RawMessage) (string, error) {
	if len(raw) > 2048 {
		return "", validationError("Diagnostic payload is too large.")
	}
	var p diagnosticPayload
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&p); err != nil {
		return "", validationError("Invalid diagnostic fields.")
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return "", validationError("Invalid diagnostic payload.")
	}
	if _, err := uuid.Parse(p.EventID); err != nil {
		return "", validationError("Invalid diagnostic event id.")
	}
	if _, err := uuid.Parse(p.PageID); err != nil {
		return "", validationError("Invalid diagnostic page id.")
	}
	if _, err := time.Parse(time.RFC3339Nano, p.OccurredAt); err != nil {
		return "", validationError("Invalid diagnostic timestamp.")
	}
	if len(p.Version) == 0 || len(p.Version) > 128 {
		return "", validationError("Invalid diagnostic version.")
	}
	for _, c := range p.Version {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '.' || c == '_' || c == '-') {
			return "", validationError("Invalid diagnostic version.")
		}
	}
	switch p.Event {
	case "mounted", "interrupted", "pagehide", "unmounted", "explicit_exit", "route_error", "render_error", "unhandled_error", "access_rejected", "resume_result":
	default:
		return "", validationError("Invalid diagnostic event.")
	}
	switch p.Reason {
	case "", "unknown", "chunk", "route", "render", "network", "server_error", "resumed", "terminal", "expired", "revoked", "ownership", "unauthenticated", "no-attempt", "transient-error", "explicit", "EXAM_ACCESS_EXPIRED", "EXAM_ACCESS_REVOKED", "SESSION_ALREADY_ACTIVE", "LEASE_FENCED", "ACTIVE_SESSION_SUPERSEDED", "UNAUTHORIZED":
	default:
		return "", validationError("Invalid diagnostic reason.")
	}
	switch p.NavigationType {
	case "", "navigate", "reload", "back_forward", "prerender", "unknown":
	default:
		return "", validationError("Invalid diagnostic navigation type.")
	}
	if p.ProviderKey != "" && p.ProviderKey != "sat" {
		return "", validationError("Invalid diagnostic provider.")
	}
	if p.StatusCode != nil && (*p.StatusCode < 100 || *p.StatusCode > 599) {
		return "", validationError("Invalid diagnostic status.")
	}
	if p.PendingMutationCount != nil && (*p.PendingMutationCount < 0 || *p.PendingMutationCount > 1000000) {
		return "", validationError("Invalid diagnostic pending count.")
	}
	return p.EventID, nil
}
