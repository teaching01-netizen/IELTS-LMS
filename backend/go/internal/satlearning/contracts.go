// Package satlearning owns the SAT activity learning policy, the immutable
// mode/capability snapshot bound to one admitted attempt, the qualifying
// completion count, and the safe answer-key projection contract.
//
// It sits below results, delivery, terminalization, schedules, and
// satclassroom in the import graph: it imports only the database/tx boundary
// and standard library packages so every caller can depend on one authority
// without a cycle.
package satlearning

import (
	"encoding/json"
	"time"
)

// Mode is the admitted attempt mode. Anything other than the two canonical
// values is malformed metadata and must fail closed.
type Mode string

const (
	ModeTest  Mode = "test"
	ModeStudy Mode = "study"
)

const (
	// DefaultRequiredCompletions is the product default unlock threshold.
	DefaultRequiredCompletions int64 = 1
	// MaxRequiredCompletions mirrors the int32 bound in the storage contract.
	MaxRequiredCompletions int64 = 2147483647
)

// StudyPermissions is the teacher's Study configuration. Preferences persist
// while Study is disabled so re-enabling restores the teacher's choices.
type StudyPermissions struct {
	Enabled             bool  `json:"enabled"`
	RequiredCompletions int64 `json:"requiredCompletions"`
	RevealAnswers       bool  `json:"revealAnswers"`
	Untimed             bool  `json:"untimed"`
}

// Policy is one activity's effective learning policy. Revision is the
// optimistic-concurrency token; the writer owns increments.
type Policy struct {
	Revision              int64            `json:"revision"`
	ReportVisible         bool             `json:"reportVisible"`
	IncludeAnswerKeyInPdf bool             `json:"includeAnswerKeyInPdf"`
	UnlimitedRetakes      bool             `json:"unlimitedRetakes"`
	PauseOnLeave          bool             `json:"pauseOnLeave"`
	Study                 StudyPermissions `json:"study"`
}

// Capabilities are the runtime grants an admitted Study attempt carries. A
// Test attempt always carries zero.
type Capabilities struct {
	RevealAnswers bool `json:"revealAnswers"`
	Untimed       bool `json:"untimed"`
}

// Snapshot is the immutable admission-time decision. Legacy reports whether
// the attempt predates attempt-learning metadata (and therefore is a Test).
type Snapshot struct {
	Mode           Mode         `json:"mode"`
	PolicyRevision int64        `json:"policyRevision"`
	Capabilities   Capabilities `json:"capabilities"`
	Legacy         bool         `json:"-"`
}

// EligibilityReason explains why a Study start cannot proceed. nil means the
// start is allowed. JSON must render null, so the field is a pointer.
type EligibilityReason string

const (
	ReasonDisabled           EligibilityReason = "disabled"
	ReasonCompletionRequired EligibilityReason = "completion_required"
	ReasonActiveAttempt      EligibilityReason = "active_attempt"
	ReasonStartsClosed       EligibilityReason = "starts_closed"
)

// Eligibility is the measured projection returned to a student. It never
// contains keys, answers, or client-supplied capability flags.
type Eligibility struct {
	CompletedTestAttempts int64              `json:"completedTestAttempts"`
	RequiredCompletions   int64              `json:"requiredCompletions"`
	Eligible              bool               `json:"eligible"`
	CanStart              bool               `json:"canStart"`
	Reason                *EligibilityReason `json:"reason"`
	Capabilities          Capabilities       `json:"capabilities"`
}

// JSON renders the wire projection. Kept here so tests assert null reasons
// without importing a handler package.
func (e Eligibility) JSON() (string, error) {
	body, err := json.Marshal(e)
	return string(body), err
}

// CompletionScope identifies one student's credit boundary: one activity
// (schedule) plus one pinned published version.
type CompletionScope struct {
	ScheduleID       string
	StudentID        string
	PublishedVersion string
}

// CompletionFacts are the canonical lifecycle inputs to the pure completion
// predicate. Phase text is informational only; terminal facts win.
type CompletionFacts struct {
	Mode                      Mode
	Submitted                 bool
	Phase                     string
	TerminalOutcome           string
	TerminalGenerationCurrent bool
	ProctorStatus             string
}

// AttemptLearningRow is the insert-only admission snapshot row.
type AttemptLearningRow struct {
	AttemptID        string
	ScheduleID       string
	PublishedVersion string
	StudentID        string
	Ordinal          int
	Mode             Mode
	PolicyRevision   int64
	RevealAnswers    bool
	Untimed          bool
	AdmittedAt       time.Time
}

// AnswerKeyAnswer is one accepted representation (choice letter + text or an
// accepted SPR value).
type AnswerKeyAnswer struct {
	Label string `json:"label"`
	Text  string `json:"text"`
}

// AnswerKey is the separately authorized current-question key projection.
type AnswerKey struct {
	ExamQuestionID   string            `json:"examQuestionId"`
	ModuleID         string            `json:"moduleId"`
	ResponseRevision int64             `json:"responseRevision"`
	Kind             string            `json:"kind"`
	CorrectAnswers   []AnswerKeyAnswer `json:"correctAnswers"`
	Result           string            `json:"result"`
}
