package runtime

import (
	"context"
	"time"
)

// C3 poll tunables (plan: the 1M enabler). Steady-state students poll every
// PollSteadySecs; within PollFastLaneWindow of a control command they poll
// every PollFastLaneSecs (the 2s fast-lane). The <=30s visibility bound is
// documented on the route; server-side write gates enforce control commands
// regardless of poll lag.
const (
	// PollFastLaneWindow keeps polls tight after a control command.
	PollFastLaneWindow = 60 * time.Second
	// PollFastLaneSecs is the fast-lane interval (plan: 2s post-command).
	PollFastLaneSecs = 2
	// PollSteadySecs is the steady-state interval (plan: 20-30s).
	PollSteadySecs = 25
)

// PollView is the versioned runtime poll projection (plan C3): exactly what
// a student needs to track cohort state without a socket.
type PollView struct {
	Revision      int64   `json:"revision"`
	Status        string  `json:"status"`
	ActiveSection *string `json:"activeSection"`
	PollAfterSecs int     `json:"pollAfterSecs"`
}

// PollView resolves the versioned poll projection for one schedule:
// snapshot-hit (B2 cache) = zero SQL, miss = one committed-read runtime
// header (+ one section row when an active section is set). sinceRev ==
// current revision reports notModified (the handler renders 304). The
// adaptive interval fast-lanes for PollFastLaneWindow after a control
// command (cache invalidation stamp) and rests at PollSteadySecs otherwise.
func (s *Service) PollView(ctx context.Context, q SnapshotQuerier, scheduleID string, sinceRev *int64, now time.Time) (PollView, bool, error) {
	now = now.UTC()
	var snap Snapshot
	var err error
	if s != nil && s.snapshots != nil {
		snap, err = s.snapshots.Get(scheduleID, now, func() (Snapshot, error) {
			return LoadSnapshot(ctx, q, scheduleID, now)
		})
	} else {
		snap, err = LoadSnapshot(ctx, q, scheduleID, now)
	}
	if err != nil {
		return PollView{}, false, err
	}
	pollAfterSecs := PollSteadySecs
	// Automatic section advances are not proctor commands, so they do not
	// invalidate the API process-local cache. Enter the fast lane from the
	// authoritative section deadline itself; otherwise a student can discover
	// a correctly-timed transition only on the next 25-second steady poll.
	if snap.SectionDeadlineAt != nil && !now.Before(snap.SectionDeadlineAt.Add(-PollFastLaneWindow)) {
		pollAfterSecs = PollFastLaneSecs
	}
	view := PollView{Revision: snap.Revision, Status: snap.Status, ActiveSection: snap.ActiveSectionKey, PollAfterSecs: pollAfterSecs}
	if s != nil && s.snapshots != nil && s.snapshots.InvalidatedWithin(scheduleID, PollFastLaneWindow, now) {
		view.PollAfterSecs = PollFastLaneSecs
	}
	if sinceRev != nil && *sinceRev == snap.Revision {
		return view, true, nil
	}
	return view, false, nil
}
