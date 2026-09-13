package authoringrealtime

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// Phase 03 bounded replay. Phase 02 stored each authoring row with:
//
//	event_kind      = 'authoring'
//	event_target_id = examId              <-- the replay partition key
//	event_revision  = draftRevision       <-- state hint, NOT an ordering key
//	event_name      = event kind
//	event_payload   = the Phase 01 envelope (carries scope.draftVersionId)
//	sequence_id     = AUTO_INCREMENT       <-- the ONLY ordering key
//
// So the replay partition is the EXAM alone. The draft is NOT a transport
// filter: it lives inside the payload (scope.draftVersionId) for clients to
// compare against their own draft, while routing follows the durable
// collaboration scope. The (event_kind, event_target_id, sequence_id) index
// from migration 0060 serves the range scan directly — no JSON extraction is
// needed on the hot path, and a draft-scoped predicate could never replay the
// draft.replaced event that invalidates a stale subscriber.
//
// Ordering and loss are strictly separate concerns:
//
//	sequence_id orders frames (transport)
//	draftRevision describes state (hint)
//
// draftRevision is NOT monotonic across Undo, so it must never be compared to
// decide whether a client missed something.

// ReplayBound caps rows returned per subscribe (matches liveupdates.PollLimit).
const ReplayBound = 200

// ReplayRow is one durable authoring row read back for a subscriber.
type ReplayRow struct {
	Cursor   int64
	Origin   string
	Name     string
	Revision int64
	Payload  []byte
}

// replayQuerier is the narrow DB surface (sqlmock-friendly, no pool coupling).
type replayQuerier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// clampReplayBound normalizes a caller-supplied bound into 1..ReplayBound.
// A bound of zero or below means "use the default"; anything larger is capped
// so a misconfiguration can never turn a subscribe into an unbounded scan.
func clampReplayBound(bound int) int {
	if bound < 1 {
		return ReplayBound
	}
	if bound > ReplayBound {
		return ReplayBound
	}
	return bound
}

// ErrUnparseableRow reports a retained row that cannot be safely interpreted.
// It is NOT a transient failure: the row is durable, so the caller must resolve
// the cursor with a snapshot rather than stream a history with a hole in it.
var ErrUnparseableRow = errors.New("authoringrealtime: replay row cannot be interpreted")

// ReplaySQL is the exact replay query. Exported so tests can assert the shape
// (and so the Phase 06 EXPLAIN harness has one source of truth).
//
// Exam-scoped and barrier-bounded: sequence_id > after (exclusive) and
// sequence_id <= barrier (inclusive), so replay and live delivery partition the
// stream with no overlap.
const ReplaySQL = "SELECT sequence_id, origin_instance_id, event_name, event_revision, CAST(event_payload AS CHAR) " +
	"FROM live_update_events " +
	"WHERE event_kind = ? AND event_target_id = ? AND sequence_id > ? AND sequence_id <= ? " +
	"ORDER BY sequence_id ASC LIMIT ?"

// LoadHistory returns durable authoring rows for the EXAM with
// afterCursor < sequence_id <= barrierCursor, ordered by sequence_id, at most
// `limit` rows.
//
// It over-fetches by one (LIMIT limit+1) so truncation is provable: when more
// than `limit` rows exist, truncated is true and the caller must force a
// snapshot — a partial stream that looks complete would silently drop events,
// which is exactly the failure mode this protocol forbids.
//
// Any row that does not parse (including a version this server must not
// execute) fails the whole load with ErrUnparseableRow. Skipping a bad row
// would leave a hole in an otherwise-complete history, so the set is validated
// BEFORE it is streamed: all-or-nothing.
func LoadHistory(ctx context.Context, db replayQuerier, examID string, afterCursor, barrierCursor int64, limit int) ([]ReplayRow, bool, error) {
	if db == nil {
		return nil, false, fmt.Errorf("authoringrealtime: replay database is unavailable")
	}
	if afterCursor < 0 {
		afterCursor = 0
	}
	limit = clampReplayBound(limit)
	if barrierCursor < afterCursor {
		return nil, false, nil
	}
	rows, err := db.QueryContext(ctx, ReplaySQL, BusEventKind, examID, afterCursor, barrierCursor, limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := make([]ReplayRow, 0, limit+1)
	for rows.Next() {
		var row ReplayRow
		var payload sql.NullString
		if err := rows.Scan(&row.Cursor, &row.Origin, &row.Name, &row.Revision, &payload); err != nil {
			return nil, false, err
		}
		if !payload.Valid || payload.String == "" {
			return nil, false, fmt.Errorf("%w: empty payload at cursor %d", ErrUnparseableRow, row.Cursor)
		}
		row.Payload = []byte(payload.String)
		if _, err := Parse(row.Payload); err != nil {
			return nil, false, fmt.Errorf("%w: cursor %d: %v", ErrUnparseableRow, row.Cursor, err)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	truncated := len(out) > limit
	if truncated {
		out = out[:limit]
	}
	return out, truncated, nil
}

// RetentionFloorSQL returns the GLOBAL oldest retained sequence id.
//
// This must be global, never per-exam. A per-exam MIN would be wrong: if Exam A
// has simply never emitted until sequence 900, then "lastSeen 40 < MIN(A) 900"
// does NOT mean Exam A's events 41..899 were purged — they never existed, and
// the intervening sequence values belong to other traffic entirely. Comparing
// against a global watermark is the only sound test of "this cursor is older
// than anything we still retain". MIN over the primary key is index-served, so
// this costs O(1) rather than a scan.
const RetentionFloorSQL = "SELECT COALESCE(MIN(sequence_id), 0) FROM live_update_events"

// RetentionFloor returns the global oldest retained sequence id (0 when the
// bus is empty). A cursor BELOW this floor is definitely unrecoverable.
func RetentionFloor(ctx context.Context, db replayQuerier) (int64, error) {
	if db == nil {
		return 0, fmt.Errorf("authoringrealtime: replay database is unavailable")
	}
	var floor sql.NullInt64
	if err := db.QueryRowContext(ctx, RetentionFloorSQL).Scan(&floor); err != nil {
		return 0, err
	}
	if !floor.Valid {
		return 0, nil
	}
	return floor.Int64, nil
}

// ReplayPlan is the decision the handler makes for one resume attempt.
type ReplayPlan struct {
	Rows             []ReplayRow
	SnapshotRequired bool
	Reason           SnapshotReason
}

// PlanReplay decides between bounded replay and snapshot_required.
//
//   - cursor < global retention floor -> snapshot{cursor_too_old} (rows gone)
//   - more rows than the bound         -> snapshot{replay_too_large} (no partial
//     stream is ever sent)
//   - an unreadable retained row       -> snapshot{unsupported_event} (validate
//     the whole set before applying any of it)
//   - otherwise                        -> the rows, in cursor order
//
// A cursor at or above the barrier simply yields zero rows: that is a valid
// "nothing missed" answer, NOT an error. A genuine DB failure is returned as an
// error and MUST fail closed (never be treated as "no events"): pretending no
// events existed would silently drop durable history.
func PlanReplay(ctx context.Context, db replayQuerier, b Binding, afterCursor, barrierCursor int64, bound int) (ReplayPlan, error) {
	limit := clampReplayBound(bound)
	if afterCursor >= barrierCursor {
		return ReplayPlan{}, nil
	}
	floor, err := RetentionFloor(ctx, db)
	if err != nil {
		return ReplayPlan{}, err
	}
	if afterCursor < floor {
		return ReplayPlan{SnapshotRequired: true, Reason: ReasonCursorTooOld}, nil
	}
	rows, truncated, err := LoadHistory(ctx, db, b.ExamID, afterCursor, barrierCursor, limit)
	if err != nil {
		if errors.Is(err, ErrUnparseableRow) {
			return ReplayPlan{SnapshotRequired: true, Reason: ReasonUnsupportedEvent}, nil
		}
		return ReplayPlan{}, err
	}
	if truncated {
		return ReplayPlan{SnapshotRequired: true, Reason: ReasonReplayTooLarge}, nil
	}
	return ReplayPlan{Rows: rows}, nil
}
