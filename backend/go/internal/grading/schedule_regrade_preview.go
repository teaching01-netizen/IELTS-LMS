package grading

// Regrade preview and the audited "regrade released" action. The preview and
// the real regrade share planScheduleRegrade, so a preview lists exactly what
// the apply path will write. The apply path re-plans inside its transaction
// and refuses a stale preview token.

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// ObjectiveRegradeScope selects which submissions a preview or apply covers.
const (
	ObjectiveRegradeScopeAll        = "all"
	ObjectiveRegradeScopeReleased   = "released"
	ObjectiveRegradeScopeUnreleased = "unreleased"
)

// ObjectiveRegradeChange is one question whose saved score would change.
type ObjectiveRegradeChange struct {
	SubmissionID   string   `json:"submissionId"`
	StudentID      string   `json:"studentId"`
	StudentName    string   `json:"studentName"`
	Section        string   `json:"section"`
	QuestionID     string   `json:"questionId"`
	Released       bool     `json:"released"`
	OldCorrectness *bool    `json:"oldCorrectness"`
	NewCorrectness *bool    `json:"newCorrectness"`
	OldAwarded     *float64 `json:"oldAwardedScore"`
	NewAwarded     *float64 `json:"newAwardedScore"`
	OldMax         *float64 `json:"oldMaxScore"`
	NewMax         *float64 `json:"newMaxScore"`
}

// ObjectiveRegradePreviewSubmission is one student whose totals would change.
type ObjectiveRegradePreviewSubmission struct {
	SubmissionID  string                   `json:"submissionId"`
	StudentID     string                   `json:"studentId"`
	StudentName   string                   `json:"studentName"`
	Released      bool                     `json:"released"`
	OldTotalScore float64                  `json:"oldTotalScore"`
	NewTotalScore float64                  `json:"newTotalScore"`
	OldMaxScore   float64                  `json:"oldMaxScore"`
	NewMaxScore   float64                  `json:"newMaxScore"`
	Changes       []ObjectiveRegradeChange `json:"changes"`
}

// ObjectiveRegradePreviewSummary counts what the preview found.
type ObjectiveRegradePreviewSummary struct {
	Submissions    int     `json:"submissions"`
	Released       int     `json:"released"`
	Unreleased     int     `json:"unreleased"`
	Changed        int     `json:"changedSubmissions"`
	QuestionChange int     `json:"questionChanges"`
	ScoreDelta     float64 `json:"scoreDelta"`
}

// ObjectiveRegradePreview is the read-only regrade plan.
type ObjectiveRegradePreview struct {
	ScheduleID   string                              `json:"scheduleId"`
	GeneratedAt  time.Time                           `json:"generatedAt"`
	Scope        string                              `json:"scope"`
	PreviewToken string                              `json:"previewToken"`
	Summary      ObjectiveRegradePreviewSummary      `json:"summary"`
	Submissions  []ObjectiveRegradePreviewSubmission `json:"submissions"`
}

func normalizeRegradeScope(scope string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(scope)) {
	case "", ObjectiveRegradeScopeAll:
		return ObjectiveRegradeScopeAll, nil
	case ObjectiveRegradeScopeReleased:
		return ObjectiveRegradeScopeReleased, nil
	case ObjectiveRegradeScopeUnreleased:
		return ObjectiveRegradeScopeUnreleased, nil
	default:
		return "", apperrors.New(apperrors.CodeValidation, "Regrade scope must be all, released, or unreleased.")
	}
}

type plannedSectionUpdate struct {
	SectionID string
	Results   map[string]any
	Status    string
}

type plannedSubmission struct {
	ID          string
	StudentID   string
	StudentName string
	Released    bool
	OldTotal    float64
	NewTotal    float64
	OldMax      float64
	NewMax      float64
	Changes     []ObjectiveRegradeChange
	Sections    []plannedSectionUpdate
}

type objectiveRegradePlan struct {
	ScheduleID  string
	Scope       string
	Submissions []plannedSubmission
	Report      ObjectiveRegradeReport
}

// PreviewScheduleObjectiveRegrade plans a regrade without writing anything.
func (s *Service) PreviewScheduleObjectiveRegrade(ctx context.Context, scheduleID, scope string) (ObjectiveRegradePreview, error) {
	normalized, err := normalizeRegradeScope(scope)
	if err != nil {
		return ObjectiveRegradePreview{}, err
	}
	var preview ObjectiveRegradePreview
	err = s.runner.WithTxRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		plan, err := planScheduleRegrade(ctx, q, scheduleID, normalized)
		if err != nil {
			return err
		}
		preview = previewFromPlan(plan)
		return nil
	})
	return preview, err
}

// RegradeReleasedScheduleObjectives applies a released-only preview. The
// preview token must match a freshly re-planned released set, so an operator
// cannot apply a preview that no longer describes the data.
func (s *Service) RegradeReleasedScheduleObjectives(ctx context.Context, scheduleID, previewToken, reason, actorID, actorName string) (ObjectiveRegradePreview, ObjectiveRegradeReport, error) {
	var preview ObjectiveRegradePreview
	var report ObjectiveRegradeReport
	if strings.TrimSpace(reason) == "" {
		return preview, report, apperrors.New(apperrors.CodeValidation, "Regrade reason is required.")
	}
	if strings.TrimSpace(previewToken) == "" {
		return preview, report, apperrors.New(apperrors.CodeValidation, "A regrade preview is required before applying released results.")
	}
	err := s.runner.WithTxRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		plan, err := planScheduleRegrade(ctx, q, scheduleID, ObjectiveRegradeScopeReleased)
		if err != nil {
			return err
		}
		preview = previewFromPlan(plan)
		if len(plan.Submissions) == 0 {
			report = plan.Report
			preview.PreviewToken = previewToken
			return nil
		}
		if preview.PreviewToken != previewToken {
			return apperrors.New(apperrors.CodeConflict, "The regrade preview is out of date; run the preview again.")
		}
		report = plan.Report
		if err := applyRegradePlan(ctx, q, plan, actorID, actorName, "objective_regrade_released", map[string]any{
			"reason": reason, "previewToken": previewToken,
		}); err != nil {
			return err
		}
		return nil
	})
	return preview, report, err
}

func previewFromPlan(plan objectiveRegradePlan) ObjectiveRegradePreview {
	preview := ObjectiveRegradePreview{
		ScheduleID:  plan.ScheduleID,
		GeneratedAt: time.Now().UTC(),
		Scope:       plan.Scope,
		Submissions: make([]ObjectiveRegradePreviewSubmission, 0, len(plan.Submissions)),
	}
	for _, submission := range plan.Submissions {
		preview.Submissions = append(preview.Submissions, ObjectiveRegradePreviewSubmission{
			SubmissionID: submission.ID, StudentID: submission.StudentID, StudentName: submission.StudentName,
			Released:      submission.Released,
			OldTotalScore: submission.OldTotal, NewTotalScore: submission.NewTotal,
			OldMaxScore: submission.OldMax, NewMaxScore: submission.NewMax,
			Changes: submission.Changes,
		})
	}
	preview.Summary = ObjectiveRegradePreviewSummary{Submissions: len(plan.Submissions)}
	for _, submission := range plan.Submissions {
		if submission.Released {
			preview.Summary.Released++
		} else {
			preview.Summary.Unreleased++
		}
		if len(submission.Changes) > 0 || len(submission.Sections) > 0 {
			preview.Summary.Changed++
		}
		preview.Summary.QuestionChange += len(submission.Changes)
		preview.Summary.ScoreDelta += submission.NewTotal - submission.OldTotal
	}
	preview.PreviewToken = objectiveRegradeToken(preview)
	return preview
}

// objectiveRegradeToken hashes the change set, excluding volatile fields.
func objectiveRegradeToken(preview ObjectiveRegradePreview) string {
	type tokenChange struct {
		SubmissionID   string   `json:"submissionId"`
		Section        string   `json:"section"`
		QuestionID     string   `json:"questionId"`
		Released       bool     `json:"released"`
		OldCorrectness *bool    `json:"oldCorrectness"`
		NewCorrectness *bool    `json:"newCorrectness"`
		OldAwarded     *float64 `json:"oldAwardedScore"`
		NewAwarded     *float64 `json:"newAwardedScore"`
		OldMax         *float64 `json:"oldMaxScore"`
		NewMax         *float64 `json:"newMaxScore"`
	}
	changes := make([]tokenChange, 0)
	for _, submission := range preview.Submissions {
		for _, change := range submission.Changes {
			changes = append(changes, tokenChange{
				SubmissionID: change.SubmissionID, Section: change.Section, QuestionID: change.QuestionID,
				Released: change.Released, OldCorrectness: change.OldCorrectness, NewCorrectness: change.NewCorrectness,
				OldAwarded: change.OldAwarded, NewAwarded: change.NewAwarded, OldMax: change.OldMax, NewMax: change.NewMax,
			})
		}
	}
	sort.SliceStable(changes, func(left, right int) bool {
		if changes[left].SubmissionID != changes[right].SubmissionID {
			return changes[left].SubmissionID < changes[right].SubmissionID
		}
		if changes[left].Section != changes[right].Section {
			return changes[left].Section < changes[right].Section
		}
		return changes[left].QuestionID < changes[right].QuestionID
	})
	raw, _ := json.Marshal(changes)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func planScheduleRegrade(ctx context.Context, q tx.Tx, scheduleID, scope string) (objectiveRegradePlan, error) {
	plan := objectiveRegradePlan{ScheduleID: scheduleID, Scope: scope, Submissions: []plannedSubmission{}}
	if scope == "" {
		scope = ObjectiveRegradeScopeAll
	}
	overrides, err := loadProjectionOverrides(ctx, q, scheduleID)
	if err != nil {
		return plan, err
	}
	rows, err := q.QueryContext(ctx, `
		SELECT s.id, s.student_id, s.student_name, s.published_version_id, s.grading_status
		FROM student_submissions s
		JOIN student_attempts a ON a.id = s.attempt_id
			AND a.terminal_generation = s.terminal_generation AND a.submitted_at IS NOT NULL
		WHERE s.schedule_id = ? AND s.provider_key = 'ielts'
		ORDER BY s.id
		FOR UPDATE`, scheduleID)
	if err != nil {
		return plan, err
	}
	type submissionRow struct {
		ID, StudentID, StudentName, VersionID, Status string
	}
	var submissions []submissionRow
	for rows.Next() {
		var row submissionRow
		if err := rows.Scan(&row.ID, &row.StudentID, &row.StudentName, &row.VersionID, &row.Status); err != nil {
			rows.Close()
			return plan, err
		}
		submissions = append(submissions, row)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return plan, err
	}

	type objectiveSource struct {
		content   map[string]any
		versionID string
		keys      map[string]string
	}
	sources := map[string]objectiveSource{}
	for _, row := range submissions {
		plan.Report.AttemptsScanned++
		released := row.Status == SubmissionReleased
		if scope == ObjectiveRegradeScopeReleased && !released {
			continue
		}
		if scope == ObjectiveRegradeScopeUnreleased && released {
			continue
		}
		plan.Report.SubmissionsMatched++
		source, ok := sources[row.VersionID]
		if !ok {
			var contentRaw, configRaw sql.NullString
			if err := q.QueryRowContext(ctx,
				"SELECT CAST(content_snapshot AS CHAR), CAST(config_snapshot AS CHAR) FROM exam_versions WHERE id = ?",
				row.VersionID).Scan(&contentRaw, &configRaw); err != nil {
				return plan, err
			}
			content, _, versionID, err := loadProjectionObjectiveSource(ctx, q, scheduleID, row.VersionID,
				projectionObject(json.RawMessage(contentRaw.String)), projectionObject(json.RawMessage(configRaw.String)))
			if err != nil {
				return plan, err
			}
			keys, err := loadObjectiveAnswerKey(ctx, q, versionID)
			if err != nil {
				return plan, err
			}
			source = objectiveSource{content: content, versionID: versionID, keys: keys}
			sources[row.VersionID] = source
		}

		sections, err := loadRegradeSections(ctx, q, row.ID)
		if err != nil {
			return plan, err
		}
		planned := plannedSubmission{
			ID: row.ID, StudentID: row.StudentID, StudentName: row.StudentName, Released: released,
			Changes: []ObjectiveRegradeChange{}, Sections: []plannedSectionUpdate{},
		}
		for _, section := range sections {
			plan.Report.SectionsChecked++
			stored := projectionObjectValue(projectionObject(json.RawMessage(section.Answers))["answers"])
			_, results := gradeProjectionObjectiveSection(section.Name, stored, source.content, source.keys, overrides, source.versionID)
			previous := projectionObject(json.RawMessage(section.Results.String))
			carryTeacherOverrides(previous, results)
			changed := projectionJSON(previous["questionResults"]) != projectionJSON(results["questionResults"]) ||
				projectionJSON(previous["integrity"]) != projectionJSON(results["integrity"])
			if changed {
				plan.Report.SectionsNeedingUpdate++
				planned.Sections = append(planned.Sections, plannedSectionUpdate{
					SectionID: section.ID, Results: results, Status: projectionObjectiveStatus(results),
				})
			}
			changes := diffQuestionResults(row.ID, row.StudentID, row.StudentName, section.Name, released, previous, results)
			planned.Changes = append(planned.Changes, changes...)
			planned.OldTotal += numberOrZero(previous["totalScore"])
			planned.NewTotal += numberOrZero(results["totalScore"])
			planned.OldMax += numberOrZero(previous["maxScore"])
			planned.NewMax += numberOrZero(results["maxScore"])
		}
		if len(planned.Sections) == 0 && len(planned.Changes) == 0 {
			continue
		}
		plan.Submissions = append(plan.Submissions, planned)
		plan.Report.SubmissionsUpdated++
	}
	plan.Report.SectionsUpdated = plan.Report.SectionsNeedingUpdate
	return plan, nil
}

func diffQuestionResults(submissionID, studentID, studentName, section string, released bool, previous, next map[string]any) []ObjectiveRegradeChange {
	oldByID := questionResultMap(previous["questionResults"])
	newByID := questionResultMap(next["questionResults"])
	ids := map[string]bool{}
	for id := range oldByID {
		ids[id] = true
	}
	for id := range newByID {
		ids[id] = true
	}
	sorted := make([]string, 0, len(ids))
	for id := range ids {
		sorted = append(sorted, id)
	}
	sort.Strings(sorted)
	changes := make([]ObjectiveRegradeChange, 0)
	for _, id := range sorted {
		oldResult, oldOK := oldByID[id]
		newResult, newOK := newByID[id]
		if oldOK == false && newOK == false {
			continue
		}
		change := ObjectiveRegradeChange{
			SubmissionID: submissionID, StudentID: studentID, StudentName: studentName,
			Section: section, QuestionID: id, Released: released,
			OldCorrectness: boolPointer(oldResult["isCorrect"], oldOK),
			NewCorrectness: boolPointer(newResult["isCorrect"], newOK),
			OldAwarded:     numberPointer(oldResult["awardedScore"], oldOK),
			NewAwarded:     numberPointer(newResult["awardedScore"], newOK),
			OldMax:         numberPointer(oldResult["maxScore"], oldOK),
			NewMax:         numberPointer(newResult["maxScore"], newOK),
		}
		if equalOptionalBool(change.OldCorrectness, change.NewCorrectness) &&
			equalOptionalNumber(change.OldAwarded, change.NewAwarded) &&
			equalOptionalNumber(change.OldMax, change.NewMax) {
			continue
		}
		changes = append(changes, change)
	}
	return changes
}

func questionResultMap(raw any) map[string]map[string]any {
	out := map[string]map[string]any{}
	items, _ := raw.([]any)
	for _, item := range items {
		result, _ := item.(map[string]any)
		if id, _ := result["questionId"].(string); id != "" {
			out[id] = result
		}
	}
	return out
}

func boolPointer(value any, ok bool) *bool {
	if !ok {
		return nil
	}
	if boolean, ok := value.(bool); ok {
		return &boolean
	}
	return nil
}

func numberPointer(value any, ok bool) *float64 {
	if !ok {
		return nil
	}
	if number, ok := value.(float64); ok {
		return &number
	}
	if number, ok := value.(int); ok {
		converted := float64(number)
		return &converted
	}
	return nil
}

func equalOptionalBool(left, right *bool) bool {
	if left == nil || right == nil {
		return left == right
	}
	return *left == *right
}

func equalOptionalNumber(left, right *float64) bool {
	if left == nil || right == nil {
		return left == right
	}
	return *left == *right
}

func applyRegradePlan(ctx context.Context, q tx.Tx, plan objectiveRegradePlan, actorID, actorName, action string, payload map[string]any) error {
	for _, submission := range plan.Submissions {
		for _, section := range submission.Sections {
			if _, err := q.ExecContext(ctx, `
				UPDATE section_submissions
				SET auto_grading_results = ?,
					grading_status = CASE WHEN grading_status IN ('auto_graded', 'needs_review') THEN ? ELSE grading_status END
				WHERE id = ?`,
				projectionJSON(section.Results), section.Status, section.SectionID); err != nil {
				return err
			}
		}
	}
	payload["report"] = plan.Report
	payload["submissions"] = regradeAuditSubmissions(plan)
	return appendScheduleOverrideEvent(ctx, q, plan.ScheduleID, actorID, actorName, action, payload)
}

func regradeAuditSubmissions(plan objectiveRegradePlan) []map[string]any {
	out := make([]map[string]any, 0, len(plan.Submissions))
	for _, submission := range plan.Submissions {
		out = append(out, map[string]any{
			"submissionId": submission.ID, "studentId": submission.StudentID, "studentName": submission.StudentName,
			"released": submission.Released, "oldTotalScore": submission.OldTotal, "newTotalScore": submission.NewTotal,
			"oldMaxScore": submission.OldMax, "newMaxScore": submission.NewMax,
			"questionChanges": len(submission.Changes),
		})
	}
	return out
}

// ObjectiveRegradePreviewText is a compact operator-facing summary.
func ObjectiveRegradePreviewText(preview ObjectiveRegradePreview) string {
	if preview.Summary.Changed == 0 {
		return "No saved objective scores would change."
	}
	return fmt.Sprintf("%d submissions change (%d released, %d unreleased), %d question changes, score delta %+.2f.",
		preview.Summary.Changed, preview.Summary.Released, preview.Summary.Unreleased,
		preview.Summary.QuestionChange, preview.Summary.ScoreDelta)
}
