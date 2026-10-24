package proctor

import (
	"context"
	"database/sql"
	"strings"
	"time"

	examruntime "example.com/ielts-proctoring/internal/runtime"
)

type ieltsPersonalRosterState struct {
	sectionKey string
	state      string
	runtime    string
	reason     string
	delivery   string
	submitted  sql.NullTime
	order      int
	lastOrder  int
	expected   sql.NullTime
	started    sql.NullTime
	deadline   sql.NullTime
}

// ieltsRosterTimeline is one attempt section timeline as the roster reads it.
type ieltsRosterTimeline struct {
	sectionKey, state           string
	order                       int
	expected, started, deadline sql.NullTime
}

// ieltsRosterSection is one runtime section (key + order).
type ieltsRosterSection struct {
	key   string
	order int
}

// loadIELTSPersonalRosterStates hydrates one roster page in three bounded
// reads (page attempts with their runtime, the sections of each runtime on the
// page, the page attempts' timelines) instead of correlated per-row
// discovery; ieltsRosterStateFor applies the selection rules in memory.
func loadIELTSPersonalRosterStates(
	ctx context.Context,
	q sessionQuerier,
	sessions []StudentSessionSummary,
	now time.Time,
) (map[string]ieltsPersonalRosterState, error) {
	if len(sessions) == 0 {
		return nil, nil
	}
	attemptIDs := make([]any, 0, len(sessions))
	seen := make(map[string]bool, len(sessions))
	for _, session := range sessions {
		if !seen[session.AttemptID] {
			seen[session.AttemptID] = true
			attemptIDs = append(attemptIDs, session.AttemptID)
		}
	}
	rows, err := q.QueryContext(ctx, `SELECT a.id, rt.id, COALESCE(rt.status, ''), COALESCE(rt.completion_reason, ''),
		COALESCE(a.delivery_status, 'running'), a.submitted_at
		FROM student_attempts a
		JOIN exam_session_runtimes rt ON rt.schedule_id = a.schedule_id AND rt.timing_model IN (`+examruntime.IELTSPersonalTimingModelsSQL+`)
		WHERE a.id IN (`+rosterPlaceholders(len(attemptIDs))+`)`, attemptIDs...)
	if err != nil {
		return nil, err
	}
	bases := make(map[string]ieltsPersonalRosterState, len(attemptIDs))
	runtimeOf := make(map[string]string, len(attemptIDs))
	pageAttempts := make([]any, 0, len(attemptIDs))
	runtimeIDs := make([]any, 0, 1)
	seenRuntime := map[string]bool{}
	for rows.Next() {
		var attemptID, runtimeID string
		var base ieltsPersonalRosterState
		if err := rows.Scan(&attemptID, &runtimeID, &base.runtime, &base.reason, &base.delivery, &base.submitted); err != nil {
			rows.Close()
			return nil, err
		}
		bases[attemptID] = base
		runtimeOf[attemptID] = runtimeID
		pageAttempts = append(pageAttempts, attemptID)
		if !seenRuntime[runtimeID] {
			seenRuntime[runtimeID] = true
			runtimeIDs = append(runtimeIDs, runtimeID)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(pageAttempts) == 0 {
		return map[string]ieltsPersonalRosterState{}, nil
	}

	sections := make(map[string][]ieltsRosterSection, len(runtimeIDs))
	rows, err = q.QueryContext(ctx, `SELECT runtime_id, section_key, section_order
		FROM exam_session_runtime_sections
		WHERE runtime_id IN (`+rosterPlaceholders(len(runtimeIDs))+`)
		ORDER BY runtime_id, section_order`, runtimeIDs...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var runtimeID string
		var section ieltsRosterSection
		if err := rows.Scan(&runtimeID, &section.key, &section.order); err != nil {
			rows.Close()
			return nil, err
		}
		sections[runtimeID] = append(sections[runtimeID], section)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	timelines := make(map[string][]ieltsRosterTimeline, len(pageAttempts))
	rows, err = q.QueryContext(ctx, `SELECT attempt_id, section_key, state, section_order, expected_start_at, started_at, deadline_at
		FROM ielts_attempt_section_timelines
		WHERE attempt_id IN (`+rosterPlaceholders(len(pageAttempts))+`)
		ORDER BY attempt_id, section_order`, pageAttempts...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var attemptID string
		var timeline ieltsRosterTimeline
		if err := rows.Scan(&attemptID, &timeline.sectionKey, &timeline.state, &timeline.order, &timeline.expected, &timeline.started, &timeline.deadline); err != nil {
			rows.Close()
			return nil, err
		}
		timelines[attemptID] = append(timelines[attemptID], timeline)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	states := make(map[string]ieltsPersonalRosterState, len(bases))
	for attemptID, base := range bases {
		states[attemptID] = ieltsRosterStateFor(base, timelines[attemptID], sections[runtimeOf[attemptID]])
	}
	_ = now
	return states, nil
}

// ieltsRosterStateFor selects an attempt's roster section: the highest-order
// timeline not completed ("open"), the highest-order completed one ("last")
// and the earliest runtime section without a completed timeline ("next"),
// combined per field with the precedence the roster has always used.
// timelines and sections are in ascending section order.
func ieltsRosterStateFor(base ieltsPersonalRosterState, timelines []ieltsRosterTimeline, sections []ieltsRosterSection) ieltsPersonalRosterState {
	var open, last *ieltsRosterTimeline
	completed := make(map[string]bool, len(timelines))
	for i := range timelines {
		t := &timelines[i]
		if t.state == "completed" {
			completed[t.sectionKey] = true
			if last == nil || t.order >= last.order {
				last = t
			}
		} else if open == nil || t.order >= open.order {
			open = t
		}
	}
	var next *ieltsRosterSection
	base.lastOrder = -1
	for i := range sections {
		if next == nil && !completed[sections[i].key] {
			next = &sections[i]
		}
		if sections[i].order > base.lastOrder {
			base.lastOrder = sections[i].order
		}
	}
	base.order = -1
	switch {
	case open != nil:
		base.sectionKey, base.state, base.order = open.sectionKey, open.state, open.order
	case next != nil:
		base.sectionKey = next.key
	case last != nil:
		base.sectionKey = last.sectionKey
	}
	if open == nil && last != nil {
		base.state, base.order = last.state, last.order
	} else if open == nil && next != nil {
		base.order = next.order
	}
	pick := func(field func(*ieltsRosterTimeline) sql.NullTime) sql.NullTime {
		if open != nil && field(open).Valid {
			return field(open)
		}
		if last != nil {
			return field(last)
		}
		return sql.NullTime{}
	}
	base.expected = pick(func(t *ieltsRosterTimeline) sql.NullTime { return t.expected })
	base.started = pick(func(t *ieltsRosterTimeline) sql.NullTime { return t.started })
	base.deadline = pick(func(t *ieltsRosterTimeline) sql.NullTime { return t.deadline })
	return base
}

func rosterPlaceholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func attachIELTSPersonalRosterStates(
	ctx context.Context,
	q sessionQuerier,
	runtime SessionRuntime,
	sessions []StudentSessionSummary,
) error {
	if !examruntime.IsIELTSPersonal(runtime.TimingModel) || len(sessions) == 0 {
		return nil
	}
	now := runtime.ServerNow.UTC()
	if now.IsZero() {
		now = time.Now().UTC()
	}
	states, err := loadIELTSPersonalRosterStates(ctx, q, sessions, now)
	if err != nil {
		return err
	}
	for i := range sessions {
		state, ok := states[sessions[i].AttemptID]
		if !ok {
			continue
		}
		status := ""
		switch {
		case state.submitted.Valid || state.delivery == "submitted":
			status = "completed"
		case state.state == "unable":
			status = "unable"
		case state.state == "active":
			if state.deadline.Valid && !state.deadline.Time.UTC().After(now) {
				if state.order >= state.lastOrder {
					status = "submitting"
				} else {
					status = "preparing"
				}
			} else if state.started.Valid && state.expected.Valid && state.started.Time.After(state.expected.Time) {
				status = "delayed"
			} else {
				status = "active"
			}
		case state.state == "preparing":
			if state.expected.Valid && now.After(state.expected.Time.UTC()) {
				status = "delayed"
			} else {
				status = "preparing"
			}
		case state.state == "completed" && state.order >= state.lastOrder:
			status = "submitting"
		case state.state == "completed":
			status = "preparing"
		case state.sectionKey != "" && (state.runtime == "live" || (state.runtime == "completed" && state.reason == "time_expired")):
			status = "preparing"
		}
		if sessions[i].Status == "connecting" && (status == "active" || status == "delayed" || status == "preparing") {
			status = "reconnecting"
		}
		if status == "" {
			continue
		}
		sessions[i].IELTSPersonalStatus = &status
		if state.sectionKey != "" {
			sectionKey := state.sectionKey
			sessions[i].IELTSPersonalSectionKey = &sectionKey
		}
		if (status == "active" || status == "delayed") && state.deadline.Valid {
			deadline := state.deadline.Time.UTC()
			remaining := int(deadline.Sub(now).Seconds())
			if deadline.After(now) && deadline.Sub(now)%time.Second != 0 {
				remaining++
			}
			if remaining < 0 {
				remaining = 0
			}
			sessions[i].IELTSPersonalDeadlineAt = &deadline
			sessions[i].IELTSPersonalTimeRemainingSeconds = &remaining
		}
	}
	return nil
}
