// Package httpx provides shared HTTP transport helpers: timeouts, body
// limits, request IDs, security headers and the stable error envelope
// (plan 10-12).
package httpx

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"github.com/google/uuid"
)

const RequestIDHeader = "X-Request-Id"

// ServerConfig carries explicit timeout policy (plan 10).
type ServerConfig struct {
	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	MaxHeaderBytes    int
}

// DefaultServerConfig: tight student-mutation-friendly defaults.
func DefaultServerConfig() ServerConfig {
	return ServerConfig{
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
}

// MaxBodyBytes bounds: student mutations stay tight, workbook import is large.
const (
	MaxStudentBodyBytes  = 256 << 10 // 256 KiB
	MaxAdminBodyBytes    = 2 << 20   // 2 MiB
	MaxWorkbookBodyBytes = 64 << 20  // 64 MiB
)

// WithRequestID ensures a request id and echoes it. Client-supplied values
// are sanitized (printable ASCII, max 128 chars); anything else is minted.
func WithRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := sanitizeRequestIDHeader(r.Header.Get(RequestIDHeader))
		if id == "" {
			id = uuid.NewString()
		}
		w.Header().Set(RequestIDHeader, id)
		next.ServeHTTP(w, r)
	})
}

// sanitizeRequestIDHeader validates a client-supplied request id (printable
// ASCII, max 128 chars); invalid input yields "" so the caller mints one.
func sanitizeRequestIDHeader(v string) string {
	v = strings.TrimSpace(v)
	if v == "" || len(v) > 128 {
		return ""
	}
	for i := 0; i < len(v); i++ {
		if v[i] < 0x20 || v[i] > 0x7E {
			return ""
		}
	}
	return v
}

// SecurityHeaders applies baseline headers.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

// RequestIDOf returns the response request id (set by WithRequestID).
func RequestIDOf(w http.ResponseWriter, r *http.Request) string {
	if id := w.Header().Get(RequestIDHeader); id != "" {
		return id
	}
	if id := r.Header.Get(RequestIDHeader); id != "" {
		return id
	}
	return ""
}

// WriteJSON encodes a payload with explicit status.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// WriteError renders the stable error envelope without leaking internals (plan 12).
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	appErr, ok := apperrors.As(err)
	if !ok {
		appErr = apperrors.New(apperrors.CodeInternal, "Internal server error.")
	}
	WriteJSON(w, appErr.HTTPStatus, apperrors.Envelope{
		Code:      string(appErr.Code),
		Message:   appErr.Message,
		Details:   appErr.Details,
		RequestID: RequestIDOf(w, r),
	})
}

// DecodeLimited decodes JSON with a byte cap.
func DecodeLimited(r *http.Request, maxBytes int64, v any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, maxBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return apperrors.New(apperrors.CodeBadRequest, "Invalid request body.")
	}
	return nil
}

// DecodeLimitedOptional decodes JSON with a byte cap, accepting an empty
// body as the zero value. It exists for create-style endpoints whose clients
// POST without a body; non-empty bodies stay as strict as DecodeLimited
// (unknown fields are rejected).
func DecodeLimitedOptional(r *http.Request, maxBytes int64, v any) error {
	if r.Body == nil {
		return nil
	}
	data, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, maxBytes))
	if err != nil {
		return apperrors.New(apperrors.CodeBadRequest, "Invalid request body.")
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return nil
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return apperrors.New(apperrors.CodeBadRequest, "Invalid request body.")
	}
	return nil
}
