// Package crypto implements attempt-token HMAC signing and secret handling.
// Tokens bind token/user/schedule/attempt/client-session/org/lease (plan 46)
// with constant-time comparison and TTL enforcement.
package crypto

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sync/atomic"
	"time"
)

// previousAttemptSecrets holds retired signing secrets that still VERIFY (never
// sign) attempt tokens during a bounded rotation window. Tokens carry no key
// ID, so verification tries the current secret first, then each retired one.
var previousAttemptSecrets atomic.Pointer[[][]byte]

// ConfigurePreviousAttemptSecrets installs the retired secrets at process
// start. Operators keep a retired secret for at least the longest credential
// lifetime (EXAM_ACCESS_MAX_HOURS) after rotating AUTH_SECRET, then remove it.
func ConfigurePreviousAttemptSecrets(secrets [][]byte) {
	keys := make([][]byte, 0, len(secrets))
	for _, secret := range secrets {
		if len(secret) > 0 {
			keys = append(keys, append([]byte(nil), secret...))
		}
	}
	previousAttemptSecrets.Store(&keys)
}

func attemptSignatureValid(secret, payload, sig []byte) bool {
	if signatureMatches(secret, payload, sig) {
		return true
	}
	if previous := previousAttemptSecrets.Load(); previous != nil {
		for _, key := range *previous {
			if signatureMatches(key, payload, sig) {
				return true
			}
		}
	}
	return false
}

func signatureMatches(secret, payload, sig []byte) bool {
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	return subtle.ConstantTimeCompare(mac.Sum(nil), sig) == 1
}

// AttemptTokenExpiredError is emitted only after signature verification. Its
// policy is authenticated metadata, not a claim accepted from an invalid token.
type AttemptTokenExpiredError struct{ CredentialPolicy string }

func (e *AttemptTokenExpiredError) Error() string { return "attempt token expired" }

// AttemptClaims mirrors AttemptTokenClaims in the Rust backend.
type AttemptClaims struct {
	TokenID          string  `json:"token_id"`
	UserID           string  `json:"user_id"`
	ScheduleID       string  `json:"schedule_id"`
	AttemptID        string  `json:"attempt_id"`
	ClientSessionID  string  `json:"client_session_id"`
	OrganizationID   string  `json:"organization_id,omitempty"`
	LeaseEpoch       *uint64 `json:"lease_epoch,omitempty"`
	CredentialPolicy string  `json:"credential_policy,omitempty"`
	Exp              int64   `json:"exp"`
}

func b64(b []byte) string            { return base64.RawURLEncoding.EncodeToString(b) }
func unb64(s string) ([]byte, error) { return base64.RawURLEncoding.DecodeString(s) }

// SignAttemptToken issues payload.signature (URL-safe).
func SignAttemptToken(secret []byte, c AttemptClaims) (string, error) {
	payload, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	return b64(payload) + "." + b64(mac.Sum(nil)), nil
}

// VerifyAttemptToken checks signature, expiry and returns claims.
func VerifyAttemptToken(secret []byte, now time.Time, token string) (AttemptClaims, error) {
	var zero AttemptClaims
	dot := -1
	for i := 0; i < len(token); i++ {
		if token[i] == '.' {
			dot = i
			break
		}
	}
	if dot < 0 {
		return zero, fmt.Errorf("malformed attempt token")
	}
	payload, err := unb64(token[:dot])
	if err != nil {
		return zero, fmt.Errorf("malformed attempt token")
	}
	sig, err := unb64(token[dot+1:])
	if err != nil {
		return zero, fmt.Errorf("malformed attempt token")
	}
	if !attemptSignatureValid(secret, payload, sig) {
		return zero, fmt.Errorf("invalid attempt token signature")
	}
	var c AttemptClaims
	if err := json.Unmarshal(payload, &c); err != nil {
		return zero, fmt.Errorf("malformed attempt token claims")
	}
	// Exp==0 is rejected (no immortal tokens): every minted token carries
	// an explicit expiry from IssueAttemptToken/AttemptTokenTTL.
	if c.Exp == 0 {
		return zero, fmt.Errorf("attempt token missing expiry")
	}
	if now.Unix() >= c.Exp {
		return zero, &AttemptTokenExpiredError{CredentialPolicy: c.CredentialPolicy}
	}
	return c, nil
}
