// Package config loads and validates process configuration once at startup.
// It mirrors the behavior-bearing surface of the Rust config catalogue
// (backend/crates/infrastructure/src/config.rs) so the Go rewrite keeps
// identical env names, defaults and validation semantics.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// BackgroundMode selects the background topology.
type BackgroundMode string

const (
	BackgroundContinuous     BackgroundMode = "continuous"
	BackgroundActivityDriven BackgroundMode = "activity_driven"
)

// Config is the validated process configuration. Loaded once, passed explicitly.
type Config struct {
	APIHost string
	APIPort int

	DatabaseURL       string
	DatabaseDirectURL string
	DBPoolMax         int
	DBPoolMaxIdle     int

	BackgroundMode BackgroundMode
	IdleGraceSecs  int

	RuntimeAutoAdvanceEnabled bool
	RuntimeAutoAdvanceTickMs  int

	// NOTE (round 74): the RESPONSE_DURABILITY_V2_ENABLED rollout flag was
	// removed — V2 is the product (plan 127/139); new attempts are always V2
	// (schedules.ProtocolVersionV2) and the V2 engine rejects protocol != 2.
	LiveModeEnabled           bool
	GradingProjectionEnabled  bool
	GradingSyncOnReadFallback bool
	StormAdmissionEnabled     bool
	MasterKeyEnabled          bool
	MasterKeyUsername         string
	MasterKeyPassword         string
	PrometheusEnabled         bool
	OtelEndpoint              string
	FrontendDistDir           string
	ObjectStorageLocalRoot    string

	AuthSecret             string
	SessionCookieName      string
	CsrfCookieName         string
	CookieSecure           bool
	SessionIdleStaffMins   int
	SessionIdleStudentMins int
	SessionAbsoluteHours   int
	AttemptTokenTTLMins    int

	MaxMutationsPerBatch  int
	MaxWritingAnswerChars int
	MaxTextAnswerChars    int
	AutoSubmitBatchSize   int
	HeartbeatMinWriteSecs int

	WorkerFallbackIntervalSecs    int
	WorkerMaintenanceIntervalSecs int
	LiveUpdatePollIntervalMs      int
	OutboxBatchSize               int
	OutboxMaxAttempts             int
	GradingProjectionIntervalSecs int

	RateLimitGlobalPerMin int
	RateLimitBucketCap    int

	StorageWarningBytes  int64
	StorageCriticalBytes int64

	ResourceProfile string
	Environment     string // development | preview | staging | production
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getenvInt(key string, def int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func getenvInt64(key string, def int64) int64 {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return def
	}
	return n
}

func getenvBool(key string, def bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	switch v {
	case "", "unset":
		return def
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return def
	}
}

// Load reads the environment with production defaults.
func Load() Config {
	profile := strings.ToLower(strings.TrimSpace(os.Getenv("RESOURCE_PROFILE")))
	poolMax := getenvInt("DB_POOL_MAX_CONNECTIONS", 20)
	if v := strings.TrimSpace(os.Getenv("DB_POOL_MAX_CONNECTIONS")); v == "" && profile == "low" {
		poolMax = 3
	}
	mode := BackgroundMode(strings.ToLower(strings.TrimSpace(os.Getenv("BACKGROUND_RUNTIME_MODE"))))
	if mode == "" {
		mode = BackgroundContinuous
	}
	environment := getenv("APP_ENV", getenv("ENVIRONMENT", "development"))
	return Config{
		APIHost: getenv("API_HOST", "0.0.0.0"),
		// Platforms such as Railway inject PORT at runtime. Keep API_PORT as
		// the local/development fallback, but never let it override the
		// platform-assigned listener port.
		APIPort: getenvInt("PORT", getenvInt("API_PORT", 4000)),

		DatabaseURL:       os.Getenv("DATABASE_URL"),
		DatabaseDirectURL: os.Getenv("DATABASE_DIRECT_URL"),
		DBPoolMax:         poolMax,
		DBPoolMaxIdle:     getenvInt("DB_POOL_MAX_IDLE", 5),

		BackgroundMode: mode,
		IdleGraceSecs:  getenvInt("IDLE_GRACE_SECS", 300),

		RuntimeAutoAdvanceEnabled: getenvBool("RUNTIME_AUTO_ADVANCE_ENABLED", true),
		RuntimeAutoAdvanceTickMs:  getenvInt("RUNTIME_AUTO_ADVANCE_TICK_MS", 1000),

		LiveModeEnabled:           getenvBool("LIVE_MODE_ENABLED", true),
		GradingProjectionEnabled:  getenvBool("GRADING_PROJECTION_ENABLED", true),
		GradingSyncOnReadFallback: getenvBool("GRADING_SYNC_ON_READ_FALLBACK", true),
		StormAdmissionEnabled:     getenvBool("STORM_ADMISSION_ENABLED", false),
		// Master-key emergency admin login (mirrors Rust AppConfig
		// master_key_*: username defaults to "master" like Rust; blank
		// username/password env values fall back to the defaults so an
		// explicitly empty password never silently locks the key out).
		MasterKeyEnabled:       getenvBool("MASTER_KEY_ENABLED", false),
		MasterKeyUsername:      getenv("MASTER_KEY_USERNAME", "master"),
		MasterKeyPassword:      os.Getenv("MASTER_KEY_PASSWORD"),
		PrometheusEnabled:      getenvBool("PROMETHEUS_ENABLED", false),
		OtelEndpoint:           os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"),
		FrontendDistDir:        os.Getenv("FRONTEND_DIST_DIR"),
		ObjectStorageLocalRoot: getenv("OBJECT_STORAGE_LOCAL_ROOT", ".data/object-store"),

		AuthSecret:             os.Getenv("AUTH_SECRET"),
		SessionCookieName:      getenv("SESSION_COOKIE_NAME", "__Host-session"),
		CsrfCookieName:         getenv("CSRF_COOKIE_NAME", "__Host-csrf"),
		CookieSecure:           getenvBool("COOKIE_SECURE", defaultCookieSecure(environment)),
		SessionIdleStaffMins:   getenvInt("SESSION_IDLE_STAFF_MINS", 30),
		SessionIdleStudentMins: getenvInt("SESSION_IDLE_STUDENT_MINS", 60),
		SessionAbsoluteHours:   getenvInt("SESSION_ABSOLUTE_HOURS", 12),
		AttemptTokenTTLMins:    getenvInt("ATTEMPT_TOKEN_TTL_MINUTES", 15),

		MaxMutationsPerBatch:  getenvInt("MAX_MUTATIONS_PER_BATCH", 200),
		MaxWritingAnswerChars: getenvInt("MAX_WRITING_ANSWER_CHARS", 50000),
		MaxTextAnswerChars:    getenvInt("MAX_TEXT_ANSWER_CHARS", 512),
		AutoSubmitBatchSize:   getenvInt("AUTO_SUBMIT_BATCH_SIZE", 100),
		HeartbeatMinWriteSecs: getenvInt("HEARTBEAT_PRESENCE_MIN_WRITE_INTERVAL_SECS", 5),

		WorkerFallbackIntervalSecs:    getenvInt("WORKER_FALLBACK_INTERVAL_SECS", 5),
		WorkerMaintenanceIntervalSecs: getenvInt("WORKER_MAINTENANCE_INTERVAL_SECS", 300),
		LiveUpdatePollIntervalMs:      getenvInt("LIVE_UPDATE_POLL_INTERVAL_MS", 1000),
		OutboxBatchSize:               getenvInt("OUTBOX_BATCH_SIZE", 100),
		OutboxMaxAttempts:             getenvInt("OUTBOX_MAX_ATTEMPTS", 10),
		GradingProjectionIntervalSecs: getenvInt("GRADING_PROJECTION_INTERVAL_SECS", 5),

		RateLimitGlobalPerMin: getenvInt("RATE_LIMIT_GLOBAL", 600),
		RateLimitBucketCap:    getenvInt("RATE_LIMIT_BUCKET_CAP", 120),

		StorageWarningBytes:  getenvInt64("STORAGE_WARNING_BYTES", 10<<30),
		StorageCriticalBytes: getenvInt64("STORAGE_CRITICAL_BYTES", 50<<30),

		ResourceProfile: profile,
		Environment:     environment,
	}
}

// offcut: __Host- cookies require Secure; without it browsers drop the
// cookie on http, so the prefix is stripped for insecure issuers.
func effectiveCookieName(configured string, secure bool) string {
	if secure {
		return configured
	}
	return strings.TrimPrefix(configured, "__Host-")
}

// EffectiveSessionCookieName is the cookie name browsers will actually store.
func (c Config) EffectiveSessionCookieName() string {
	return effectiveCookieName(c.SessionCookieName, c.CookieSecure)
}

// EffectiveCsrfCookieName is the cookie name browsers will actually store.
func (c Config) EffectiveCsrfCookieName() string {
	return effectiveCookieName(c.CsrfCookieName, c.CookieSecure)
}

func defaultCookieSecure(environment string) bool {
	switch strings.ToLower(strings.TrimSpace(environment)) {
	case "production", "prod":
		return true
	default:
		return false
	}
}

// ValidateForRuntime rejects unsafe production configuration.
func (c Config) ValidateForRuntime() error {
	if c.DatabaseURL == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	// Master key is an emergency credential: enabling it without a password
	// is a misconfiguration in every environment (fail closed), matching the
	// Rust posture where an empty password never authenticates.
	if c.MasterKeyEnabled && strings.TrimSpace(c.MasterKeyPassword) == "" {
		return fmt.Errorf("MASTER_KEY_PASSWORD must be set when MASTER_KEY_ENABLED is true")
	}
	// AUTH_SECRET signs attempt tokens + session-adjacent HMACs: require a
	// non-default secret with minimum entropy in every environment (fail
	// closed). Tests that never sign tokens must set a throwaway value.
	if strings.TrimSpace(c.AuthSecret) == "" || c.AuthSecret == "dev-secret-change-me" || len(c.AuthSecret) < 32 {
		return fmt.Errorf("AUTH_SECRET must be set to a strong value of at least 32 characters")
	}
	env := strings.ToLower(c.Environment)
	if env == "production" {
		if c.MasterKeyEnabled {
			return fmt.Errorf("MASTER_KEY_ENABLED must be false in production")
		}
	}
	if c.BackgroundMode != BackgroundContinuous && c.BackgroundMode != BackgroundActivityDriven {
		return fmt.Errorf("invalid BACKGROUND_RUNTIME_MODE %q", c.BackgroundMode)
	}
	if c.APIPort <= 0 || c.APIPort > 65535 {
		return fmt.Errorf("invalid API port %d", c.APIPort)
	}
	if c.DBPoolMax <= 0 {
		return fmt.Errorf("DB_POOL_MAX_CONNECTIONS must be positive")
	}
	return nil
}

// Addr returns host:port.
func (c Config) Addr() string { return fmt.Sprintf("%s:%d", c.APIHost, c.APIPort) }
