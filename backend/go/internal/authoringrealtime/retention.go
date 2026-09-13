// Phase 06 retention contract for authoring event rows.
//
// The decision this file records, because the alternative is inheriting the old
// implicit behavior silently:
//
//   - There is exactly ONE retention owner for live_update_events:
//     maintenance.RunRetention, whose single bounded, oldest-first, windowed
//     DELETE ages out every family together (72h, batch-scaled, worker slow
//     cycle). Authoring rows are covered by it; no authoring-specific DELETE is
//     wired. A second DELETE over the same table would purge one window twice
//     while reporting two row counts, so a number could look correct while one
//     statement deleted more than it claimed.
//   - Authoring-specific retention is therefore reserved for the case the review
//     standard allows: authoring genuinely needing a DIFFERENT window. That
//     fallback statement lives below, correct and tested, unwired.
//   - Retention is deliberately NOT extended to cover long offline clients. The
//     cover for a cursor older than the window is the resync path:
//     cursor_expired -> authoring.snapshot_required -> authoritative refetch.
//     Stretching retention to chase offline duration would grow the table
//     forever to avoid a recovery path that already exists.
package authoringrealtime

import "sort"

// AuthoringRetentionHours is how long an authoring event row is replayable. It
// matches the live-bus retention window; retention_test.go pins that parity so
// the two cannot drift apart unnoticed.
const AuthoringRetentionHours = 72

// AuthoringRetentionBatch bounds one purge pass. Oldest-first plus a LIMIT keeps
// the delete off the long tail of a huge table; the next pass continues where
// this one stopped.
const AuthoringRetentionBatch = 1000

// BusEventKindColumn is the value of live_update_events.event_kind for authoring
// rows, and the ONLY column that identifies the authoring family.
//
// This distinction is load-bearing rather than cosmetic. live_update_events
// carries TWO kind columns: `event_kind` is the bus family ('authoring',
// 'runtime', ...) while `event_name` is the specific domain kind
// ('question.changed', ...). A purge predicate that matched domain kinds against
// `event_kind` would match zero rows — never purging anything, while looking
// entirely plausible in review.
const BusEventKindColumn = "authoring"

// PurgeAuthoringEventsSQL is the FALLBACK purge for the day authoring rows need
// a different window or their own table. Binds are (retentionHours, batch).
//
// It is deliberately NOT wired; see the file comment. It exists so the decision
// is testable rather than tribal knowledge.
const PurgeAuthoringEventsSQL = `
DELETE FROM live_update_events
WHERE event_kind = '` + BusEventKindColumn + `'
  AND created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
ORDER BY sequence_id ASC
LIMIT ?`

// AuthoringEventNames returns the domain kind names that ride INSIDE authoring
// rows, sorted: `event_name` values, never `event_kind` values. Derived from
// KnownKinds rather than re-listed, so a future kind cannot be forgotten.
func AuthoringEventNames() []Kind {
	out := make([]Kind, 0, len(KnownKinds))
	for kind := range KnownKinds {
		out = append(out, kind)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// The watermark rule itself (a cursor older than the GLOBAL oldest retained
// sequence is unrecoverable) lives in replay.go next to the replay plan, not
// here: there must be exactly one place that decides `cursor_too_old`.
