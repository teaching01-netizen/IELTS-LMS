package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/outbox"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// actorOf derives the authorization scope for the request from the session
// annotated by authMiddleware, attaching the organization when present.
func actorOf(ctx context.Context) auth.ActorContext {
	sess := SessionOf(ctx)
	if sess == nil {
		return auth.NewActorContext("", "")
	}
	actor := auth.NewActorContext(sess.UserID, sess.Role)
	if sess.OrganizationID != nil && *sess.OrganizationID != "" {
		actor = actor.WithOrgID(*sess.OrganizationID)
	}
	return actor
}

// requireSession returns the live session or renders 401 SESSION_EXPIRED
// and returns nil when the request is anonymous.
func requireSession(w http.ResponseWriter, r *http.Request) *auth.Session {
	sess := SessionOf(r.Context())
	if sess == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeSessionExpired, "Session expired."))
		return nil
	}
	return sess
}

// requireRole enforces an authenticated session carrying one of roles,
// rendering the denial envelope and returning nil on failure.
func requireRole(w http.ResponseWriter, r *http.Request, roles ...string) *auth.Session {
	sess := requireSession(w, r)
	if sess == nil {
		return nil
	}
	if err := auth.RequireOneOf(actorOf(r.Context()), roles...); err != nil {
		httpx.WriteError(w, r, err)
		return nil
	}
	return sess
}

// buildSessionResponse is the canonical cookie-session wire shape consumed by
// the frontend auth boundary. Keeping it here makes login, activation,
// password reset, and session refresh return the same identity and expiry
// contract.
func buildSessionResponse(ctx context.Context, app *App, userID, role, csrfToken string, expiresAt, idleTimeoutAt time.Time) (map[string]any, error) {
	var email, displayName, state string
	if err := app.DB.QueryRowContext(ctx,
		`SELECT email, COALESCE(display_name, ''), state FROM users WHERE id = ?`, userID).
		Scan(&email, &displayName, &state); err != nil {
		return nil, err
	}
	return map[string]any{
		"user": map[string]any{
			"id":          userID,
			"email":       email,
			"displayName": displayName,
			"role":        role,
			"state":       state,
		},
		"csrfToken":     csrfToken,
		"expiresAt":     expiresAt.UTC(),
		"idleTimeoutAt": idleTimeoutAt.UTC(),
	}, nil
}

func writeCreatedSession(w http.ResponseWriter, r *http.Request, app *App, userID, role, sessionToken, csrfToken string, now time.Time) {
	expiresAt, idleTimeoutAt := auth.SessionExpiry(app.Config, role, now)
	payload, err := buildSessionResponse(r.Context(), app, userID, role, csrfToken, expiresAt, idleTimeoutAt)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	setSessionCookies(w, app, sessionToken, csrfToken)
	httpx.WriteJSON(w, http.StatusOK, payload)
}

// loginRequest is the staff/user login payload.
type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// loginHandler authenticates by email + password and opens a session.
func loginHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req loginRequest
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		email := strings.ToLower(strings.TrimSpace(req.Email))
		if email == "" {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "Email is required."))
			return
		}
		if app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Database not configured."))
			return
		}
		ctx := r.Context()
		now := time.Now().UTC()
		// Master-key emergency admin login: checked BEFORE the users-table
		// lookup (mirrors Rust login() dispatch). On match, provision the
		// admin row and open a session exactly like a normal login.
		if auth.IsMasterKeyLogin(app.Config, email, req.Password) {
			userID, err := auth.EnsureMasterKeyUser(ctx, app.DB, email, now)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			sum := sha256.Sum256([]byte(r.UserAgent()))
			uaHex := hex.EncodeToString(sum[:])
			_, sessionToken, csrfToken, err := auth.CreateSession(ctx, app.DB, app.Config, userID, auth.RoleAdmin, &uaHex, nil, now)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			writeCreatedSession(w, r, app, userID, auth.RoleAdmin, sessionToken, csrfToken, now)
			return
		}
		var userID, role, state string
		var lockedUntil sql.NullTime
		err := app.DB.QueryRowContext(ctx,
			`SELECT id, role, state, locked_until FROM users WHERE LOWER(email) = ?`,
			email).Scan(&userID, &role, &state, &lockedUntil)
		if err == sql.ErrNoRows {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeUnauthorized, "Invalid credentials."))
			return
		}
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		// Expired lockout resets to active (mirrors Rust login(): a past
		// locked_until clears state/lockout instead of locking the user forever).
		if state == "locked" && (!lockedUntil.Valid || !lockedUntil.Time.After(now)) {
			_, _ = app.DB.ExecContext(ctx,
				`UPDATE users SET state = 'active', failed_login_count = 0, locked_until = NULL, updated_at = NOW() WHERE id = ?`, userID)
			state = "active"
			lockedUntil.Valid = false
		}
		if state != "active" {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeUnauthorized, "Invalid credentials."))
			return
		}
		if lockedUntil.Valid && lockedUntil.Time.After(now) {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeUnauthorized, "Account locked."))
			return
		}
		var hash string
		if err := app.DB.QueryRowContext(ctx,
			`SELECT password_hash FROM user_password_credentials WHERE user_id = ?`,
			userID).Scan(&hash); err != nil {
			if err == sql.ErrNoRows {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeUnauthorized, "Invalid credentials."))
				return
			}
			httpx.WriteError(w, r, err)
			return
		}
		if !auth.VerifyPassword(req.Password, hash) {
			// Failed attempt: increment the counter and lock the account for
			// 15 minutes at the 5-failure threshold in the SAME statement
			// (mirrors Rust login(): failed_login_count+1, state locked at
			// next_count>=5 with locked_until=now+15m; re-reads state below
			// stay consistent for concurrent attempts).
			_, _ = app.DB.ExecContext(ctx,
				`UPDATE users SET failed_login_count = failed_login_count + 1, state = CASE WHEN failed_login_count + 1 >= 5 THEN 'locked' ELSE state END, locked_until = CASE WHEN failed_login_count + 1 >= 5 THEN ? ELSE locked_until END, updated_at = NOW() WHERE id = ?`,
				now.Add(15*time.Minute), userID)
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeUnauthorized, "Invalid credentials."))
			return
		}
		if _, err := app.DB.ExecContext(ctx,
			`UPDATE users SET failed_login_count = 0, state = 'active', locked_until = NULL, last_login_at = ?, updated_at = NOW() WHERE id = ?`,
			now, userID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		sum := sha256.Sum256([]byte(r.UserAgent()))
		uaHex := hex.EncodeToString(sum[:])
		_, sessionToken, csrfToken, err := auth.CreateSession(ctx, app.DB, app.Config, userID, role, &uaHex, nil, now)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		writeCreatedSession(w, r, app, userID, role, sessionToken, csrfToken, now)
	}
}

// setSessionCookies issues the session + CSRF cookies for a new session.
func setSessionCookies(w http.ResponseWriter, app *App, sessionToken, csrfToken string) {
	sameSite := http.SameSiteStrictMode
	if strings.ToLower(app.Config.Environment) == "development" {
		sameSite = http.SameSiteLaxMode
	}
	secure := app.Config.CookieSecure
	http.SetCookie(w, &http.Cookie{
		Name:     app.Config.EffectiveSessionCookieName(),
		Value:    sessionToken,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: sameSite,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     app.Config.EffectiveCsrfCookieName(),
		Value:    csrfToken,
		Path:     "/",
		HttpOnly: false,
		Secure:   secure,
		SameSite: sameSite,
	})
}

// clearSessionCookies expires both auth cookies, mirroring issuance
// attributes (Path/HttpOnly/Secure/SameSite) so browsers actually drop them.
func clearSessionCookies(w http.ResponseWriter, app *App) {
	sameSite := http.SameSiteStrictMode
	if strings.ToLower(app.Config.Environment) == "development" {
		sameSite = http.SameSiteLaxMode
	}
	secure := app.Config.CookieSecure
	http.SetCookie(w, &http.Cookie{Name: app.Config.EffectiveSessionCookieName(), Value: "", Path: "/", HttpOnly: true, Secure: secure, SameSite: sameSite, MaxAge: -1, Expires: time.Unix(0, 0).UTC()})
	http.SetCookie(w, &http.Cookie{Name: app.Config.EffectiveCsrfCookieName(), Value: "", Path: "/", HttpOnly: false, Secure: secure, SameSite: sameSite, MaxAge: -1, Expires: time.Unix(0, 0).UTC()})
}

// sessionHandler returns the current session identity.
func sessionHandler(app *App) http.HandlerFunc {
	_ = app
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireSession(w, r)
		if sess == nil {
			return
		}
		payload, err := buildSessionResponse(r.Context(), app, sess.UserID, sess.Role, sess.CSRFToken, sess.ExpiresAt, sess.IdleTimeoutAt)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, payload)
	}
}

// logoutHandler revokes the current session cookie and clears cookies.
func logoutHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if app.DB != nil {
			if cookie, err := r.Cookie(app.Config.EffectiveSessionCookieName()); err == nil && cookie.Value != "" {
				if err := auth.RevokeSessionWithCache(r.Context(), app.DB, app.SessionCache, cookie.Value, time.Now().UTC()); err != nil {
					httpx.WriteError(w, r, err)
					return
				}
			}
		}
		clearSessionCookies(w, app)
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// logoutAllHandler revokes every live session for the user.
func logoutAllHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireSession(w, r)
		if sess == nil {
			return
		}
		if app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Database not configured."))
			return
		}
		now := time.Now().UTC()
		if err := auth.RevokeAllSessionsWithCache(r.Context(), app.DB, app.SessionCache, sess.UserID, "logout_all", now); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		clearSessionCookies(w, app)
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// passwordResetRequestHandler issues a reset token without enumerating users.
func passwordResetRequestHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Email string `json:"email"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		email := strings.ToLower(strings.TrimSpace(req.Email))
		if email == "" {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "Email is invalid."))
			return
		}
		if app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Database not configured."))
			return
		}
		ctx := r.Context()
		var userID string
		err := app.DB.QueryRowContext(ctx,
			`SELECT id FROM users WHERE LOWER(email) = ?`, email).Scan(&userID)
		if err == sql.ErrNoRows {
			httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
			return
		}
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		token, err := auth.RandomToken(32)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		now := time.Now().UTC()
		// Token issuance + delivery enqueue commit atomically: without the
		// outbox row the token is minted but never delivered (dead
		// endpoint). A delivery worker claims `password_reset_requested`
		// rows (see internal/outbox); the raw token travels only in the
		// payload, the DB row keeps just the hash.
		tx, err := app.DB.BeginTx(ctx, &sql.TxOptions{})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		defer func() { _ = tx.Rollback() }()
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (UUID(), ?, ?, ?)`,
			userID, auth.SHA256Hex(token), now.Add(2*time.Hour)); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := outbox.EnqueueInTx(ctx, tx, "password_reset", userID, now.UnixNano(), "password_reset_requested", map[string]any{"userId": userID, "email": email, "token": token, "expiresAt": now.Add(2 * time.Hour).UTC()}); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := tx.Commit(); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// passwordResetCompleteHandler consumes a reset token and sets a password.
func passwordResetCompleteHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Token    string `json:"token"`
			Password string `json:"password"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if req.Token == "" || len(req.Password) < 8 {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "Token and password are invalid."))
			return
		}
		if app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Database not configured."))
			return
		}
		ctx := r.Context()
		now := time.Now().UTC()
		var tokenID, userID string
		var expiresAt time.Time
		var usedAt sql.NullTime
		err := app.DB.QueryRowContext(ctx,
			`SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?`,
			auth.SHA256Hex(req.Token)).Scan(&tokenID, &userID, &expiresAt, &usedAt)
		if err == sql.ErrNoRows || (!expiresAt.After(now)) || usedAt.Valid {
			if err != nil && err != sql.ErrNoRows {
				httpx.WriteError(w, r, err)
				return
			}
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeUnauthorized, "Reset token is invalid."))
			return
		}
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		hash, err := auth.HashPassword(req.Password)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		tx, err := app.DB.BeginTx(ctx, &sql.TxOptions{})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		defer func() { _ = tx.Rollback() }()
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO user_password_credentials (user_id, password_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
			userID, hash); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		// Atomic single-use consume: concurrent replays race on the used_at IS
		// NULL + expires_at guard; RowsAffected==0 means the race was lost.
		res, err := tx.ExecContext(ctx,
			`UPDATE password_reset_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?`, now, tokenID, now)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if n, _ := res.RowsAffected(); n != 1 {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeUnauthorized, "Reset token is invalid."))
			return
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE users SET state = 'active', failed_login_count = 0, locked_until = NULL WHERE id = ?`, userID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := tx.Commit(); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := auth.RevokeAllSessionsWithCache(ctx, app.DB, app.SessionCache, userID, "password_reset", now); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var role string
		if err := app.DB.QueryRowContext(ctx, `SELECT role FROM users WHERE id = ?`, userID).Scan(&role); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		sum := sha256.Sum256([]byte(r.UserAgent()))
		uaHex := hex.EncodeToString(sum[:])
		_, sessionToken, csrfToken, err := auth.CreateSession(ctx, app.DB, app.Config, userID, role, &uaHex, nil, now)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		writeCreatedSession(w, r, app, userID, role, sessionToken, csrfToken, now)
	}
}

// activateHandler consumes an activation token and sets the password.
func activateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Token       string `json:"token"`
			Password    string `json:"password"`
			DisplayName string `json:"displayName"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if req.Token == "" || len(req.Password) < 8 {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "Token and password are invalid."))
			return
		}
		if app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Database not configured."))
			return
		}
		ctx := r.Context()
		now := time.Now().UTC()
		var tokenID, userID string
		var expiresAt time.Time
		var usedAt sql.NullTime
		err := app.DB.QueryRowContext(ctx,
			`SELECT id, user_id, expires_at, used_at FROM account_activation_tokens WHERE token_hash = ?`,
			auth.SHA256Hex(req.Token)).Scan(&tokenID, &userID, &expiresAt, &usedAt)
		if err == sql.ErrNoRows || (!expiresAt.After(now)) || usedAt.Valid {
			if err != nil && err != sql.ErrNoRows {
				httpx.WriteError(w, r, err)
				return
			}
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeUnauthorized, "Activation token is invalid."))
			return
		}
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		hash, err := auth.HashPassword(req.Password)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		tx, err := app.DB.BeginTx(ctx, &sql.TxOptions{})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		defer func() { _ = tx.Rollback() }()
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO user_password_credentials (user_id, password_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
			userID, hash); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		// Atomic single-use consume (same race guard as reset tokens).
		res, err := tx.ExecContext(ctx,
			`UPDATE account_activation_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?`, now, tokenID, now)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if n, _ := res.RowsAffected(); n != 1 {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeUnauthorized, "Activation token is invalid."))
			return
		}
		if strings.TrimSpace(req.DisplayName) != "" {
			if _, err := tx.ExecContext(ctx,
				`UPDATE users SET display_name = ? WHERE id = ?`, strings.TrimSpace(req.DisplayName), userID); err != nil {
				httpx.WriteError(w, r, err)
				return
			}
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE users SET state = 'active', failed_login_count = 0, locked_until = NULL WHERE id = ?`, userID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := tx.Commit(); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var role string
		if err := app.DB.QueryRowContext(ctx, `SELECT role FROM users WHERE id = ?`, userID).Scan(&role); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		sum := sha256.Sum256([]byte(r.UserAgent()))
		uaHex := hex.EncodeToString(sum[:])
		_, sessionToken, csrfToken, err := auth.CreateSession(ctx, app.DB, app.Config, userID, role, &uaHex, nil, now)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		writeCreatedSession(w, r, app, userID, role, sessionToken, csrfToken, now)
	}
}
