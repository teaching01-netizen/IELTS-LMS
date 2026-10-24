package delivery

import (
	"context"
	"database/sql"
	"errors"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/results"
)

// AnsweredExam is the print projection of a sealed SAT attempt
// (docs/sat-result.md §4–5): the attempt's pinned published version narrowed to
// the modules it administered, with the responses the server accepted. Content
// comes from LoadSections, so it carries no answer keys, rationales or scoring
// rules, and never a module the student did not start.
type AnsweredExam struct {
	AttemptID     string            `json:"attemptId"`
	ExamTitle     string            `json:"examTitle"`
	CandidateName string            `json:"candidateName"`
	VersionID     string            `json:"versionId"`
	Sections      []DeliverySection `json:"sections"`
	Attempt       AttemptSnapshot   `json:"attempt"`
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
// their score report is open, as the result screen shows it.
func (s *Service) AnsweredExamForStudent(ctx context.Context, bearerScheduleID, bearerAttemptID, urlScheduleID string) (*AnsweredExam, error) {
	if urlScheduleID != bearerScheduleID {
		return nil, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule.")
	}
	var open bool
	err := s.db.QueryRowContext(ctx, results.SATScoreReportOpenSQL+" AND sa.schedule_id = ?", bearerAttemptID, bearerScheduleID).Scan(&open)
	if err == sql.ErrNoRows {
		return nil, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
	}
	if err != nil {
		return nil, err
	}
	if !open {
		return nil, apperrors.New(apperrors.CodeForbidden, "The answered exam is not available for this session.")
	}
	return s.AnsweredExam(ctx, bearerAttemptID)
}

// AnsweredExam builds the projection. Callers authorize the attempt first.
// It is refused with 409 until the attempt is terminal and with 429 when
// answeredExamSlots builds are already running (PDF-09).
func (s *Service) AnsweredExam(ctx context.Context, attemptID string) (*AnsweredExam, error) {
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
	return out, err
}

func (s *Service) answeredExamSnapshot(ctx context.Context, attemptID string) (*AnsweredExam, error) {
	out := &AnsweredExam{AttemptID: attemptID}
	// The attempt's own published version: the version it was delivered,
	// whatever the exam or schedule points at now (PDF-07).
	err := s.db.QueryRowContext(ctx, "SELECT sa.published_version_id, COALESCE(sch.exam_title, '') FROM student_attempts sa JOIN exam_schedules sch ON sch.id = sa.schedule_id JOIN exam_entities e ON e.id = sa.exam_id AND e.provider_key = 'sat' WHERE sa.id = ?", attemptID).Scan(&out.VersionID, &out.ExamTitle)
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
