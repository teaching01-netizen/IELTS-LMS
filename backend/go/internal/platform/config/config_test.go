package config

import (
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	t.Setenv("TRUSTED_PROXIES", "")
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
	if c.IdleGraceSecs != 60 || c.GradingSyncOnReadFallback || !c.PrometheusEnabled {
		t.Fatalf("Rust runtime defaults changed: %+v", c)
	}
	if c.WorkerFallbackIntervalSecs != 10 || c.LiveUpdatePollIntervalMs != 250 || c.AutoSubmitBatchSize != 50 {
		t.Fatalf("Rust worker defaults changed: %+v", c)
	}
	if c.RateLimitBucketCap != 10000 || c.RateLimitMaxKeys != 10000 || c.RateLimitBurst != 0 || c.RateLimitExportPerUser != 3 || c.RateLimitExportPerUserWindowSecs != 300 {
		t.Fatalf("Rust rate-limit defaults changed: %+v", c)
	}
	if len(c.TrustedProxyCIDRs) != 2 || c.TrustedProxyCIDRs[0] != "127.0.0.0/8" || c.TrustedProxyCIDRs[1] != "::1/128" {
		t.Fatalf("trusted-proxy defaults must be loopback only: %v", c.TrustedProxyCIDRs)
	}
}

func TestTrustedProxyConfig(t *testing.T) {
	t.Setenv("TRUSTED_PROXIES", "10.0.0.0/8, 2001:db8::/32")
	c := Load()
	if len(c.TrustedProxyCIDRs) != 2 || c.TrustedProxyCIDRs[0] != "10.0.0.0/8" || c.TrustedProxyCIDRs[1] != "2001:db8::/32" {
		t.Fatalf("trusted-proxy env parsing changed: %v", c.TrustedProxyCIDRs)
	}

	c.DatabaseURL = "user:pass@tcp(localhost:3306)/db?parseTime=true"
	c.AuthSecret = "test-only-auth-secret-32-chars-min"
	c.TrustedProxyCIDRs = []string{"not-a-cidr"}
	if err := c.ValidateForRuntime(); err == nil {
		t.Fatal("invalid TRUSTED_PROXIES CIDR must fail runtime validation")
	}
}

func TestPromptCoeditingIsAlwaysOn(t *testing.T) {
	t.Setenv("AUTHORING_REALTIME_COEDITING", "false")
	t.Setenv("AUTHORING_COEDIT_SERVICE_ENABLED", "false")
	t.Setenv("AUTHORING_COEDIT_SERVICE_URL", "")
	t.Setenv("AUTHORING_COEDIT_TOKEN_SECRET", "")
	t.Setenv("AUTHORING_COEDIT_SERVICE_SECRET", "")

	c := Load()
	if !c.AuthoringRealtimeCoediting || !c.AuthoringCoeditServiceEnabled {
		t.Fatalf("prompt co-editing must be enabled without rollout flags: %+v", c)
	}
	if c.AuthoringCoeditServiceURL == "" || len(c.AuthoringCoeditTokenSecret) < 32 || len(c.AuthoringCoeditServiceSecret) < 32 {
		t.Fatalf("prompt co-editing local defaults are incomplete: %+v", c)
	}
}

func TestLoadLowResourceDefaults(t *testing.T) {
	t.Setenv("RESOURCE_PROFILE", "low")
	c := Load()
	if c.WorkerFallbackIntervalSecs != 60 || c.LiveUpdatePollIntervalMs != 500 {
		t.Fatalf("low-resource defaults changed: %+v", c)
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
	prod.MasterKeyPassword = "production-test-master-password"
	if err := prod.ValidateForRuntime(); err != nil {
		t.Fatalf("production master key with password rejected: %v", err)
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
	embedded := good
	embedded.AuthoringCoeditProxyEnabled = true
	if err := embedded.ValidateForRuntime(); err == nil {
		t.Fatal("expected embedded co-edit proxy to require a public URL")
	}
	embedded.AuthoringCoeditPublicURL = "https://api.example.com/authoring-coedit"
	if err := embedded.ValidateForRuntime(); err != nil {
		t.Fatalf("valid embedded co-edit public URL rejected: %v", err)
	}
	embedded.AuthoringCoeditPublicURL = "ftp://api.example.com/authoring-coedit"
	if err := embedded.ValidateForRuntime(); err == nil {
		t.Fatal("expected embedded co-edit proxy to reject non-web URL")
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
