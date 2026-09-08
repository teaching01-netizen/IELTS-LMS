// Attempt-verify posture behind plan A3.
//
// Strict (ship state): HMAC + expiry + DB binding against attempt_sessions
// (revoked/mismatched rows fail closed). One SELECT per verification.
//
// Stateless (single-deploy target): HMAC + expiry only, zero SQL. Claim-to-
// resource binding is enforced downstream against rows the business tx
// already holds: attempts.saveInTx compares claims.ScheduleID/UserID (and
// org when set) to the locked attempt row, validateTokenSession is dead
// code there (Phase B removes the in-tx session SELECT), and every handler
// below re-checks claims.AttemptID/ScheduleID against the URL. Revocation
// rests on short TTL (15m) + lease-epoch fencing on next write — the same
// window today's touch gap already allows. No new crypto (HMAC-SHA256).
package auth

import (
	"context"
	"fmt"
	"time"

	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/crypto"
)

// AttemptVerifyMode selects the bearer-verification posture.
type AttemptVerifyMode string

const (
	// AttemptVerifyStrict keeps today's DB binding (ship default).
	AttemptVerifyStrict AttemptVerifyMode = "strict"
	// AttemptVerifyStateless verifies HMAC + expiry only (zero SQL).
	AttemptVerifyStateless AttemptVerifyMode = "stateless"
)

// VerifyAttemptTokenRouted verifies an attempt bearer under mode. The zero
// value is strict (fail closed: unknown modes never silently drop the DB
// binding — config validation rejects them at startup, and this switch
// defaults to strict defensively).
func VerifyAttemptTokenRouted(ctx context.Context, db Querier, cfg config.Config, mode AttemptVerifyMode, now time.Time, token string) (crypto.AttemptClaims, error) {
	if mode == AttemptVerifyStateless {
		return VerifyAttemptTokenStateless(cfg, now, token)
	}
	return VerifyAttemptToken(ctx, db, cfg, now, token)
}

// VerifyAttemptTokenStateless verifies signature + expiry only. It performs
// zero DB I/O; callers must enforce claim-to-resource binding against
// authoritative rows (attempt row in-tx, URL params at the edge).
func VerifyAttemptTokenStateless(cfg config.Config, now time.Time, token string) (crypto.AttemptClaims, error) {
	var zero crypto.AttemptClaims
	claims, err := crypto.VerifyAttemptToken([]byte(cfg.AuthSecret), now, token)
	if err != nil {
		return zero, fmt.Errorf("auth: verify attempt token: %w", err)
	}
	return claims, nil
}
