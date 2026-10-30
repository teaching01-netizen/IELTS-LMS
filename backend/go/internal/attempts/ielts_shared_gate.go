package attempts

import (
	"example.com/ielts-proctoring/internal/platform/apperrors"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// Section-scoped refusals for the IELTS shared timetable. The code stays the
// historical one; the reason and sectionKey let a client confine the refusal
// (and the evidence it retains) to that section's drafts.
const (
	ReasonIELTSSectionClosed  = "IELTS_SECTION_CLOSED"
	ReasonIELTSSectionNotOpen = "IELTS_SECTION_NOT_OPEN"
)

func sharedSectionRejection(code apperrors.Code, message, reason, sectionKey, questionID string) *apperrors.Error {
	details := map[string]any{"reason": reason, "sectionKey": sectionKey}
	if questionID != "" {
		details["questionId"] = questionID
	}
	return &apperrors.Error{Code: code, Message: message, HTTPStatus: 422, Details: details}
}

func usesSharedSchedule(gate RuntimeGate) bool {
	return examruntime.IsIELTSSharedSchedule(gate.TimingModel)
}

func resolveSharedGate(gate RuntimeGate) (examruntime.IELTSSharedPosition, error) {
	if gate.SharedSchedule == nil {
		return examruntime.IELTSSharedPosition{}, &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "The IELTS room schedule is unavailable.", HTTPStatus: 422}
	}
	pos, err := examruntime.ResolveIELTSSharedWindow(*gate.SharedSchedule, gate.Now)
	if err != nil {
		return pos, &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "The IELTS room schedule is unavailable.", HTTPStatus: 422}
	}
	return pos, nil
}

// ensureSharedScheduleWritable is the attempt-level gate for the shared
// timetable. The committed schedule, resolved at database time, replaces the
// section-row projections, which a late worker may not have advanced yet.
func ensureSharedScheduleWritable(gate RuntimeGate) error {
	if gate.Status == "paused" {
		return savePaused("Exam runtime is paused.")
	}
	if gate.Status != "" && gate.Status != "live" {
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Exam runtime is not live.", HTTPStatus: 422}
	}
	pos, err := resolveSharedGate(gate)
	if err != nil {
		return err
	}
	switch pos.Kind {
	case examruntime.SharedPaused:
		return savePaused("Exam runtime is paused.")
	case examruntime.SharedComplete:
		return sharedSectionRejection(apperrors.CodeDeadlineExpired, "Response deadline has passed.", ReasonIELTSSectionClosed, "", "")
	}
	// Before start and gaps are refused per question, with the section named.
	return nil
}

// ensureSharedQuestionAdmitted accepts a write only for the section whose
// committed window is working or draining at database time.
func ensureSharedQuestionAdmitted(owner QuestionOwner, gate RuntimeGate, questionID string) error {
	pos, err := resolveSharedGate(gate)
	if err != nil {
		return err
	}
	if pos.Accepts(owner.SectionKey) {
		return nil
	}
	if pos.Kind == examruntime.SharedPaused {
		return savePaused("Exam runtime is paused.")
	}
	// A section without a window was cut by an early end: it is closed.
	if w, ok := gate.SharedSchedule.WindowFor(owner.SectionKey); !ok || !gate.Now.Before(w.SaveUntil) {
		return sharedSectionRejection(apperrors.CodeDeadlineExpired, "This IELTS section has closed.", ReasonIELTSSectionClosed, owner.SectionKey, questionID)
	}
	return sharedSectionRejection(apperrors.CodeAttemptNotWritable, "This IELTS section is not open.", ReasonIELTSSectionNotOpen, owner.SectionKey, questionID)
}
