package main

import (
	"context"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/runtime"
)

// snapshotRuntimeGate maps a B2 runtime Snapshot to the attempts.RuntimeGate
// the write path consumes. Missing active section means "no section scoping"
// ("*"), matching v2Locker's open-gate branch. Now is stamped by the caller
// (in-tx dbNow) so server time stays authoritative.
func snapshotRuntimeGate(snap runtime.Snapshot, now time.Time) attempts.RuntimeGate {
	gate := attempts.RuntimeGate{
		Status:                snap.Status,
		TimingModel:           snap.TimingModel,
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

// snapshotLocker is the lock-free RuntimeLocker for V2 writes (RUNTIME_SNAPSHOT).
// It reads the runtime + active-section state ON THE CALLER'S TRANSACTION — the
// transaction that commits the write — without taking the runtime/section FOR
// UPDATE locks. That is the whole difference from v2Locker: same authority, no
// lock queueing behind runtime control commands on the hot path.
//
// The snapshot cache is deliberately NOT consulted here. A cached view is up to
// SnapshotTTL stale, and any decision that ACCEPTS a write from stale state is a
// correctness bug however narrow the window. (Audit finding 3: this file used to
// claim the in-tx ensureWritable re-check made the cached pre-gate safe. It did
// not — the gate it passed on WAS the cached one, and ensureWritable did not read
// the section flags at all, so with this locker a write could land against a
// paused or not-yet-started section, and with the flag off a computed
// SectionPaused had no consumer.) The cache still serves student runtime POLLS
// (runtime.Service.PollView), where ~1s staleness costs nothing.
type snapshotLocker struct{}

var _ attempts.RuntimeLocker = snapshotLocker{}

// Lock implements attempts.RuntimeLocker. No FOR UPDATE is needed, and the read
// is still authoritative for the write that commits here: the caller already
// holds this attempt's row lock, the write path runs READ COMMITTED, and every
// writer of runtime/section status (runtime.Service commands; the proctor pause
// path goes through them) locks the schedule's attempt rows before the runtime
// row (runtime.lockAttemptsFirst). A conflicting transition therefore either
// committed before this read (this read sees it) or is still blocked on the
// attempt row this transaction holds (it commits after this write).
func (snapshotLocker) Lock(ctx context.Context, q tx.Tx, scheduleID string) (attempts.RuntimeGate, error) {
	snap, err := runtime.LoadSnapshot(ctx, q, scheduleID, time.Now().UTC())
	if err != nil {
		return attempts.RuntimeGate{}, err
	}
	now, err := dbNow(ctx, q)
	if err != nil {
		return attempts.RuntimeGate{}, err
	}
	return snapshotRuntimeGate(snap, now), nil
}
