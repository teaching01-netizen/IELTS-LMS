package crypto

import (
	"bytes"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
)

func TestRecoveryCodeIsSixDigitsAndVariable(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 200; i++ {
		code, err := NewRecoveryCode()
		if err != nil {
			t.Fatalf("code: %v", err)
		}
		if len(code) != 6 {
			t.Fatalf("code %q is not six characters", code)
		}
		for _, r := range code {
			if r < '0' || r > '9' {
				t.Fatalf("code %q is not numeric", code)
			}
		}
		seen[code] = true
	}
	if len(seen) < 150 {
		t.Fatalf("code generator looks deterministic: %d unique of 200", len(seen))
	}
}

func TestRecoveryLinkSecretIs256Bits(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 50; i++ {
		secret, err := NewRecoveryLinkSecret()
		if err != nil {
			t.Fatalf("link secret: %v", err)
		}
		raw, err := unb64(secret)
		if err != nil {
			t.Fatalf("link secret is not base64url: %v", err)
		}
		if len(raw) != 32 {
			t.Fatalf("link secret is %d bytes, want 32", len(raw))
		}
		seen[secret] = true
	}
	if len(seen) != 50 {
		t.Fatal("link secret generator repeated")
	}
}

func TestRecoveryCodeMACBindsGrantAndAttempt(t *testing.T) {
	auth := []byte("0123456789abcdef0123456789abcdef")
	mac := RecoveryCodeMAC(auth, "grant-1", "att-1", "123456")
	if len(mac) != 64 {
		t.Fatalf("mac length = %d", len(mac))
	}
	if _, err := hex.DecodeString(mac); err != nil {
		t.Fatalf("mac is not hex: %v", err)
	}
	if !RecoverySecretMatches(mac, RecoveryCodeMAC(auth, "grant-1", "att-1", "123456")) {
		t.Fatal("identical MACs did not match")
	}
	// Same code, different grant/attempt: the verifier must differ so a MAC
	// cannot be copied between rows.
	for _, other := range []string{
		RecoveryCodeMAC(auth, "grant-2", "att-1", "123456"),
		RecoveryCodeMAC(auth, "grant-1", "att-2", "123456"),
		RecoveryCodeMAC(auth, "grant-1", "att-1", "123457"),
		RecoveryCodeMAC([]byte("another-secret"), "grant-1", "att-1", "123456"),
	} {
		if RecoverySecretMatches(mac, other) {
			t.Fatalf("MAC collision with %q", other)
		}
	}
	for _, malformed := range []string{"", "abc", strings.Repeat("g", 64), strings.Repeat("a", 63)} {
		if RecoverySecretMatches(mac, malformed) {
			t.Fatalf("malformed candidate %q matched", malformed)
		}
	}
}

func TestRecoveryLinkHashIsPurposeSeparated(t *testing.T) {
	auth := []byte("0123456789abcdef0123456789abcdef")
	hash := RecoveryLinkHash(auth, "link-secret")
	if len(hash) != 64 {
		t.Fatalf("hash length = %d", len(hash))
	}
	if hash == RecoveryLinkHash(auth, "other") {
		t.Fatal("different link secrets collided")
	}
	if hash == RecoveryCodeMAC(auth, "grant-1", "att-1", "link-secret") {
		t.Fatal("link and code purposes produced the same verifier")
	}
}

func TestRecoveryCapsuleRoundTripAndBinding(t *testing.T) {
	auth := []byte("0123456789abcdef0123456789abcdef")
	plaintext := []byte(`{"code":"123456","linkSecret":"secret"}`)
	blob, err := SealRecoveryIssuance(auth, "grant-1", "att-1", plaintext)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	if bytes.Contains(blob, plaintext) {
		t.Fatal("capsule contains plaintext")
	}
	got, err := OpenRecoveryIssuance(auth, "grant-1", "att-1", blob)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if !bytes.Equal(got, plaintext) {
		t.Fatalf("plaintext = %q", got)
	}
	// Any identity/key/nonce change fails authentication.
	for name, attempt := range map[string]func() ([]byte, error){
		"other grant":   func() ([]byte, error) { return OpenRecoveryIssuance(auth, "grant-2", "att-1", blob) },
		"other attempt": func() ([]byte, error) { return OpenRecoveryIssuance(auth, "grant-1", "att-2", blob) },
		"other key": func() ([]byte, error) {
			return OpenRecoveryIssuance([]byte("another-secret"), "grant-1", "att-1", blob)
		},
		"flipped byte": func() ([]byte, error) {
			tampered := append([]byte(nil), blob...)
			tampered[len(tampered)-1] ^= 0xff
			return OpenRecoveryIssuance(auth, "grant-1", "att-1", tampered)
		},
	} {
		if _, err := attempt(); !errors.Is(err, ErrRecoverySecretMalformed) {
			t.Fatalf("%s: err = %v, want ErrRecoverySecretMalformed", name, err)
		}
	}
	if _, err := OpenRecoveryIssuance(auth, "grant-1", "att-1", blob[:12]); !errors.Is(err, ErrRecoverySecretMalformed) {
		t.Fatalf("truncated capsule err = %v", err)
	}
	if _, err := SealRecoveryIssuance(auth, "", "att-1", plaintext); !errors.Is(err, ErrRecoverySecretMalformed) {
		t.Fatalf("empty grant err = %v", err)
	}
}
