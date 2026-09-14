package authoringcoedit

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ServiceSignatureHeaders are the headers every private call carries. The
// signature covers method, path, timestamp, and body hash, so a captured
// request cannot be replayed against a different route or with a mutated body.
const (
	HeaderServiceTimestamp = "X-Coedit-Timestamp"
	HeaderServiceSignature = "X-Coedit-Signature"
)

// ErrServiceSignature is the uniform private-call verification failure.
var ErrServiceSignature = errors.New("coedit service signature invalid")

// ServiceSigner signs and verifies private Go <-> Hocuspocus calls with a
// dedicated secret (AUTHORING_COEDIT_SERVICE_SECRET).
type ServiceSigner struct {
	secret []byte
	now    func() time.Time
}

// NewServiceSigner validates the secret length and returns a signer.
func NewServiceSigner(secret string) (*ServiceSigner, error) {
	trimmed := strings.TrimSpace(secret)
	if len(trimmed) < MinSecretBytes {
		return nil, fmt.Errorf("co-edit service secret must be at least %d bytes", MinSecretBytes)
	}
	return &ServiceSigner{secret: []byte(trimmed), now: time.Now}, nil
}

// WithClock returns a COPY of the signer with a different clock (tests only).
// Like TokenIssuer.WithClock it never mutates the receiver, so verifying with
// the shared signer cannot inherit a test clock.
func (s *ServiceSigner) WithClock(now func() time.Time) *ServiceSigner {
	if s == nil || now == nil {
		return s
	}
	clone := *s
	clone.now = now
	return &clone
}

// BodyHash is the hex SHA-256 of a request body.
func BodyHash(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

// Sign returns (timestamp, signature) for the canonical request envelope.
func (s *ServiceSigner) Sign(method, path string, body []byte) (string, string, error) {
	if s == nil || len(s.secret) == 0 {
		return "", "", errors.New("coedit service signer is not configured")
	}
	ts := strconv.FormatInt(s.timestamp(), 10)
	return ts, s.signature(method, path, ts, BodyHash(body)), nil
}

func (s *ServiceSigner) timestamp() int64 {
	if s == nil || s.now == nil {
		return time.Now().Unix()
	}
	return s.now().Unix()
}

func (s *ServiceSigner) signature(method, path, ts, bodyHash string) string {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte("authoring-coedit-service.v1\n"))
	mac.Write([]byte(strings.ToUpper(strings.TrimSpace(method))))
	mac.Write([]byte("\n"))
	mac.Write([]byte(path))
	mac.Write([]byte("\n"))
	mac.Write([]byte(ts))
	mac.Write([]byte("\n"))
	mac.Write([]byte(bodyHash))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// Verify checks the signature and rejects timestamps outside the accepted
// window. The body must be the exact bytes that were signed.
func (s *ServiceSigner) Verify(method, path, timestamp, signature string, body []byte) error {
	if s == nil || len(s.secret) == 0 {
		return ErrServiceSignature
	}
	ts, err := strconv.ParseInt(strings.TrimSpace(timestamp), 10, 64)
	if err != nil {
		return ErrServiceSignature
	}
	now := s.timestamp()
	skew := now - ts
	if skew < 0 {
		skew = -skew
	}
	if skew > ServiceSignatureWindowSeconds {
		return ErrServiceSignature
	}
	expected := s.signature(method, path, strings.TrimSpace(timestamp), BodyHash(body))
	if !hmac.Equal([]byte(expected), []byte(strings.TrimSpace(signature))) {
		return ErrServiceSignature
	}
	return nil
}
