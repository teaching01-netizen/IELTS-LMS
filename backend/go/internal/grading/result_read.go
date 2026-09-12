package grading

// WS-05 pilot: result read-model owned by the grading service.
//
// LatestSubmissionForSchedule and LatestGradingResult moved verbatim from
// cmd/api/handlers_grading.go (latestSubmissionForSchedule / latestGradingResult
// + decodeGradingJSON / decodeNullableGradingJSON). Behavior on valid rows is
// byte-identical: same SQL, same scan order, same output map keys. The only
// intentional change is fail-closed JSON: silent fallbacks (invalid JSON ->
// empty map / raw string) now return a typed *ResultProjectionCorruptError
// (HTTP 502) so the handler renders a corrupt-projection envelope and logs.

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// ResultProjectionCorruptError marks one student_results JSON column that
// failed to decode. HTTPStatus 502 keeps the wire envelope distinct from
// INTERNAL so operators can alert on corrupt projections; Details carries
// the column name (never the raw payload).
type ResultProjectionCorruptError struct {
	Column       string
	SubmissionID string
	Err          error
}

func (e *ResultProjectionCorruptError) Error() string {
	return fmt.Sprintf("grading projection corrupt: column %s submission %s: %v", e.Column, e.SubmissionID, e.Err)
}

// LatestSubmissionForSchedule resolves the newest student_submissions row
// for a schedule. sql.ErrNoRows surfaces when the schedule has none.
func (s *Service) LatestSubmissionForSchedule(ctx context.Context, scheduleID string) (string, error) {
	var id string
	err := s.db.QueryRowContext(ctx,
		`SELECT id FROM student_submissions WHERE schedule_id = ? ORDER BY created_at DESC LIMIT 1`,
		scheduleID).Scan(&id)
	return id, err
}

// LatestGradingResult loads the newest student_results row for a submission
// (22-column scan, version DESC / updated_at DESC). Missing rows surface
// NOT_FOUND. Any JSON column that fails to decode returns
// *ResultProjectionCorruptError (fail-closed; the handler maps it to the
// 502 corrupt-projection envelope and logs with request/submission IDs).
func (s *Service) LatestGradingResult(ctx context.Context, submissionID string) (map[string]any, error) {
	var (
		id, submission, studentID, studentName, releaseStatus        string
		releasedAt, releasedBy, scheduledAt                          sql.NullString
		overallBand                                                  float64
		sectionBands, listening, reading, writing, speaking, summary sql.NullString
		version                                                      int
		previousID, revisionReason, authorizedActor                  sql.NullString
		createdAt, updatedAt                                         time.Time
	)
	// Read-committed single-row read: no repeatable snapshot needed, matches
	// the tx.go:72-77 narrowed invariant (RC where callers read by key).
	err := s.runner.WithTxRC(ctx, func(ctx context.Context, q tx.Tx) error {
		return q.QueryRowContext(ctx, `
		SELECT id, submission_id, student_id, student_name, release_status,
		       released_at, released_by, scheduled_release_date, overall_band,
		       section_bands, listening_result, reading_result, writing_results,
		       speaking_result, teacher_summary, version, previous_version_id,
		       revision_reason, authorized_actor_id, created_at, updated_at
		FROM student_results
		WHERE submission_id = ?
		ORDER BY version DESC, updated_at DESC
		LIMIT 1`, submissionID).Scan(
			&id, &submission, &studentID, &studentName, &releaseStatus,
			&releasedAt, &releasedBy, &scheduledAt, &overallBand,
			&sectionBands, &listening, &reading, &writing, &speaking, &summary,
			&version, &previousID, &revisionReason, &authorizedActor, &createdAt, &updatedAt,
		)
	})
	if err == sql.ErrNoRows {
		return nil, apperrors.New(apperrors.CodeNotFound, "Result not found.")
	}
	if err != nil {
		return nil, err
	}
	sectionBandsVal, err := decodeResultJSON(sectionBands, "section_bands", submissionID, map[string]any{})
	if err != nil {
		return nil, err
	}
	listeningVal, err := decodeNullableResultJSON(listening, "listening_result", submissionID)
	if err != nil {
		return nil, err
	}
	readingVal, err := decodeNullableResultJSON(reading, "reading_result", submissionID)
	if err != nil {
		return nil, err
	}
	writingVal, err := decodeResultJSON(writing, "writing_results", submissionID, map[string]any{})
	if err != nil {
		return nil, err
	}
	speakingVal, err := decodeNullableResultJSON(speaking, "speaking_result", submissionID)
	if err != nil {
		return nil, err
	}
	summaryVal, err := decodeResultJSON(summary, "teacher_summary", submissionID, map[string]any{})
	if err != nil {
		return nil, err
	}
	out := map[string]any{
		"id": id, "submissionId": submission, "studentId": studentID, "studentName": studentName,
		"releaseStatus": releaseStatus, "overallBand": overallBand,
		"sectionBands":    sectionBandsVal,
		"listeningResult": listeningVal,
		"readingResult":   readingVal,
		"writingResults":  writingVal,
		"speakingResult":  speakingVal,
		"teacherSummary":  summaryVal,
		"version":         version, "createdAt": createdAt.UTC(), "updatedAt": updatedAt.UTC(),
	}
	if releasedAt.Valid {
		out["releasedAt"] = releasedAt.String
	}
	if releasedBy.Valid {
		out["releasedBy"] = releasedBy.String
	}
	if scheduledAt.Valid {
		out["scheduledReleaseDate"] = scheduledAt.String
	}
	if previousID.Valid {
		out["previousVersionId"] = previousID.String
	}
	if revisionReason.Valid {
		out["revisionReason"] = revisionReason.String
	}
	if authorizedActor.Valid {
		out["authorizedActorId"] = authorizedActor.String
	}
	return out, nil
}

// corruptResultError builds the typed corruption error. The handler maps it
// via errors.As to the 502 corrupt-projection envelope plus a structured
// server-side log (the raw payload never leaves the server).
func corruptResultError(column, submissionID string, err error) error {
	return &ResultProjectionCorruptError{Column: column, SubmissionID: submissionID, Err: err}
}

// decodeResultJSON ports the old decodeGradingJSON fallback semantics
// exactly (missing/blank/JSON-null -> fallback); only a JSON syntax failure
// becomes a typed corruption error (fail-closed instead of empty success).
func decodeResultJSON(raw sql.NullString, column, submissionID string, fallback any) (any, error) {
	if !raw.Valid || strings.TrimSpace(raw.String) == "" || strings.TrimSpace(raw.String) == "null" {
		return fallback, nil
	}
	var value any
	if err := json.Unmarshal([]byte(raw.String), &value); err != nil {
		return nil, corruptResultError(column, submissionID,
			&ResultProjectionCorruptError{Column: column, SubmissionID: submissionID, Err: err})
	}
	if value == nil {
		return fallback, nil
	}
	return value, nil
}

func decodeNullableResultJSON(raw sql.NullString, column, submissionID string) (any, error) {
	if !raw.Valid || strings.TrimSpace(raw.String) == "" || strings.TrimSpace(raw.String) == "null" {
		return nil, nil
	}
	var value any
	if err := json.Unmarshal([]byte(raw.String), &value); err != nil {
		return nil, corruptResultError(column, submissionID,
			&ResultProjectionCorruptError{Column: column, SubmissionID: submissionID, Err: err})
	}
	return value, nil
}
