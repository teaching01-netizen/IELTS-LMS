package authoringcoedit

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Control API paths on the singleton Hocuspocus service. Every one of them is
// signed with the service secret; none of them is reachable from a browser.
const (
	ControlPathFreeze   = "/control/freeze"
	ControlPathUnfreeze = "/control/unfreeze"
	ControlPathRenew    = "/control/renew"
	ControlPathFlush    = "/control/flush"
	ControlPathClose    = "/control/close"
	ControlPathHealthz  = "/healthz"
	ControlPathReadyz   = "/readyz"
	ControlPathMetrics  = "/metrics"
)

// FreezeRequest asks the service to make the listed rooms read-only, flush
// provider output, run every pending store hook, and return a manifest.
type FreezeRequest struct {
	DocumentNames     []string `json:"documentNames"`
	DraftVersionID    string   `json:"draftVersionId"`
	Reason            string   `json:"reason"`
	FreezeOperationID string   `json:"freezeOperationId,omitempty"`
	FreezeExpiresAt   int64    `json:"freezeExpiresAt,omitempty"`
}

// FreezeManifestEntry is one document's committed state as the service last
// acknowledged it. Go verifies every hash against MySQL before publishing.
type FreezeManifestEntry struct {
	DocumentName         string        `json:"documentName"`
	StateHash            string        `json:"stateHash"`
	MaterializedRevision int           `json:"materializedRevision"`
	QuestionRevision     int           `json:"questionRevision"`
	StateEpoch           DecimalString `json:"stateEpoch,omitempty"`
	CommitSequence       DecimalString `json:"commitSequence,omitempty"`
	WorkspaceRevision    int           `json:"workspaceRevision,omitempty"`
}

// FreezeResponse carries the lease token and the committed manifest.
type FreezeResponse struct {
	FreezeToken       string                `json:"freezeToken"`
	FreezeOperationID string                `json:"freezeOperationId,omitempty"`
	FreezeExpiresAt   int64                 `json:"freezeExpiresAt,omitempty"`
	Manifest          []FreezeManifestEntry `json:"manifest"`
}

// UnfreezeRequest releases a freeze lease early (publish failure paths).
type UnfreezeRequest struct {
	FreezeToken       string `json:"freezeToken"`
	FreezeOperationID string `json:"freezeOperationId,omitempty"`
}

// RenewRequest extends one operation-owned service lease. The durable Go
// rows are renewed by the orchestration layer before this call, so a failed
// service renewal leaves the rooms fenced rather than reopening them.
type RenewRequest struct {
	FreezeToken       string `json:"freezeToken"`
	FreezeOperationID string `json:"freezeOperationId,omitempty"`
	FreezeExpiresAt   int64  `json:"freezeExpiresAt,omitempty"`
}

// FlushRequest forces pending store hooks to run. When a freeze operation ID
// is present, the service must use its operation-owned final-store path rather
// than an ordinary store; this prevents a stale room from crossing the fence.
type FlushRequest struct {
	DocumentNames     []string `json:"documentNames"`
	FreezeOperationID string   `json:"freezeOperationId,omitempty"`
}

// CloseRequest closes rooms with a closed-vocabulary reason.
type CloseRequest struct {
	DocumentNames     []string `json:"documentNames"`
	Reason            string   `json:"reason"`
	FreezeOperationID string   `json:"freezeOperationId,omitempty"`
}

// ControlClient is the Go-side client for the private control API. It is
// deliberately tiny: bounded timeouts, signed requests, no retries (the
// caller decides whether a publish should fail closed).
type ControlClient struct {
	baseURL string
	signer  *ServiceSigner
	client  *http.Client
}

// NewControlClient validates the base URL and secret.
func NewControlClient(baseURL string, signer *ServiceSigner) (*ControlClient, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if trimmed == "" {
		return nil, fmt.Errorf("co-edit service url is required")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("co-edit service url %q is not a valid absolute url", baseURL)
	}
	if signer == nil {
		return nil, fmt.Errorf("co-edit service signer is required")
	}
	return &ControlClient{
		baseURL: trimmed,
		signer:  signer,
		client: &http.Client{
			// The freeze/flush call must never hang a publish transaction
			// indefinitely; a timeout is a fail-closed outcome.
			Timeout: 10 * time.Second,
		},
	}, nil
}

// BaseURL exposes the configured base (assertable without exposing secrets).
func (c *ControlClient) BaseURL() string {
	if c == nil {
		return ""
	}
	return c.baseURL
}

// Freeze flushes and freezes the listed rooms.
func (c *ControlClient) Freeze(ctx context.Context, req FreezeRequest) (FreezeResponse, error) {
	var out FreezeResponse
	if err := c.do(ctx, http.MethodPost, ControlPathFreeze, req, &out); err != nil {
		return FreezeResponse{}, err
	}
	return out, nil
}

// Unfreeze releases a freeze lease.
func (c *ControlClient) Unfreeze(ctx context.Context, req UnfreezeRequest) error {
	return c.do(ctx, http.MethodPost, ControlPathUnfreeze, req, nil)
}

// Renew extends a freeze lease without retrying. The caller owns the failure
// policy and must keep the durable rows fenced if this call fails.
func (c *ControlClient) Renew(ctx context.Context, req RenewRequest) error {
	return c.do(ctx, http.MethodPost, ControlPathRenew, req, nil)
}

// Flush forces pending stores to run (shutdown and drain paths). An operation
// ID makes a fenced flush a final-store request at the service boundary.
func (c *ControlClient) Flush(ctx context.Context, req FlushRequest) error {
	return c.do(ctx, http.MethodPost, ControlPathFlush, req, nil)
}

// Close closes rooms with a closed-vocabulary reason.
func (c *ControlClient) Close(ctx context.Context, req CloseRequest) error {
	return c.do(ctx, http.MethodPost, ControlPathClose, req, nil)
}

// Healthy reports whether the service answers readiness. It is used for
// publish fail-closed decisions, never for request-path gating.
func (c *ControlClient) Healthy(ctx context.Context) error {
	return c.do(ctx, http.MethodGet, ControlPathReadyz, nil, nil)
}

func (c *ControlClient) do(ctx context.Context, method, path string, body any, out any) error {
	if c == nil {
		return New(CodeServiceUnavailable, "Co-editing service is not configured.")
	}
	var payload []byte
	var err error
	if body != nil {
		payload, err = json.Marshal(body)
		if err != nil {
			return err
		}
	}
	timestamp, signature, err := c.signer.Sign(method, path, payload)
	if err != nil {
		return RetryableErr(CodeServiceUnavailable, "Co-editing service signing failed.")
	}
	var reader io.Reader
	if payload != nil {
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set(HeaderServiceTimestamp, timestamp)
	req.Header.Set(HeaderServiceSignature, signature)
	resp, err := c.client.Do(req)
	if err != nil {
		return RetryableErr(CodeServiceUnavailable, "Co-editing service is unavailable.")
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return RetryableErr(CodeServiceUnavailable,
			fmt.Sprintf("Co-editing service returned %d.", resp.StatusCode))
	}
	if out != nil && len(respBody) > 0 {
		if err := json.Unmarshal(respBody, out); err != nil {
			return RetryableErr(CodeServiceUnavailable, "Co-editing service returned an invalid response.")
		}
	}
	return nil
}

// ErrServiceDisabled is returned when a feature-flagged operation is attempted
// while the capability is off.
var ErrServiceDisabled = New(CodeDisabled, "Prompt co-editing is not enabled.")

// ErrServiceUnavailable is the shared fail-closed error for publish paths.
var ErrServiceUnavailable = RetryableErr(CodeServiceUnavailable, "Prompt co-editing service is unavailable.")

// SanitizeDocumentNames deduplicates and validates a document name list,
// returning the typed names. An invalid name aborts the whole call: a partial
// freeze would leave some rooms accepting edits during publish.
func SanitizeDocumentNames(raw []string) ([]string, error) {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(raw))
	for _, candidate := range raw {
		name, _, _, err := ParseAnyDocumentName(candidate)
		if err != nil {
			return nil, New(CodeServiceUnavailable, "Co-editing document name is invalid.")
		}
		key := string(name)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, key)
	}
	return out, nil
}
