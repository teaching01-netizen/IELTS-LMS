package authoringcoedit

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// TokenClaims is the signed authority a browser presents to Hocuspocus. The
// browser never constructs a room name from raw identifiers and never supplies
// its own identity: both come from these server-signed claims.
type TokenClaims struct {
	Version            int     `json:"version"`
	DocumentName       string  `json:"documentName"`
	ActorID            string  `json:"actorId"`
	DisplayName        string  `json:"displayName"`
	OrganizationID     *string `json:"organizationId"`
	ExamID             string  `json:"examId"`
	DraftVersionID     string  `json:"draftVersionId"`
	ExamQuestionID     string  `json:"examQuestionId"`
	QuestionRevisionID string  `json:"questionRevisionId"`
	// FieldSet is omitted by legacy v1 prompt tokens and is inferred as
	// "prompt" during verification. Workspace v2 tokens set it explicitly.
	FieldSet  string   `json:"fieldSet,omitempty"`
	Mode      AuthMode `json:"mode"`
	IssuedAt  int64    `json:"issuedAt"`
	ExpiresAt int64    `json:"expiresAt"`
	// StateEpoch is signed with the token once epoch-aware cache recovery is
	// enabled. It is additive so epoch-zero legacy tokens remain verifiable.
	StateEpoch        DecimalString `json:"stateEpoch,omitempty"`
	CommitSequence    DecimalString `json:"commitSequence,omitempty"`
	WorkspaceRevision int           `json:"workspaceRevision,omitempty"`
}

// TokenVersion is the only accepted claim version.
const TokenVersion = 1

// ErrTokenInvalid is the uniform failure for signature/version/expiry/shape
// problems. Callers must not distinguish these to a browser: a forged token
// and an expired one look identical.
var ErrTokenInvalid = errors.New("coedit token invalid")

// TokenIssuer mints and verifies browser tokens with a dedicated secret
// (AUTHORING_COEDIT_TOKEN_SECRET), never the general application secret.
type TokenIssuer struct {
	secret []byte
	now    func() time.Time
}

// NewTokenIssuer validates the secret length and returns an issuer.
func NewTokenIssuer(secret string) (*TokenIssuer, error) {
	trimmed := strings.TrimSpace(secret)
	if len(trimmed) < MinSecretBytes {
		return nil, fmt.Errorf("co-edit token secret must be at least %d bytes", MinSecretBytes)
	}
	return &TokenIssuer{secret: []byte(trimmed), now: time.Now}, nil
}

// WithClock returns a COPY of the issuer with a different clock (tests only).
// It deliberately does not mutate the receiver: a shared issuer mutated by a
// test seam would move the expiry horizon of every token in flight.
func (t *TokenIssuer) WithClock(now func() time.Time) *TokenIssuer {
	if t == nil || now == nil {
		return t
	}
	clone := *t
	clone.now = now
	return &clone
}

func (t *TokenIssuer) nowUnix() int64 {
	if t == nil || t.now == nil {
		return time.Now().Unix()
	}
	return t.now().Unix()
}

// SecretBytes returns the secret length (assertable without exposing it).
func (t *TokenIssuer) SecretBytes() int {
	if t == nil {
		return 0
	}
	return len(t.secret)
}

// Mint signs claims. IssuedAt/ExpiresAt are overwritten from the clock so a
// caller cannot mint a long-lived token by accident.
func (t *TokenIssuer) Mint(claims TokenClaims) (string, TokenClaims, error) {
	if t == nil || len(t.secret) == 0 {
		return "", TokenClaims{}, errors.New("coedit token issuer is not configured")
	}
	if !claims.Mode.Valid() {
		return "", TokenClaims{}, ErrTokenInvalid
	}
	_, _, schemaVersion, err := ParseAnyDocumentName(claims.DocumentName)
	if err != nil {
		return "", TokenClaims{}, ErrTokenInvalid
	}
	if strings.TrimSpace(claims.FieldSet) == "" {
		claims.FieldSet = FieldSetPrompt
	}
	if schemaVersion == SchemaVersion && claims.FieldSet != FieldSetPrompt {
		return "", TokenClaims{}, ErrTokenInvalid
	}
	if schemaVersion == WorkspaceSchemaVersion && claims.FieldSet != FieldSetWorkspace {
		return "", TokenClaims{}, ErrTokenInvalid
	}
	if (claims.StateEpoch != "" && !IsDecimalString(string(claims.StateEpoch))) ||
		(claims.CommitSequence != "" && !IsDecimalString(string(claims.CommitSequence))) ||
		claims.WorkspaceRevision < 0 {
		return "", TokenClaims{}, ErrTokenInvalid
	}
	if strings.TrimSpace(claims.ActorID) == "" {
		return "", TokenClaims{}, ErrTokenInvalid
	}
	claims.Version = TokenVersion
	claims.IssuedAt = t.nowUnix()
	claims.ExpiresAt = claims.IssuedAt + TokenLifetimeSeconds
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", TokenClaims{}, err
	}
	body := base64.RawURLEncoding.EncodeToString(payload)
	sig := t.sign(body)
	return body + "." + sig, claims, nil
}

// Verify checks signature, version, expiry, and shape, returning the claims.
// It never returns a partially-valid claim set.
func (t *TokenIssuer) Verify(token string) (TokenClaims, error) {
	if t == nil || len(t.secret) == 0 {
		return TokenClaims{}, ErrTokenInvalid
	}
	raw := strings.TrimSpace(token)
	parts := strings.Split(raw, ".")
	if len(parts) != 2 {
		return TokenClaims{}, ErrTokenInvalid
	}
	expected := t.sign(parts[0])
	if !hmac.Equal([]byte(expected), []byte(parts[1])) {
		return TokenClaims{}, ErrTokenInvalid
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return TokenClaims{}, ErrTokenInvalid
	}
	var claims TokenClaims
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&claims); err != nil {
		return TokenClaims{}, ErrTokenInvalid
	}
	if claims.Version != TokenVersion {
		return TokenClaims{}, ErrTokenInvalid
	}
	if !claims.Mode.Valid() {
		return TokenClaims{}, ErrTokenInvalid
	}
	_, _, schemaVersion, err := ParseAnyDocumentName(claims.DocumentName)
	if err != nil {
		return TokenClaims{}, ErrTokenInvalid
	}
	if strings.TrimSpace(claims.FieldSet) == "" {
		claims.FieldSet = FieldSetPrompt
	}
	if (schemaVersion == SchemaVersion && claims.FieldSet != FieldSetPrompt) ||
		(schemaVersion == WorkspaceSchemaVersion && claims.FieldSet != FieldSetWorkspace) {
		return TokenClaims{}, ErrTokenInvalid
	}
	if (claims.StateEpoch != "" && !IsDecimalString(string(claims.StateEpoch))) ||
		(claims.CommitSequence != "" && !IsDecimalString(string(claims.CommitSequence))) ||
		claims.WorkspaceRevision < 0 {
		return TokenClaims{}, ErrTokenInvalid
	}
	if strings.TrimSpace(claims.ActorID) == "" || strings.TrimSpace(claims.ExamID) == "" ||
		strings.TrimSpace(claims.DraftVersionID) == "" ||
		(claims.FieldSet == FieldSetPrompt && (strings.TrimSpace(claims.ExamQuestionID) == "" || strings.TrimSpace(claims.QuestionRevisionID) == "")) {
		return TokenClaims{}, ErrTokenInvalid
	}
	if claims.ExpiresAt <= t.nowUnix() {
		return TokenClaims{}, ErrTokenInvalid
	}
	return claims, nil
}

func (t *TokenIssuer) sign(body string) string {
	mac := hmac.New(sha256.New, t.secret)
	mac.Write([]byte("authoring-coedit-token.v1."))
	mac.Write([]byte(body))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
