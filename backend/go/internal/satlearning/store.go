package satlearning

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"example.com/ielts-proctoring/internal/platform/tx"
)

const policyColumns = `policy_revision, report_visible, include_answer_key_in_pdf,
	study_enabled, study_required_completions, study_reveal_answers, study_untimed, unlimited_retakes, pause_on_leave`

// LoadPolicyTx reads the saved room policy or derives the legacy default from
// the room mode, individual timing, and exam-level results switch.
// Database failures are errors, never a silent default.
func LoadPolicyTx(ctx context.Context, q tx.Tx, scheduleID string) (Policy, error) {
	return loadPolicyTx(ctx, q, scheduleID, false)
}

// LoadPolicyCurrentTx reads the same effective policy with locking reads, so a
// state-changing decision (admission, pause) is ordered after every committed
// policy write. The room row is locked FOR SHARE first, which also serializes
// the absent-policy case against a room save that inserts the row.
func LoadPolicyCurrentTx(ctx context.Context, q tx.Tx, scheduleID string) (Policy, error) {
	if scheduleID == "" {
		return Policy{}, invalid("scheduleId", "A schedule is required.")
	}
	var id string
	if err := q.QueryRowContext(ctx, `SELECT id FROM exam_schedules WHERE id = ? FOR SHARE`, scheduleID).Scan(&id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Policy{}, invalid("scheduleId", "The room does not exist.")
		}
		return Policy{}, err
	}
	return loadPolicyTx(ctx, q, scheduleID, true)
}

func loadPolicyTx(ctx context.Context, q tx.Tx, scheduleID string, lock bool) (Policy, error) {
	if scheduleID == "" {
		return Policy{}, invalid("scheduleId", "A schedule is required.")
	}
	query := `SELECT ` + policyColumns + `
		FROM sat_activity_policies WHERE schedule_id = ?`
	if lock {
		query += " FOR SHARE"
	}
	var policy Policy
	err := q.QueryRowContext(ctx, query, scheduleID).
		Scan(&policy.Revision, &policy.ReportVisible, &policy.IncludeAnswerKeyInPdf,
			&policy.Study.Enabled, &policy.Study.RequiredCompletions,
			&policy.Study.RevealAnswers, &policy.Study.Untimed, &policy.UnlimitedRetakes, &policy.PauseOnLeave)
	if err == nil {
		if err := ValidatePolicy(policy); err != nil {
			return Policy{}, fmt.Errorf("satlearning: stored policy for schedule %s is invalid: %w", scheduleID, err)
		}
		return NormalizePolicy(policy), nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Policy{}, err
	}

	policy = DefaultPolicy()
	// Legacy non-classroom rows (older schedules created before assignment
	// bindings) keep the exact pre-policy gate: the exam switch AND classroom
	// session mode. Only Classroom rooms with individual timers default to
	// retakes, since shared-timer rooms cannot start a fresh timed attempt.
	//
	// This read stays non-locking: taking the exam row here would invert the
	// exam-save lock order (exam -> room -> policy) and deadlock. The room
	// FOR SHARE lock already serializes against an exam save, which materializes
	// a room policy row before it changes the legacy flag, so a committed
	// change is observed by the policy read above rather than this fallback.
	err = q.QueryRowContext(ctx, `SELECT COALESCE(e.sat_score_report_enabled, FALSE)
			AND COALESCE(sch.sat_session_mode, 'practice') = 'classroom',
			COALESCE(sch.sat_session_mode, 'practice') = 'classroom'
			AND COALESCE(sch.sat_timing_model = 'sat_personal_v1', FALSE)
		FROM exam_schedules sch JOIN exam_entities e ON e.id = sch.exam_id
		WHERE sch.id = ?`, scheduleID).Scan(&policy.ReportVisible, &policy.UnlimitedRetakes)
	if err == nil {
		return policy, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return policy, nil
	}
	return Policy{}, err
}

// LoadSnapshotTx reads the admission-time mode/capability snapshot. An absent
// row is an explicit legacy Test attempt with zero capabilities. Malformed
// metadata fails closed.
func LoadSnapshotTx(ctx context.Context, q tx.Tx, attemptID string) (Snapshot, error) {
	if attemptID == "" {
		return Snapshot{}, invalid("attemptId", "An attempt is required.")
	}
	var rawMode string
	var snapshot Snapshot
	err := q.QueryRowContext(ctx, `SELECT mode, policy_revision, reveal_answers, untimed
		FROM sat_attempt_learning WHERE attempt_id = ?`, attemptID).
		Scan(&rawMode, &snapshot.PolicyRevision, &snapshot.Capabilities.RevealAnswers, &snapshot.Capabilities.Untimed)
	if errors.Is(err, sql.ErrNoRows) {
		return Snapshot{Mode: ModeTest, Legacy: true}, nil
	}
	if err != nil {
		return Snapshot{}, err
	}
	snapshot.Mode = Mode(rawMode)
	switch snapshot.Mode {
	case ModeTest, ModeStudy:
	default:
		return Snapshot{}, fmt.Errorf("satlearning: attempt %s has malformed mode %q", attemptID, rawMode)
	}
	if snapshot.PolicyRevision < 0 {
		return Snapshot{}, fmt.Errorf("satlearning: attempt %s has a negative policy revision", attemptID)
	}
	if snapshot.Mode == ModeTest &&
		(snapshot.Capabilities.RevealAnswers || snapshot.Capabilities.Untimed) {
		return Snapshot{}, fmt.Errorf("satlearning: Test attempt %s carries study capabilities", attemptID)
	}
	return snapshot, nil
}

// InsertSnapshotTx writes the immutable admission snapshot. It is insert-only:
// no UPDATE path exists, so a settings edit or replay can never upgrade an
// admitted attempt's capabilities.
func InsertSnapshotTx(ctx context.Context, q tx.Tx, row AttemptLearningRow) error {
	if row.AttemptID == "" || row.ScheduleID == "" || row.StudentID == "" || row.PublishedVersion == "" {
		return invalid("attemptId", "The admission snapshot needs an attempt, schedule, student, and version.")
	}
	if row.Mode != ModeTest && row.Mode != ModeStudy {
		return invalid("mode", "Choose Test or Study.")
	}
	if row.Ordinal < 1 {
		return invalid("ordinal", "The attempt ordinal must be positive.")
	}
	if row.PolicyRevision < 0 {
		return invalid("policyRevision", "The policy revision must be nonnegative.")
	}
	if row.Mode == ModeTest && (row.RevealAnswers || row.Untimed) {
		return invalid("mode", "A Test attempt cannot carry Study capabilities.")
	}
	_, err := q.ExecContext(ctx, `INSERT INTO sat_attempt_learning
		(attempt_id, schedule_id, published_version_id, student_id, ordinal, mode, policy_revision,
		 reveal_answers, untimed, admitted_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`,
		row.AttemptID, row.ScheduleID, row.PublishedVersion, row.StudentID, row.Ordinal,
		string(row.Mode), row.PolicyRevision, row.RevealAnswers, row.Untimed)
	return err
}

// CountCompletedTestAttemptsTx counts distinct qualifying Test completions for
// one student, activity, and pinned version. The SQL is a scope read, not a
// replacement for the lifecycle predicate: Study rows, terminated outcomes,
// stale-generation receipts, and terminated proctor states are excluded.
func CountCompletedTestAttemptsTx(ctx context.Context, q tx.Tx, scope CompletionScope) (int64, error) {
	if scope.ScheduleID == "" || scope.StudentID == "" || scope.PublishedVersion == "" {
		return 0, invalid("scope", "The completion count needs a student, activity, and published version.")
	}
	var count int64
	err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM (
			SELECT sa.id
			FROM student_attempts sa
			LEFT JOIN sat_attempt_learning l ON l.attempt_id = sa.id
			LEFT JOIN attempt_terminalizations t
				ON t.attempt_id = sa.id AND t.terminal_generation = sa.terminal_generation
			WHERE sa.schedule_id = ? AND sa.user_id = ? AND sa.published_version_id = ?
				AND sa.submitted_at IS NOT NULL
				AND COALESCE(l.mode, 'test') = 'test'
				AND COALESCE(sa.proctor_status, 'active') <> 'terminated'
				AND COALESCE(t.outcome, 'submitted') <> 'terminated'
		) completed`, scope.ScheduleID, scope.StudentID, scope.PublishedVersion).Scan(&count)
	return count, err
}

// SavePolicyTx writes one optimistic-concurrency revision for a schedule and
// projects report visibility into the legacy classroom field. Both the
// classroom assignment alias and the schedule alias call this one writer.
//
// Every writer locks the parent room row first. That serializes two writers
// against an absent policy row: without it both could read revision 0 and the
// second INSERT ... ON DUPLICATE KEY would silently overwrite the first.
func SavePolicyTx(ctx context.Context, q tx.Tx, scheduleID string, policy Policy, expectedRevision int64, actorID string) (Policy, error) {
	if scheduleID == "" {
		return Policy{}, invalid("scheduleId", "A schedule is required.")
	}
	policy = NormalizePolicy(policy)
	if err := ValidatePolicy(policy); err != nil {
		return Policy{}, err
	}
	if err := lockScheduleTx(ctx, q, scheduleID); err != nil {
		return Policy{}, err
	}
	var current int64
	err := q.QueryRowContext(ctx, `SELECT policy_revision FROM sat_activity_policies
		WHERE schedule_id = ? FOR UPDATE`, scheduleID).Scan(&current)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		current = 0
	case err != nil:
		return Policy{}, err
	}
	if expectedRevision != current {
		return Policy{}, &RevisionConflict{Current: current}
	}
	next := policy
	next.Revision = current + 1
	if err := writePolicyTx(ctx, q, scheduleID, next, actorID); err != nil {
		return Policy{}, err
	}

	return next, nil
}

// lockScheduleTx serializes every policy writer on the parent room, including
// the absent-policy case where there is no policy row to lock. It is the same
// row room creation already locks, so an exam save and a room save establish
// the order exam -> room -> policy.
func lockScheduleTx(ctx context.Context, q tx.Tx, scheduleID string) error {
	var id string
	err := q.QueryRowContext(ctx, `SELECT id FROM exam_schedules WHERE id = ? FOR UPDATE`, scheduleID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return invalid("scheduleId", "The room does not exist.")
	}
	return err
}

// writePolicyTx upserts one complete policy row. Callers own the revision.
func writePolicyTx(ctx context.Context, q tx.Tx, scheduleID string, policy Policy, actorID string) error {
	_, err := q.ExecContext(ctx, `INSERT INTO sat_activity_policies
		(schedule_id, policy_revision, report_visible, include_answer_key_in_pdf,
		 study_enabled, study_required_completions, study_reveal_answers, study_untimed, unlimited_retakes, pause_on_leave, updated_by)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			policy_revision = VALUES(policy_revision),
			report_visible = VALUES(report_visible),
			include_answer_key_in_pdf = VALUES(include_answer_key_in_pdf),
			study_enabled = VALUES(study_enabled),
			study_required_completions = VALUES(study_required_completions),
			study_reveal_answers = VALUES(study_reveal_answers),
			study_untimed = VALUES(study_untimed),
			unlimited_retakes = VALUES(unlimited_retakes),
			pause_on_leave = VALUES(pause_on_leave),
			updated_by = VALUES(updated_by)`,
		scheduleID, policy.Revision, policy.ReportVisible, policy.IncludeAnswerKeyInPdf,
		policy.Study.Enabled, policy.Study.RequiredCompletions, policy.Study.RevealAnswers,
		policy.Study.Untimed, policy.UnlimitedRetakes, policy.PauseOnLeave, nullableActor(actorID))
	return err
}

// ApplyExamDefaultsTx fans one accepted exam save out to every scheduled or
// running SAT room. Callers must hold the exam row lock and must call it
// before changing the exam's legacy score-report flag: an absent room policy
// resolves its fallback from that flag, and the fan-out has to capture the
// pre-save fallback so an unchanged field keeps its old value.
//
// Only the fields in change are written; a room's own choices for unchanged
// fields survive. Closed and cancelled rooms keep their policy. The return
// value counts rooms whose effective policy actually changed.
func ApplyExamDefaultsTx(ctx context.Context, q tx.Tx, examID string, change PolicyChange, defaults Policy, actorID string) (int, error) {
	if examID == "" {
		return 0, invalid("examId", "An exam is required.")
	}
	if !change.Any() {
		return 0, nil
	}
	defaults = NormalizePolicy(defaults)
	if err := ValidatePolicy(defaults); err != nil {
		return 0, err
	}
	// The legacy exam flag is the fallback for a room without a policy row. A
	// results change rewrites that flag, so first freeze every room that still
	// relies on it. This keeps closed and cancelled rooms on their own policy
	// while the eligible fan-out below changes only the scheduled/live ones.
	if change.ReportVisible {
		if err := freezeLegacyPoliciesTx(ctx, q, examID, actorID); err != nil {
			return 0, err
		}
	}
	rows, err := q.QueryContext(ctx, `SELECT id FROM exam_schedules
		WHERE exam_id = ? AND provider_key = 'sat' AND status IN ('scheduled', 'live')
		ORDER BY id FOR UPDATE`, examID)
	if err != nil {
		return 0, err
	}
	var scheduleIDs []string
	func() {
		defer rows.Close()
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil {
				scheduleIDs = append(scheduleIDs, id)
			}
		}
		err = rows.Err()
	}()
	if err != nil {
		return 0, err
	}
	applied := 0
	for _, scheduleID := range scheduleIDs {
		current, err := LoadPolicyTx(ctx, q, scheduleID)
		if err != nil {
			return applied, err
		}
		next := ApplyPolicyChange(current, defaults, change)
		if samePolicyExceptRevision(current, next) {
			continue
		}
		next.Revision = current.Revision + 1
		if err := writePolicyTx(ctx, q, scheduleID, next, actorID); err != nil {
			return applied, err
		}
		applied++
	}
	return applied, nil
}

// freezeLegacyPoliciesTx materializes the pre-save effective policy of every
// SAT room that has no policy row. Callers run it before changing the legacy
// exam-level results flag, so a closed room keeps the value it had instead of
// silently following the exam. Rows are written at revision 0: this is a
// snapshot, not a staff edit, and the first explicit room save still starts
// from 0.
func freezeLegacyPoliciesTx(ctx context.Context, q tx.Tx, examID, actorID string) error {
	rows, err := q.QueryContext(ctx, `SELECT id FROM exam_schedules
		WHERE exam_id = ? AND provider_key = 'sat'
		ORDER BY id FOR UPDATE`, examID)
	if err != nil {
		return err
	}
	var scheduleIDs []string
	func() {
		defer rows.Close()
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil {
				scheduleIDs = append(scheduleIDs, id)
			}
		}
		err = rows.Err()
	}()
	if err != nil {
		return err
	}
	for _, scheduleID := range scheduleIDs {
		var exists int
		err := q.QueryRowContext(ctx, `SELECT 1 FROM sat_activity_policies WHERE schedule_id = ? FOR SHARE`, scheduleID).Scan(&exists)
		if err == nil {
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		current, err := LoadPolicyTx(ctx, q, scheduleID)
		if err != nil {
			return err
		}
		if err := writePolicyTx(ctx, q, scheduleID, current, actorID); err != nil {
			return err
		}
	}
	return nil
}

// samePolicyExceptRevision compares every persisted policy field but the
// optimistic-concurrency token.
func samePolicyExceptRevision(a, b Policy) bool {
	return a.ReportVisible == b.ReportVisible &&
		a.IncludeAnswerKeyInPdf == b.IncludeAnswerKeyInPdf &&
		a.UnlimitedRetakes == b.UnlimitedRetakes &&
		a.PauseOnLeave == b.PauseOnLeave &&
		a.Study == b.Study
}

// CopyExamDefaultsTx pins a configured library policy when a new room is
// created. An unconfigured exam retains the existing schedule fallback.
func CopyExamDefaultsTx(ctx context.Context, q tx.Tx, examID, scheduleID, actorID string) error {
	var raw []byte
	if err := q.QueryRowContext(ctx, "SELECT sat_learning_defaults FROM exam_entities WHERE id = ?", examID).Scan(&raw); err != nil {
		return err
	}
	if len(raw) == 0 {
		return nil
	}
	policy, err := UnmarshalPolicy(raw)
	if err != nil {
		return err
	}
	_, err = SavePolicyTx(ctx, q, scheduleID, policy, 0, actorID)
	return err
}

// RevisionConflict is reported when a caller saved against a stale revision.
type RevisionConflict struct {
	Current int64
}

func (e *RevisionConflict) Error() string {
	return fmt.Sprintf("the activity policy moved to revision %d", e.Current)
}

func nullableActor(actorID string) any {
	if actorID == "" {
		return nil
	}
	return actorID
}

// MarshalPolicy is used by draft assignments that persist their intended
// settings before a schedule exists.
func MarshalPolicy(p Policy) ([]byte, error) { return json.Marshal(p) }

// UnmarshalPolicy reads a persisted draft policy without inventing defaults.
func UnmarshalPolicy(raw []byte) (Policy, error) {
	var p Policy
	if len(raw) == 0 {
		return DefaultPolicy(), nil
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return Policy{}, err
	}
	return NormalizePolicy(p), ValidatePolicy(p)
}
