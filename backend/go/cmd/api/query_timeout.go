package main

import (
	"context"
	"errors"
	"net/http"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// DefaultQueryTimeout bounds hot read paths (plan E1: poll/bootstrap/roster
// at 5-10s). Pile-ups behind a slow MySQL become bounded 503s (retryable)
// instead of unbounded goroutine/conn growth.
const DefaultQueryTimeout = 10 * time.Second

// withQueryTimeout runs h with a deadline budget. An already-exhausted
// budget short-circuits to 503 (never runs the handler with a dead
// context). Handlers derive per-query timeouts via QueryContext.
func withQueryTimeout(w http.ResponseWriter, r *http.Request, budget time.Duration, h func(http.ResponseWriter, *http.Request)) {
	if budget <= 0 {
		telemetry.IncCounter(telemetry.MQueryTimeout)
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Request budget exhausted; please retry."))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), budget)
	defer cancel()
	h(w, r.WithContext(ctx))
}

// QueryContext derives a per-query timeout from the request context: when
// the request already carries a deadline (withQueryTimeout), the query
// inherits the remaining budget capped at maxWait; otherwise maxWait
// applies. Callers use it for every DB call on hot paths.
func QueryContext(r *http.Request, maxWait time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), maxWait)
}

// MapDBError translates a wedged-MySQL failure to the honest envelope
// (plan E1): context deadline/cancel (budget exhausted, readiness probe
// timeout) -> retryable 503 SERVICE_UNAVAILABLE. Anything else passes
// through untouched (WriteError maps unknown to 500 INTERNAL).
func MapDBError(err error) error {
	// errors.Is (not ==): sql + service layers wrap ctx.Err() with %w.
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return apperrors.New(apperrors.CodeServiceUnavailable, "Database budget exhausted; please retry.")
	}
	return err
}
