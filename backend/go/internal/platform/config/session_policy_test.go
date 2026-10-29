package config

import (
	"strings"
	"testing"
)

func validRuntimeConfig() Config {
	cfg := Load()
	cfg.DatabaseURL = "user@tcp(localhost)/db"
	cfg.AuthSecret = strings.Repeat("s", 40)
	cfg.Environment = "development"
	cfg.SessionCacheEnabled = false
	return cfg
}

func TestPersistentLoginDefaults(t *testing.T) {
	for _, key := range []string{"PERSISTENT_LOGIN_ENABLED", "SESSION_REMEMBER_STAFF_IDLE_HOURS", "SESSION_REMEMBER_STAFF_ABSOLUTE_HOURS", "SESSION_REMEMBER_ADMIN_IDLE_HOURS", "SESSION_REMEMBER_ADMIN_ABSOLUTE_HOURS", "SESSION_CREDENTIAL_FRESH_MINS", "AUTH_PUBLIC_ORIGIN"} {
		t.Setenv(key, "")
	}
	cfg := Load()
	if cfg.PersistentLoginEnabled {
		t.Fatal("remembered issuance must ship off")
	}
	if cfg.SessionRememberStaffIdleHours != 168 || cfg.SessionRememberStaffAbsoluteHours != 720 ||
		cfg.SessionRememberAdminIdleHours != 24 || cfg.SessionRememberAdminAbsoluteHours != 168 ||
		cfg.SessionCredentialFreshMins != 15 {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
}

func TestSessionPolicyValidation(t *testing.T) {
	cases := map[string]func(*Config){
		"zero staff idle":        func(c *Config) { c.SessionRememberStaffIdleHours = 0 },
		"idle above absolute":    func(c *Config) { c.SessionRememberStaffIdleHours, c.SessionRememberStaffAbsoluteHours = 200, 100 },
		"absolute above cap":     func(c *Config) { c.SessionRememberStaffAbsoluteHours = MaxRememberedSessionHours + 1 },
		"admin idle above cap":   func(c *Config) { c.SessionRememberAdminIdleHours = 10000 },
		"negative admin":         func(c *Config) { c.SessionRememberAdminAbsoluteHours = -1 },
		"zero freshness":         func(c *Config) { c.SessionCredentialFreshMins = 0 },
		"freshness above cap":    func(c *Config) { c.SessionCredentialFreshMins = MaxCredentialFreshMins + 1 },
		"origin with path":       func(c *Config) { c.AuthPublicOrigin = "https://exams.example.com/app" },
		"origin with user info":  func(c *Config) { c.AuthPublicOrigin = "https://u:p@exams.example.com" },
		"origin non-http scheme": func(c *Config) { c.AuthPublicOrigin = "ftp://exams.example.com" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			cfg := validRuntimeConfig()
			mutate(&cfg)
			if err := cfg.ValidateForRuntime(); err == nil {
				t.Fatal("invalid session policy accepted")
			}
		})
	}
	if err := validRuntimeConfig().ValidateForRuntime(); err != nil {
		t.Fatalf("defaults must validate: %v", err)
	}
}

func TestValidateForAPI(t *testing.T) {
	cfg := validRuntimeConfig()
	if err := cfg.ValidateForAPI(); err != nil {
		t.Fatalf("development defaults must validate: %v", err)
	}
	cached := cfg
	cached.SessionCacheEnabled = true
	if err := cached.ValidateForAPI(); err == nil {
		t.Fatal("the API must refuse SESSION_CACHE=on")
	}

	prod := cfg
	prod.Environment = "production"
	prod.ObjectStorageLocalRoot = "/data/object-store"
	prod.CookieSecure = true
	prod.AuthPublicOrigin = ""
	if err := prod.ValidateForAPI(); err == nil {
		t.Fatal("production must declare AUTH_PUBLIC_ORIGIN")
	}
	prod.AuthPublicOrigin = "http://exams.example.com"
	if err := prod.ValidateForAPI(); err == nil {
		t.Fatal("production origin must be https")
	}
	prod.AuthPublicOrigin = "https://exams.example.com"
	if err := prod.ValidateForAPI(); err != nil {
		t.Fatalf("valid production config rejected: %v", err)
	}
	prod.CookieSecure = false
	if err := prod.ValidateForAPI(); err == nil {
		t.Fatal("production must use Secure cookies")
	}
}

func TestParseAuthOriginNormalizes(t *testing.T) {
	cases := map[string]string{
		"https://Exams.Example.com":      "https://exams.example.com:443",
		"https://exams.example.com:443/": "https://exams.example.com:443",
		"http://localhost:3000":          "http://localhost:3000",
		"http://127.0.0.1":               "http://127.0.0.1:80",
	}
	for in, want := range cases {
		got, err := ParseAuthOrigin(in)
		if err != nil || got.String() != want {
			t.Errorf("ParseAuthOrigin(%q) = %q, %v; want %q", in, got.String(), err, want)
		}
	}
	for _, bad := range []string{"", "null", "exams.example.com", "https://exams.example.com?x=1", "https://exams.example.com#f"} {
		if _, err := ParseAuthOrigin(bad); err == nil {
			t.Errorf("ParseAuthOrigin(%q) accepted", bad)
		}
	}
}
