package schedules

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
	"example.com/ielts-proctoring/internal/satlearning"
	"example.com/ielts-proctoring/internal/satstartcode"
)

// PracticeStartInput is the server-validated explicit retake request. Identity
// comes from the handler's authenticated practice/account proof, never from a
// display email or a caller-supplied student id.
type PracticeStartInput struct {
	StudentID       string
	StudentName     string
	StudentEmail    string
	Mode            satlearning.Mode
	Intent          string
	ObservedOrdinal int
	OperationKey    string
	ClientSessionID string
}

// PracticeAttempt is one accepted explicit practice sitting.
type PracticeAttempt struct {
	AttemptID       string
	ScheduleID      string
	Ordinal         int
	Disposition     string
	AttemptStatus   string
	AcceptedAt      time.Time
	Learning        satlearning.Snapshot
	ClientSessionID string
}

type PracticeAttemptSummary struct {
	AttemptID   string               `json:"attemptId"`
	Ordinal     int                  `json:"ordinal"`
	Mode        satlearning.Mode     `json:"mode"`
	Learning    satlearning.Snapshot `json:"learning"`
	Status      string               `json:"attemptStatus"`
	SubmittedAt *time.Time           `json:"submittedAt,omitempty"`
	AcceptedAt  time.Time            `json:"acceptedAt"`
}

type PracticeLearningState struct {
	ScheduleID            string                         `json:"scheduleId"`
	Policy                satlearning.Policy             `json:"policy"`
	CompletedTestAttempts int64                          `json:"completedTestAttempts"`
	RequiredCompletions   int64                          `json:"requiredCompletions"`
	Eligible              bool                           `json:"eligible"`
	CanRetakeTest         bool                           `json:"canRetakeTest"`
	CanStart              bool                           `json:"canStart"`
	Reason                *satlearning.EligibilityReason `json:"reason"`
	Capabilities          satlearning.Capabilities       `json:"capabilities"`
	LastOrdinal           int                            `json:"lastOrdinal"`
	ActiveAttempt         *PracticeAttemptSummary        `json:"activeAttempt"`
	Attempts              []PracticeAttemptSummary       `json:"attempts"`
}

func practiceConflict(code apperrors.Code, message string, details map[string]any) error {
	e := apperrors.New(code, message)
	e.HTTPStatus = 409
	if details != nil {
		e.Details = details
	}
	return e
}

func practiceBadRequest(message string) error {
	return apperrors.New(apperrors.CodeBadRequest, message)
}

type practiceSchedule struct {
	ID               string
	ExamID           string
	VersionID        string
	Title            string
	OrganizationID   *string
	Status           string
	EndTime          time.Time
	TimingModel      string
	SessionMode      string
	StartMode        string
	PublishedVersion int64
}

func loadPracticeSchedule(ctx context.Context, q tx.Tx, scheduleID string, forUpdate bool) (practiceSchedule, error) {
	query := `SELECT id, exam_id, published_version_id, exam_title, organization_id, status, end_time,
		COALESCE(sat_timing_model, ''), COALESCE(sat_session_mode, 'practice'), COALESCE(sat_start_mode, 'proctor'),
		revision
		FROM exam_schedules WHERE id = ? AND provider_key = 'sat'`
	if forUpdate {
		query += ` FOR UPDATE`
	}
	var out practiceSchedule
	var org sql.NullString
	if err := q.QueryRowContext(ctx, query, scheduleID).
		Scan(&out.ID, &out.ExamID, &out.VersionID, &out.Title, &org, &out.Status, &out.EndTime,
			&out.TimingModel, &out.SessionMode, &out.StartMode, &out.PublishedVersion); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return out, apperrors.New(apperrors.CodeNotFound, "Practice activity not found.")
		}
		return out, err
	}
	if org.Valid {
		value := org.String
		out.OrganizationID = &value
	}
	if out.SessionMode != "practice" && (out.SessionMode != "classroom" || !examruntime.IsSatPersonal(out.TimingModel)) {
		return out, apperrors.New(apperrors.CodeNotFound, "Practice activity not found.")
	}
	return out, nil
}

func practiceAdmissionOpen(sch practiceSchedule, now time.Time) bool {
	if sch.Status != StatusScheduled && sch.Status != StatusLive {
		return false
	}
	if examruntime.IsSatPersonal(examruntime.ResolveTimingModel("sat", sch.TimingModel)) && !now.Before(sch.EndTime) {
		return false
	}
	return true
}

// practiceCodeWindowOpen keeps the code-room admission window in effect even
// when a returning student has already verified the code for this sitting.
func practiceCodeWindowOpen(ctx context.Context, q tx.Tx, scheduleID string, now time.Time) (bool, error) {
	var open bool
	err := q.QueryRowContext(ctx, `SELECT s.start_time <= ?
		AND NOT EXISTS (
			SELECT 1 FROM assessment_access_links l WHERE l.schedule_id = s.id
			AND (l.lifecycle_state <> 'active' OR l.opens_at > ? OR l.closes_at <= ?)
		)
		AND NOT EXISTS (
			SELECT 1 FROM exam_session_runtimes r WHERE r.schedule_id = s.id AND r.status = 'paused'
		)
		FROM exam_schedules s WHERE s.id = ?`, now, now, now, scheduleID).Scan(&open)
	return open, err
}

type practiceLatest struct {
	ID          string
	SubmittedAt *time.Time
	Phase       string
	Proctor     string
	Outcome     string
	Mode        satlearning.Mode
	Ordinal     int
	AcceptedAt  time.Time
}

func practiceLatestAttempt(ctx context.Context, q tx.Tx, scheduleID, studentID string) (practiceLatest, bool, error) {
	var out practiceLatest
	var submitted sql.NullTime
	var mode string
	err := q.QueryRowContext(ctx, `SELECT sa.id, sa.submitted_at, sa.phase,
			COALESCE(sa.proctor_status, 'active'), COALESCE(t.outcome, ''), COALESCE(l.mode, 'test'),
			COALESCE(l.ordinal, 0), sa.created_at
		FROM student_attempts sa
		LEFT JOIN attempt_terminalizations t ON t.attempt_id = sa.id AND t.terminal_generation = sa.terminal_generation
		LEFT JOIN sat_attempt_learning l ON l.attempt_id = sa.id
		WHERE sa.schedule_id = ? AND sa.user_id = ?
		ORDER BY COALESCE(l.ordinal, 0) DESC, sa.created_at DESC, sa.id DESC LIMIT 1 FOR UPDATE`, scheduleID, studentID).
		Scan(&out.ID, &submitted, &out.Phase, &out.Proctor, &out.Outcome, &mode, &out.Ordinal, &out.AcceptedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return out, false, nil
	}
	if err != nil {
		return out, false, err
	}
	out.SubmittedAt = nil
	if submitted.Valid {
		value := submitted.Time
		out.SubmittedAt = &value
	}
	out.Mode = satlearning.Mode(mode)
	return out, true, nil
}

func practiceAttemptStatus(latest practiceLatest) string {
	if latest.SubmittedAt != nil && latest.Outcome != "terminated" && latest.Proctor != "terminated" {
		return "submitted"
	}
	if latest.Outcome == "terminated" || latest.Proctor == "terminated" || latest.Phase == "post-exam" {
		return "terminated"
	}
	if latest.SubmittedAt == nil {
		return "active"
	}
	return "submitted"
}

// practiceClientSession recovers the accepted browser session from the
// attempt's recovery evidence so a replay can be admitted without minting a new
// session identity. A missing value stays empty; the handler may mint one.
func practiceClientSession(ctx context.Context, q tx.Tx, attemptID string) string {
	var value sql.NullString
	if err := q.QueryRowContext(ctx, `SELECT JSON_UNQUOTE(JSON_EXTRACT(recovery, '$.clientSessionId'))
		FROM student_attempts WHERE id = ?`, attemptID).Scan(&value); err != nil || !value.Valid {
		return ""
	}
	return strings.TrimSpace(value.String)
}

// practiceAttemptStateByID reports "active" for a live attempt, "" for a
// submitted/terminated one. It is a status read, never a capability source.
func practiceAttemptStateByID(ctx context.Context, q tx.Tx, attemptID string) (string, error) {
	var submitted sql.NullTime
	var phase, proctor, outcome string
	err := q.QueryRowContext(ctx, `SELECT sa.submitted_at, sa.phase, COALESCE(sa.proctor_status,'active'),
			COALESCE(t.outcome,'')
		FROM student_attempts sa
		LEFT JOIN attempt_terminalizations t ON t.attempt_id = sa.id AND t.terminal_generation = sa.terminal_generation
		WHERE sa.id = ?`, attemptID).Scan(&submitted, &phase, &proctor, &outcome)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if outcome == "terminated" || proctor == "terminated" || phase == "post-exam" {
		return "", nil
	}
	if submitted.Valid {
		return "", nil
	}
	return "active", nil
}

func practiceDigest(input PracticeStartInput) (string, error) {
	body, err := json.Marshal(struct {
		Student  string           `json:"student"`
		Mode     satlearning.Mode `json:"mode"`
		Intent   string           `json:"intent"`
		Observed int              `json:"observed"`
	}{
		Student: input.StudentID, Mode: input.Mode, Intent: input.Intent, Observed: input.ObservedOrdinal,
	})
	if err != nil {
		return "", err
	}
	return sha256Hex(body), nil
}

func sha256Hex(body []byte) string {
	sum := sha256.Sum256(body)
	return fmt.Sprintf("%x", sum)
}

// StartPracticeAttempt writes one explicitly admitted practice sitting. It is
// idempotent by operation key and serialized by the sat_practice_students row.
func (s *Service) StartPracticeAttempt(ctx context.Context, scheduleID string, input PracticeStartInput) (PracticeAttempt, error) {
	if s == nil || s.db == nil || s.runner == nil {
		return PracticeAttempt{}, apperrors.New(apperrors.CodeServiceUnavailable, "Schedules are unavailable.")
	}
	if strings.TrimSpace(input.StudentID) == "" || strings.TrimSpace(input.OperationKey) == "" {
		return PracticeAttempt{}, practiceBadRequest("A practice identity and operation key are required.")
	}
	mode := input.Mode
	if mode == "" {
		mode = satlearning.ModeTest
	}
	if mode != satlearning.ModeTest && mode != satlearning.ModeStudy {
		return PracticeAttempt{}, practiceBadRequest("Choose a timed exam.")
	}
	input.Mode = mode
	intent := strings.ToLower(strings.TrimSpace(input.Intent))
	if intent != "retake" || input.ObservedOrdinal < 1 {
		return PracticeAttempt{}, practiceBadRequest("Submit an exam before starting it again.")
	}
	input.Intent = intent
	digest, err := practiceDigest(input)
	if err != nil {
		return PracticeAttempt{}, err
	}
	var out PracticeAttempt
	err = s.runner.WithTxRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		var txErr error
		out, txErr = s.startPracticeAttemptTx(ctx, q, scheduleID, input, intent, digest)
		return txErr
	})
	return out, err
}

func (s *Service) startPracticeAttemptTx(ctx context.Context, q tx.Tx, scheduleID string, input PracticeStartInput, intent, digest string) (PracticeAttempt, error) {
	sch, err := loadPracticeSchedule(ctx, q, scheduleID, true)
	if err != nil {
		return PracticeAttempt{}, err
	}
	var now time.Time
	if err := q.QueryRowContext(ctx, `SELECT UTC_TIMESTAMP(6)`).Scan(&now); err != nil {
		return PracticeAttempt{}, err
	}
	if !practiceAdmissionOpen(sch, now) {
		return PracticeAttempt{}, practiceConflict(apperrors.Code("STARTS_CLOSED"), "Starts are closed for this practice activity.",
			map[string]any{"status": sch.Status, "endTime": sch.EndTime, "now": now, "timingModel": sch.TimingModel, "sessionMode": sch.SessionMode})
	}
	if _, err := q.ExecContext(ctx, `INSERT INTO sat_practice_students (schedule_id, student_id)
		VALUES (?, ?) ON DUPLICATE KEY UPDATE schedule_id = schedule_id`, scheduleID, input.StudentID); err != nil {
		return PracticeAttempt{}, err
	}
	var latestOrdinal int
	var activeAttemptID sql.NullString
	if err := q.QueryRowContext(ctx, `SELECT latest_ordinal, active_attempt_id FROM sat_practice_students
		WHERE schedule_id = ? AND student_id = ? FOR UPDATE`, scheduleID, input.StudentID).
		Scan(&latestOrdinal, &activeAttemptID); err != nil {
		return PracticeAttempt{}, err
	}
	// The initial registration-backed entry predates this serialization row.
	// It counts as ordinal 1 without inventing a new identity.
	if latestOrdinal == 0 {
		var count int
		if err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM student_attempts WHERE schedule_id = ? AND user_id = ?`,
			scheduleID, input.StudentID).Scan(&count); err != nil {
			return PracticeAttempt{}, err
		}
		latestOrdinal = count
	}
	latest, found, err := practiceLatestAttempt(ctx, q, scheduleID, input.StudentID)
	if err != nil {
		return PracticeAttempt{}, err
	}
	if replayed, ok, err := practiceReplay(ctx, q, scheduleID, input.StudentID, input.OperationKey, digest); err != nil {
		return PracticeAttempt{}, err
	} else if ok {
		return replayed, nil
	}
	if activeAttemptID.Valid && activeAttemptID.String != "" {
		state, stateErr := practiceAttemptStateByID(ctx, q, activeAttemptID.String)
		if stateErr != nil {
			return PracticeAttempt{}, stateErr
		}
		if state == "" {
			// A terminal attempt leaves the pointer stale; clear it and let the
			// normal retake/status rules decide this request.
			if _, err := q.ExecContext(ctx, `UPDATE sat_practice_students SET active_attempt_id = NULL
				WHERE schedule_id = ? AND student_id = ? AND active_attempt_id = ?`,
				scheduleID, input.StudentID, activeAttemptID.String); err != nil {
				return PracticeAttempt{}, err
			}
			activeAttemptID = sql.NullString{}
		} else {
			snapshot, err := satlearning.LoadSnapshotTx(ctx, q, activeAttemptID.String)
			if err != nil {
				return PracticeAttempt{}, err
			}
			if snapshot.Mode != input.Mode {
				reason := satlearning.ReasonActiveAttempt
				return PracticeAttempt{}, practiceConflict(apperrors.CodeStudyLocked,
					"This practice activity already has an active attempt in another mode.",
					map[string]any{"reason": string(reason), "attemptStatus": "active", "mode": snapshot.Mode})
			}
			attemptID := activeAttemptID.String
			ordinal := latest.Ordinal
			if ordinal == 0 {
				_ = q.QueryRowContext(ctx, `SELECT ordinal FROM sat_attempt_learning WHERE attempt_id = ?`, attemptID).Scan(&ordinal)
			}
			return PracticeAttempt{AttemptID: attemptID, ScheduleID: scheduleID, Ordinal: ordinal,
				Disposition: "already_active", AttemptStatus: "active", AcceptedAt: latest.AcceptedAt,
				Learning: snapshot, ClientSessionID: practiceClientSession(ctx, q, attemptID)}, nil
		}
	}
	if found && practiceAttemptStatus(latest) == "active" {
		snapshot, err := satlearning.LoadSnapshotTx(ctx, q, latest.ID)
		if err != nil {
			return PracticeAttempt{}, err
		}
		if snapshot.Mode != input.Mode {
			reason := satlearning.ReasonActiveAttempt
			return PracticeAttempt{}, practiceConflict(apperrors.CodeStudyLocked,
				"This practice activity already has an active attempt in another mode.",
				map[string]any{"reason": string(reason), "attemptStatus": "active", "mode": snapshot.Mode})
		}
		return PracticeAttempt{AttemptID: latest.ID, ScheduleID: scheduleID, Ordinal: latest.Ordinal,
			Disposition: "already_active", AttemptStatus: "active", AcceptedAt: latest.AcceptedAt,
			Learning: snapshot, ClientSessionID: practiceClientSession(ctx, q, latest.ID)}, nil
	}
	if input.ObservedOrdinal != latestOrdinal {
		return PracticeAttempt{}, practiceConflict(apperrors.CodeConflict,
			"The attempt history changed. Refresh before starting.",
			map[string]any{"lastOrdinal": latestOrdinal})
	}
	if latestOrdinal == 0 && intent != "start" {
		return PracticeAttempt{}, practiceConflict(apperrors.CodeConflict, "Start the first attempt before retaking.", nil)
	}
	if latestOrdinal > 0 && intent != "retake" {
		return PracticeAttempt{}, practiceConflict(apperrors.CodeConflict, "Retake this activity explicitly after the previous attempt.", nil)
	}
	if latestOrdinal > 0 && (!found || practiceAttemptStatus(latest) != "submitted") {
		return PracticeAttempt{}, practiceConflict(apperrors.Code("RETAKE_NOT_ALLOWED"),
			"A new attempt is only available after a confirmed submission.",
			map[string]any{"lastOrdinal": latestOrdinal, "attemptStatus": practiceAttemptStatus(latest)})
	}

	policy, err := satlearning.LoadPolicyCurrentTx(ctx, q, scheduleID)
	if err != nil {
		return PracticeAttempt{}, err
	}
	if input.Mode == satlearning.ModeStudy {
		return PracticeAttempt{}, practiceConflict(apperrors.CodeStudyLocked, "Study mode is no longer available for new attempts.",
			map[string]any{"reason": string(satlearning.ReasonDisabled)})
	}
	if latestOrdinal > 0 && !examruntime.IsSatPersonal(sch.TimingModel) {
		return PracticeAttempt{}, practiceConflict(apperrors.CodeConflict, "Retakes require a room with individual timers.", nil)
	}
	if latestOrdinal > 0 && !policy.UnlimitedRetakes {
		return PracticeAttempt{}, practiceConflict(apperrors.Code("RETAKE_NOT_ALLOWED"), "Retakes are disabled for this exam.", nil)
	}
	codeRequired := sch.StartMode == satstartcode.ModeAccessCode
	if codeRequired && latestOrdinal > 0 {
		open, err := practiceCodeWindowOpen(ctx, q, scheduleID, now)
		if err != nil {
			return PracticeAttempt{}, err
		}
		if !open {
			return PracticeAttempt{}, practiceConflict(apperrors.Code("STARTS_CLOSED"), "New starts are unavailable for this exam.", nil)
		}
		// Only a prior submitted, code-verified attempt owned by this student
		// in this room and exam version can carry admission forward.
		var verified bool
		if err := q.QueryRowContext(ctx, `SELECT EXISTS (
			SELECT 1 FROM student_attempts a
			WHERE a.schedule_id = ? AND a.user_id = ? AND a.published_version_id = ?
			AND a.sat_start_code_accepted_at IS NOT NULL AND a.submitted_at IS NOT NULL
			AND a.delivery_status = 'submitted' AND COALESCE(a.proctor_status, 'active') <> 'terminated'
		)`, scheduleID, input.StudentID, sch.VersionID).Scan(&verified); err != nil {
			return PracticeAttempt{}, err
		}
		codeRequired = !verified
	}
	snapshot := satlearning.TestSnapshot(policy.Revision)

	ordinal := latestOrdinal + 1
	attemptID := uuid.NewString()
	studentKey := fmt.Sprintf("practice:%s:%s:%d", scheduleID, input.StudentID, ordinal)
	email := strings.TrimSpace(input.StudentEmail)
	name := strings.TrimSpace(input.StudentName)
	if name == "" {
		name = "Practice student"
	}
	clientSession := strings.TrimSpace(input.ClientSessionID)
	if clientSession == "" {
		clientSession = uuid.NewString()
	}
	// A retake keeps the same server-issued candidate locator as the sitting it
	// retakes, so the legacy student URL and resume resolver find the newest
	// attempt instead of the completed one. The locator is read from the owned
	// attempt, never from a display form.
	var candidateID, candidateWcode string
	if err := q.QueryRowContext(ctx, `SELECT COALESCE(candidate_id, ''), COALESCE(wcode, '')
		FROM student_attempts WHERE schedule_id = ? AND user_id = ? ORDER BY created_at, id LIMIT 1`,
		scheduleID, input.StudentID).Scan(&candidateID, &candidateWcode); err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return PracticeAttempt{}, err
		}
	}
	if candidateID == "" {
		candidateID = input.StudentID
	}
	recovery, _ := json.Marshal(map[string]string{"clientSessionId": clientSession})
	if _, err := q.ExecContext(ctx, `INSERT INTO student_attempts
		(id, schedule_id, registration_id, user_id, wcode, student_key, organization_id, exam_id, published_version_id, exam_title,
		 candidate_id, candidate_name, candidate_email, phase, current_module, answers, writing_answers, flags, violations_snapshot,
		 integrity, recovery, created_at, updated_at, revision, protocol_version, delivery_status, lease_epoch, control_epoch, response_revision, sat_start_code_required)
		VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lobby', 'reading', '{}', '{}', '{}', '[]', '{}', ?, NOW(), NOW(), 0, 2, 'running', 1, 1, 0, ?)`,
		attemptID, scheduleID, input.StudentID, candidateWcode, studentKey, nullableStrPtr(sch.OrganizationID), sch.ExamID, sch.VersionID,
		sch.Title, candidateID, name, email, string(recovery), codeRequired); err != nil {
		return PracticeAttempt{}, err
	}
	if err := satlearning.InsertSnapshotTx(ctx, q, satlearning.AttemptLearningRow{
		AttemptID: attemptID, ScheduleID: scheduleID, PublishedVersion: sch.VersionID,
		StudentID: input.StudentID, Ordinal: ordinal, Mode: snapshot.Mode,
		PolicyRevision: snapshot.PolicyRevision,
		RevealAnswers:  snapshot.Capabilities.RevealAnswers,
		Untimed:        snapshot.Capabilities.Untimed,
	}); err != nil {
		return PracticeAttempt{}, err
	}
	if _, err := q.ExecContext(ctx, `UPDATE sat_practice_students SET latest_ordinal = ?, active_attempt_id = ?
		WHERE schedule_id = ? AND student_id = ?`, ordinal, attemptID, scheduleID, input.StudentID); err != nil {
		return PracticeAttempt{}, err
	}
	if err := s.savePracticeReceipt(ctx, q, scheduleID, input.StudentID, input.OperationKey, digest, attemptID); err != nil {
		return PracticeAttempt{}, err
	}
	// A live room may already have a runtime; project its active section clock
	// onto this attempt exactly as initial check-in does.
	var runtimeID, activeSection string
	if !codeRequired {
		if err := q.QueryRowContext(ctx, `SELECT id, active_section_key FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE`,
			scheduleID).Scan(&runtimeID, &activeSection); err == nil && strings.TrimSpace(activeSection) != "" {
			running := "running"
			if err := examruntime.SyncV2TimingForAttemptInTx(ctx, q, scheduleID, runtimeID, activeSection, attemptID, &running); err != nil {
				return PracticeAttempt{}, err
			}
		} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return PracticeAttempt{}, err
		}
	}
	return PracticeAttempt{AttemptID: attemptID, ScheduleID: scheduleID, Ordinal: ordinal,
		Disposition: "started", AttemptStatus: "active", AcceptedAt: now.UTC(), Learning: snapshot,
		ClientSessionID: clientSession}, nil
}

func (s *Service) savePracticeReceipt(ctx context.Context, q tx.Tx, scheduleID, studentID, key, digest, attemptID string) error {
	_, err := q.ExecContext(ctx, `INSERT INTO sat_practice_start_receipts
		(schedule_id, student_id, operation_key, request_digest, attempt_id) VALUES (?, ?, ?, ?, ?)`,
		scheduleID, studentID, key, digest, attemptID)
	return err
}

func practiceReplay(ctx context.Context, q tx.Tx, scheduleID, studentID, key, digest string) (PracticeAttempt, bool, error) {
	var attemptID, stored string
	err := q.QueryRowContext(ctx, `SELECT attempt_id, request_digest FROM sat_practice_start_receipts
		WHERE schedule_id = ? AND student_id = ? AND operation_key = ?`, scheduleID, studentID, key).
		Scan(&attemptID, &stored)
	if errors.Is(err, sql.ErrNoRows) {
		return PracticeAttempt{}, false, nil
	}
	if err != nil {
		return PracticeAttempt{}, false, err
	}
	if stored != digest {
		return PracticeAttempt{}, false, practiceConflict(apperrors.CodeOperationKeyConflict,
			"This request key was already used for another start.", nil)
	}
	var ordinal int
	var accepted time.Time
	var mode string
	if err := q.QueryRowContext(ctx, `SELECT COALESCE(l.ordinal, 0), COALESCE(l.mode, 'test'), sa.created_at
		FROM student_attempts sa LEFT JOIN sat_attempt_learning l ON l.attempt_id = sa.id
		WHERE sa.id = ?`, attemptID).Scan(&ordinal, &mode, &accepted); err != nil {
		return PracticeAttempt{}, false, err
	}
	snapshot, err := satlearning.LoadSnapshotTx(ctx, q, attemptID)
	if err != nil {
		return PracticeAttempt{}, false, err
	}
	return PracticeAttempt{AttemptID: attemptID, ScheduleID: scheduleID, Ordinal: ordinal,
		Disposition: "replayed", AttemptStatus: "active", AcceptedAt: accepted,
		Learning: snapshot, ClientSessionID: practiceClientSession(ctx, q, attemptID)}, true, nil
}

// PracticeLearningState projects the caller's own measured history, active
// attempt, and policy. A failed read is an error, never a fabricated zero.
func (s *Service) PracticeLearningState(ctx context.Context, scheduleID, studentID string) (PracticeLearningState, error) {
	if s == nil || s.db == nil {
		return PracticeLearningState{}, apperrors.New(apperrors.CodeServiceUnavailable, "Schedules are unavailable.")
	}
	sch, err := loadPracticeSchedule(ctx, s.db, scheduleID, false)
	if err != nil {
		return PracticeLearningState{}, err
	}
	var now time.Time
	if err := s.db.QueryRowContext(ctx, `SELECT UTC_TIMESTAMP(6)`).Scan(&now); err != nil {
		return PracticeLearningState{}, err
	}
	policy, err := satlearning.LoadPolicyTx(ctx, s.db, scheduleID)
	if err != nil {
		return PracticeLearningState{}, err
	}
	completed, err := satlearning.CountCompletedTestAttemptsTx(ctx, s.db, satlearning.CompletionScope{
		ScheduleID: scheduleID, StudentID: studentID, PublishedVersion: sch.VersionID,
	})
	if err != nil {
		return PracticeLearningState{}, err
	}
	var lastOrdinal int
	var activeID sql.NullString
	err = s.db.QueryRowContext(ctx, `SELECT latest_ordinal, active_attempt_id FROM sat_practice_students
		WHERE schedule_id = ? AND student_id = ?`, scheduleID, studentID).Scan(&lastOrdinal, &activeID)
	if errors.Is(err, sql.ErrNoRows) {
		lastOrdinal = 0
	} else if err != nil {
		return PracticeLearningState{}, err
	}
	if lastOrdinal == 0 {
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM student_attempts WHERE schedule_id = ? AND user_id = ?`,
			scheduleID, studentID).Scan(&lastOrdinal); err != nil {
			return PracticeLearningState{}, err
		}
	}
	rows, err := s.db.QueryContext(ctx, `SELECT sa.id, COALESCE(l.ordinal, 0), COALESCE(l.mode, 'test'),
			COALESCE(l.policy_revision, 0), COALESCE(l.reveal_answers, FALSE), COALESCE(l.untimed, FALSE),
			sa.submitted_at, sa.phase, COALESCE(sa.proctor_status, 'active'), COALESCE(t.outcome, ''), sa.created_at
		FROM student_attempts sa
		LEFT JOIN sat_attempt_learning l ON l.attempt_id = sa.id
		LEFT JOIN attempt_terminalizations t ON t.attempt_id = sa.id AND t.terminal_generation = sa.terminal_generation
		WHERE sa.schedule_id = ? AND sa.user_id = ?
		ORDER BY COALESCE(l.ordinal, 0) DESC, sa.created_at DESC, sa.id DESC LIMIT 25`, scheduleID, studentID)
	if err != nil {
		return PracticeLearningState{}, err
	}
	defer rows.Close()
	out := PracticeLearningState{ScheduleID: scheduleID, Policy: policy,
		CompletedTestAttempts: completed, RequiredCompletions: policy.Study.RequiredCompletions}
	out.Attempts = make([]PracticeAttemptSummary, 0)
	for rows.Next() {
		var item PracticeAttemptSummary
		var submitted sql.NullTime
		var phase, proctor, outcome string
		var mode string
		var revision int64
		var reveal, untimed bool
		if err := rows.Scan(&item.AttemptID, &item.Ordinal, &mode, &revision, &reveal, &untimed,
			&submitted, &phase, &proctor, &outcome, &item.AcceptedAt); err != nil {
			return PracticeLearningState{}, err
		}
		item.Mode = satlearning.Mode(mode)
		if item.Ordinal == 0 {
			// Registration-backed first entries predate 0128 and carry no
			// snapshot ordinal; it is the first attempt.
			item.Ordinal = 1
		}
		item.Learning = satlearning.Snapshot{Mode: item.Mode, PolicyRevision: revision,
			Capabilities: satlearning.Capabilities{RevealAnswers: reveal, Untimed: untimed}}
		if submitted.Valid {
			value := submitted.Time
			item.SubmittedAt = &value
		}
		item.Status = practiceStatus(submitted, phase, proctor, outcome)
		if item.Status == "active" {
			copy := item
			out.ActiveAttempt = &copy
			if activeID.Valid && activeID.String != "" {
				_ = activeID
			}
		}
		out.Attempts = append(out.Attempts, item)
	}
	if err := rows.Err(); err != nil {
		return PracticeLearningState{}, err
	}
	out.LastOrdinal = lastOrdinal
	active := out.ActiveAttempt != nil
	startsOpen := practiceAdmissionOpen(sch, now)
	if startsOpen && sch.StartMode == satstartcode.ModeAccessCode {
		startsOpen, err = practiceCodeWindowOpen(ctx, s.db, scheduleID, now)
		if err != nil {
			return PracticeLearningState{}, err
		}
	}
	out.CanRetakeTest = startsOpen && examruntime.IsSatPersonal(sch.TimingModel) && !active &&
		len(out.Attempts) > 0 && out.Attempts[0].Status == "submitted" && policy.UnlimitedRetakes
	reason := satlearning.ReasonDisabled
	out.Reason = &reason
	return out, nil
}

func practiceStatus(submitted sql.NullTime, phase, proctor, outcome string) string {
	if submitted.Valid && outcome != "terminated" && proctor != "terminated" {
		return "submitted"
	}
	if outcome == "terminated" || proctor == "terminated" || phase == "post-exam" {
		return "terminated"
	}
	return "active"
}

// MarkPracticeAttemptInactive clears the active pointer after a terminal
// transition; the next explicit retake can then be admitted.
func (s *Service) MarkPracticeAttemptInactive(ctx context.Context, scheduleID, studentID, attemptID string) error {
	if s == nil || s.db == nil {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `UPDATE sat_practice_students SET active_attempt_id = NULL
		WHERE schedule_id = ? AND student_id = ? AND active_attempt_id = ?`, scheduleID, studentID, attemptID)
	return err
}
