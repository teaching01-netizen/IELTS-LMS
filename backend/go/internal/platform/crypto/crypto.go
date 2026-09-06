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
	"time"
)

// AttemptClaims mirrors AttemptTokenClaims in the Rust backend.
type AttemptClaims struct {
	TokenID         string  `json:"token_id"`
	UserID          string  `json:"user_id"`
	ScheduleID      string  `json:"schedule_id"`
	AttemptID       string  `json:"attempt_id"`
	ClientSessionID string  `json:"client_session_id"`
	OrganizationID  string  `json:"organization_id,omitempty"`
	LeaseEpoch      *uint64 `json:"lease_epoch,omitempty"`
	Exp             int64   `json:"exp"`
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
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	if subtle.ConstantTimeCompare(mac.Sum(nil), sig) != 1 {
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
	if now.Unix() > c.Exp {
		return zero, fmt.Errorf("attempt token expired")
	}
	return c, nil
}
