package auth

import (
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"github.com/google/uuid"
)

// SessionProof records the server authentication boundary that established the
// principal. Display email/name and a legacy role snapshot are not that proof.
// Account covers password, activation/reset-token, and trusted bootstrap paths.
// Practice covers a validated opaque capability and remains sitting-scoped.
// Recovery covers a single-use staff-assisted continuation: it is always bound
// to one attempt and derives its schedule from that attempt row.
type SessionProof struct {
	Source             string
	PracticeScheduleID string
	RecoveryAttemptID  string
	// RecoveryScheduleID is never supplied by a caller. Session lookups derive
	// it from the bound attempt before the proof is accepted.
	RecoveryScheduleID string
}

const (
	SessionSourceAccount  = "account"
	SessionSourcePractice = "practice"
	SessionSourceRecovery = "recovery"
)

func (p SessionProof) validate(role string) error {
	switch p.Source {
	case SessionSourceAccount:
		if p.PracticeScheduleID == "" && p.RecoveryAttemptID == "" && p.RecoveryScheduleID == "" {
			return nil
		}
	case SessionSourcePractice:
		id, err := uuid.Parse(p.PracticeScheduleID)
		if role == RoleStudent && err == nil && id != uuid.Nil &&
			p.RecoveryAttemptID == "" && p.RecoveryScheduleID == "" {
			return nil
		}
	case SessionSourceRecovery:
		// The schedule is server-derived, never caller-supplied. Requiring it
		// to be empty here keeps the create boundary unable to bind a session
		// to a schedule other than the attempt's own.
		id, err := uuid.Parse(p.RecoveryAttemptID)
		if role == RoleStudent && err == nil && id != uuid.Nil &&
			p.PracticeScheduleID == "" && p.RecoveryScheduleID == "" {
			return nil
		}
	}
	return apperrors.New(apperrors.CodeUnauthorized, "A verified authentication origin is required.")
}

// validateStored accepts pre-proof sessions (NULL origin). They keep ordinary
// session authority but never qualify as proof for selecting an existing
// sitting; handlers compare Source explicitly.
func (p SessionProof) validateStored(role string) error {
	if p.Source == "" && p.PracticeScheduleID == "" && p.RecoveryAttemptID == "" {
		return nil
	}
	if p.Source == SessionSourceRecovery {
		if role != RoleStudent || p.PracticeScheduleID != "" {
			return apperrors.New(apperrors.CodeUnauthorized, "A verified authentication origin is required.")
		}
		attemptID, attemptErr := uuid.Parse(p.RecoveryAttemptID)
		scheduleID, scheduleErr := uuid.Parse(p.RecoveryScheduleID)
		if attemptErr == nil && scheduleErr == nil && attemptID != uuid.Nil && scheduleID != uuid.Nil {
			return nil
		}
		return apperrors.New(apperrors.CodeUnauthorized, "A verified authentication origin is required.")
	}
	return p.validate(role)
}

// IsRecovery reports whether this proof is a scoped recovery origin.
func (p SessionProof) IsRecovery() bool {
	return p.Source == SessionSourceRecovery
}
