package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// ActiveAttemptPrincipalSQL is the eligibility rule shared by live attempt
// credential lookups. It references the attempt_sessions row being authorized.
// Keep this as a nonlocking EXISTS: account credential writers lock users first,
// whereas exam mutations already hold the attempt lock. A user-row lock here
// would invert those orders. READ COMMITTED gives each authorization statement
// a fresh eligibility view; deliberate grant revocation locks the grant row.
const ActiveAttemptPrincipalSQL = `EXISTS (
 SELECT 1 FROM users WHERE users.id = attempt_sessions.user_id AND users.state = 'active'
)`

// AttemptCredentialError preserves the distinction between an expired sitting
// grant (staff/account recovery) and a renewable legacy access token.
func AttemptCredentialError(err error) *apperrors.Error {
	var expired *crypto.AttemptTokenExpiredError
	if errors.As(err, &expired) {
		if expired.CredentialPolicy == ExamCredentialSitting {
			return ExamAccessExpiredError()
		}
		recordExamAccessRejection("expired", CredentialLegacy)
		return apperrors.New(apperrors.CodeAttemptTokenExpired, "Attempt credential expired.")
	}
	// An unverifiable token has no authenticated policy.
	recordExamAccessRejection("invalid", "unknown")
	return apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential.")
}

// ExamAccessExpiredError is a sitting grant past its fixed horizon. Renewal
// cannot help; authenticated re-entry or staff recovery is required.
func ExamAccessExpiredError() *apperrors.Error {
	recordExamAccessRejection("expired", ExamCredentialSitting)
	return apperrors.New(apperrors.CodeExamAccessExpired, "Exam access expired. Ask your proctor to restore access.")
}

// ExamAccessRevokedError is a sitting grant deliberately revoked (logout,
// security reset) or whose account is no longer active.
func ExamAccessRevokedError() *apperrors.Error {
	recordExamAccessRejection("revoked", ExamCredentialSitting)
	return apperrors.New(apperrors.CodeExamAccessRevoked, "Exam access was revoked. Ask your proctor to restore access.")
}

// RecordExamAccessAdmitted counts a committed credential admission by policy.
func RecordExamAccessAdmitted(policy string) {
	telemetry.IncCounter(telemetry.MExamAccessAdmittedTotal, "policy", NormalizeCredentialPolicy(policy))
}

// NormalizeCredentialPolicy maps the claim value (absent on legacy tokens) to
// the closed policy vocabulary used by APIs and metrics.
func NormalizeCredentialPolicy(policy string) string {
	if policy == ExamCredentialSitting {
		return ExamCredentialSitting
	}
	return CredentialLegacy
}

func recordExamAccessRejection(reason, policy string) {
	telemetry.IncCounter(telemetry.MExamAccessRejectedTotal, "reason", reason, "policy", policy)
}

// LockExamPrincipalTx takes the account row FOR SHARE before any
// attempt_sessions lock in the caller's transaction. Logout-all and security
// reset hold users FOR UPDATE and then revoke every grant, while issuance
// reads users FOR SHARE. A transaction that fences grants (transfer, device
// recovery) and then issues a credential must therefore lock the account
// first, keeping one global order: users -> attempt_sessions. A missing user
// is left to the issuance check, which reports it.
func LockExamPrincipalTx(ctx context.Context, q Querier, userID string) error {
	var state string
	err := q.QueryRowContext(ctx, `SELECT state FROM users WHERE id = ? FOR SHARE`, userID).Scan(&state)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("auth: lock exam principal: %w", err)
	}
	return nil
}
