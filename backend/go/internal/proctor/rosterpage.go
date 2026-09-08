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
	var b strings.Builder
	args := []any{scheduleID}
	b.WriteString("SELECT " + studentSessionColumns + " " + studentSessionFrom + " WHERE sa.schedule_id = ?")
	if strings.TrimSpace(status) != "" {
		b.WriteString(" AND COALESCE(sa.delivery_status,'running') = ?")
		args = append(args, strings.TrimSpace(status))
	}
	if !cursor.UpdatedAt.IsZero() && cursor.ID != "" {
		b.WriteString(" AND (sa.updated_at, sa.id) > (?, ?)")
		args = append(args, cursor.UpdatedAt, cursor.ID)
	}
	b.WriteString(" ORDER BY sa.updated_at ASC, sa.id ASC LIMIT ?")
	args = append(args, limit+1)
	rows, err := q.QueryContext(ctx, b.String(), args...)
	if err != nil {
		return RosterPage{}, err
	}
	defer rows.Close()
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
	if len(keyed) > limit {
		keyed = keyed[:limit]
		page := RosterPage{HasMore: true}
		for _, k := range keyed {
			page.Rows = append(page.Rows, k.summary)
		}
		last := keyed[len(keyed)-1]
		page.Next = RosterCursor{UpdatedAt: last.updated, ID: last.id}
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
	return page, nil
}
