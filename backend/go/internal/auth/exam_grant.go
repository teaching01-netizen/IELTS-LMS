package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"github.com/google/uuid"
)

// Credential policies persisted on attempt_sessions.credential_policy and
// carried in the signed claim. Legacy tokens omit the claim.
const (
	CredentialLegacy      = "legacy_v1"
	ExamCredentialSitting = "sitting_v1"
)

// ExamGrantOptions carries only server-established authority. Reauthorize is
// reserved for explicit authenticated re-entry, transfer, or staff recovery;
// it is never granted by ordinary projection/resume.
type ExamGrantOptions struct {
	AccountSessionID string
	Reauthorize      bool
}

// IssueExamGrantTx must run under the existing attempt ownership lock and
// verified admission. The flag governs new grants only; stored sitting grants
// keep their identity and deadline even after issuance is switched off.
func IssueExamGrantTx(ctx context.Context, q AttemptSessionExecer, cfg config.Config,
	userID, scheduleID, attemptID, clientSessionID string, organizationID *string,
	lease uint64, now time.Time, opts ExamGrantOptions,
) (string, time.Time, error) {
	var tokenID, storedUser, storedSchedule, policy string
	var storedOrg sql.NullString
	var expires time.Time
	var revoked sql.NullTime
	var storedLease sql.NullInt64
	err := q.QueryRowContext(ctx, `SELECT token_id, user_id, credential_policy, expires_at, revoked_at, lease_epoch, schedule_id, organization_id FROM attempt_sessions WHERE attempt_id = ? AND client_session_id = ? FOR UPDATE`, attemptID, clientSessionID).
		Scan(&tokenID, &storedUser, &policy, &expires, &revoked, &storedLease, &storedSchedule, &storedOrg)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		if isMissingColumn(err) && !cfg.ExamAccessEnabled {
			return IssueAttemptTokenTx(ctx, q, cfg, userID, scheduleID, attemptID, clientSessionID, organizationID, &lease, now)
		}
		return "", time.Time{}, fmt.Errorf("auth: load exam grant: %w", err)
	}
	exists := err == nil
	if exists && (storedUser != userID || storedSchedule != scheduleID) {
		return "", time.Time{}, apperrors.New(apperrors.CodeForbidden, "This exam grant belongs to another student.")
	}
	if exists && revoked.Valid && !opts.Reauthorize {
		return "", time.Time{}, ExamAccessRevokedError()
	}
	if exists && policy == ExamCredentialSitting {
		leaseMatches := storedLease.Valid && uint64(storedLease.Int64) == lease
		active := !revoked.Valid && leaseMatches && now.Before(expires)
		if active {
			org := organizationID
			if storedOrg.Valid {
				org = &storedOrg.String
			}
			if organizationID != nil && (!storedOrg.Valid || *organizationID != storedOrg.String) {
				return "", time.Time{}, apperrors.New(apperrors.CodeForbidden, "Exam organization binding changed.")
			}
			// Even explicit entry cannot slide a grant which is still valid.
			return signExamGrant(cfg, userID, scheduleID, attemptID, clientSessionID, tokenID, org, lease, expires)
		}
		if !opts.Reauthorize {
			if !leaseMatches {
				return "", time.Time{}, apperrors.New(apperrors.CodeLeaseFenced, "This browser no longer owns the exam.")
			}
			return "", time.Time{}, ExamAccessExpiredError()
		}
	}
	if exists && policy != CredentialLegacy && policy != ExamCredentialSitting {
		return "", time.Time{}, apperrors.New(apperrors.CodeServiceUnavailable, "Unknown exam credential policy.")
	}
	if (exists && policy == CredentialLegacy) || (!exists && !cfg.ExamAccessEnabled) {
		return IssueAttemptTokenTx(ctx, q, cfg, userID, scheduleID, attemptID, clientSessionID, organizationID, &lease, now)
	}
	hours := cfg.ExamAccessMaxHours
	if hours < 1 || hours > 24 {
		return "", time.Time{}, apperrors.New(apperrors.CodeServiceUnavailable, "Exam access policy is not configured.")
	}
	expires = now.UTC().Truncate(time.Second).Add(time.Duration(hours) * time.Hour)
	tokenID, err = RandomToken(24)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("auth: create exam grant: %w", err)
	}
	var org any
	if organizationID != nil {
		org = *organizationID
	}
	_, err = q.ExecContext(ctx, `INSERT INTO attempt_sessions (id, user_id, schedule_id, attempt_id, client_session_id, token_id, issued_at, last_seen_at, expires_at, organization_id, lease_epoch, credential_policy, account_session_id)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''))
 ON DUPLICATE KEY UPDATE token_id=VALUES(token_id), issued_at=VALUES(issued_at), last_seen_at=VALUES(last_seen_at), expires_at=VALUES(expires_at), organization_id=VALUES(organization_id), lease_epoch=VALUES(lease_epoch), credential_policy=VALUES(credential_policy), account_session_id=VALUES(account_session_id), revoked_at=NULL, revocation_reason=NULL`,
		uuid.NewString(), userID, scheduleID, attemptID, clientSessionID, tokenID, now.UTC().Truncate(time.Second), now.UTC(), expires, org, lease, ExamCredentialSitting, opts.AccountSessionID)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("auth: persist exam grant: %w", err)
	}
	return signExamGrant(cfg, userID, scheduleID, attemptID, clientSessionID, tokenID, organizationID, lease, expires)
}

func signExamGrant(cfg config.Config, userID, scheduleID, attemptID, sessionID, tokenID string, org *string, lease uint64, expires time.Time) (string, time.Time, error) {
	claims := crypto.AttemptClaims{TokenID: tokenID, UserID: userID, ScheduleID: scheduleID, AttemptID: attemptID, ClientSessionID: sessionID, LeaseEpoch: &lease, Exp: expires.Unix(), CredentialPolicy: ExamCredentialSitting}
	if org != nil {
		claims.OrganizationID = *org
	}
	token, err := crypto.SignAttemptToken([]byte(cfg.AuthSecret), claims)
	return token, expires, err
}
