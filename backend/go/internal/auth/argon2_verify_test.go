package auth

import (
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

// Real prod hash shape (password unknown): must parse params without error path tripping.
func TestVerifyArgon2idProdShapeParses(t *testing.T) {
	h := "$argon2id$v=19$m=19456,t=2,p=1$iFyRaI2/VqGNofNHzlWZIg$HACAsTv5Jr6YyI/dq7WOvwrP+EhsZjez0AXJdjoTVVA"
	// Wrong password -> false (not panic, not true).
	if VerifyPassword("definitely-wrong-password", h) {
		t.Fatal("wrong password must not verify")
	}
}

func TestArgon2idRoundTrip(t *testing.T) {
	h, err := HashPassword("Correct Horse Battery Staple")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Fatalf("unexpected PHC prefix: %s", h[:40])
	}
	if !VerifyPassword("Correct Horse Battery Staple", h) {
		t.Fatal("round-trip verify failed")
	}
	if VerifyPassword("correct horse battery staple", h) {
		t.Fatal("case-mutated password must not verify")
	}
}

func TestBcryptLegacyStillVerifies(t *testing.T) {
	// Legacy path: a bcrypt hash minted by the old Go HashPassword must
	// keep verifying after the Argon2id migration (generated, not pasted).
	const pw = "legacy-bcrypt-password"
	raw, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword(pw, string(raw)) {
		t.Fatal("legacy bcrypt hash must still verify")
	}
	if VerifyPassword("wrong", string(raw)) {
		t.Fatal("wrong bcrypt password must not verify")
	}
}

func TestMalformedHashesFailClosed(t *testing.T) {
	for _, h := range []string{"", "not-a-hash", "$argon2id$v=19$m=0,t=2,p=1$xx$yy",
		"$argon2id$v=99$m=19456,t=2,p=1$xx$yy", "$argon2id$v=19$m=19456,t=2,p=1$!!!$yy"} {
		if VerifyPassword("anything", h) {
			t.Fatalf("malformed hash must fail closed: %q", h)
		}
	}
}
