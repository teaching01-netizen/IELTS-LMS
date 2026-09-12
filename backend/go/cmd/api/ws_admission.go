package main

import (
	"context"

	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// wsHeartbeatFunc ticks one lease; it closes over the active gate so the
// write pump stays gate-agnostic.
type wsHeartbeatFunc func(ctx context.Context, token, instanceID, userID string) error

// acquireWSLease admits one WS conn through the active gate (plan C2):
// memory = zero-SQL in-process admission; db = the singleton-row lease tx.
// The (token, admitted, err) shape is identical on both paths, including
// the CodeLeaseAcquireFailed 429 when a cap rejects the conn.
func (a *App) acquireWSLease(ctx context.Context, origin, userID string, scheduleID *string) (string, bool, error) {
	if a != nil && a.Config.WSAdmissionMemory() && a.Admission != nil {
		token, ok, reason := a.Admission.Acquire(userID, scheduleID)
		if !ok {
			_ = reason
			return "", false, nil
		}
		return token, true, nil
	}
	if a == nil || a.Leases == nil {
		return "", false, apperrors.New(apperrors.CodeServiceUnavailable, "Live updates are unavailable.")
	}
	return a.Leases.Acquire(ctx, origin, userID, scheduleID, liveupdates.CapTotal, liveupdates.CapPerUser, liveupdates.CapPerSchedule)
}

// wsHeartbeatFunc returns the tick for the active gate. Memory misses report
// NOT_FOUND (expired leases never revive — mirrors the DB Heartbeat).
func (a *App) wsHeartbeatFunc() wsHeartbeatFunc {
	if a != nil && a.Config.WSAdmissionMemory() && a.Admission != nil {
		return func(_ context.Context, token, _, _ string) error {
			if !a.Admission.Heartbeat(token) {
				return apperrors.New(apperrors.CodeNotFound, "Lease not found.")
			}
			return nil
		}
	}
	return func(ctx context.Context, token, instanceID, userID string) error {
		return a.Leases.Heartbeat(ctx, token, instanceID, userID)
	}
}

// wsGateReady reports whether the active gate is usable: memory needs the
// Admission; db needs the Leases repo.
func (a *App) wsGateReady() bool {
	if a == nil {
		return false
	}
	if a.Config.WSAdmissionMemory() {
		return a.Admission != nil
	}
	return a.Leases != nil
}

// releaseWSLease drops the lease on disconnect. Memory release is a no-op
// for unknown tokens (disconnect paths never fail).
func (a *App) releaseWSLease(ctx context.Context, token, origin, userID string) {
	if a != nil && a.Config.WSAdmissionMemory() && a.Admission != nil {
		a.Admission.Release(token)
		return
	}
	if a == nil || a.Leases == nil {
		return
	}
	_ = a.Leases.Release(ctx, token, origin, userID)
}
