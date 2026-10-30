package main

import (
	"context"
	"database/sql"
	"net/http"
	"strings"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"github.com/go-chi/chi/v5"
)

// Recovery-origin cookies authorize delivery for one sitting. Route checks run
// after Chi has resolved parameters; candidate selectors are checked against
// the bound row by resolveStudentAttemptForSession as well.
func recoverySessionRouteAllowed(r *http.Request, sess *auth.Session) bool {
	if sess == nil || !sess.Proof.IsRecovery() {
		return true
	}
	if sess.Role != auth.RoleStudent || sess.Proof.RecoveryAttemptID == "" || sess.Proof.RecoveryScheduleID == "" {
		return false
	}
	path := r.URL.Path
	if (r.Method == http.MethodGet && path == "/api/v1/auth/session") || (r.Method == http.MethodPost && path == "/api/v1/auth/logout") {
		return true
	}
	// Capability endpoints authenticate their own browser proof, including when
	// the browser still has a cookie from a previous continuation.
	if strings.HasPrefix(path, "/api/v1/student/device-recovery/") {
		return true
	}
	if id := chi.URLParam(r, "attemptID"); id != "" && id != sess.Proof.RecoveryAttemptID {
		return false
	}
	if id := chi.URLParam(r, "scheduleID"); id != "" && id != sess.Proof.RecoveryScheduleID {
		return false
	}
	switch {
	case strings.HasPrefix(path, "/api/v1/student/sessions/"), strings.HasPrefix(path, "/api/v1/assessment-delivery/schedules/"), strings.HasPrefix(path, "/api/v1/assessment-forms/schedules/"):
		return chi.URLParam(r, "scheduleID") == sess.Proof.RecoveryScheduleID
	case strings.HasPrefix(path, "/api/v2/student/attempts/"), strings.HasPrefix(path, "/v2/student/attempts/"):
		return chi.URLParam(r, "attemptID") == sess.Proof.RecoveryAttemptID
	case strings.HasPrefix(path, "/api/v1/media/"):
		// Media handlers still require an attempt bearer and pinned-content access.
		return bearerOf(r) != ""
	}
	return false
}

func recoveryScopeError() error {
	return apperrors.New(apperrors.CodeForbidden, "This recovery session is restricted to its exam sitting.")
}

func resolveStudentAttemptForSession(ctx context.Context, db *sql.DB, scheduleID, candidateID string, sess *auth.Session) (string, error) {
	if claims := sess.AttemptCredential; claims != nil {
		if claims.ScheduleID != scheduleID || claims.UserID != sess.UserID {
			return "", recoveryScopeError()
		}
		var id string
		err := db.QueryRowContext(ctx, `SELECT id FROM student_attempts WHERE id = ? AND schedule_id = ? AND user_id = ? AND (? = '' OR candidate_id = ? OR wcode = ? OR student_key = ?)`, claims.AttemptID, scheduleID, sess.UserID, candidateID, candidateID, candidateID, candidateID).Scan(&id)
		return id, err
	}
	if !sess.Proof.IsRecovery() {
		return resolveStudentAttemptIDForUser(ctx, db, scheduleID, candidateID, sess.UserID)
	}
	if scheduleID != sess.Proof.RecoveryScheduleID {
		return "", recoveryScopeError()
	}
	var id string
	err := db.QueryRowContext(ctx, `SELECT id FROM student_attempts WHERE id = ? AND schedule_id = ? AND user_id = ? AND (? = '' OR candidate_id = ? OR wcode = ? OR student_key = ?)`, sess.Proof.RecoveryAttemptID, scheduleID, sess.UserID, candidateID, candidateID, candidateID, candidateID).Scan(&id)
	if err != nil {
		return "", err
	}
	if err := requireScheduleRegistration(ctx, db, scheduleID, sess.UserID); err != nil {
		return "", err
	}
	return id, nil
}
