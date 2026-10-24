package proctor

import (
	"context"
	"strings"
	"time"
)

// DefaultRosterPageLimit bounds one dashboard page (plan D4 default 200).
const DefaultRosterPageLimit = 200

// RosterCursor is the (updated_at, id) keyset position. Zero = first page.
type RosterCursor struct {
	UpdatedAt time.Time
	ID        string
}

// RosterPage is one keyset page: Rows (<= limit) + Next/HasMore.
type RosterPage struct {
	Rows    []StudentSessionSummary
	Next    RosterCursor
	HasMore bool
}

// LoadStudentSessionsPage serves the paginated roster (plan D4): keyset on
// (updated_at, id) with a limit+1 probe — no gaps/dups under concurrent
// updates (rows shifting behind the cursor reappear at most once via the
// tiebreak, never skipped). Status filters on COALESCE(delivery_status).
// Row shape matches the full roster (same columns, same hydration).
func (s *Service) LoadStudentSessionsPage(ctx context.Context, scheduleID string, cursor RosterCursor, limit int, status string) (RosterPage, error) {
	q, err := s.sessionDB()
	if err != nil {
		return RosterPage{}, err
	}
	if limit <= 0 {
		limit = DefaultRosterPageLimit
	}
	if limit > 1000 {
		limit = 1000
	}
	now := time.Now().UTC()
	// Runtime hydrates per-row deadlines. Failure must not fail the page:
	// fall back to an empty runtime (rows hydrate without deadlines, as
	// the legacy path does when no runtime row exists).
	var runtime SessionRuntime
	if sched, serr := loadSessionSchedule(ctx, q, scheduleID); serr == nil {
		// loadSessionRuntime issues 2 reads (header + sections). Skip it
		// unless the schedule is live/completed/cancelled (a runtime row
		// may exist): pages then cost exactly 2 queries (schedule probe
		// + page) for idle schedules; rows hydrate without deadlines
		// like the legacy no-runtime path.
		switch sched.Status {
		case "live", "completed", "cancelled":
			if rt, rerr := loadSessionRuntime(ctx, q, sched, now); rerr == nil {
				runtime = rt
			}
		}
	}
	_ = now
	query, args := rosterPageQuery(scheduleID, cursor, limit, status)
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return RosterPage{}, err
	}
	defer rows.Close()
	attachPersonalStates := func(page *RosterPage) error {
		return attachIELTSPersonalRosterStates(ctx, q, runtime, page.Rows)
	}
	type keyedRow struct {
		summary StudentSessionSummary
		updated time.Time
		id      string
	}
	var keyed []keyedRow
	for rows.Next() {
		r, serr := scanStudentSessionRow(rows)
		if serr != nil {
			rows.Close()
			return RosterPage{}, serr
		}
		keyed = append(keyed, keyedRow{summary: attemptRowToSession(r, runtime), updated: r.updatedAt.UTC(), id: r.id})
	}
	if err := rows.Err(); err != nil {
		return RosterPage{}, err
	}
	if err := rows.Close(); err != nil {
		return RosterPage{}, err
	}
	if len(keyed) > limit {
		keyed = keyed[:limit]
		page := RosterPage{HasMore: true}
		for _, k := range keyed {
			page.Rows = append(page.Rows, k.summary)
		}
		last := keyed[len(keyed)-1]
		page.Next = RosterCursor{UpdatedAt: last.updated, ID: last.id}
		if err := attachPersonalStates(&page); err != nil {
			return RosterPage{}, err
		}
		return page, nil
	}
	page := RosterPage{}
	for _, k := range keyed {
		page.Rows = append(page.Rows, k.summary)
	}
	if len(keyed) > 0 {
		last := keyed[len(keyed)-1]
		page.Next = RosterCursor{UpdatedAt: last.updated, ID: last.id}
	}
	if err := attachPersonalStates(&page); err != nil {
		return RosterPage{}, err
	}
	return page, nil
}

// rosterPageQuery builds one keyset page statement. The page is chosen from
// attempts alone and only its rows are hydrated: joining first made every
// page join and sort the whole room before LIMIT. The hint names migration
// 0102's index, which supplies the page in order; MySQL ignores the hint with
// a warning when the index is absent. Leading the ORDER BY with the fixed
// schedule_id keeps that fallback bounded to the room: no global
// (updated_at, id) index can supply this order, so the optimizer cannot walk
// every schedule's attempts looking for this room's page. The expanded cursor
// predicate (both columns NOT NULL) is the range-scannable form of
// (updated_at, id) > (?, ?).
func rosterPageQuery(scheduleID string, cursor RosterCursor, limit int, status string) (string, []any) {
	var b strings.Builder
	args := []any{scheduleID}
	b.WriteString("SELECT " + studentSessionColumns + " FROM (SELECT /*+ INDEX(page_sa idx_student_attempts_schedule_roster) */ page_sa.id" +
		" FROM student_attempts page_sa WHERE page_sa.schedule_id = ?")
	if strings.TrimSpace(status) != "" {
		b.WriteString(" AND COALESCE(page_sa.delivery_status,'running') = ?")
		args = append(args, strings.TrimSpace(status))
	}
	if !cursor.UpdatedAt.IsZero() && cursor.ID != "" {
		b.WriteString(" AND (page_sa.updated_at > ? OR (page_sa.updated_at = ? AND page_sa.id > ?))")
		args = append(args, cursor.UpdatedAt, cursor.UpdatedAt, cursor.ID)
	}
	b.WriteString(" ORDER BY page_sa.schedule_id, page_sa.updated_at ASC, page_sa.id ASC LIMIT ?) page" +
		" JOIN student_attempts sa ON sa.id = page.id " + studentSessionJoins +
		" ORDER BY sa.updated_at ASC, sa.id ASC")
	return b.String(), append(args, limit+1)
}
