package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"log"
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
	if role == auth.RoleStudent && strings.HasSuffix(email, "@practice.invalid") {
		var contact sql.NullString
		var distinctContacts int
		if err := app.DB.QueryRowContext(ctx, "SELECT MIN(candidate_email), COUNT(DISTINCT candidate_email) FROM student_attempts WHERE user_id = ?", userID).Scan(&contact, &distinctContacts); err != nil {
			return nil, err
		}
		if !contact.Valid || distinctContacts != 1 {
			return nil, apperrors.New(apperrors.CodeConflict, "Practice identity has no unambiguous owned sitting.")
		}
		email = contact.String
	}
	return sessionPayload(auth.SessionUser{ID: userID, Email: email, DisplayName: displayName, Role: role, State: state}, csrfToken, expiresAt, idleTimeoutAt, false, nil), nil
}

// sessionPayload is the pure JSON projection of a session. remembered and
// credentialAuthenticatedAt are additive fields older clients ignore.
func sessionPayload(user auth.SessionUser, csrfToken string, expiresAt, idleTimeoutAt time.Time, remembered bool, credentialAt *time.Time) map[string]any {
	var credential any
	if credentialAt != nil {
		credential = credentialAt.UTC()
	}
	return map[string]any{
		"user": map[string]any{
			"id":          user.ID,
			"email":       user.Email,
			"displayName": user.DisplayName,
			"role":        user.Role,
			"state":       user.State,
		},
		"csrfToken":                 csrfToken,
		"expiresAt":                 expiresAt.UTC(),
		"idleTimeoutAt":             idleTimeoutAt.UTC(),
		"remembered":                remembered,
		"credentialAuthenticatedAt": credential,
	}
}

// writeCreatedSession answers a legacy CreateSession issuance (master key).
func writeCreatedSession(w http.ResponseWriter, r *http.Request, app *App, userID, role, sessionToken, csrfToken string, now time.Time) {
	expiresAt, idleTimeoutAt := auth.SessionExpiry(app.Config, role, now)
	payload, err := buildSessionResponse(r.Context(), app, userID, role, csrfToken, expiresAt, idleTimeoutAt)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	setCreatedSessionCookies(w, app, role, sessionToken, csrfToken, expiresAt, now)
	httpx.WriteJSON(w, http.StatusOK, payload)
}

// writeAccountSession answers a committed password workflow. Deadlines and
// the remembered choice come from the persisted row, never recomputed here,
// and cookies are only written after the workflow's commit was acknowledged.
func writeAccountSession(w http.ResponseWriter, r *http.Request, app *App, created auth.CreatedSession) {
	s := created.Session
	var payload map[string]any
	if s.Role == auth.RoleStudent {
		// Students keep the practice-identity projection and cookie policy.
		p, err := buildSessionResponse(r.Context(), app, s.UserID, s.Role, s.CSRFToken, s.ExpiresAt, s.IdleTimeoutAt)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		payload = p
		setCreatedSessionCookies(w, app, s.Role, created.Token, s.CSRFToken, s.ExpiresAt, s.IssuedAt)
	} else {
		payload = sessionPayload(created.User, s.CSRFToken, s.ExpiresAt, s.IdleTimeoutAt, s.Remembered, s.CredentialAuthenticatedAt)
		var persistUntil time.Time
		if s.Remembered {
			persistUntil = s.ExpiresAt
		}
		writeSessionCookies(w, app, created.Token, s.CSRFToken, persistUntil, time.Now().UTC())
	}
	httpx.WriteJSON(w, http.StatusOK, payload)
}

// authStoreError keeps typed auth verdicts and turns any operational failure
// (DB down, lost commit) into a retryable 503: never a false 401, never a
// claim of success. The cause is logged without credentials.
func authStoreError(op string, err error) error {
	if _, ok := apperrors.As(err); ok {
		return err
	}
	log.Printf(`{"level":"error","msg":"auth store failure","op":%q,"err":%q}`, op, err.Error())
	return apperrors.New(apperrors.CodeServiceUnavailable, "Authentication is temporarily unavailable; please retry.")
}

func userAgentHash(r *http.Request) *string {
	sum := sha256.Sum256([]byte(r.UserAgent()))
	v := hex.EncodeToString(sum[:])
	return &v
}

// loginRequest is the staff/user login payload. RememberMe is optional so
// existing clients (field omitted) keep the short browser-session policy.
type loginRequest struct {
	Email      string          `json:"email"`
	Password   string          `json:"password"`
	RememberMe json.RawMessage `json:"rememberMe,omitempty"`
}

// loginHandler authenticates by email + password and opens a session.
func loginHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req loginRequest
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var remember bool
		if len(req.RememberMe) > 0 {
			if strings.TrimSpace(string(req.RememberMe)) == "null" || json.Unmarshal(req.RememberMe, &remember) != nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "rememberMe must be a boolean."))
				return
			}
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
		// lookup (mirrors Rust login() dispatch). It always issues the short
		// legacy policy with no password freshness, whatever rememberMe says.
		if auth.IsMasterKeyLogin(app.Config, email, req.Password) {
			userID, err := auth.EnsureMasterKeyUser(ctx, app.DB, email, now)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			_, sessionToken, csrfToken, err := auth.CreateSession(ctx, app.DB, app.Config, userID, auth.RoleAdmin, auth.SessionProof{Source: auth.SessionSourceAccount}, userAgentHash(r), nil, now)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			writeCreatedSession(w, r, app, userID, auth.RoleAdmin, sessionToken, csrfToken, now)
			return
		}
		created, err := auth.LoginWithPassword(ctx, app.DB, app.Config, email, req.Password, remember, userAgentHash(r))
		if err != nil {
			httpx.WriteError(w, r, authStoreError("login", err))
			return
		}
		writeAccountSession(w, r, app, created)
	}
}

// cookieSameSite keeps the existing policy: Strict, Lax in development.
func cookieSameSite(app *App) http.SameSite {
	if strings.ToLower(app.Config.Environment) == "development" {
		return http.SameSiteLaxMode
	}
	return http.SameSiteStrictMode
}

// writeSessionCookies is the single owner of auth cookie attributes. A zero
// persistUntil issues browser-session cookies; otherwise both cookies live
// until persistUntil (always an absolute deadline, never the moving idle
// deadline, which the server enforces on lookup).
func writeSessionCookies(w http.ResponseWriter, app *App, sessionToken, csrfToken string, persistUntil, now time.Time) {
	sameSite := cookieSameSite(app)
	secure := app.Config.CookieSecure
	session := &http.Cookie{Name: app.Config.EffectiveSessionCookieName(), Value: sessionToken, Path: "/", HttpOnly: true, Secure: secure, SameSite: sameSite}
	csrf := &http.Cookie{Name: app.Config.EffectiveCsrfCookieName(), Value: csrfToken, Path: "/", HttpOnly: false, Secure: secure, SameSite: sameSite}
	if !persistUntil.IsZero() {
		maxAge := int(persistUntil.Sub(now).Seconds())
		if maxAge <= 0 {
			maxAge = -1
		}
		for _, c := range []*http.Cookie{session, csrf} {
			c.Expires = persistUntil.UTC()
			c.MaxAge = maxAge
		}
	}
	http.SetCookie(w, session)
	http.SetCookie(w, csrf)
}

// setSessionCookies issues browser-session auth cookies.
func setSessionCookies(w http.ResponseWriter, app *App, sessionToken, csrfToken string) {
	writeSessionCookies(w, app, sessionToken, csrfToken, time.Time{}, time.Time{})
}

// setCreatedSessionCookies makes student sessions survive a browser restart.
// Both cookies live until the session's absolute deadline. The idle deadline
// is deliberately not copied into the cookie: the server slides it forward on
// every authenticated request but only issues cookies here, so an idle-bound
// cookie expired in the browser one idle window after entry while the student
// was still actively sitting the exam, logging the whole room out mid-test.
// Idle expiry stays enforced server-side by the session lookup.
// Staff persistence is decided only by writeAccountSession from the stored
// remembered flag; this legacy adapter keeps staff cookies session-scoped.
func setCreatedSessionCookies(w http.ResponseWriter, app *App, role, sessionToken, csrfToken string, expiresAt, now time.Time) {
	if role != auth.RoleStudent {
		setSessionCookies(w, app, sessionToken, csrfToken)
		return
	}
	writeSessionCookies(w, app, sessionToken, csrfToken, expiresAt, now)
}

// clearSessionCookies expires both auth cookies, mirroring issuance
// attributes (Path/HttpOnly/Secure/SameSite) so browsers actually drop them.
func clearSessionCookies(w http.ResponseWriter, app *App) {
	sameSite := cookieSameSite(app)
	secure := app.Config.CookieSecure
	http.SetCookie(w, &http.Cookie{Name: app.Config.EffectiveSessionCookieName(), Value: "", Path: "/", HttpOnly: true, Secure: secure, SameSite: sameSite, MaxAge: -1, Expires: time.Unix(0, 0).UTC()})
	http.SetCookie(w, &http.Cookie{Name: app.Config.EffectiveCsrfCookieName(), Value: "", Path: "/", HttpOnly: false, Secure: secure, SameSite: sameSite, MaxAge: -1, Expires: time.Unix(0, 0).UTC()})
}

// sessionHandler returns the current session identity. It reads and
// validates only: it never issues cookies or moves the absolute or
// password-authentication time.
func sessionHandler(app *App) http.HandlerFunc {
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
		payload["remembered"] = sess.Remembered
		if sess.CredentialAuthenticatedAt != nil {
			payload["credentialAuthenticatedAt"] = sess.CredentialAuthenticatedAt.UTC()
		}
		httpx.WriteJSON(w, http.StatusOK, payload)
	}
}

// logoutHandler revokes the presented session cookie and clears cookies. It
// is callable without a live session (expired/revoked cookies still get
// cleared) but grants no account authority: it only revokes the exact token
// the browser holds. The route's origin guard always applies; CSRF applies
// whenever the cookie still names a live session. Unknown or already-revoked
// tokens succeed; a store failure is 503 so the client keeps its pending
// logout instead of claiming success.
func logoutHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if cookie, err := r.Cookie(app.Config.EffectiveSessionCookieName()); err == nil && cookie.Value != "" {
			if app.DB == nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Database not configured."))
				return
			}
			if err := auth.RevokeBrowserSessionWithCache(r.Context(), app.DB, app.SessionCache, cookie.Value, time.Now().UTC()); err != nil {
				httpx.WriteError(w, r, authStoreError("logout", err))
				return
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
			httpx.WriteError(w, r, authStoreError("logout_all", err))
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
// Token consumption, the password change, revocation of every prior session
// and the short replacement session commit together (auth.CompletePasswordReset).
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
		created, err := auth.CompletePasswordReset(r.Context(), app.DB, app.Config, req.Token, req.Password, userAgentHash(r))
		if err != nil {
			httpx.WriteError(w, r, authStoreError("password_reset", err))
			return
		}
		if app.SessionCache != nil {
			app.SessionCache.InvalidateUser(created.Session.UserID)
		}
		writeAccountSession(w, r, app, created)
	}
}

// activateHandler consumes an activation token and sets the password. It
// never reactivates a disabled account and revokes any earlier sessions.
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
		created, err := auth.CompleteActivation(r.Context(), app.DB, app.Config, req.Token, req.Password, req.DisplayName, userAgentHash(r))
		if err != nil {
			httpx.WriteError(w, r, authStoreError("activation", err))
			return
		}
		if app.SessionCache != nil {
			app.SessionCache.InvalidateUser(created.Session.UserID)
		}
		writeAccountSession(w, r, app, created)
	}
}
