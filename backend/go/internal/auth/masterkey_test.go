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
