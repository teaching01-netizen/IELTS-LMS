package grading

// Released results are served from the immutable student_results snapshot, not
// from section_submissions. A released regrade therefore has to publish a new
// snapshot version so students and teachers see corrected bands.

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"
	"strings"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func applyReleasedStudentResults(ctx context.Context, q tx.Tx, plan objectiveRegradePlan, actorID string, audit map[string]any) error {
	for _, submission := range plan.Submissions {
		if !submission.Released || len(submission.Sections) == 0 {
			continue
		}
		if err := publishCorrectedReleasedResult(ctx, q, plan, submission, actorID, audit); err != nil {
			return err
		}
	}
	return nil
}

func publishCorrectedReleasedResult(ctx context.Context, q tx.Tx, plan objectiveRegradePlan, submission plannedSubmission, actorID string, audit map[string]any) error {
	var id, studentID, studentName string
	var version int
	var overallBand float64
	var sectionBandsRaw, listeningRaw, readingRaw, writingRaw, speakingRaw, summaryRaw sql.NullString
	if err := q.QueryRowContext(ctx, `
		SELECT id, version, student_id, student_name, overall_band,
		       CAST(section_bands AS CHAR), CAST(listening_result AS CHAR),
		       CAST(reading_result AS CHAR), CAST(writing_results AS CHAR),
		       CAST(speaking_result AS CHAR), CAST(teacher_summary AS CHAR)
		FROM student_results
		WHERE submission_id = ?
		ORDER BY version DESC LIMIT 1 FOR UPDATE`, submission.ID).Scan(
		&id, &version, &studentID, &studentName, &overallBand,
		&sectionBandsRaw, &listeningRaw, &readingRaw, &writingRaw, &speakingRaw, &summaryRaw,
	); err != nil {
		if err == sql.ErrNoRows {
			return apperrors.New(apperrors.CodeConflict, "Released result snapshot not found; cannot publish corrected scores.")
		}
		return err
	}

	sectionBands := projectionObject(json.RawMessage(sectionBandsRaw.String))
	oldBands := projectionObject(json.RawMessage(sectionBandsRaw.String))
	oldSectionTotals := map[string]float64{}
	newSectionTotals := map[string]float64{}
	for _, section := range submission.Sections {
		oldSectionTotals[section.Section] = section.OldTotal
		newSectionTotals[section.Section] = section.NewTotal
		if section.Section != "listening" && section.Section != "reading" {
			continue
		}
		band, ok := objectiveBandForTotal(plan.Config, plan.ExamType, section.Section, section.NewTotal)
		if !ok {
			continue
		}
		sectionBands[section.Section] = band
	}
	if projectionJSON(oldBands) == projectionJSON(sectionBands) && oldSectionTotalsEqual(oldSectionTotals, newSectionTotals) {
		return nil
	}

	overall := averageBand(sectionBands)
	now, err := dbNow(ctx, q)
	if err != nil {
		return err
	}
	resultID := uuid.NewString()
	writing := writingRaw.String
	if strings.TrimSpace(writing) == "" {
		writing = "{}"
	}
	summary := summaryRaw.String
	if strings.TrimSpace(summary) == "" {
		summary = "{}"
	}
	if _, err := q.ExecContext(ctx, `
		INSERT INTO student_results (
			id, submission_id, student_id, student_name, release_status, released_at,
			released_by, scheduled_release_date, overall_band, section_bands,
			listening_result, reading_result, writing_results, speaking_result,
			teacher_summary, version, previous_version_id, revision_reason,
			authorized_actor_id, created_at, updated_at
		) VALUES (?, ?, ?, ?, 'released', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		resultID, submission.ID, studentID, studentName, now, actorID,
		overall, projectionJSON(sectionBands), nullStringValue(listeningRaw),
		nullStringValue(readingRaw), writing, nullStringValue(speakingRaw), summary,
		version+1, id, "objective_regrade_released", actorID, now, now,
	); err != nil {
		return err
	}

	payload := map[string]any{
		"reason":           audit["reason"],
		"previewToken":     audit["previewToken"],
		"oldOverallBand":   overallBand,
		"newOverallBand":   overall,
		"oldSectionBands":  oldBands,
		"newSectionBands":  sectionBands,
		"oldSectionTotals": oldSectionTotals,
		"newSectionTotals": newSectionTotals,
	}
	if _, err := q.ExecContext(ctx, `
		INSERT INTO release_events (id, result_id, submission_id, actor_id, action, payload, created_at)
		VALUES (?, ?, ?, ?, 'regraded_released', ?, ?)`,
		uuid.NewString(), resultID, submission.ID, actorID, string(mustJSON(payload)), now,
	); err != nil {
		return err
	}
	return nil
}

func oldSectionTotalsEqual(oldTotals, newTotals map[string]float64) bool {
	if len(oldTotals) != len(newTotals) {
		return false
	}
	for section, oldTotal := range oldTotals {
		if newTotals[section] != oldTotal {
			return false
		}
	}
	return true
}

func nullStringValue(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return value.String
}

// objectiveBandForTotal mirrors the website's IELTS band lookup: listening
// always uses the listening table; reading selects the academic or general
// training table from the exam type. A missing table leaves the old band.
func objectiveBandForTotal(config map[string]any, examType, section string, total float64) (float64, bool) {
	table := objectiveBandTable(config, examType, section)
	if len(table) == 0 {
		return 0, false
	}
	thresholds := make([]float64, 0, len(table))
	for threshold := range table {
		thresholds = append(thresholds, threshold)
	}
	sort.Sort(sort.Reverse(sort.Float64Slice(thresholds)))
	for _, threshold := range thresholds {
		if total >= threshold {
			return table[threshold], true
		}
	}
	return 0, true
}

func objectiveBandTable(config map[string]any, examType, section string) map[float64]float64 {
	var key string
	switch section {
	case "listening":
		key = "listening"
	case "reading":
		key = "readingAcademic"
		if strings.Contains(strings.ToLower(examType), "general") {
			key = "readingGeneralTraining"
		}
	default:
		return map[float64]float64{}
	}
	var raw map[string]any
	if standards, ok := config["standards"].(map[string]any); ok {
		if tables, ok := standards["bandScoreTables"].(map[string]any); ok {
			raw, _ = tables[key].(map[string]any)
		}
	}
	if len(raw) == 0 {
		if sections, ok := config["sections"].(map[string]any); ok {
			if sectionConfig, ok := sections[section].(map[string]any); ok {
				raw, _ = sectionConfig["bandScoreTable"].(map[string]any)
			}
		}
	}
	table := map[float64]float64{}
	for rawThreshold, rawBand := range raw {
		threshold, ok := numberOf(rawThreshold)
		if !ok {
			continue
		}
		band, ok := numberOf(rawBand)
		if !ok {
			continue
		}
		table[threshold] = band
	}
	return table
}
