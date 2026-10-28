package exams

// Staff-assisted device recovery: shared attempt-owned values.
//
// The recovery control is written only by the server and stored as JSON on
// student_attempts.recovery_control (migration 0105). It is deliberately
// separate from student_attempts.recovery, which belongs to the draft
// compatibility contract and must never be reinterpreted by this feature.
//
// Ownership of the types lives here because both attempts (writer authority)
// and delivery/runtime (continuation orchestration) need the vocabulary, and
// attempts already imports runtime: runtime must not import attempts, so a
// neutral package is required. exams has no dependency on either package.
//
// The control is an authority statement, not a clock. The effective working
// deadline stays in the provider-owned clock (SAT module attempt, IELTS
// timeline, or the attempt-owned recovery deadline); the grant keeps the
// requested policy. Suspended stages hold deliberate frozen continuation
// seconds for successors, never a competing active countdown.

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// RecoveryControlVersion is the only persisted control version this build
// understands. A row carrying another version is malformed rather than
// forward-compatible: writing authority data we cannot interpret must fail
// closed, because guessing would either strand a student or grant access.
const RecoveryControlVersion = "staff_recovery_v1"

// Recovery control phases.
const (
	// RecoveryPhaseHeld: staff began a transfer. No browser is an authorized
	// writer until the target explicitly continues.
	RecoveryPhaseHeld = "held"
	// RecoveryPhaseWorking: the target browser continued and owns the focused
	// run. Ordinary saves are authorized for that owner only.
	RecoveryPhaseWorking = "working"
	// RecoveryPhaseReturning: staff designated the original browser for
	// return. No writer exists until that browser explicitly continues.
	RecoveryPhaseReturning = "returning"
)

// Recovery target and suspension bounds. These reject corrupt stored values;
// they are not product policy knobs.
const (
	maxRecoveryIDLength     = 64
	maxRecoveryStateLength  = 32
	maxSuspendedStages      = 32
	maxSuspendedStageSecond = 7 * 24 * 60 * 60
)

// ErrRecoveryControlMalformed is the sentinel for any stored control that
// cannot be trusted. Callers translate it into an unavailable state and must
// not fall back to ordinary admission.
var ErrRecoveryControlMalformed = errors.New("recovery control is malformed")

// RecoveryTarget identifies the one stage a recovery focuses.
//
// ModuleAttemptID is empty for snapshot-backed section-only providers
// (IELTS sections and legacy ACT sections). ModuleID is retained because the
// module identity, not the module-attempt identity, is what the published
// version pins; a reopened run keeps the same module attempt row and advances
// its run generation instead of inserting a second identity.
type RecoveryTarget struct {
	SectionKey      string `json:"sectionKey"`
	ModuleAttemptID string `json:"moduleAttemptId,omitempty"`
	ModuleID        string `json:"moduleId,omitempty"`
}

// Normalized returns the target with surrounding whitespace removed.
func (t RecoveryTarget) Normalized() RecoveryTarget {
	return RecoveryTarget{
		SectionKey:      strings.TrimSpace(t.SectionKey),
		ModuleAttemptID: strings.TrimSpace(t.ModuleAttemptID),
		ModuleID:        strings.TrimSpace(t.ModuleID),
	}
}

// Empty reports whether the target names no stage.
func (t RecoveryTarget) Empty() bool {
	n := t.Normalized()
	return n.SectionKey == "" && n.ModuleAttemptID == "" && n.ModuleID == ""
}

// Equal compares two targets after normalization.
func (t RecoveryTarget) Equal(other RecoveryTarget) bool {
	return t.Normalized() == other.Normalized()
}

// Validate checks the structural target contract. provider may be empty when
// the caller does not yet know it; a known provider additionally enforces the
// published section vocabulary.
func (t RecoveryTarget) Validate(provider string) error {
	n := t.Normalized()
	if n.SectionKey == "" {
		return fmt.Errorf("%w: target section is required", ErrRecoveryControlMalformed)
	}
	if provider != "" && !ValidSectionKey(provider, n.SectionKey) {
		return fmt.Errorf("%w: section %q is not valid for provider %q", ErrRecoveryControlMalformed, n.SectionKey, provider)
	}
	if len(n.SectionKey) > maxRecoveryIDLength {
		return fmt.Errorf("%w: target section is too long", ErrRecoveryControlMalformed)
	}
	if len(n.ModuleAttemptID) > maxRecoveryIDLength || len(n.ModuleID) > maxRecoveryIDLength {
		return fmt.Errorf("%w: target module identity is too long", ErrRecoveryControlMalformed)
	}
	if (n.ModuleAttemptID == "") != (n.ModuleID == "") {
		return fmt.Errorf("%w: target module attempt and module id must be supplied together", ErrRecoveryControlMalformed)
	}
	return nil
}

// SuspendedRecoveryStage is a successor clock frozen at Continue time.
//
// RemainingSeconds is the continuation value: on focus completion the stage
// resumes at now + RemainingSeconds. Zero is meaningful and must never be
// turned into a fresh allocation. EntryRemainingSeconds and
// BreakRemainingSeconds preserve an already-armed offer/break window so a
// rewind never re-awards a form or a break.
type SuspendedRecoveryStage struct {
	Target                RecoveryTarget `json:"target"`
	State                 string         `json:"state"`
	RemainingSeconds      int            `json:"remainingSeconds"`
	EntryRemainingSeconds *int           `json:"entryRemainingSeconds,omitempty"`
	BreakRemainingSeconds *int           `json:"breakRemainingSeconds,omitempty"`
	RunGeneration         uint64         `json:"runGeneration"`
}

// RecoveryControl is the persisted attempt-owned transfer authority.
type RecoveryControl struct {
	Version            string         `json:"version"`
	ID                 string         `json:"id"`
	Phase              string         `json:"phase"`
	ActiveGrantID      string         `json:"activeGrantId"`
	OriginalSessionID  string         `json:"originalSessionId"`
	Target             RecoveryTarget `json:"target"`
	FocusRunGeneration uint64         `json:"focusRunGeneration"`
	// FocusDeadlineAt is the common writer/read projection of the provider
	// clock. Provider clock mutations refresh it in the same transaction.
	// For snapshot sections without a per-attempt timeline it owns the deadline.
	FocusDeadlineAt *time.Time               `json:"focusDeadlineAt,omitempty"`
	Suspended       []SuspendedRecoveryStage `json:"suspended,omitempty"`
	// Break clocks stay in their existing rows. These identities keep ordinary
	// pause/resume from releasing them before the recovered module finishes.
	SuspendedBreakIDs []string   `json:"suspendedBreakIds,omitempty"`
	FocusPausedAt     *time.Time `json:"focusPausedAt,omitempty"`
	FocusStartedAt    *time.Time `json:"focusStartedAt,omitempty"`
}

// NewRecoveryControl builds a held control for a first or new transfer.
func NewRecoveryControl(id, originalSessionID string, target RecoveryTarget) RecoveryControl {
	return RecoveryControl{
		Version:           RecoveryControlVersion,
		ID:                strings.TrimSpace(id),
		Phase:             RecoveryPhaseHeld,
		OriginalSessionID: strings.TrimSpace(originalSessionID),
		Target:            target.Normalized(),
	}
}

// Validate rejects a control this build cannot safely enforce.
func (c RecoveryControl) Validate() error {
	if c.Version != RecoveryControlVersion {
		return fmt.Errorf("%w: unsupported version %q", ErrRecoveryControlMalformed, c.Version)
	}
	if id := strings.TrimSpace(c.ID); id == "" || len(id) > maxRecoveryIDLength {
		return fmt.Errorf("%w: control id is required and bounded", ErrRecoveryControlMalformed)
	}
	switch c.Phase {
	case RecoveryPhaseHeld, RecoveryPhaseWorking, RecoveryPhaseReturning:
	default:
		return fmt.Errorf("%w: unknown phase %q", ErrRecoveryControlMalformed, c.Phase)
	}
	if len(strings.TrimSpace(c.ActiveGrantID)) > maxRecoveryIDLength {
		return fmt.Errorf("%w: active grant id is too long", ErrRecoveryControlMalformed)
	}
	if len(strings.TrimSpace(c.OriginalSessionID)) > maxRecoveryIDLength {
		return fmt.Errorf("%w: original session id is too long", ErrRecoveryControlMalformed)
	}
	if err := c.Target.Validate(""); err != nil {
		return err
	}
	if c.FocusDeadlineAt != nil && c.FocusDeadlineAt.IsZero() {
		return fmt.Errorf("%w: focus deadline is zero", ErrRecoveryControlMalformed)
	}
	if len(c.Suspended) > maxSuspendedStages {
		return fmt.Errorf("%w: too many suspended stages", ErrRecoveryControlMalformed)
	}
	if len(c.SuspendedBreakIDs) > maxSuspendedStages {
		return fmt.Errorf("%w: too many suspended breaks", ErrRecoveryControlMalformed)
	}
	breaks := map[string]bool{}
	for _, id := range c.SuspendedBreakIDs {
		if strings.TrimSpace(id) == "" || len(id) > maxRecoveryIDLength || breaks[id] {
			return fmt.Errorf("%w: invalid suspended break identity", ErrRecoveryControlMalformed)
		}
		breaks[id] = true
	}
	seen := make(map[string]bool, len(c.Suspended))
	for i, stage := range c.Suspended {
		if err := stage.Target.Validate(""); err != nil {
			return fmt.Errorf("suspended stage %d: %w", i, err)
		}
		key := RecoveryTargetKey(stage.Target)
		if seen[key] {
			return fmt.Errorf("%w: duplicate suspended target %q", ErrRecoveryControlMalformed, key)
		}
		seen[key] = true
		if state := strings.TrimSpace(stage.State); state == "" || len(state) > maxRecoveryStateLength {
			return fmt.Errorf("%w: suspended stage %d has no bounded state", ErrRecoveryControlMalformed, i)
		}
		if !validSuspendedSeconds(stage.RemainingSeconds) {
			return fmt.Errorf("%w: suspended stage %d has an invalid remaining time", ErrRecoveryControlMalformed, i)
		}
		if stage.EntryRemainingSeconds != nil && !validSuspendedSeconds(*stage.EntryRemainingSeconds) {
			return fmt.Errorf("%w: suspended stage %d has an invalid entry time", ErrRecoveryControlMalformed, i)
		}
		if stage.BreakRemainingSeconds != nil && !validSuspendedSeconds(*stage.BreakRemainingSeconds) {
			return fmt.Errorf("%w: suspended stage %d has an invalid break time", ErrRecoveryControlMalformed, i)
		}
	}
	return nil
}

func validSuspendedSeconds(seconds int) bool {
	return seconds >= 0 && seconds <= maxSuspendedStageSecond
}

// ParseRecoveryControl decodes and validates a stored control. An empty or
// NULL value is not a control at all and is reported as (nil, nil); every
// other malformed value fails closed with ErrRecoveryControlMalformed.
func ParseRecoveryControl(raw []byte) (*RecoveryControl, error) {
	if len(strings.TrimSpace(string(raw))) == 0 {
		return nil, nil
	}
	var control RecoveryControl
	if err := json.Unmarshal(raw, &control); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrRecoveryControlMalformed, err)
	}
	if err := control.Validate(); err != nil {
		return nil, err
	}
	return &control, nil
}

// RecoveryTargetKey is the stable merge/dedupe identity of a target.
func RecoveryTargetKey(target RecoveryTarget) string {
	n := target.Normalized()
	return n.SectionKey + "\x00" + n.ModuleAttemptID + "\x00" + n.ModuleID
}

// MergeSuspendedStages keeps every already-frozen continuation value and
// appends stages a new transfer discovered. Existing values win on conflict:
// they were captured earlier at a server transaction time, so replacing them
// with a later snapshot would hand the successor extra time. The result is
// deterministic (existing order, then new order) and contains no duplicates.
func MergeSuspendedStages(existing, incoming []SuspendedRecoveryStage) []SuspendedRecoveryStage {
	if len(existing) == 0 && len(incoming) == 0 {
		return nil
	}
	seen := make(map[string]bool, len(existing)+len(incoming))
	out := make([]SuspendedRecoveryStage, 0, len(existing)+len(incoming))
	for _, stage := range existing {
		key := RecoveryTargetKey(stage.Target)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, stage)
	}
	for _, stage := range incoming {
		key := RecoveryTargetKey(stage.Target)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, stage)
	}
	return out
}
