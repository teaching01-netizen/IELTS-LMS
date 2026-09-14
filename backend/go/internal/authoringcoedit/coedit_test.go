package authoringcoedit

import (
	"strings"
	"testing"
	"time"
)

func testSecret(prefix string) string {
	return prefix + strings.Repeat("x", MinSecretBytes)
}

func TestTokenIssuerRejectsShortSecret(t *testing.T) {
	if _, err := NewTokenIssuer("too-short"); err == nil {
		t.Fatal("expected a short token secret to be refused")
	}
}

func TestTokenRoundTripsClaims(t *testing.T) {
	issuer, err := NewTokenIssuer(testSecret("token-"))
	if err != nil {
		t.Fatalf("issuer: %v", err)
	}
	name, err := NewDocumentName("11111111-2222-3333-4444-555555555555")
	if err != nil {
		t.Fatalf("name: %v", err)
	}
	token, issued, err := issuer.Mint(TokenClaims{
		DocumentName:       string(name),
		ActorID:            "actor-1",
		DisplayName:        "Alice",
		ExamID:             "exam-1",
		DraftVersionID:     "draft-1",
		ExamQuestionID:     "eq-1",
		QuestionRevisionID: "rev-1",
		Mode:               ModeWrite,
	})
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if issued.ExpiresAt-issued.IssuedAt != TokenLifetimeSeconds {
		t.Fatalf("ttl = %d, want %d", issued.ExpiresAt-issued.IssuedAt, TokenLifetimeSeconds)
	}
	claims, err := issuer.Verify(token)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.DocumentName != string(name) || claims.ActorID != "actor-1" || claims.Mode != ModeWrite {
		t.Fatalf("claims round-trip mismatch: %+v", claims)
	}
}

func TestTokenVerifyRejectsTamperingExpiryAndForeignSecret(t *testing.T) {
	issuer, err := NewTokenIssuer(testSecret("token-a-"))
	if err != nil {
		t.Fatalf("issuer: %v", err)
	}
	name, _ := NewDocumentName("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	token, _, err := issuer.Mint(TokenClaims{
		DocumentName:       string(name),
		ActorID:            "actor-1",
		ExamID:             "exam-1",
		DraftVersionID:     "draft-1",
		ExamQuestionID:     "eq-1",
		QuestionRevisionID: "rev-1",
		Mode:               ModeRead,
	})
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if _, err := issuer.Verify(token + "x"); err == nil {
		t.Fatal("expected a tampered token to be refused")
	}
	other, err := NewTokenIssuer(testSecret("token-b-"))
	if err != nil {
		t.Fatalf("other issuer: %v", err)
	}
	if _, err := other.Verify(token); err == nil {
		t.Fatal("expected a token signed by another secret to be refused")
	}
	// Expiry is enforced against the clock.
	past := issuer.WithClock(func() time.Time { return time.Now().Add(-2 * time.Hour) })
	expired, _, err := past.Mint(TokenClaims{
		DocumentName:       string(name),
		ActorID:            "actor-1",
		ExamID:             "exam-1",
		DraftVersionID:     "draft-1",
		ExamQuestionID:     "eq-1",
		QuestionRevisionID: "rev-1",
		Mode:               ModeRead,
	})
	if err != nil {
		t.Fatalf("mint expired: %v", err)
	}
	if _, err := issuer.Verify(expired); err == nil {
		t.Fatal("expected an expired token to be refused")
	}
}

func TestTokenMintRejectsInvalidModeAndDocumentName(t *testing.T) {
	issuer, err := NewTokenIssuer(testSecret("token-"))
	if err != nil {
		t.Fatalf("issuer: %v", err)
	}
	if _, _, err := issuer.Mint(TokenClaims{DocumentName: "coedit:v1:abc", ActorID: "a", Mode: "admin"}); err == nil {
		t.Fatal("expected an invalid mode to be refused")
	}
	if _, _, err := issuer.Mint(TokenClaims{DocumentName: "admin:abc", ActorID: "a", Mode: ModeWrite}); err == nil {
		t.Fatal("expected a non-coedit document name to be refused")
	}
}

func TestServiceSignerRoundTripAndSkew(t *testing.T) {
	signer, err := NewServiceSigner(testSecret("service-"))
	if err != nil {
		t.Fatalf("signer: %v", err)
	}
	body := []byte(`{"documentName":"coedit:v1:abc"}`)
	ts, sig, err := signer.Sign("POST", "/internal/authoring-coedit/store", body)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if err := signer.Verify("POST", "/internal/authoring-coedit/store", ts, sig, body); err != nil {
		t.Fatalf("verify: %v", err)
	}
	// A different path or body must not verify.
	if err := signer.Verify("POST", "/internal/authoring-coedit/load", ts, sig, body); err == nil {
		t.Fatal("expected a path change to invalidate the signature")
	}
	if err := signer.Verify("POST", "/internal/authoring-coedit/store", ts, sig, []byte(`{}`)); err == nil {
		t.Fatal("expected a body change to invalidate the signature")
	}
	// Stale timestamps are refused.
	stale := signer.WithClock(func() time.Time {
		return time.Now().Add(-2 * ServiceSignatureWindowSeconds * time.Second)
	})
	oldTS, oldSig, err := stale.Sign("POST", "/internal/authoring-coedit/store", body)
	if err != nil {
		t.Fatalf("sign stale: %v", err)
	}
	if err := signer.Verify("POST", "/internal/authoring-coedit/store", oldTS, oldSig, body); err == nil {
		t.Fatal("expected a replayed timestamp to be refused")
	}
}

func TestParseDocumentName(t *testing.T) {
	name, id, err := ParseDocumentName("coedit:v1:abc123")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if id != "abc123" || string(name) != "coedit:v1:abc123" {
		t.Fatalf("unexpected parse result: %q %q", name, id)
	}
	for _, bad := range []string{"", "coedit:v2:abc", "abc", "coedit:v1:", "coedit:v1:a:b", "coedit:v1:a b"} {
		if _, _, err := ParseDocumentName(bad); err == nil {
			t.Fatalf("expected %q to be refused", bad)
		}
	}
}

func TestLifecycleTransitions(t *testing.T) {
	cases := []struct {
		from, to LifecycleState
		want     bool
	}{
		{StateInitializing, StateActive, true},
		{StateInitializing, StateClosed, true},
		{StateActive, StateFreezing, true},
		{StateActive, StateFrozen, false},
		{StateFreezing, StateFrozen, true},
		{StateFreezing, StateActive, true},
		{StateFrozen, StateActive, true},
		{StateFrozen, StateFreezing, false},
		{StateClosed, StateActive, false},
		{StateActive, StateActive, true},
	}
	for _, tc := range cases {
		if got := CanTransition(tc.from, tc.to); got != tc.want {
			t.Errorf("CanTransition(%s,%s) = %v, want %v", tc.from, tc.to, got, tc.want)
		}
	}
	if !StateActive.AcceptingEdits() {
		t.Error("active must accept edits")
	}
	if StateFrozen.AcceptingEdits() || StateClosed.AcceptingEdits() {
		t.Error("frozen/closed must not accept edits")
	}
}

func TestCloseReasonVocabulary(t *testing.T) {
	for _, reason := range AllCloseReasons {
		if !reason.Valid() {
			t.Errorf("%q should be valid", reason)
		}
	}
	if CloseReason("published").Valid() {
		t.Error("unknown close reasons must be refused")
	}
}

func TestCapabilityRequiresBothGates(t *testing.T) {
	full := Flags{FeatureEnabled: true, ServiceEnabled: true, ServiceURL: "http://127.0.0.1:1235"}
	if !full.CapabilityEnabled() {
		t.Fatal("both gates plus a URL must be capable")
	}
	if (Flags{FeatureEnabled: true}).CapabilityEnabled() {
		t.Fatal("feature alone must not be capable")
	}
	if (Flags{FeatureEnabled: true, ServiceEnabled: true}).CapabilityEnabled() {
		t.Fatal("a missing service url must not be capable")
	}
	if Off().CapabilityEnabled() {
		t.Fatal("the zero value must be off")
	}
}

func TestRoleCapabilities(t *testing.T) {
	if !CanReadCoedit("admin") || !CanReadCoedit("admin_observer") || !CanReadCoedit("builder") {
		t.Fatal("all three authoring roles must read")
	}
	if CanWriteCoedit("admin_observer") {
		t.Fatal("observers must never get a write token")
	}
	if !CanWriteCoedit("admin") || !CanWriteCoedit("builder") {
		t.Fatal("admin and builder must write")
	}
	if CanReadCoedit("student") || CanWriteCoedit("") {
		t.Fatal("unrelated roles must be refused")
	}
}

func TestSanitizeDocumentNames(t *testing.T) {
	names, err := SanitizeDocumentNames([]string{"coedit:v1:a", "coedit:v1:a", "coedit:v1:b"})
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if len(names) != 2 {
		t.Fatalf("dedupe failed: %v", names)
	}
	if _, err := SanitizeDocumentNames([]string{"nope"}); err == nil {
		t.Fatal("an invalid name must abort the whole call")
	}
}

func TestErrorMappingIsStable(t *testing.T) {
	for _, code := range AllDomainCodes {
		err := New(code, "message")
		appErr := err.ToAppError()
		if appErr == nil {
			t.Fatalf("%s produced no app error", code)
		}
		if got := appErr.Details["coeditReason"]; got != string(code) {
			t.Fatalf("reason = %v, want %s", got, code)
		}
	}
}
