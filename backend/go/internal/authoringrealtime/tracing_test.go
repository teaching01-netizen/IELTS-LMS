package authoringrealtime

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestWithIDsRoundTrips(t *testing.T) {
	ctx := WithIDs(context.Background(), "trace-1", "corr-1")
	traceID, correlationID := IDsFrom(ctx)
	if traceID != "trace-1" || correlationID != "corr-1" {
		t.Fatalf("IDsFrom = (%q, %q), want (trace-1, corr-1)", traceID, correlationID)
	}
}

func TestIDsFromEmptyContextIsNotAnError(t *testing.T) {
	if traceID, correlationID := IDsFrom(context.Background()); traceID != "" || correlationID != "" {
		t.Fatalf("bare context returned (%q, %q), want empty", traceID, correlationID)
	}
}

func TestEnsureIDsFromHeaderForwardsUpstreamTrace(t *testing.T) {
	header := http.Header{}
	header.Set(TraceHeader, "upstream-trace")
	header.Set(CorrelationHeader, "upstream-corr")

	ctx, traceID, correlationID := EnsureIDsFromHeader(context.Background(), header)
	if traceID != "upstream-trace" || correlationID != "upstream-corr" {
		t.Fatalf("did not forward upstream ids: (%q, %q)", traceID, correlationID)
	}
	fromCtx, corrFromCtx := IDsFrom(ctx)
	if fromCtx != "upstream-trace" || corrFromCtx != "upstream-corr" {
		t.Fatalf("context did not carry the forwarded ids: (%q, %q)", fromCtx, corrFromCtx)
	}
}

func TestEnsureIDsFromHeaderGeneratesAndDerives(t *testing.T) {
	ctx, traceID, correlationID := EnsureIDsFromHeader(context.Background(), http.Header{})
	if traceID == "" {
		t.Fatal("a missing trace id must be generated, not left empty")
	}
	// With no upstream correlation id, the trace id IS the correlation id: one
	// id greps the whole hop chain instead of two half-populated ones.
	if correlationID != traceID {
		t.Fatalf("correlation id = %q, want it to default to the trace id %q", correlationID, traceID)
	}
	if got, _ := IDsFrom(ctx); got != traceID {
		t.Fatalf("generated trace id did not reach the context: %q", got)
	}

	// A nil header must behave exactly like an empty one.
	_, nilTrace, _ := EnsureIDsFromHeader(context.Background(), nil)
	if nilTrace == "" {
		t.Fatal("nil header must still generate a trace id")
	}

	// A blank header value is treated as absent rather than as a real id.
	blank := http.Header{}
	blank.Set(TraceHeader, "   ")
	_, blankTrace, _ := EnsureIDsFromHeader(context.Background(), blank)
	if blankTrace == "" || blankTrace == "   " {
		t.Fatalf("blank header produced %q, want a generated id", blankTrace)
	}
}

func TestNewTraceIDIsOpaqueAndUnique(t *testing.T) {
	a, b := NewTraceID(), NewTraceID()
	if a == b {
		t.Fatalf("NewTraceID returned the same id twice: %q", a)
	}
	if a == "" {
		t.Fatal("NewTraceID returned an empty id")
	}
}

func TestEchoIDsWritesBothHeaders(t *testing.T) {
	ctx := WithIDs(context.Background(), "trace-9", "corr-9")
	header := http.Header{}
	EchoIDs(header, ctx)
	if got := header.Get(TraceHeader); got != "trace-9" {
		t.Fatalf("%s = %q, want trace-9", TraceHeader, got)
	}
	if got := header.Get(CorrelationHeader); got != "corr-9" {
		t.Fatalf("%s = %q, want corr-9", CorrelationHeader, got)
	}
}

func TestEchoIDsWithNoTraceWritesNothing(t *testing.T) {
	header := http.Header{}
	EchoIDs(header, context.Background())
	if got := header.Get(TraceHeader); got != "" {
		t.Fatalf("an untraced request must not get an empty header, got %q", got)
	}
	// A nil header must be a no-op rather than a panic.
	EchoIDs(nil, WithIDs(context.Background(), "trace-1", "corr-1"))
}

// An inbound id is attacker-controllable input on its way into logs and event
// metadata. It is validated, never trusted: a crafted value is replaced with a
// server-generated id rather than echoed.
func TestEnsureIDsFromHeaderRejectsUnsafeIds(t *testing.T) {
	unsafe := []string{
		"bad id with spaces",
		"trace\nwith newline",
		`quote"injection`,
		strings.Repeat("a", maxTraceIDLen+1),
		"<script>alert(1)</script>",
		"id;rm -rf /",
		"tab\tid",
	}
	for _, raw := range unsafe {
		header := http.Header{}
		header.Set(TraceHeader, raw)
		header.Set(CorrelationHeader, raw)
		ctx, traceID, correlationID := EnsureIDsFromHeader(context.Background(), header)
		if traceID == raw || correlationID == raw {
			t.Fatalf("unsafe id %q was trusted verbatim", raw)
		}
		if !traceIDShape.MatchString(traceID) || !traceIDShape.MatchString(correlationID) {
			t.Fatalf("unsafe id %q produced non-conforming ids (%q, %q)", raw, traceID, correlationID)
		}
		if got, _ := IDsFrom(ctx); got != traceID {
			t.Fatalf("context kept a different id than the one returned")
		}
	}
}

// A value that reaches the context by some other path must still not become an
// unvalidated response header.
func TestEchoIDsRefusesUnvalidatedContextValues(t *testing.T) {
	header := http.Header{}
	EchoIDs(header, WithIDs(context.Background(), "bad id with spaces", "also bad"))
	if got := header.Get(TraceHeader); got != "" {
		t.Fatalf("unsafe trace id was echoed: %q", got)
	}
	if got := header.Get(CorrelationHeader); got != "" {
		t.Fatalf("unsafe correlation id was echoed: %q", got)
	}
}

// The pair travels as an opaque value: it must never be parsed, and it must not
// collide with other context keys.
func TestIDsAreScopedToTheirOwnContextKey(t *testing.T) {
	type otherKey struct{}
	ctx := context.WithValue(context.Background(), otherKey{}, "trace-1")
	ctx = WithIDs(ctx, "trace-real", "corr-real")
	traceID, correlationID := IDsFrom(ctx)
	if traceID != "trace-real" || correlationID != "corr-real" {
		t.Fatalf("IDsFrom picked up the wrong key: (%q, %q)", traceID, correlationID)
	}
}
