package main

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/accesslinks"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
	"example.com/ielts-proctoring/internal/schedules"
)

// authorizeStudentCredentialTx runs after the attempt ownership lock. Existing
// admission is a credential fact, not a preprovisioned registration. This keeps
// legitimate resume independent of link eligibility without creating a second
// admission door through direct schedule entry.
func authorizeStudentCredentialTx(ctx context.Context, q tx.Tx, userID, scheduleID, attemptID string) (time.Time, error) {
	var now time.Time
	if err := q.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&now); err != nil {
		return now, err
	}
	var role, state string
	if err := q.QueryRowContext(ctx, "SELECT role, state FROM users WHERE id = ? FOR SHARE", userID).Scan(&role, &state); err != nil {
		return now, err
	}
	if state != "active" {
		return now, apperrors.New(apperrors.CodeUnauthorized, "Student authentication is unavailable.")
	}
	var code, name, email, cohortName string
	err := q.QueryRowContext(ctx, `SELECT COALESCE(sr.wcode, sa.candidate_id, sa.student_key, ''), COALESCE(sa.candidate_name, ''), COALESCE(sa.candidate_email, ''), COALESCE(s.cohort_name, '') FROM student_attempts sa JOIN exam_schedules s ON s.id = sa.schedule_id LEFT JOIN schedule_registrations sr ON sr.id = sa.registration_id AND sr.schedule_id = sa.schedule_id WHERE sa.id = ? AND sa.schedule_id = ? AND sa.user_id = ?`, attemptID, scheduleID, userID).Scan(&code, &name, &email, &cohortName)
	if err == sql.ErrNoRows {
		return now, apperrors.New(apperrors.CodeForbidden, "This sitting is not bound to the authenticated principal.")
	}
	if err != nil {
		return now, err
	}
	preview := strings.HasPrefix(strings.TrimSpace(cohortName), previewRuntimeCohortPrefix)
	if role != auth.RoleStudent && !(preview && (role == auth.RoleAdmin || role == auth.RoleBuilder || role == auth.RoleProctor)) {
		return now, apperrors.New(apperrors.CodeForbidden, "A student principal is required for this sitting.")
	}
	var admitted bool
	if err := q.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM attempt_sessions WHERE attempt_id = ? AND schedule_id = ? AND user_id = ?)", attemptID, scheduleID, userID).Scan(&admitted); err != nil {
		return now, err
	}
	if admitted {
		return now, nil
	}
	var linkID string
	err = q.QueryRowContext(ctx, "SELECT id FROM assessment_access_links WHERE schedule_id = ? FOR SHARE", scheduleID).Scan(&linkID)
	if err != nil && err != sql.ErrNoRows {
		return now, err
	}
	if err == nil {
		resolved, err := accesslinks.ResolveEntryTx(ctx, q, linkID, code, name, email)
		if err != nil {
			return now, err
		}
		if resolved.ScheduleID != scheduleID {
			return now, apperrors.New(apperrors.CodeForbidden, "Admission sitting changed.")
		}
		return now, nil
	}
	if preview {
		return now, nil
	}
	var status, provider string
	var end time.Time
	var model sql.NullString
	if err := q.QueryRowContext(ctx, "SELECT status, provider_key, end_time, sat_timing_model FROM exam_schedules WHERE id = ? FOR SHARE", scheduleID).Scan(&status, &provider, &end, &model); err != nil {
		return now, err
	}
	if status != schedules.StatusScheduled && status != schedules.StatusLive {
		return now, apperrors.New(apperrors.CodeForbidden, "This sitting is closed to new admissions.")
	}
	if provider == "sat" && model.Valid && examruntime.IsSatPersonal(model.String) && !now.Before(end) {
		return now, apperrors.New(apperrors.CodeForbidden, "This sitting is closed to new admissions.")
	}
	return now, nil
}
