package main

import (
	"context"
	"database/sql"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/runtime"
)

// errSnapshotLockerDown fails closed when the snapshot path has no store:
// callers surface today's 503 envelope, never an open gate.
func errSnapshotLockerDown() error {
	return apperrors.New(apperrors.CodeServiceUnavailable, "Runtime snapshot service is unavailable.")
}

// snapshotRuntimeGate maps a B2 runtime Snapshot to the attempts.RuntimeGate
// the write path consumes. Missing active section means "no section scoping"
// ("*"), matching today's v2Locker open-gate branch. Now is stamped by the
// caller (in-tx dbNow) so server time stays authoritative.
func snapshotRuntimeGate(snap runtime.Snapshot, now time.Time) attempts.RuntimeGate {
	gate := attempts.RuntimeGate{
		Status:                snap.Status,
		ActiveSectionKey:      "*",
		SectionLive:           snap.SectionLive,
		SectionPaused:         snap.SectionPaused,
		SectionStarted:        snap.SectionStarted,
		WaitingForNextSection: snap.WaitingForNextSection,
		Now:                   now.UTC(),
	}
	if snap.ActiveSectionKey != nil && *snap.ActiveSectionKey != "" {
		gate.ActiveSectionKey = *snap.ActiveSectionKey
	}
	return gate
}

// snapshotLocker is the plan-B2 lock-free RuntimeLocker for V2 writes.
// Gate decision comes from a ~1s-TTL committed-read snapshot (no FOR
// UPDATE); the in-tx attempts.ensureWritable re-check stays authoritative,
// so a ~1s-stale accept can never slip a write past pause/complete.
// Mismatch/stale-snapshot errors trigger exactly one synchronous refresh +
// retry inside gateFor, then today's 422/409 codes surface.
type snapshotLocker struct {
	db    *sql.DB
	cache *runtime.SnapshotCache
}

var _ attempts.RuntimeLocker = snapshotLocker{}

// gateFor loads (or refreshes) the snapshot, enforces the pre-gate once,
// and on failure refreshes exactly once before returning the verdict.
// The returned gate carries a zero Now: Lock stamps authoritative in-tx
// time via dbNow after the snapshot decision.
func (l snapshotLocker) gateFor(ctx context.Context, scheduleID string) (attempts.RuntimeGate, error) {
	if l.db == nil || l.cache == nil {
		return attempts.RuntimeGate{}, errSnapshotLockerDown()
	}
	now := time.Now().UTC()
	snap, err := l.cache.Get(scheduleID, now, func() (runtime.Snapshot, error) {
		return runtime.LoadSnapshot(ctx, l.db, scheduleID, now)
	})
	if err != nil {
		return attempts.RuntimeGate{}, err
	}
	if err := snap.CheckWritable(); err != nil {
		// One synchronous refresh + retry (plan B2.1): the cached view
		// may predate a pause/complete by up to one TTL.
		l.cache.Invalidate(scheduleID)
		fresh, ferr := l.cache.Get(scheduleID, time.Now().UTC(), func() (runtime.Snapshot, error) {
			return runtime.LoadSnapshot(ctx, l.db, scheduleID, time.Now().UTC())
		})
		if ferr != nil {
			return attempts.RuntimeGate{}, ferr
		}
		if ferr := fresh.CheckWritable(); ferr != nil {
			return attempts.RuntimeGate{}, ferr
		}
		return snapshotRuntimeGate(fresh, time.Time{}), nil
	}
	return snapshotRuntimeGate(snap, time.Time{}), nil
}

// Lock implements attempts.RuntimeLocker: snapshot pre-gate (zero SQL when
// the TTL view is fresh and writable) + authoritative in-tx server time.
// The attempt row + idempotency + ensureWritable checks inside saveInTx and
// submitInTx remain the correctness fence; this gate only avoids taking the
// runtime + section FOR UPDATE locks on the hot path.
func (l snapshotLocker) Lock(ctx context.Context, q tx.Tx, scheduleID string) (attempts.RuntimeGate, error) {
	gate, err := l.gateFor(ctx, scheduleID)
	if err != nil {
		return attempts.RuntimeGate{}, err
	}
	now, terr := dbNow(ctx, q)
	if terr != nil {
		return attempts.RuntimeGate{}, terr
	}
	gate.Now = now
	return gate, nil
}
