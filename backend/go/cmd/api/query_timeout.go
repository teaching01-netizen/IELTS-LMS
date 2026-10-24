package main

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"github.com/go-sql-driver/mysql"
)

// DefaultQueryTimeout bounds hot read paths (plan E1: poll/bootstrap/roster
// at 5-10s). Pile-ups behind a slow MySQL become bounded 503s (retryable)
// instead of unbounded goroutine/conn growth.
const DefaultQueryTimeout = 10 * time.Second

// DefaultEntryTimeout bounds the SAT module transition endpoints (start, enter,
// visible, entry-state). They are not reads whose latency a student can wait
// out: the client arms a three-second offer lead and needs the response back
// with at least one displayed second to spare (SAT_PERSONAL_MIN_ENTRY_LEAD_MS),
// so a transition that cannot get database capacity inside this budget must
// fail fast as a retryable 503 instead of holding its connection for the 10s
// read budget. That is the difference between a bounded retry storm and an
// unbounded connection/lock convoy behind a saturated MySQL (plan 2026-09-24,
// entry reliability). It stays above the p99 objective for these endpoints
// (<500ms) with room for a cold first request.
const DefaultEntryTimeout = 1500 * time.Millisecond

// DefaultSATCloseTimeout bounds one close request below the browser's six
// second transport timeout. An ambiguous commit remains safe to recover by
// replaying the same close ID or reading lifecycle state.
const DefaultSATCloseTimeout = 5 * time.Second

func writeEntryError(w http.ResponseWriter, r *http.Request, err error) {
	if r != nil && r.Context().Err() != nil {
		// database/sql can return ErrTxDone after the request deadline has
		// already rolled back its transaction; retain the retryable cause.
		err = errors.Join(err, r.Context().Err())
	}
	mapped := MapDBError(err)
	if appErr, ok := apperrors.As(mapped); ok && appErr.Code == apperrors.CodeServiceUnavailable {
		w.Header().Set("Retry-After", "1")
		appErr.Details = map[string]any{"retryAfterSeconds": 1}
	}
	httpx.WriteError(w, r, mapped)
}

func attemptVerificationError(err error) error {
	var lookupErr *auth.AttemptSessionLookupError
	if errors.As(err, &lookupErr) {
		return apperrors.New(apperrors.CodeServiceUnavailable, "Attempt verification is temporarily unavailable; please retry.")
	}
	return apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential.")
}

func writeAttemptVerificationError(w http.ResponseWriter, r *http.Request, err error) {
	mapped := attemptVerificationError(err)
	if appErr, ok := apperrors.As(mapped); ok && appErr.Code == apperrors.CodeServiceUnavailable {
		writeEntryError(w, r, mapped)
		return
	}
	httpx.WriteError(w, r, mapped)
}

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

// MapDBError translates bounded database failures to a retryable response.
// Context exhaustion and the transient MySQL errors retried by tx.Runner map
// to 503; after the retry budget is exhausted, returning an opaque 500 would
// make clients stop retrying precisely while the database is contended.
func MapDBError(err error) error {
	// errors.Is (not ==): sql + service layers wrap ctx.Err() with %w.
	// Round 157: string-fallback mirrors auth.isClientGone — the mysql
	// driver surfaces cancellations message-intact but identity-opaque
	// (r153-r156 live: bare `context canceled` still 500 despite this
	// guard). Both spellings map to retryable 503, never INTERNAL.
	if err == nil {
		return nil
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return apperrors.New(apperrors.CodeServiceUnavailable, "Database budget exhausted; please retry.")
	}
	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) && (mysqlErr.Number == 1205 || mysqlErr.Number == 1213) {
		return apperrors.New(apperrors.CodeServiceUnavailable, "Database is temporarily busy; please retry.")
	}
	s := strings.ToLower(err.Error())
	if strings.Contains(s, "context canceled") || strings.Contains(s, "context deadline exceeded") {
		return apperrors.New(apperrors.CodeServiceUnavailable, "Database budget exhausted; please retry.")
	}
	return err
}
