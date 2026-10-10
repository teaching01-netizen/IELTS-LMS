package satstartcode

import (
	"encoding/base64"
	"strings"
	"testing"
)

func key(b byte) string {
	return base64.StdEncoding.EncodeToString([]byte(strings.Repeat(string(rune(b)), 32)))
}

func TestNormalizeSubmittedAcceptsExactlySixASCIIDigits(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want string
		ok   bool
	}{
		{"004827", "004827", true},
		{"000000", "000000", true},
		{"999999", "999999", true},
		{"  123456\t", "123456", true},
		{"12345", "", false},
		{"1234567", "", false},
		{"12 456", "", false},
		{"12-456", "", false},
		{"12a456", "", false},
		{"١٢٣٤٥٦", "", false}, // non-ASCII digits are refused, never normalized
		{"", "", false},
	} {
		got, ok := NormalizeSubmitted(tc.in)
		if ok != tc.ok || got != tc.want {
			t.Errorf("NormalizeSubmitted(%q) = %q,%v want %q,%v", tc.in, got, ok, tc.want, tc.ok)
		}
	}
}

func TestGeneratePreservesLeadingZerosAndSixDigits(t *testing.T) {
	for range 2000 {
		code, err := Generate()
		if err != nil {
			t.Fatal(err)
		}
		if normalized, ok := NormalizeSubmitted(code); !ok || normalized != code {
			t.Fatalf("generated %q is not a canonical six-digit code", code)
		}
	}
}

func TestSealedCodeIsBoundToScheduleAndGeneration(t *testing.T) {
	ring, err := ParseKeyring("k1:" + key('a'))
	if err != nil {
		t.Fatal(err)
	}
	ct, nonce, keyID, err := ring.seal("sched-1", 2, "004827")
	if err != nil {
		t.Fatal(err)
	}
	if got, err := ring.open("sched-1", 2, keyID, ct, nonce); err != nil || got != "004827" {
		t.Fatalf("round trip: %q %v", got, err)
	}
	if _, err := ring.open("sched-2", 2, keyID, ct, nonce); err == nil {
		t.Fatal("ciphertext copied to another schedule must not open")
	}
	if _, err := ring.open("sched-1", 3, keyID, ct, nonce); err == nil {
		t.Fatal("ciphertext replayed under another generation must not open")
	}
	tampered := append([]byte(nil), ct...)
	tampered[0] ^= 0xff
	if _, err := ring.open("sched-1", 2, keyID, tampered, nonce); err == nil {
		t.Fatal("tampered ciphertext must not open")
	}
}

func TestRetiredKeyStillOpensAfterKeyRotation(t *testing.T) {
	old, _ := ParseKeyring("k1:" + key('a'))
	ct, nonce, keyID, err := old.seal("sched-1", 1, "123456")
	if err != nil {
		t.Fatal(err)
	}
	rotated, err := ParseKeyring("k2:" + key('b') + ",k1:" + key('a'))
	if err != nil {
		t.Fatal(err)
	}
	if got, err := rotated.open("sched-1", 1, keyID, ct, nonce); err != nil || got != "123456" {
		t.Fatalf("retired key must still decrypt: %q %v", got, err)
	}
	_, _, newKeyID, _ := rotated.seal("sched-1", 1, "123456")
	if newKeyID != "k2" {
		t.Fatalf("the first configured key must seal, got %q", newKeyID)
	}
	withoutOld, _ := ParseKeyring("k2:" + key('b'))
	if _, err := withoutOld.open("sched-1", 1, keyID, ct, nonce); err == nil {
		t.Fatal("a dropped key must fail closed, never regenerate")
	}
}

func TestValidateConfigFailsClosed(t *testing.T) {
	if _, err := ValidateConfig(true, ""); err == nil {
		t.Fatal("enabling code start without keys must refuse to boot")
	}
	if _, err := ValidateConfig(false, "k1:not-base64!"); err == nil {
		t.Fatal("a malformed keyring must refuse to boot")
	}
	if _, err := ValidateConfig(false, "k1:"+base64.StdEncoding.EncodeToString([]byte("short"))); err == nil {
		t.Fatal("a wrong-size key must refuse to boot")
	}
	if err := func() error { _, err := ValidateConfig(false, "k1:"+key('a')+",k1:"+key('b')); return err }(); err == nil {
		t.Fatal("duplicate key ids must refuse to boot")
	}
	if ring, err := ValidateConfig(false, ""); err != nil || ring != nil {
		t.Fatalf("disabled without keys is valid: %v %v", ring, err)
	}
}

func TestResolveCreateModeFollowsRolloutAndExclusions(t *testing.T) {
	Configure(false, nil)
	if mode, _ := ResolveCreateMode("sat", "Cohort", ""); mode != ModeProctor {
		t.Fatalf("rollout off keeps proctor start, got %q", mode)
	}
	if _, err := ResolveCreateMode("sat", "Cohort", ModeAccessCode); err == nil {
		t.Fatal("explicit code start must wait for rollout enablement")
	}
	ring, _ := ParseKeyring("k1:" + key('a'))
	Configure(true, ring)
	t.Cleanup(func() { Configure(false, nil) })
	if mode, _ := ResolveCreateMode("sat", "Cohort", ""); mode != ModeAccessCode {
		t.Fatalf("new normal SAT sessions default to code start, got %q", mode)
	}
	if mode, _ := ResolveCreateMode("sat", previewCohortPrefix+"exam:author:reading", ""); mode != ModeProctor {
		t.Fatalf("previews keep their isolated start, got %q", mode)
	}
	if mode, _ := ResolveCreateMode("ielts", "Cohort", ""); mode != ModeProctor {
		t.Fatalf("non-SAT providers keep proctor start, got %q", mode)
	}
	if _, err := ResolveCreateMode("act", "Cohort", ModeAccessCode); err == nil {
		t.Fatal("code start is SAT-only")
	}
	if _, err := ResolveCreateMode("sat", "Cohort", "room"); err == nil {
		t.Fatal("unknown modes are rejected")
	}
}
