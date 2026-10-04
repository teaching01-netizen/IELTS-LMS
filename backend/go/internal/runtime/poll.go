package runtime

import (
	"context"
	"math"
	"time"
)

// C3 poll tunables (plan: the 1M enabler). Steady-state students poll every
// PollSteadySecs; a room waiting on the proctor polls every PollWaitingSecs;
// within PollFastLaneWindow of a control command or past a section deadline
// they poll every PollFastLaneSecs (the 2s fast-lane). The <=30s visibility
// bound is documented on the route; server-side write gates enforce control
// commands regardless of poll lag.
const (
	// PollFastLaneWindow keeps polls tight after a control command.
	PollFastLaneWindow = 60 * time.Second
	// PollFastLaneSecs is the fast-lane interval (plan: 2s post-command).
	PollFastLaneSecs = 2
	// PollWaitingSecs bounds how long a waiting room takes to see Start/Resume.
	PollWaitingSecs = 5
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
	view := PollView{Revision: snap.Revision, Status: snap.Status, ActiveSection: snap.ActiveSectionKey, PollAfterSecs: pollAfterSecs(snap, now)}
	if s != nil && s.snapshots != nil && s.snapshots.InvalidatedWithin(scheduleID, PollFastLaneWindow, now) {
		view.PollAfterSecs = PollFastLaneSecs
	}
	if sinceRev != nil && *sinceRev == snap.Revision {
		return view, true, nil
	}
	return view, false, nil
}

// pollAfterSecs is the cadence without a recent control command. Automatic
// section advances are not proctor commands, so they do not invalidate the
// API process-local cache: the student wakes once just past the authoritative
// deadline, then fast-lanes until the advance is visible. Polling every 2s for
// the whole last minute would cost a room 30 requests per student per section.
func pollAfterSecs(snap Snapshot, now time.Time) int {
	secs := PollSteadySecs
	if snap.Status == StatusNotStarted || snap.Status == StatusPaused || snap.SectionPaused || snap.WaitingForNextSection {
		secs = PollWaitingSecs
	}
	if snap.SectionDeadlineAt == nil {
		return secs
	}
	until := snap.SectionDeadlineAt.Sub(now)
	switch {
	case until <= -PollFastLaneWindow:
		return secs
	case until <= 0:
		return PollFastLaneSecs
	}
	if wake := int(math.Ceil(until.Seconds())) + 1; wake < secs {
		return max(wake, PollFastLaneSecs)
	}
	return secs
}
