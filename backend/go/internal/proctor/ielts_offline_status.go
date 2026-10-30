package proctor

import (
	"context"
	"database/sql"

	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// IELTS offline-continuity visibility (docs/superpowers/plans/
// 2026-10-30-ielts-shared-clock-offline-continuity.md Task 8). These columns
// are diagnostic only: a missing package or pending evidence never blocks a
// transition, another student's room schedule, or a proctor command.
//
// A readiness row in the shared timing model means the device verified its
// complete offline package for that section (see readyIELTSSharedSectionInTx).
// Pending draft evidence is the retained, unscored ledger written when a
// closed-section write could not be saved normally.

// attachIELTSOfflineRosterStates hydrates one bounded page (or detail read)
// with two per-attempt lookups. Both queries are keyed by attempt id so the
// roster costs are bounded by the page, not the room.
func attachIELTSOfflineRosterStates(
	ctx context.Context,
	q sessionQuerier,
	runtime SessionRuntime,
	sessions []StudentSessionSummary,
) error {
	if len(sessions) == 0 || runtime.ID == "" || !examruntime.IsIELTSSharedSchedule(runtime.TimingModel) {
		return nil
	}
	ids := make([]string, 0, len(sessions))
	index := make(map[string]int, len(sessions))
	for i := range sessions {
		id := sessions[i].AttemptID
		if id == "" {
			continue
		}
		index[id] = i
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil
	}
	args := make([]any, 0, len(ids)+1)
	args = append(args, runtime.ID)
	for _, id := range ids {
		args = append(args, id)
	}
	rows, err := q.QueryContext(ctx,
		"SELECT attempt_id, section_key, ready_at FROM ielts_section_readiness WHERE runtime_id = ? AND attempt_id IN ("+
			rosterPlaceholders(len(ids))+") ORDER BY ready_at DESC, attempt_id ASC", args...)
	if err != nil {
		return err
	}
	seen := make(map[string]bool, len(ids))
	for rows.Next() {
		var attemptID, sectionKey string
		var readyAt sql.NullTime
		if err := rows.Scan(&attemptID, &sectionKey, &readyAt); err != nil {
			rows.Close()
			return err
		}
		i, ok := index[attemptID]
		if !ok || seen[attemptID] {
			continue
		}
		seen[attemptID] = true
		if sectionKey != "" {
			key := sectionKey
			sessions[i].IELTSOfflinePreparedSection = &key
		}
		if readyAt.Valid {
			at := readyAt.Time.UTC()
			sessions[i].IELTSOfflinePreparedAt = &at
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}

	evidenceArgs := make([]any, 0, len(ids))
	for _, id := range ids {
		evidenceArgs = append(evidenceArgs, id)
	}
	evidenceRows, err := q.QueryContext(ctx,
		"SELECT attempt_id, COUNT(*) FROM attempt_draft_evidence WHERE disposition = 'pending' AND attempt_id IN ("+
			rosterPlaceholders(len(ids))+") GROUP BY attempt_id", evidenceArgs...)
	if err != nil {
		return err
	}
	defer evidenceRows.Close()
	for evidenceRows.Next() {
		var attemptID string
		var pending int
		if err := evidenceRows.Scan(&attemptID, &pending); err != nil {
			return err
		}
		if i, ok := index[attemptID]; ok {
			sessions[i].DraftEvidencePending = pending
		}
	}
	return evidenceRows.Err()
}
