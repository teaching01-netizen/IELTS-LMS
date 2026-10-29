package auth

// Real-MySQL evidence for the persistent-login lifecycle (TC-3/6/7/8):
// locked admission, monotonic touch, credential fences, atomic reset /
// activation and revoke-all audit. Races use InnoDB lock
// waits as barriers (a holder transaction plus polling information_schema
// for the waiter), never sleeps. Failure injection uses a trigger scoped to
// one test user. Gated on TEST_MYSQL_DSN pointing at a disposable, fully
// migrated database; without it the suite skips.

import (
	"context"
	"database/sql"
	"os"
	"sync"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/config"
	platformdb "example.com/ielts-proctoring/internal/platform/db"
	"github.com/google/uuid"
)

func authMySQL(t *testing.T) *sql.DB {
	t.Helper()
	raw := os.Getenv("TEST_MYSQL_DSN")
	if raw == "" {
		t.Skip("TEST_MYSQL_DSN not set; requires an isolated migrated MySQL")
	}
	dsn, err := platformdb.NormalizeDSN(raw)
	if err != nil {
		t.Fatalf("normalize TEST_MYSQL_DSN: %v", err)
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(16)
	t.Cleanup(func() { db.Close() })
	if err := db.Ping(); err != nil {
		t.Fatalf("TEST_MYSQL_DSN unreachable: %v", err)
	}
	return db
}

func persistentTestCfg() config.Config {
	cfg := testCfg()
	cfg.PersistentLoginEnabled = true
	cfg.SessionRememberStaffIdleHours, cfg.SessionRememberStaffAbsoluteHours = 168, 720
	cfg.SessionRememberAdminIdleHours, cfg.SessionRememberAdminAbsoluteHours = 24, 168
	return cfg
}

const testPassword = "Correct-Horse-1"

// seedAccount inserts an account with a password and returns its id/email.
func seedAccount(t *testing.T, db *sql.DB, role, state string) (string, string) {
	t.Helper()
	id := uuid.NewString()
	email := "pl-" + id + "@example.test"
	hash, err := HashPassword(testPassword)
	if err != nil {
		t.Fatal(err)
	}
	mustExecDB(t, db, `INSERT INTO users (id, email, display_name, role, state, failed_login_count) VALUES (?, ?, 'Persistent Test', ?, ?, 0)`, id, email, role, state)
	mustExecDB(t, db, `INSERT INTO user_password_credentials (user_id, password_hash) VALUES (?, ?)`, id, hash)
	t.Cleanup(func() {
		_, _ = db.Exec(`DELETE FROM user_sessions WHERE user_id = ?`, id)
		_, _ = db.Exec(`DELETE FROM password_reset_tokens WHERE user_id = ?`, id)
		_, _ = db.Exec(`DELETE FROM account_activation_tokens WHERE user_id = ?`, id)
		_, _ = db.Exec(`DELETE FROM user_password_credentials WHERE user_id = ?`, id)
		_, _ = db.Exec(`DELETE FROM users WHERE id = ?`, id)
	})
	return id, email
}

func mustExecDB(t *testing.T, db interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, q string, args ...any) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(), q, args...); err != nil {
		t.Fatalf("exec %q: %v", q, err)
	}
}

type sessionRowState struct {
	revoked      bool
	remembered   bool
	idleWindow   sql.NullInt64
	credentialAt sql.NullTime
	expiresAt    time.Time
	idleAt       time.Time
	issuedAt     time.Time
}

func readSessionRow(t *testing.T, db *sql.DB, id string) sessionRowState {
	t.Helper()
	var s sessionRowState
	var revoked sql.NullTime
	if err := db.QueryRow(`SELECT revoked_at, remembered, idle_window_seconds, credential_authenticated_at, expires_at, idle_timeout_at, issued_at FROM user_sessions WHERE id = ?`, id).
		Scan(&revoked, &s.remembered, &s.idleWindow, &s.credentialAt, &s.expiresAt, &s.idleAt, &s.issuedAt); err != nil {
		t.Fatal(err)
	}
	s.revoked = revoked.Valid
	return s
}

func wantCode(t *testing.T, err error, code apperrors.Code) {
	t.Helper()
	ae, ok := apperrors.As(err)
	if !ok || ae.Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
}

// awaitLockWait blocks until some transaction is waiting on a row lock —
// the deterministic barrier that the contender reached its locked read.
// performance_schema is live; information_schema.innodb_trx is a cache that
// tight polling never refreshes.
func awaitLockWait(t *testing.T, db *sql.DB) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var n int
		if err := db.QueryRow(`SELECT COUNT(*) FROM performance_schema.data_lock_waits`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("contender never reached its lock wait")
}

func TestLoginPolicyPersistenceMySQL(t *testing.T) {
	db := authMySQL(t)
	ctx := context.Background()
	cfg := persistentTestCfg()

	_, builderEmail := seedAccount(t, db, RoleBuilder, "active")
	created, err := LoginWithPassword(ctx, db, cfg, builderEmail, testPassword, true, nil)
	if err != nil {
		t.Fatal(err)
	}
	row := readSessionRow(t, db, created.Session.ID)
	if !row.remembered || row.idleWindow.Int64 != 7*24*3600 || !row.credentialAt.Valid {
		t.Fatalf("remembered builder row = %+v", row)
	}
	if got := row.expiresAt.Sub(row.issuedAt); got != 720*time.Hour {
		t.Fatalf("hard lifetime = %s", got)
	}
	if got := row.idleAt.Sub(row.issuedAt); got != 168*time.Hour {
		t.Fatalf("idle window = %s", got)
	}
	if !created.Session.Remembered || created.Session.CredentialAuthenticatedAt == nil {
		t.Fatal("created session must report the persisted policy")
	}

	short, err := LoginWithPassword(ctx, db, cfg, builderEmail, testPassword, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	row = readSessionRow(t, db, short.Session.ID)
	if row.remembered || row.idleWindow.Int64 != 30*60 || !row.credentialAt.Valid || row.expiresAt.Sub(row.issuedAt) != 12*time.Hour {
		t.Fatalf("opt-out row = %+v", row)
	}

	off := cfg
	off.PersistentLoginEnabled = false
	flagOff, err := LoginWithPassword(ctx, db, off, builderEmail, testPassword, true, nil)
	if err != nil {
		t.Fatal(err)
	}
	if readSessionRow(t, db, flagOff.Session.ID).remembered {
		t.Fatal("feature off must not issue remembered sessions")
	}

	_, studentEmail := seedAccount(t, db, RoleStudent, "active")
	student, err := LoginWithPassword(ctx, db, cfg, studentEmail, testPassword, true, nil)
	if err != nil {
		t.Fatal(err)
	}
	row = readSessionRow(t, db, student.Session.ID)
	if row.remembered || row.idleWindow.Valid || row.credentialAt.Valid {
		t.Fatalf("student password login must stay on the legacy metadata path: %+v", row)
	}

	_, observerEmail := seedAccount(t, db, RoleAdminObserver, "active")
	observer, err := LoginWithPassword(ctx, db, cfg, observerEmail, testPassword, true, nil)
	if err != nil {
		t.Fatal(err)
	}
	if readSessionRow(t, db, observer.Session.ID).remembered {
		t.Fatal("admin_observer is not yet rememberable")
	}
}

func TestLoginAccountStateFencesMySQL(t *testing.T) {
	db := authMySQL(t)
	ctx := context.Background()
	cfg := persistentTestCfg()

	t.Run("failed attempts commit and lock", func(t *testing.T) {
		id, email := seedAccount(t, db, RoleProctor, "active")
		for i := 0; i < maxFailedLogins; i++ {
			_, err := LoginWithPassword(ctx, db, cfg, email, "wrong", false, nil)
			wantCode(t, err, apperrors.CodeUnauthorized)
		}
		var state string
		var failed int
		var until sql.NullTime
		if err := db.QueryRow(`SELECT state, failed_login_count, locked_until FROM users WHERE id = ?`, id).Scan(&state, &failed, &until); err != nil {
			t.Fatal(err)
		}
		if state != "locked" || failed != maxFailedLogins || !until.Valid {
			t.Fatalf("lockout not committed: state=%s failed=%d until=%v", state, failed, until)
		}
		_, err := LoginWithPassword(ctx, db, cfg, email, testPassword, false, nil)
		if ae, _ := apperrors.As(err); ae == nil || ae.Message != "Account locked." {
			t.Fatalf("locked account must stay locked: %v", err)
		}
		// Expired timed lock: a correct password reactivates.
		mustExecDB(t, db, `UPDATE users SET locked_until = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE id = ?`, id)
		if _, err := LoginWithPassword(ctx, db, cfg, email, testPassword, false, nil); err != nil {
			t.Fatalf("expired timed lock must clear: %v", err)
		}
	})
	for _, state := range []string{"disabled", "pending_activation"} {
		t.Run(state, func(t *testing.T) {
			id, email := seedAccount(t, db, RoleBuilder, state)
			_, err := LoginWithPassword(ctx, db, cfg, email, testPassword, true, nil)
			wantCode(t, err, apperrors.CodeUnauthorized)
			var got string
			_ = db.QueryRow(`SELECT state FROM users WHERE id = ?`, id).Scan(&got)
			if got != state {
				t.Fatalf("correct password reactivated a %s account (now %s)", state, got)
			}
		})
	}
	t.Run("indefinite lock", func(t *testing.T) {
		id, email := seedAccount(t, db, RoleBuilder, "locked")
		_, err := LoginWithPassword(ctx, db, cfg, email, testPassword, false, nil)
		wantCode(t, err, apperrors.CodeUnauthorized)
		var got string
		_ = db.QueryRow(`SELECT state FROM users WHERE id = ?`, id).Scan(&got)
		if got != "locked" {
			t.Fatal("a lock without a deadline must never clear automatically")
		}
	})
}

// INV-5: a password changed after verification (but before the login takes
// its locks) makes the old proof stale.
func TestLoginRejectsPasswordChangedDuringVerificationMySQL(t *testing.T) {
	db := authMySQL(t)
	ctx := context.Background()
	id, email := seedAccount(t, db, RoleBuilder, "active")

	holder, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Rollback()
	if _, err := holder.ExecContext(ctx, `SELECT id FROM users WHERE id = ? FOR UPDATE`, id); err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		_, err := LoginWithPassword(ctx, db, persistentTestCfg(), email, testPassword, true, nil)
		result <- err
	}()
	awaitLockWait(t, db)
	newHash, _ := HashPassword("A-New-Password-2")
	if _, err := holder.ExecContext(ctx, `UPDATE user_password_credentials SET password_hash = ? WHERE user_id = ?`, newHash, id); err != nil {
		t.Fatal(err)
	}
	if err := holder.Commit(); err != nil {
		t.Fatal(err)
	}
	wantCode(t, <-result, apperrors.CodeUnauthorized)
	var sessions int
	_ = db.QueryRow(`SELECT COUNT(*) FROM user_sessions WHERE user_id = ?`, id).Scan(&sessions)
	if sessions != 0 {
		t.Fatal("a stale password proof issued a session")
	}
}

// An administrative disable that lands between verification and lock wins.
func TestLoginDisableBetweenVerificationAndLockMySQL(t *testing.T) {
	db := authMySQL(t)
	ctx := context.Background()
	id, email := seedAccount(t, db, RoleBuilder, "active")
	holder, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Rollback()
	if _, err := holder.ExecContext(ctx, `SELECT id FROM users WHERE id = ? FOR UPDATE`, id); err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		_, err := LoginWithPassword(ctx, db, persistentTestCfg(), email, testPassword, false, nil)
		result <- err
	}()
	awaitLockWait(t, db)
	if _, err := holder.ExecContext(ctx, `UPDATE users SET state = 'disabled' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	if err := holder.Commit(); err != nil {
		t.Fatal(err)
	}
	wantCode(t, <-result, apperrors.CodeUnauthorized)
	var state string
	_ = db.QueryRow(`SELECT state FROM users WHERE id = ?`, id).Scan(&state)
	if state != "disabled" {
		t.Fatalf("verified password overwrote a concurrent disable (state %s)", state)
	}
}

func TestLookupLockedAdmissionMySQL(t *testing.T) {
	db := authMySQL(t)
	ctx := context.Background()
	cfg := persistentTestCfg()
	_, email := seedAccount(t, db, RoleBuilder, "active")

	t.Run("remembered touch uses snapshot and never moves hard expiry", func(t *testing.T) {
		created, err := LoginWithPassword(ctx, db, cfg, email, testPassword, true, nil)
		if err != nil {
			t.Fatal(err)
		}
		before := readSessionRow(t, db, created.Session.ID)
		mustExecDB(t, db, `UPDATE user_sessions SET idle_timeout_at = issued_at + INTERVAL 1 HOUR WHERE id = ?`, created.Session.ID)
		s, err := LookupSession(ctx, db, cfg, created.Token)
		if err != nil || s == nil {
			t.Fatalf("lookup: %+v %v", s, err)
		}
		after := readSessionRow(t, db, created.Session.ID)
		if !after.expiresAt.Equal(before.expiresAt) || !after.credentialAt.Time.Equal(before.credentialAt.Time) {
			t.Fatal("lookup moved the absolute deadline or password time")
		}
		if d := after.idleAt.Sub(s.ValidatedAt); d != 168*time.Hour {
			t.Fatalf("idle extension = %s, want stored 168h window", d)
		}
	})

	t.Run("revocation committed while lookup waits", func(t *testing.T) {
		created, err := LoginWithPassword(ctx, db, cfg, email, testPassword, false, nil)
		if err != nil {
			t.Fatal(err)
		}
		holder, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer holder.Rollback()
		if _, err := holder.ExecContext(ctx, `SELECT id FROM user_sessions WHERE id = ? FOR UPDATE`, created.Session.ID); err != nil {
			t.Fatal(err)
		}
		type res struct {
			s   *Session
			err error
		}
		out := make(chan res, 1)
		go func() {
			s, err := LookupSession(ctx, db, cfg, created.Token)
			out <- res{s, err}
		}()
		awaitLockWait(t, db)
		if _, err := holder.ExecContext(ctx, `UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP(), revocation_reason = 'logout' WHERE id = ?`, created.Session.ID); err != nil {
			t.Fatal(err)
		}
		if err := holder.Commit(); err != nil {
			t.Fatal(err)
		}
		r := <-out
		if r.err != nil || r.s != nil {
			t.Fatalf("lookup admitted a session revoked during its lock wait: %+v %v", r.s, r.err)
		}
	})

	t.Run("deadline passes while lookup waits", func(t *testing.T) {
		created, err := LoginWithPassword(ctx, db, cfg, email, testPassword, false, nil)
		if err != nil {
			t.Fatal(err)
		}
		mustExecDB(t, db, `UPDATE user_sessions SET idle_timeout_at = UTC_TIMESTAMP() + INTERVAL 1 SECOND WHERE id = ?`, created.Session.ID)
		holder, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer holder.Rollback()
		if _, err := holder.ExecContext(ctx, `SELECT id FROM user_sessions WHERE id = ? FOR UPDATE`, created.Session.ID); err != nil {
			t.Fatal(err)
		}
		out := make(chan *Session, 1)
		errs := make(chan error, 1)
		go func() {
			s, err := LookupSession(ctx, db, cfg, created.Token)
			out <- s
			errs <- err
		}()
		awaitLockWait(t, db)
		// Hold the lock until the database clock is past the idle deadline.
		for {
			var past bool
			if err := db.QueryRow(`SELECT UTC_TIMESTAMP() > idle_timeout_at FROM user_sessions WHERE id = ?`, created.Session.ID).Scan(&past); err != nil {
				t.Fatal(err)
			}
			if past {
				break
			}
			time.Sleep(50 * time.Millisecond)
		}
		if err := holder.Commit(); err != nil {
			t.Fatal(err)
		}
		if s, err := <-out, <-errs; err != nil || s != nil {
			t.Fatalf("lookup extended a session whose deadline passed during its lock wait: %+v %v", s, err)
		}
	})

	t.Run("concurrent touches never shorten idle", func(t *testing.T) {
		created, err := LoginWithPassword(ctx, db, cfg, email, testPassword, true, nil)
		if err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if s, err := LookupSession(ctx, db, cfg, created.Token); err != nil || s == nil {
					t.Errorf("concurrent lookup: %+v %v", s, err)
				}
			}()
		}
		wg.Wait()
		row := readSessionRow(t, db, created.Session.ID)
		var dbNow time.Time
		_ = db.QueryRow(`SELECT UTC_TIMESTAMP()`).Scan(&dbNow)
		if row.idleAt.Before(dbNow.Add(168*time.Hour - 5*time.Second)) {
			t.Fatalf("idle deadline regressed to %s", row.idleAt)
		}
	})
}

func TestPasswordResetAtomicityMySQL(t *testing.T) {
	db := authMySQL(t)
	ctx := context.Background()
	cfg := persistentTestCfg()

	issueToken := func(userID string) string {
		token, _ := RandomToken(32)
		mustExecDB(t, db, `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (UUID(), ?, ?, UTC_TIMESTAMP() + INTERVAL 1 HOUR)`, userID, SHA256Hex(token))
		return token
	}

	t.Run("commit revokes old sessions and replays fail", func(t *testing.T) {
		id, email := seedAccount(t, db, RoleBuilder, "locked")
		mustExecDB(t, db, `UPDATE users SET locked_until = UTC_TIMESTAMP() + INTERVAL 10 MINUTE WHERE id = ?`, id)
		mustExecDB(t, db, `UPDATE users SET state = 'active', locked_until = NULL WHERE id = ?`, id)
		old, err := LoginWithPassword(ctx, db, cfg, email, testPassword, true, nil)
		if err != nil {
			t.Fatal(err)
		}
		token := issueToken(id)
		created, err := CompletePasswordReset(ctx, db, cfg, token, "Brand-New-Pass-3", nil)
		if err != nil {
			t.Fatal(err)
		}
		if s, _ := LookupSession(ctx, db, cfg, old.Token); s != nil {
			t.Fatal("a session from before the reset survived")
		}
		row := readSessionRow(t, db, created.Session.ID)
		if row.remembered || row.credentialAt.Valid {
			t.Fatalf("reset replacement must be a short session without password freshness: %+v", row)
		}
		var events int
		_ = db.QueryRow(`SELECT COUNT(*) FROM user_session_events WHERE session_id = ? AND event_type = 'revoked_all'`, old.Session.ID).Scan(&events)
		if events != 1 {
			t.Fatalf("revocation audit rows = %d, want 1", events)
		}
		_, err = CompletePasswordReset(ctx, db, cfg, token, "Another-Pass-4", nil)
		wantCode(t, err, apperrors.CodeUnauthorized)
		_, err = LoginWithPassword(ctx, db, cfg, email, testPassword, false, nil)
		wantCode(t, err, apperrors.CodeUnauthorized)
		if _, err := LoginWithPassword(ctx, db, cfg, email, "Brand-New-Pass-3", false, nil); err != nil {
			t.Fatalf("new password must work: %v", err)
		}
	})

	t.Run("failure before commit rolls everything back", func(t *testing.T) {
		id, email := seedAccount(t, db, RoleBuilder, "active")
		old, err := LoginWithPassword(ctx, db, cfg, email, testPassword, false, nil)
		if err != nil {
			t.Fatal(err)
		}
		token := issueToken(id)
		trigger := "trg_pl_fail_" + uuid.NewString()[:8]
		mustExecDB(t, db, "CREATE TRIGGER `"+trigger+"` BEFORE INSERT ON user_session_events FOR EACH ROW BEGIN IF NEW.user_id = '"+id+"' AND NEW.event_type = 'created' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected failure'; END IF; END")
		t.Cleanup(func() { _, _ = db.Exec("DROP TRIGGER IF EXISTS `" + trigger + "`") })

		if _, err := CompletePasswordReset(ctx, db, cfg, token, "Brand-New-Pass-3", nil); err == nil {
			t.Fatal("injected failure must surface")
		}
		if s, _ := LookupSession(ctx, db, cfg, old.Token); s == nil {
			t.Fatal("rolled-back reset still revoked the old session")
		}
		var used sql.NullTime
		_ = db.QueryRow(`SELECT used_at FROM password_reset_tokens WHERE token_hash = ?`, SHA256Hex(token)).Scan(&used)
		if used.Valid {
			t.Fatal("rolled-back reset consumed the token")
		}
		mustExecDB(t, db, "DROP TRIGGER `"+trigger+"`")
		if _, err := LoginWithPassword(ctx, db, cfg, email, testPassword, false, nil); err != nil {
			t.Fatalf("rolled-back reset changed the password: %v", err)
		}
	})

	t.Run("reset never reactivates a disabled account", func(t *testing.T) {
		id, _ := seedAccount(t, db, RoleBuilder, "disabled")
		token := issueToken(id)
		_, err := CompletePasswordReset(ctx, db, cfg, token, "Brand-New-Pass-3", nil)
		wantCode(t, err, apperrors.CodeUnauthorized)
		var state string
		_ = db.QueryRow(`SELECT state FROM users WHERE id = ?`, id).Scan(&state)
		if state != "disabled" {
			t.Fatal("reset reactivated a disabled account")
		}
	})
}

func TestActivationMySQL(t *testing.T) {
	db := authMySQL(t)
	ctx := context.Background()
	cfg := persistentTestCfg()
	activationToken := func(userID string) string {
		token, _ := RandomToken(32)
		mustExecDB(t, db, `INSERT INTO account_activation_tokens (id, user_id, token_hash, expires_at) VALUES (UUID(), ?, ?, UTC_TIMESTAMP() + INTERVAL 1 HOUR)`, userID, SHA256Hex(token))
		return token
	}
	pendingID, pendingEmail := seedAccount(t, db, RoleProctor, "pending_activation")
	created, err := CompleteActivation(ctx, db, cfg, activationToken(pendingID), "Activated-Pass-5", "Renamed", nil)
	if err != nil {
		t.Fatal(err)
	}
	if created.User.DisplayName != "Renamed" || created.Session.Remembered {
		t.Fatalf("activation result = %+v", created)
	}
	if _, err := LoginWithPassword(ctx, db, cfg, pendingEmail, "Activated-Pass-5", false, nil); err != nil {
		t.Fatalf("activated account cannot log in: %v", err)
	}

	disabledID, _ := seedAccount(t, db, RoleProctor, "disabled")
	_, err = CompleteActivation(ctx, db, cfg, activationToken(disabledID), "Activated-Pass-5", "", nil)
	wantCode(t, err, apperrors.CodeUnauthorized)
}

// Revoke-all serializes against issuance through the user row lock: a
// session created after it committed survives, everything before is gone.
func TestRevokeAllSerializesWithIssuanceMySQL(t *testing.T) {
	db := authMySQL(t)
	ctx := context.Background()
	cfg := persistentTestCfg()
	id, email := seedAccount(t, db, RoleGrader, "active")
	var before []CreatedSession
	for i := 0; i < 3; i++ {
		c, err := LoginWithPassword(ctx, db, cfg, email, testPassword, true, nil)
		if err != nil {
			t.Fatal(err)
		}
		before = append(before, c)
	}
	// Pre-revoked row must not gain a second audit entry.
	mustExecDB(t, db, `UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP(), revocation_reason = 'logout' WHERE id = ?`, before[0].Session.ID)

	holder, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Rollback()
	if _, err := holder.ExecContext(ctx, `SELECT id FROM users WHERE id = ? FOR UPDATE`, id); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- RevokeAllSessions(ctx, db, id, "logout_all", time.Now().UTC()) }()
	awaitLockWait(t, db)
	if err := holder.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	after, err := LoginWithPassword(ctx, db, cfg, email, testPassword, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range before {
		if s, _ := LookupSession(ctx, db, cfg, c.Token); s != nil {
			t.Fatal("a session from before logout-all survived")
		}
	}
	if s, _ := LookupSession(ctx, db, cfg, after.Token); s == nil {
		t.Fatal("a deliberate later login must be allowed")
	}
	var audits int
	_ = db.QueryRow(`SELECT COUNT(*) FROM user_session_events WHERE user_id = ? AND event_type = 'revoked_all'`, id).Scan(&audits)
	if audits != 2 {
		t.Fatalf("revoke-all audit rows = %d, want exactly the 2 live sessions", audits)
	}
}
