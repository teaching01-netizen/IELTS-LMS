package crypto

// Staff-assisted device recovery credentials.
//
// A recovery grant carries two separate secrets:
//
//   - a 256-bit link secret delivered in the URL fragment (read client-side,
//     sent in the claim body, never in a path or query string);
//   - a six-digit code delivered out of band and typed by staff/candidate.
//
// Neither is persisted in plaintext. The link secret is stored as a
// purpose-derived HMAC and the code as a purpose-derived MAC, so a database
// leak cannot be replayed against a live grant. The authorized staff replay
// capsule is AES-256-GCM encrypted under a third purpose key; associated data
// binds the ciphertext to the grant and attempt identities so a capsule
// cannot be moved between grants.
//
// Purpose separation matters: the same auth secret feeds attempt-token
// signing, so every key here is HMAC(secret, purpose-label) rather than the
// raw secret. Labels are versioned to allow a future rotation without
// reinterpreting old rows.

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
)

const (
	recoveryCodeKeyLabel    = "staff-recovery-code-key-v1"
	recoveryLinkKeyLabel    = "staff-recovery-link-key-v1"
	recoveryCapsuleKeyLabel = "staff-recovery-capsule-key-v1"
	recoveryClaimKeyLabel   = "staff-recovery-claim-key-v1"
	recoveryCodeDigits      = 6
	recoveryLinkBytes       = 32
	recoveryNonceBytes      = 12
)

// ErrRecoverySecretMalformed means a stored hash/MAC or sealed capsule does
// not match the contract. Callers fail closed; they never fall back to a
// weaker comparison.
var ErrRecoverySecretMalformed = errors.New("recovery credential is malformed")

func purposeKey(secret []byte, label string) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(label))
	return mac.Sum(nil)
}

// NewRecoveryLinkSecret returns 32 random bytes, URL-safe without padding.
func NewRecoveryLinkSecret() (string, error) {
	buf := make([]byte, recoveryLinkBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("recovery link secret: %w", err)
	}
	return b64(buf), nil
}

// NewRecoveryCode returns a uniformly random six-digit code. Codes with
// leading zeros stay six characters on the wire.
func NewRecoveryCode() (string, error) {
	max := big.NewInt(1_000_000)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", fmt.Errorf("recovery code: %w", err)
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// RecoveryLinkHash is the constant-length stored identity of a link secret.
func RecoveryLinkHash(secret []byte, linkSecret string) string {
	mac := hmac.New(sha256.New, purposeKey(secret, recoveryLinkKeyLabel))
	mac.Write([]byte(linkSecret))
	return hex.EncodeToString(mac.Sum(nil))
}

// RecoveryCodeMAC derives the stored verifier for one grant's code. Binding
// grant and attempt ids prevents a valid code MAC from being copied onto a
// different grant row.
func RecoveryCodeMAC(secret []byte, grantID, attemptID, code string) string {
	mac := hmac.New(sha256.New, purposeKey(secret, recoveryCodeKeyLabel))
	mac.Write([]byte(grantID))
	mac.Write([]byte{0})
	mac.Write([]byte(attemptID))
	mac.Write([]byte{0})
	mac.Write([]byte(code))
	return hex.EncodeToString(mac.Sum(nil))
}

// RecoverySecretMatches compares two hex verifiers in constant time. Empty or
// malformed values never match.
func RecoverySecretMatches(expected, candidate string) bool {
	if len(expected) != sha256.Size*2 || len(candidate) != sha256.Size*2 {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(candidate)) == 1
}

// RecoveryClaimProofHash binds a browser-generated proof to one grant. The
// browser never sends the proof itself in storage lookups; the server compares
// this derived value, so a database leak cannot hijack a preparation window.
func RecoveryClaimProofHash(secret []byte, grantID, browserProof string) string {
	mac := hmac.New(sha256.New, purposeKey(secret, recoveryClaimKeyLabel))
	mac.Write([]byte(grantID))
	mac.Write([]byte{0})
	mac.Write([]byte(browserProof))
	return hex.EncodeToString(mac.Sum(nil))
}

// SealRecoveryIssuance encrypts the authorized replay payload. AAD binds the
// capsule to one grant/attempt pair; opening with different identities fails.
func SealRecoveryIssuance(secret []byte, grantID, attemptID string, plaintext []byte) ([]byte, error) {
	if grantID == "" || attemptID == "" {
		return nil, fmt.Errorf("%w: grant and attempt ids are required", ErrRecoverySecretMalformed)
	}
	gcm, err := recoveryGCM(secret)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, recoveryNonceBytes)
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("recovery capsule nonce: %w", err)
	}
	sealed := gcm.Seal(nil, nonce, plaintext, recoveryAAD(grantID, attemptID))
	out := make([]byte, 0, len(nonce)+len(sealed))
	out = append(out, nonce...)
	out = append(out, sealed...)
	return out, nil
}

// OpenRecoveryIssuance decrypts a capsule produced by SealRecoveryIssuance.
func OpenRecoveryIssuance(secret []byte, grantID, attemptID string, blob []byte) ([]byte, error) {
	if grantID == "" || attemptID == "" || len(blob) <= recoveryNonceBytes {
		return nil, ErrRecoverySecretMalformed
	}
	gcm, err := recoveryGCM(secret)
	if err != nil {
		return nil, err
	}
	nonce, ciphertext := blob[:recoveryNonceBytes], blob[recoveryNonceBytes:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, recoveryAAD(grantID, attemptID))
	if err != nil {
		return nil, fmt.Errorf("%w: capsule authentication failed", ErrRecoverySecretMalformed)
	}
	return plaintext, nil
}

func recoveryGCM(secret []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(purposeKey(secret, recoveryCapsuleKeyLabel))
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func recoveryAAD(grantID, attemptID string) []byte {
	return []byte(grantID + "\x00" + attemptID)
}
