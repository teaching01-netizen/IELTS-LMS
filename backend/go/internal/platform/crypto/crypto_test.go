package crypto

import (
	"testing"
	"time"
)

func TestAttemptTokenRoundTrip(t *testing.T) {
	secret := []byte("test-secret-32-bytes-long-value!!")
	lease := uint64(3)
	claims := AttemptClaims{
		TokenID: "tok-1", UserID: "u-1", ScheduleID: "s-1", AttemptID: "a-1",
		ClientSessionID: "sess-1", OrganizationID: "org-1",
		LeaseEpoch: &lease, Exp: time.Now().Add(15 * time.Minute).Unix(),
	}
	tok, err := SignAttemptToken(secret, claims)
	if err != nil {
		t.Fatal(err)
	}
	got, err := VerifyAttemptToken(secret, time.Now().UTC(), tok)
	if err != nil {
		t.Fatal(err)
	}
	if got.AttemptID != "a-1" || got.LeaseEpoch == nil || *got.LeaseEpoch != 3 {
		t.Fatalf("claims mismatch: %+v", got)
	}
}

func TestAttemptTokenTamperAndExpiry(t *testing.T) {
	secret := []byte("test-secret-32-bytes-long-value!!")
	claims := AttemptClaims{TokenID: "t", UserID: "u", ScheduleID: "s", AttemptID: "a", ClientSessionID: "c", Exp: time.Now().Add(time.Minute).Unix()}
	tok, _ := SignAttemptToken(secret, claims)
	tampered := tok[:len(tok)-2] + "AA"
	if _, err := VerifyAttemptToken(secret, time.Now().UTC(), tampered); err == nil {
		t.Fatal("expected tamper rejection")
	}
	if _, err := VerifyAttemptToken([]byte("wrong-secret-value-here-123456"), time.Now().UTC(), tok); err == nil {
		t.Fatal("expected wrong-secret rejection")
	}
	expired := claims
	expired.Exp = time.Now().Add(-time.Minute).Unix()
	expTok, _ := SignAttemptToken(secret, expired)
	if _, err := VerifyAttemptToken(secret, time.Now().UTC(), expTok); err == nil {
		t.Fatal("expected expiry rejection")
	}
	if _, err := VerifyAttemptToken(secret, time.Now().UTC(), "not-a-token"); err == nil {
		t.Fatal("expected malformed rejection")
	}
}

// Exp==0 tokens are immortal without this guard: every minted token must
// carry an explicit expiry (IssueAttemptToken/AttemptTokenTTL always set it).
func TestAttemptTokenZeroExpiryRejected(t *testing.T) {
	secret := []byte("test-secret-32-bytes-long-value!!")
	claims := AttemptClaims{TokenID: "t", UserID: "u", ScheduleID: "s", AttemptID: "a", ClientSessionID: "c", Exp: 0}
	tok, err := SignAttemptToken(secret, claims)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyAttemptToken(secret, time.Now().UTC(), tok); err == nil {
		t.Fatal("expected zero-expiry rejection")
	}
}

func TestAttemptTokenExpiryBoundaryIsExclusive(t *testing.T) {
	secret := []byte("boundary-secret-32-characters-long!")
	deadline := time.Now().UTC().Truncate(time.Second)
	token, err := SignAttemptToken(secret, AttemptClaims{TokenID: "token", Exp: deadline.Unix(), CredentialPolicy: "sitting_v1"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = VerifyAttemptToken(secret, deadline.Add(-time.Second), token); err != nil {
		t.Fatal(err)
	}
	if _, err = VerifyAttemptToken(secret, deadline, token); err == nil {
		t.Fatal("credential accepted at its expiry boundary")
	}
}

// A rotation keeps tokens signed by the retired secret verifiable for the
// configured window; nothing new is ever signed with it, and an unknown key
// is rejected.
func TestRetiredAttemptSecretVerifiesDuringRotation(t *testing.T) {
	retired := []byte("retired-attempt-secret-with-32-characters")
	current := []byte("current-attempt-secret-with-32-characters")
	t.Cleanup(func() { ConfigurePreviousAttemptSecrets(nil) })
	exp := time.Now().Add(time.Hour).Unix()
	old, err := SignAttemptToken(retired, AttemptClaims{TokenID: "grant", Exp: exp, CredentialPolicy: "sitting_v1"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyAttemptToken(current, time.Now(), old); err == nil {
		t.Fatal("retired-key token verified before the keyring was configured")
	}
	ConfigurePreviousAttemptSecrets([][]byte{retired})
	claims, err := VerifyAttemptToken(current, time.Now(), old)
	if err != nil || claims.TokenID != "grant" {
		t.Fatalf("retired-key token rejected during rotation: %+v %v", claims, err)
	}
	foreign, _ := SignAttemptToken([]byte("unknown-attempt-secret-with-32-characters"), AttemptClaims{TokenID: "x", Exp: exp})
	if _, err := VerifyAttemptToken(current, time.Now(), foreign); err == nil {
		t.Fatal("token from an unknown key verified")
	}
	ConfigurePreviousAttemptSecrets(nil)
	if _, err := VerifyAttemptToken(current, time.Now(), old); err == nil {
		t.Fatal("retired key still verified after removal")
	}
}
