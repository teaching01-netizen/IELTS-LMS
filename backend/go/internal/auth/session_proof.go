package auth

import (
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"github.com/google/uuid"
)

// SessionProof records the server authentication boundary that established the
// principal. Display email/name and a legacy role snapshot are not that proof.
// Account covers password, activation/reset-token, and trusted bootstrap paths.
// Practice covers a validated opaque capability and remains sitting-scoped.
type SessionProof struct {
	Source             string
	PracticeScheduleID string
}

const (
	SessionSourceAccount  = "account"
	SessionSourcePractice = "practice"
)

func (p SessionProof) validate(role string) error {
	switch p.Source {
	case SessionSourceAccount:
		if p.PracticeScheduleID == "" {
			return nil
		}
	case SessionSourcePractice:
		id, err := uuid.Parse(p.PracticeScheduleID)
		if role == RoleStudent && err == nil && id != uuid.Nil {
			return nil
		}
	}
	return apperrors.New(apperrors.CodeUnauthorized, "A verified authentication origin is required.")
}

// validateStored accepts pre-proof sessions (NULL origin). They keep ordinary
// session authority but never qualify as proof for selecting an existing
// sitting; handlers compare Source explicitly.
func (p SessionProof) validateStored(role string) error {
	if p.Source == "" && p.PracticeScheduleID == "" {
		return nil
	}
	return p.validate(role)
}
