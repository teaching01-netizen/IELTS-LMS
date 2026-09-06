package config

import (
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	c := Load()
	if c.APIPort != 4000 {
		t.Fatalf("default port = %d", c.APIPort)
	}
	if c.BackgroundMode != BackgroundContinuous {
		t.Fatalf("default mode = %q", c.BackgroundMode)
	}
	// NOTE (round 74): V2-only is structural now (no rollout flag); the
	// creation gate (schedules.ProtocolVersionV2) + engine reject (!=2) own it.
	if c.MaxMutationsPerBatch != 200 || c.MaxWritingAnswerChars != 50000 || c.MaxTextAnswerChars != 512 {
		t.Fatalf("delivery guardrails changed: %+v", c)
	}
	if c.AttemptTokenTTLMins != 15 || c.SessionIdleStaffMins != 30 || c.SessionIdleStudentMins != 60 {
		t.Fatalf("auth lifetimes changed: %+v", c)
	}
}

func TestLoadPrefersPlatformPort(t *testing.T) {
	t.Setenv("PORT", "8080")
	t.Setenv("API_PORT", "4000")
	if got := Load().APIPort; got != 8080 {
		t.Fatalf("platform port = %d, want 8080", got)
	}
}

func TestValidateForRuntime(t *testing.T) {
	good := Load()
	good.DatabaseURL = "user:pass@tcp(localhost:3306)/db?parseTime=true"
	good.Environment = "development"
	// AUTH_SECRET is required in every environment (min 32 chars); the
	// default env has none, so the valid fixture sets a throwaway value.
	good.AuthSecret = "test-only-auth-secret-32-chars-min"
	if err := good.ValidateForRuntime(); err != nil {
		t.Fatalf("valid dev config rejected: %v", err)
	}
	missing := good
	missing.DatabaseURL = ""
	if err := missing.ValidateForRuntime(); err == nil {
		t.Fatal("expected DATABASE_URL requirement")
	}
	prod := good
	prod.Environment = "production"
	prod.AuthSecret = ""
	if err := prod.ValidateForRuntime(); err == nil {
		t.Fatal("expected production AUTH_SECRET requirement")
	}
	prod.AuthSecret = "test-only-auth-secret-32-chars-min!!"
	prod.MasterKeyEnabled = true
	if err := prod.ValidateForRuntime(); err == nil {
		t.Fatal("expected production master-key rejection")
	}
	// Master key without a password is a misconfiguration in every
	// environment (fail closed): enabling it must require a password.
	nopw := good
	nopw.MasterKeyEnabled = true
	nopw.MasterKeyPassword = ""
	if err := nopw.ValidateForRuntime(); err == nil {
		t.Fatal("expected master-key-without-password rejection")
	}
	withpw := nopw
	withpw.MasterKeyPassword = "s3cret"
	if err := withpw.ValidateForRuntime(); err != nil {
		t.Fatalf("master key with password rejected in dev: %v", err)
	}
	// Weak/short secrets are rejected in every environment (no immortal
	// dev bypass); empty and default values fail closed too.
	for _, weak := range []string{"", "dev-secret-change-me", "short"} {
		w := good
		w.AuthSecret = weak
		if err := w.ValidateForRuntime(); err == nil {
			t.Fatalf("expected weak AUTH_SECRET %q rejection", weak)
		}
	}
	// Username defaults to "master" like Rust when the env value is blank.
	t.Setenv("MASTER_KEY_USERNAME", "")
	if got := Load().MasterKeyUsername; got != "master" {
		t.Fatalf("default master-key username = %q", got)
	}
}

func TestCookieTransportDefaultsInsecureOutsideProduction(t *testing.T) {
	c := Load()
	if c.Environment == "production" || c.Environment == "prod" {
		t.Skip("production env")
	}
	if c.CookieSecure {
		t.Fatal("CookieSecure must default false outside production (Secure + __Host- cookies are dropped on http)")
	}
	if got := c.EffectiveSessionCookieName(); got != "session" {
		t.Fatalf("EffectiveSessionCookieName = %q, want %q", got, "session")
	}
	if got := c.EffectiveCsrfCookieName(); got != "csrf" {
		t.Fatalf("EffectiveCsrfCookieName = %q, want %q", got, "csrf")
	}
}

func TestEffectiveCookieNameKeepsHostPrefixWhenSecure(t *testing.T) {
	if got := effectiveCookieName("__Host-session", true); got != "__Host-session" {
		t.Fatalf("secure name = %q", got)
	}
	if got := effectiveCookieName("custom", false); got != "custom" {
		t.Fatalf("custom insecure name = %q", got)
	}
	if !defaultCookieSecure("production") || !defaultCookieSecure("prod") {
		t.Fatal("production must default secure")
	}
	if defaultCookieSecure("development") {
		t.Fatal("development must default insecure")
	}
}
