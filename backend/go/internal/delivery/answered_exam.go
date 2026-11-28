package delivery

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"example.com/ielts-proctoring/internal/assessscore"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satlearning"
)

// AnsweredExam is the print projection of a sealed SAT attempt
// (docs/sat-result.md §4–5): the attempt's pinned published version narrowed to
// the modules it administered, with the responses the server accepted. Content
// comes from LoadSections, so it carries no answer keys, rationales or scoring
// rules, and never a module the student did not start. AnswerKey is attached
// only by the separately authorized keyed-PDF path; the ordinary projection
// leaves it nil.
type AnsweredExam struct {
	ExamID        string            `json:"-"`
	AttemptID     string            `json:"attemptId"`
	ExamTitle     string            `json:"examTitle"`
	CandidateName string            `json:"candidateName"`
	VersionID     string            `json:"versionId"`
	Sections      []DeliverySection `json:"sections"`
	Attempt       AttemptSnapshot   `json:"attempt"`
	// AnswerKey is the server-owned key projection. Nil on every ordinary
	// read; only an authorized keyed export receives entries.
	AnswerKey *AnsweredExamAnswerKey `json:"answerKey,omitempty"`
}

// AnsweredExamAnswerKey mirrors the client print contract. Available=false is
// the honest answer-only fallback; no entry is ever fabricated.
type AnsweredExamAnswerKey struct {
	Available      bool                   `json:"available"`
	PolicyRevision int64                  `json:"policyRevision"`
	VersionID      string                 `json:"versionId"`
	Entries        []AnsweredExamKeyEntry `json:"entries"`
}

// AnsweredExamKeyEntry is one authorized row: the correct answers plus the
// server's verdict against the accepted response.
type AnsweredExamKeyEntry struct {
	ModuleID       string                        `json:"moduleId"`
	ExamQuestionID string                        `json:"examQuestionId"`
	CorrectAnswers []satlearning.AnswerKeyAnswer `json:"correctAnswers"`
	Result         string                        `json:"result"`
	Explanation    json.RawMessage               `json:"explanation,omitempty"`
}

// ErrAnsweredExamBusy reports a full build bound; handlers render it as 429
// with Retry-After (PDF-09).
var ErrAnsweredExamBusy = errors.New("answered exam builds are at capacity")

// offcut: one process-local bound; a shared queue only if one node cannot absorb a cohort's downloads
const answeredExamSlots = 16

func (s *Service) answeredExamSlot() (release func(), ok bool) {
	s.answeredOnce.Do(func() { s.answered = make(chan struct{}, answeredExamSlots) })
	select {
	case s.answered <- struct{}{}:
		return func() { <-s.answered }, true
	default:
		return nil, false
	}
}

// AnsweredExamForStudent serves the bearer's own attempt: the attempt id comes
// from the credential, never the request, and the student gets it only while
// their score report is open under the activity policy.
func (s *Service) AnsweredExamForStudent(ctx context.Context, bearerScheduleID, bearerAttemptID, urlScheduleID string) (*AnsweredExam, error) {
	return s.AnsweredExamForStudentWithKey(ctx, bearerScheduleID, bearerAttemptID, urlScheduleID, false)
}

// AnsweredExamForStudentWithKey is the same read plus the separately authorized
// key projection when includeKey is true AND the live policy permits it. A
// caller that requests keys when the policy forbids them gets the answer-only
// projection, never a partial or fabricated key.
func (s *Service) AnsweredExamForStudentWithKey(ctx context.Context, bearerScheduleID, bearerAttemptID, urlScheduleID string, includeKey bool) (*AnsweredExam, error) {
	if urlScheduleID != bearerScheduleID {
		return nil, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule.")
	}
	var scheduleID string
	if err := s.db.QueryRowContext(ctx, `SELECT schedule_id FROM student_attempts WHERE id = ?`, bearerAttemptID).Scan(&scheduleID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
		}
		return nil, err
	}
	if scheduleID != bearerScheduleID {
		return nil, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule.")
	}
	policy, err := satlearning.LoadPolicyTx(ctx, s.db, scheduleID)
	if err != nil {
		return nil, err
	}
	if !policy.ReportVisible {
		return nil, apperrors.New(apperrors.CodeForbidden, "The answered exam is not available for this session.")
	}
	return s.AnsweredExamWithKey(ctx, bearerAttemptID, includeKey)
}

// AnsweredExam builds the ordinary projection. Callers authorize the attempt
// first. It is refused with 409 until the attempt is terminal and with 429 when
// answeredExamSlots builds are already running (PDF-09).
func (s *Service) AnsweredExam(ctx context.Context, attemptID string) (*AnsweredExam, error) {
	return s.AnsweredExamWithKey(ctx, attemptID, false)
}

// AnsweredExamWithKey builds the projection and, when includeKey is true and
// the live policy permits it, attaches the authorized key table. A key request
// that is not permitted returns the answer-only paper; a permitted request with
// a missing key fails with the stable ANSWER_KEY_UNAVAILABLE code so no partial
// keyed artifact can be produced.
func (s *Service) AnsweredExamWithKey(ctx context.Context, attemptID string, includeKey bool) (*AnsweredExam, error) {
	release, ok := s.answeredExamSlot()
	if !ok {
		return nil, ErrAnsweredExamBusy
	}
	defer release()
	var out *AnsweredExam
	err := s.runner.WithTxReadOnly(ctx, func(ctx context.Context, q tx.Tx) error {
		var readErr error
		out, readErr = s.withTxDatabase(q).answeredExamSnapshot(ctx, attemptID)
		return readErr
	})
	if err != nil {
		return nil, err
	}
	if includeKey {
		allowed, err := s.KeyedPDFAllowed(ctx, attemptID)
		if err != nil {
			return nil, err
		}
		if allowed {
			if err := s.attachAnswerKey(ctx, out); err != nil {
				return nil, err
			}
		}
	}
	return out, nil
}

// ReportVisible is the live report-release gate used by download handlers. It
// resolves the attempt's schedule policy without building the paper.
func (s *Service) ReportVisible(ctx context.Context, attemptID string) (bool, error) {
	var scheduleID string
	if err := s.db.QueryRowContext(ctx, `SELECT schedule_id FROM student_attempts WHERE id = ?`, attemptID).Scan(&scheduleID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, apperrors.New(apperrors.CodeNotFound, "SAT attempt not found.")
		}
		return false, err
	}
	policy, err := satlearning.LoadPolicyTx(ctx, s.db, scheduleID)
	if err != nil {
		return false, err
	}
	return policy.ReportVisible, nil
}

// KeyedPDFAllowed is the live release gate checked at prepare and again on every
// download: report visible, PDF key permission on, and a valid completed attempt
// (submitted with no termination precedence). It never answers from a cached
// artifact.
func (s *Service) KeyedPDFAllowed(ctx context.Context, attemptID string) (bool, error) {
	var scheduleID, deliveryStatus, proctorStatus, outcome string
	var submitted sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT sa.schedule_id, COALESCE(sa.delivery_status, 'running'),
			COALESCE(sa.proctor_status, 'active'), COALESCE(t.outcome, ''), sa.submitted_at
		FROM student_attempts sa
		LEFT JOIN attempt_terminalizations t
			ON t.attempt_id = sa.id AND t.terminal_generation = sa.terminal_generation
		WHERE sa.id = ?`, attemptID).
		Scan(&scheduleID, &deliveryStatus, &proctorStatus, &outcome, &submitted)
	if errors.Is(err, sql.ErrNoRows) {
		return false, apperrors.New(apperrors.CodeNotFound, "SAT attempt not found.")
	}
	if err != nil {
		return false, err
	}
	policy, err := satlearning.LoadPolicyTx(ctx, s.db, scheduleID)
	if err != nil {
		return false, err
	}
	if !policy.ReportVisible || !policy.IncludeAnswerKeyInPdf {
		return false, nil
	}
	if !submitted.Valid || deliveryStatus == "terminated" || deliveryStatus == "locked" || deliveryStatus == "cancelled" ||
		proctorStatus == "terminated" || outcome == "terminated" {
		return false, nil
	}
	return true, nil
}

// attachAnswerKey fills the key table from the pinned published definitions and
// the accepted response of the administered modules only.
func (s *Service) attachAnswerKey(ctx context.Context, exam *AnsweredExam) error {
	if exam == nil || len(exam.Attempt.ModuleAttempts) == 0 {
		return nil
	}
	moduleIDs := make([]string, 0, len(exam.Attempt.ModuleAttempts))
	seenModule := map[string]bool{}
	for _, module := range exam.Attempt.ModuleAttempts {
		if module.ModuleID == "" || seenModule[module.ModuleID] {
			continue
		}
		seenModule[module.ModuleID] = true
		moduleIDs = append(moduleIDs, module.ModuleID)
	}
	if len(moduleIDs) == 0 {
		return nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(moduleIDs)), ",")
	args := make([]any, 0, len(moduleIDs)+5)
	args = append(args, exam.AttemptID, exam.AttemptID, exam.VersionID)
	for _, id := range moduleIDs {
		args = append(args, id)
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT m.id, eq.id, eq.is_pretest, CAST(qr.answer_definition AS CHAR), CAST(ev.config_snapshot AS CHAR),
			CAST(v.response AS CHAR), CAST(ar.response AS CHAR), CAST(qr.rationale AS CHAR)
		FROM assessment_modules m
		JOIN assessment_sections s ON s.id = m.section_id
		JOIN exam_versions ev ON ev.id = s.exam_version_id
		JOIN assessment_exam_questions eq ON eq.module_id = m.id
		JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id
		LEFT JOIN assessment_module_attempts ma ON ma.module_id = m.id AND ma.attempt_id = ?
		LEFT JOIN assessment_question_responses ar ON ar.module_attempt_id = ma.id AND ar.exam_question_id = eq.id
		LEFT JOIN attempt_responses_v2 v ON v.attempt_id = ma.attempt_id
			AND v.question_id IN (eq.id, eq.question_id) AND v.module_id = m.id
			AND s.exam_version_id = (SELECT published_version_id FROM student_attempts WHERE id = ?)
		WHERE s.exam_version_id = ? AND m.id IN (`+placeholders+`)
		ORDER BY s.display_order, m.display_order, eq.display_order`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	entries := make([]AnsweredExamKeyEntry, 0)
	seenQuestion := map[string]bool{}
	for rows.Next() {
		var moduleID, examQuestionID, answerJSON, configJSON string
		var isPretest bool
		var v2Raw, legacyRaw sql.NullString
		var explanation string
		if err := rows.Scan(&moduleID, &examQuestionID, &isPretest, &answerJSON, &configJSON, &v2Raw, &legacyRaw, &explanation); err != nil {
			return err
		}
		if isPretest || seenQuestion[examQuestionID] {
			continue
		}
		seenQuestion[examQuestionID] = true
		var definition answerKeyDefinition
		if json.Unmarshal([]byte(answerJSON), &definition) != nil {
			return apperrors.New(apperrors.CodeAnswerKeyUnavailable, "This paper's answer key is unavailable.")
		}
		correct, ok := correctAnswers(definition)
		if !ok {
			return apperrors.New(apperrors.CodeAnswerKeyUnavailable, "This paper's answer key is unavailable.")
		}
		response, answered := scoredResponse(v2Raw, legacyRaw)
		policy := assessscore.SATSPRPolicy(configJSON)
		result := "unanswered"
		if answered && assessscore.SATResponseUsable(definition.Kind, response) {
			if assessscore.SATResponseCorrectWithPolicy(answerJSON, true, response, policy) {
				result = "correct"
			} else {
				result = "incorrect"
			}
		}
		entries = append(entries, AnsweredExamKeyEntry{
			ModuleID: moduleID, ExamQuestionID: examQuestionID,
			CorrectAnswers: correct, Result: result, Explanation: json.RawMessage(explanation),
		})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	revision := int64(0)
	var scheduleID string
	if err := s.db.QueryRowContext(ctx, `SELECT schedule_id FROM student_attempts WHERE id = ?`, exam.AttemptID).Scan(&scheduleID); err != nil {
		return err
	}
	policy, err := satlearning.LoadPolicyTx(ctx, s.db, scheduleID)
	if err != nil {
		return err
	}
	revision = policy.Revision
	exam.AnswerKey = &AnsweredExamAnswerKey{
		Available: true, PolicyRevision: revision, VersionID: exam.VersionID, Entries: entries,
	}
	return nil
}

func (s *Service) answeredExamSnapshot(ctx context.Context, attemptID string) (*AnsweredExam, error) {
	out := &AnsweredExam{AttemptID: attemptID}
	// The attempt's own published version: the version it was delivered,
	// whatever the exam or schedule points at now (PDF-07).
	err := s.db.QueryRowContext(ctx, "SELECT sa.exam_id, sa.published_version_id, COALESCE(sch.exam_title, '') FROM student_attempts sa JOIN exam_schedules sch ON sch.id = sa.schedule_id JOIN exam_entities e ON e.id = sa.exam_id AND e.provider_key = 'sat' WHERE sa.id = ?", attemptID).Scan(&out.ExamID, &out.VersionID, &out.ExamTitle)
	if err == sql.ErrNoRows {
		return nil, apperrors.New(apperrors.CodeNotFound, "SAT attempt not found.")
	}
	if err != nil {
		return nil, err
	}
	control, err := s.loadAttemptControl(ctx, attemptID, attemptControl{})
	if err != nil {
		return nil, err
	}
	if !attemptTerminal(control) {
		return nil, apperrors.New(apperrors.CodeConflict, "The answered exam is available once the attempt is complete.")
	}
	out.CandidateName = control.candidateName
	rev, err := s.versionRevision(ctx, out.VersionID)
	if err != nil {
		return nil, err
	}
	sections, err := s.cachedSections(ctx, out.VersionID, rev)
	if err != nil {
		return nil, err
	}
	now, err := s.dbNow(ctx)
	if err != nil {
		return nil, err
	}
	all, err := s.loadModuleAttempts(ctx, attemptID, now)
	if err != nil {
		return nil, err
	}
	administered := make([]ModuleAttempt, 0, len(all))
	started := map[string]bool{}
	for _, m := range all {
		if m.StartedAt != nil {
			administered = append(administered, m)
			started[m.ModuleID] = true
		}
	}
	responses, err := s.loadResponses(ctx, attemptID)
	if err != nil {
		return nil, err
	}
	out.Sections = administeredSections(sections, started)
	out.Attempt = AttemptSnapshot{ID: attemptID, ModuleAttempts: administered, Responses: filterResponsesForModuleAttempts(responses, administered)}
	return out, nil
}

// administeredSections keeps only started modules, base ones included, and
// drops sections left empty. Like deliverySectionsForOpenedModules it copies,
// so the version cache's shared tree is never mutated.
func administeredSections(sections []DeliverySection, started map[string]bool) []DeliverySection {
	out := make([]DeliverySection, 0, len(sections))
	for _, section := range sections {
		modules := make([]DeliveryModule, 0, len(section.Modules))
		for _, module := range section.Modules {
			if started[module.ID] {
				modules = append(modules, module)
			}
		}
		if len(modules) > 0 {
			section.Modules = modules
			out = append(out, section)
		}
	}
	return out
}

// attemptTerminal is the terminal projection boundary loadBootstrapResult
// reads results behind: sealed, or ended by staff.
func attemptTerminal(c attemptControl) bool {
	return c.submittedAt != nil || c.deliveryStatus == "terminated" || c.deliveryStatus == "locked" || c.deliveryStatus == "cancelled"
}
