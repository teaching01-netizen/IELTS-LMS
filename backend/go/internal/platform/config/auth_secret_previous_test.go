package config

import "testing"

func TestAuthSecretPreviousParsesAndValidates(t *testing.T) {
	t.Setenv("AUTH_SECRET_PREVIOUS", " retired-secret-one-with-32-characters!! , ,retired-secret-two-with-32-characters!!")
	cfg := Load()
	cfg.DatabaseURL = "user:pass@tcp(localhost:3306)/db?parseTime=true"
	cfg.AuthSecret = "current-auth-secret-with-32-characters!!"
	if len(cfg.AuthSecretPrevious) != 2 {
		t.Fatalf("retired secrets: %q", cfg.AuthSecretPrevious)
	}
	if err := cfg.ValidateForRuntime(); err != nil {
		t.Fatalf("valid retired secrets rejected: %v", err)
	}
	for _, bad := range [][]string{{"short"}, {cfg.AuthSecret}} {
		invalid := cfg
		invalid.AuthSecretPrevious = bad
		if err := invalid.ValidateForRuntime(); err == nil {
			t.Fatalf("invalid retired secret accepted: %q", bad)
		}
	}
}
