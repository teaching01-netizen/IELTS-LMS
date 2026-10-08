package main

import (
	"database/sql"
	"net/http"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/schedules"
	"github.com/google/uuid"
)

type studentEntryIdentity struct {
	UserID, DisplayName, Email, ScheduleID, Code, AttemptID, ClientSessionID string
	Proof                                                                    auth.SessionProof
}

// Recovery is independent of new-admission windows. Only an authenticated
// owner or the already-minted practice capability can select an existing
// sitting. Neither a public link, code, nor display email is authority.
func lookupOwnEntry(r *http.Request, app *App, scheduleID, linkID, capability, code, sessionID string) (*studentEntryIdentity, error) {
	if app.DB == nil {
		return nil, nil
	}
	var principals [2]string
	if sess := SessionOf(r.Context()); sess != nil && sess.Role == auth.RoleStudent {
		if err := auth.VerifyCSRF(r, sess.CSRFToken); err != nil {
			return nil, err
		}
		// Only a session whose origin was proven may select an existing sitting;
		// legacy NULL-origin cookies cannot.
		if sess.Proof.Source == auth.SessionSourceAccount || (sess.Proof.Source == auth.SessionSourcePractice && sess.Proof.PracticeScheduleID == scheduleID) {
			principals[0] = sess.UserID
		}
	}
	if principals[0] == "" && strings.TrimSpace(capability) == "" {
		return nil, nil
	}
	if linkID != "" {
		err := app.DB.QueryRowContext(r.Context(), "SELECT schedule_id FROM assessment_access_links WHERE id = ?", linkID).Scan(&scheduleID)
		if err == sql.ErrNoRows {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
	}
	if scheduleID == "" {
		return nil, nil
	}
	if strings.TrimSpace(capability) != "" {
		address, err := practiceEntryAddress(scheduleID, capability)
		if err != nil {
			return nil, err
		}
		var role, state string
		err = app.DB.QueryRowContext(r.Context(), "SELECT id, role, state FROM users WHERE email = ?", address).Scan(&principals[1], &role, &state)
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
		if err == nil && (role != auth.RoleStudent || state != "active") {
			return nil, apperrors.New(apperrors.CodeUnauthorized, "Practice recovery is unavailable.")
		}
	}
	for i, userID := range principals {
		if userID == "" || (i == 1 && userID == principals[0]) {
			continue
		}
		candidateCode := schedules.NormalizeAccessCode(code)
		if candidateCode == "" {
			candidateCode = "OPEN-" + strings.ToUpper(strings.ReplaceAll(userID, "-", ""))
		}
		out := studentEntryIdentity{UserID: userID, ScheduleID: scheduleID, ClientSessionID: sessionID, Proof: auth.SessionProof{Source: auth.SessionSourcePractice, PracticeScheduleID: scheduleID}}
		if i == 0 {
			out.Proof = auth.SessionProof{Source: auth.SessionSourceAccount}
		}
		err := app.DB.QueryRowContext(r.Context(), `SELECT sa.id, sr.wcode, sa.candidate_name, sa.candidate_email FROM student_attempts sa JOIN schedule_registrations sr ON sr.id = sa.registration_id AND sr.schedule_id = sa.schedule_id WHERE sa.schedule_id = ? AND sa.user_id = ? AND sr.user_id = ? AND sr.wcode = ? AND EXISTS (SELECT 1 FROM attempt_sessions ats WHERE ats.attempt_id = sa.id AND ats.schedule_id = sa.schedule_id AND ats.user_id = sa.user_id) LIMIT 1`, scheduleID, userID, userID, candidateCode).Scan(&out.AttemptID, &out.Code, &out.DisplayName, &out.Email)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return nil, err
		}
		return &out, nil
	}
	return nil, nil
}

func writeStudentEntry(w http.ResponseWriter, r *http.Request, app *App, identity studentEntryIdentity) {
	if identity.ClientSessionID == "" {
		identity.ClientSessionID = uuid.NewString()
	}
	admission, err := admitStudentSession(r.Context(), app, identity.UserID, identity.ScheduleID, identity.AttemptID, identity.ClientSessionID)
	if err != nil {
		httpx.WriteError(w, r, MapDBError(err))
		return
	}
	// A blocked browser receives only the authenticated student session needed
	// to request transfer. Admit never mints a competing writer credential.
	now := time.Now().UTC()
	_, sessionToken, csrfToken, err := auth.CreateSession(r.Context(), app.DB, app.Config, identity.UserID, auth.RoleStudent, identity.Proof, nil, nil, now)
	if err != nil {
		httpx.WriteError(w, r, MapDBError(err))
		return
	}
	expiresAt, idleTimeoutAt := auth.SessionExpiry(app.Config, auth.RoleStudent, now)
	setCreatedSessionCookies(w, app, auth.RoleStudent, sessionToken, csrfToken, expiresAt, idleTimeoutAt, now)
	out := map[string]any{
		"user":      map[string]any{"id": identity.UserID, "email": identity.Email, "displayName": identity.DisplayName, "role": auth.RoleStudent, "state": "active"},
		"csrfToken": csrfToken, "expiresAt": expiresAt, "idleTimeoutAt": idleTimeoutAt,
		"scheduleId": identity.ScheduleID, "studentCode": identity.Code, "attemptId": identity.AttemptID,
		"clientSessionId": identity.ClientSessionID, "admission": admissionPayload(admission),
		"attemptToken": nil, "attemptExpiresAt": nil,
	}
	if admission.Token != "" {
		out["attemptToken"] = admission.Token
		out["attemptExpiresAt"] = admission.ExpiresAt.UTC()
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}
