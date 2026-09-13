// Phase 06 trace and correlation IDs.
//
// The goal is one id that greps end to end:
//
//	HTTP mutation -> tx -> event row -> forwarder poll -> hub fan-out -> socket
//
// Deliberately NOT an OTel SDK: this repo's convention is an `X-Trace-Id`
// echo, and vendoring a tracing SDK to move one string would be a much larger
// change than the problem deserves.
//
// One adaptation worth stating: the Phase 01 envelope and the Phase 03 frame
// are FROZEN, so the row does not get new fields. It reuses the existing
// `CausationID`, which is already the operation-correlation slot, as the
// carrier, and the forwarder logs it back out. That keeps the freeze intact
// while still joining every hop.
package authoringrealtime

import (
	"context"
	"net/http"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

// Header names. X-Trace-Id matches the existing convention; the correlation id
// is the authoring-specific companion that survives a retried operation.
const (
	TraceHeader       = "X-Trace-Id"
	CorrelationHeader = "X-Correlation-Id"
)

type idsKey struct{}

type traceIDs struct {
	traceID       string
	correlationID string
}

// maxTraceIDLen bounds an accepted inbound id.
const maxTraceIDLen = 64

// traceIDShape accepts opaque, identifier-like ids only. An id is attacker-
// controllable input on its way into logs and event metadata, so it is
// validated rather than trusted: anything with whitespace, quotes, newlines, or
// an over-long value is discarded and replaced with a server-generated one, so
// a crafted header cannot forge log lines or smuggle content into a trace field.
var traceIDShape = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,64}$`)

// NewTraceID mints an opaque id. Never a metric label, never parsed.
func NewTraceID() string { return uuid.NewString() }

// sanitizeTraceID returns a trustworthy id or "" when the input is unusable.
// "" means "generate a fresh one", never "keep the raw value".
func sanitizeTraceID(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || len(trimmed) > maxTraceIDLen {
		return ""
	}
	if !traceIDShape.MatchString(trimmed) {
		return ""
	}
	return trimmed
}

// WithIDs stores the pair on the context. Empty values become empty strings
// rather than being invented here; callers that need generation call
// EnsureIDsFromHeader.
func WithIDs(ctx context.Context, traceID, correlationID string) context.Context {
	return context.WithValue(ctx, idsKey{}, traceIDs{
		traceID:       strings.TrimSpace(traceID),
		correlationID: strings.TrimSpace(correlationID),
	})
}

// IDsFrom reads the pair back. Zero values mean "not set", never an error.
func IDsFrom(ctx context.Context) (traceID string, correlationID string) {
	if ctx == nil {
		return "", ""
	}
	pair, ok := ctx.Value(idsKey{}).(traceIDs)
	if !ok {
		return "", ""
	}
	return pair.traceID, pair.correlationID
}

// EnsureIDsFromHeader reads the inbound headers (forwarding an upstream trace
// when a proxy already started one), generates whatever is missing, and
// returns the context plus the pair so the caller can echo it back.
func EnsureIDsFromHeader(ctx context.Context, header http.Header) (context.Context, string, string) {
	var traceID, correlationID string
	if header != nil {
		// Validated, not trusted: an invalid value is dropped (and replaced
		// below) instead of being echoed into logs and event metadata.
		traceID = sanitizeTraceID(header.Get(TraceHeader))
		correlationID = sanitizeTraceID(header.Get(CorrelationHeader))
	}
	if traceID == "" {
		traceID = NewTraceID()
	}
	if correlationID == "" {
		// One id greps the whole hop chain, rather than two half-populated ones.
		correlationID = traceID
	}
	return WithIDs(ctx, traceID, correlationID), traceID, correlationID
}

// EchoIDs writes the pair onto an outbound response so a client (or an
// operator with devtools open) can quote the id in a report.
func EchoIDs(header http.Header, ctx context.Context) {
	if header == nil {
		return
	}
	// Re-validated on the way out as well: a value that reached the context by
	// some other path must not become an unvalidated response header.
	traceID := sanitizeTraceID(mustIDsFrom(ctx))
	if traceID == "" {
		return
	}
	header.Set(TraceHeader, traceID)
	if _, correlationID := IDsFrom(ctx); correlationID != "" {
		if safe := sanitizeTraceID(correlationID); safe != "" {
			header.Set(CorrelationHeader, safe)
		}
	}
}

// mustIDsFrom reads only the trace id, for call sites that do not need the pair.
func mustIDsFrom(ctx context.Context) string {
	traceID, _ := IDsFrom(ctx)
	return traceID
}
