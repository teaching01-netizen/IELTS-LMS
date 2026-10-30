package attempts

import (
	"context"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// Access is an authorized view of the existing credential, not a renewal.
// Returning it never rotates its ID or extends its absolute expiry.
type Access struct {
	AttemptID        string    `json:"attemptId"`
	ClientSessionID  string    `json:"clientSessionId"`
	LeaseEpoch       uint64    `json:"leaseEpoch"`
	CredentialPolicy string    `json:"credentialPolicy"`
	ExpiresAt        time.Time `json:"expiresAt"`
	AttemptToken     string    `json:"attemptToken"`
}

func (s *Service) authorizeAccessTx(ctx context.Context, q tx.Tx, claims crypto.AttemptClaims, attemptID string) (AttemptState, error) {
	if claims.AttemptID != attemptID {
		return AttemptState{}, apperrors.New(apperrors.CodeForbidden, "The credential does not belong to this exam attempt.")
	}
	attempt, err := lockAttempt(ctx, q, attemptID)
	if err != nil {
		return AttemptState{}, err
	}
	if claims.AttemptID != attemptID || claims.UserID != attempt.UserID || claims.ScheduleID != attempt.ScheduleID {
		return AttemptState{}, apperrors.New(apperrors.CodeForbidden, "The credential does not belong to this exam attempt.")
	}
	if claims.OrganizationID != "" && attempt.OrganizationID != "" && claims.OrganizationID != attempt.OrganizationID {
		return AttemptState{}, apperrors.New(apperrors.CodeForbidden, "The credential does not belong to this organization.")
	}
	if err = s.validateTokenSession(ctx, q, claims); err != nil {
		return AttemptState{}, err
	}
	if err = validateClaimLease(attempt, claims); err != nil {
		return AttemptState{}, err
	}
	if err := ensureActiveSession(attempt, claims); err != nil {
		return AttemptState{}, err
	}
	return attempt, nil
}

func (s *Service) ResumeAccess(ctx context.Context, bearer, attemptID string) (Access, error) {
	if err := ValidateAttemptID(attemptID); err != nil {
		return Access{}, err
	}
	claims, err := crypto.VerifyAttemptToken(s.secret, s.clock.Now(), bearer)
	if err != nil {
		return Access{}, auth.AttemptCredentialError(err)
	}
	err = s.tx.WithTxRC(ctx, func(ctx context.Context, q tx.Tx) error {
		_, err := s.authorizeAccessTx(ctx, q, claims, attemptID)
		return err
	})
	if err != nil {
		return Access{}, err
	}
	return Access{AttemptID: attemptID, ClientSessionID: claims.ClientSessionID, LeaseEpoch: *claims.LeaseEpoch, CredentialPolicy: auth.NormalizeCredentialPolicy(claims.CredentialPolicy), ExpiresAt: time.Unix(claims.Exp, 0).UTC(), AttemptToken: bearer}, nil
}

// SubmissionReceipt reads the current generation's durable result without
// applying final commands, touching runtime clocks, or sealing a second time.
func (s *Service) SubmissionReceipt(ctx context.Context, bearer, attemptID, submissionID string) (ReceiptSnapshot, error) {
	if err := ValidateAttemptID(attemptID); err != nil {
		return ReceiptSnapshot{}, err
	}
	if strings.TrimSpace(submissionID) == "" || len(submissionID) > MaxSubmissionIDLen {
		return ReceiptSnapshot{}, apperrors.New(apperrors.CodeBadRequest, "A valid submission ID is required.")
	}
	claims, err := crypto.VerifyAttemptToken(s.secret, s.clock.Now(), bearer)
	if err != nil {
		return ReceiptSnapshot{}, auth.AttemptCredentialError(err)
	}
	var result ReceiptSnapshot
	err = s.tx.WithTxRC(ctx, func(ctx context.Context, q tx.Tx) error {
		attempt, err := s.authorizeAccessTx(ctx, q, claims, attemptID)
		if err != nil {
			return err
		}
		receipt, found, err := loadSubmissionReceipt(ctx, q, attemptID)
		if err != nil {
			return err
		}
		if !found || receipt.SubmissionID != submissionID {
			return apperrors.New(apperrors.CodeNotFound, "Submission has not been confirmed.")
		}
		acks := receipt.Result.Acknowledgements
		if acks == nil {
			acks = []Ack{}
		}
		result = ReceiptSnapshot{AttemptID: attemptID, SubmissionID: submissionID, Status: attempt.DeliveryStatus, AttemptRevision: attempt.ResponseRevision, FinalResponseDigest: receipt.Result.FinalDigest, SubmittedAt: attempt.SubmittedAt, Acknowledgements: acks}
		return nil
	})
	return result, err
}

// ReceiptSnapshot is read under the same attempt lock as authorization and the
// receipt generation. Final acknowledgements are captured at submission commit.
type ReceiptSnapshot struct {
	AttemptID           string     `json:"attemptId"`
	SubmissionID        string     `json:"submissionId"`
	Status              string     `json:"status"`
	AttemptRevision     uint64     `json:"attemptRevision"`
	FinalResponseDigest string     `json:"finalResponseDigest"`
	SubmittedAt         *time.Time `json:"submittedAt"`
	Acknowledgements    []Ack      `json:"acknowledgements"`
}
