package auth

import (
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/config"
)

// Master-key emergency login (mirrors Rust is_master_key_login +
// login_with_master_key dispatch): pure credential check plus the
// provision/repair upsert. Table-driven over enabled/disabled, username
// case/whitespace, wrong password, and blank-config fail-closed cases.
func TestIsMasterKeyLogin(t *testing.T) {
	base := config.Config{MasterKeyEnabled: true, MasterKeyUsername: "master", MasterKeyPassword: "s3cret"}
	cases := []struct {
		name  string
		cfg   config.Config
		email string
		pw    string
		want  bool
	}{
		{"match", base, "master", "s3cret", true},
		{"email case-insensitive", base, "MASTER", "s3cret", true},
		{"email whitespace trimmed", base, "  master  ", "s3cret", true},
		{"wrong password", base, "master", "nope", false},
		{"wrong username", base, "admin", "s3cret", false},
		{"disabled never matches", config.Config{MasterKeyEnabled: false, MasterKeyUsername: "master", MasterKeyPassword: "s3cret"}, "master", "s3cret", false},
		{"blank configured username fails closed", config.Config{MasterKeyEnabled: true, MasterKeyUsername: "  ", MasterKeyPassword: "s3cret"}, "master", "s3cret", false},
		{"blank configured password fails closed", config.Config{MasterKeyEnabled: true, MasterKeyUsername: "master", MasterKeyPassword: ""}, "master", "", false},
	}
	for _, c := range cases {
		if got := IsMasterKeyLogin(c.cfg, c.email, c.pw); got != c.want {
			t.Fatalf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

// LoginWithMasterKey honors the remembered choice: a checked sign-in with
// issuance enabled mints a remembered master session on the dedicated master
// windows (default 90d idle / 90d absolute, stamped password time); an
// unchecked one keeps the short legacy policy with no password time.
// Fully mocked: no database required.
func TestLoginWithMasterKeyRememberedPolicy(t *testing.T) {
	rememberedCfg := config.Load()
	rememberedCfg.PersistentLoginEnabled = true
	rememberedCfg.SessionRememberMasterIdleHours = 2160
	rememberedCfg.SessionRememberMasterAbsoluteHours = 2160

	legacyCfg := config.Load()
	legacyCfg.PersistentLoginEnabled = false

	for _, tc := range []struct {
		name     string
		cfg      config.Config
		remember bool
	}{
		{"checked signs a remembered master session", rememberedCfg, true},
		{"unchecked keeps the short legacy session", legacyCfg, false},
		{"checked with issuance disabled stays legacy", legacyCfg, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock: %v", err)
			}
			defer db.Close()
			// Fixed database clock, deliberately off wall time: deadlines
			// must derive from it, never from the API host clock.
			dbNow := time.Date(2026, 11, 3, 12, 0, 0, 0, time.UTC)
			// EnsureMasterKeyUser: own transaction, canonical id wins.
			mock.ExpectBegin()
			mock.ExpectExec("INSERT INTO users").WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectQuery("SELECT id FROM users").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("user-1"))
			mock.ExpectExec("INSERT INTO staff_profiles").WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectCommit()
			// Session issuance: tx begin, DB clock read, locked re-read,
			// row + audit event, commit.
			mock.ExpectBegin()
			mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
			mock.ExpectQuery("SELECT UTC_TIMESTAMP").
				WillReturnRows(sqlmock.NewRows([]string{"UTC_TIMESTAMP()"}).AddRow(dbNow))
			mock.ExpectQuery("FROM users WHERE id = .*FOR SHARE").
				WillReturnRows(sqlmock.NewRows([]string{"role", "state", "email", "display_name"}).AddRow("admin", "active", "master", "Master Key Admin"))
			mock.ExpectExec("INSERT INTO user_sessions").WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectExec("INSERT INTO user_session_events").WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectCommit()

			created, err := LoginWithMasterKey(t.Context(), db, tc.cfg, "master", tc.remember, nil)
			if err != nil {
				t.Fatalf("login: %v", err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("unmet expectations: %v", err)
			}
			if want := tc.remember && tc.cfg.PersistentLoginEnabled; created.Session.Remembered != want {
				t.Fatalf("remembered = %v, want %v", created.Session.Remembered, want)
			}
			if created.Session.Remembered {
				if created.Session.CredentialAuthenticatedAt == nil || !created.Session.CredentialAuthenticatedAt.Equal(dbNow) {
					t.Fatalf("remembered password time = %+v, want DB time %v", created.Session.CredentialAuthenticatedAt, dbNow)
				}
				if created.Session.IdleWindowSeconds == nil || *created.Session.IdleWindowSeconds != 2160*3600 {
					t.Fatalf("remembered master idle snapshot = %+v, want 7776000", created.Session.IdleWindowSeconds)
				}
				if !created.Session.IdleTimeoutAt.Equal(dbNow.Add(2160*time.Hour)) || !created.Session.ExpiresAt.Equal(dbNow.Add(2160*time.Hour)) {
					t.Fatalf("remembered deadlines = %v / %v, want DB-time +2160h", created.Session.IdleTimeoutAt, created.Session.ExpiresAt)
				}
			} else if created.Session.CredentialAuthenticatedAt != nil {
				t.Fatal("legacy master-key session must not gain a password time")
			}
			if created.Token == "" || created.Session.CSRFToken == "" {
				t.Fatal("issuance must return bearer + csrf credentials")
			}
		})
	}
}
// EnsureMasterKeyUser upserts users + staff_profiles in one tx and returns
// the canonical id by email (a pre-existing row wins over the fresh uuid).
func TestEnsureMasterKeyUser(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO users").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("SELECT id FROM users").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("user-existing"))
	mock.ExpectExec("INSERT INTO staff_profiles").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	id, err := EnsureMasterKeyUser(t.Context(), db, "master", time.Now().UTC())
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if id != "user-existing" {
		t.Fatalf("expected canonical id user-existing, got %q", id)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
