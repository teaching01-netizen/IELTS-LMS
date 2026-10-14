package exams

import (
	"context"
	"database/sql"
	"strings"
	"sync/atomic"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/satpublish"
)

// SATRoutePolicy is the per-session Module 2 routing policy stored in
// exam_schedules.sat_route_policy (SAT Practice Classroom). Adaptive is the
// default for every existing and every standard-practice session.
type SATRoutePolicy string

const (
	SATRouteAdaptive    SATRoutePolicy = "adaptive"
	SATRouteForceLower  SATRoutePolicy = "force_lower"
	SATRouteForceHigher SATRoutePolicy = "force_higher"
	// SATRouteStaffSelects holds each student after Module 1 until staff assign
	// the Module 2 branch; no route decision exists until they do.
	SATRouteStaffSelects SATRoutePolicy = "staff_selects"
)

// ParseSATRoutePolicy normalizes a request value; empty means adaptive.
func ParseSATRoutePolicy(raw string) (SATRoutePolicy, error) {
	switch p := SATRoutePolicy(strings.ToLower(strings.TrimSpace(raw))); p {
	case "", SATRouteAdaptive:
		return SATRouteAdaptive, nil
	case SATRouteForceLower, SATRouteForceHigher, SATRouteStaffSelects:
		return p, nil
	default:
		return "", apperrors.New(apperrors.CodeValidation, "Unknown SAT route policy.")
	}
}

// Branch returns the adaptive_role a forced policy administers, or "" for adaptive.
func (p SATRoutePolicy) Branch() string {
	switch p {
	case SATRouteForceLower:
		return "lower_branch"
	case SATRouteForceHigher:
		return "higher_branch"
	}
	return ""
}

// SATSession is the stored classroom configuration of a SAT session
// (exam_schedules.sat_session_mode + sat_route_policy). The zero value is
// standard practice: adaptive routing, withheld score.
type SATSession struct {
	Classroom bool
	Route     SATRoutePolicy
}

// ParseSATSession validates a request's session mode and route policy. A
// forced route implies classroom mode; combining one with an explicit
// "practice" mode is rejected rather than silently reinterpreted.
func ParseSATSession(mode, route string) (SATSession, error) {
	policy, err := ParseSATRoutePolicy(route)
	if err != nil {
		return SATSession{}, err
	}
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "":
		return SATSession{Classroom: policy != SATRouteAdaptive, Route: policy}, nil
	case "practice":
		if policy != SATRouteAdaptive {
			return SATSession{}, apperrors.New(apperrors.CodeValidation, "A non-adaptive Module 2 route requires classroom mode.")
		}
		return SATSession{Route: policy}, nil
	case "classroom":
		return SATSession{Classroom: true, Route: policy}, nil
	}
	return SATSession{}, apperrors.New(apperrors.CodeValidation, "Unknown SAT session mode.")
}

// RoutePolicyExecer is the write boundary PersistSATRoutePolicy needs; tx.Tx
// and *sql.DB both satisfy it.
type RoutePolicyExecer interface {
	RowQueryer
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// A zero-value atomic.Bool is false, so the creation gate fails closed until
// startup explicitly applies SAT_CLASSROOM_ENABLED.
var classroomCreationEnabled atomic.Bool

// SetClassroomCreationEnabled is the rollout gate for NEW classroom sessions.
// The API binary sets it from SAT_CLASSROOM_ENABLED, which defaults to false.
func SetClassroomCreationEnabled(enabled bool) { classroomCreationEnabled.Store(enabled) }

// SATClassroomCreationEnabled reports the effective rollout gate used by room
// creation. Capability responses use the same atomic value as the write path.
func SATClassroomCreationEnabled() bool { return classroomCreationEnabled.Load() }

// PersistSATSession validates and stores the classroom configuration on a
// schedule. Standard practice is the column default, so it writes nothing. A forced
// policy is SAT-only and requires the forced branch to hold questions in every
// section the run delivers; otherwise the session would route students into an
// empty module. scope is the run's section scope (nil = every section).
func PersistSATSession(ctx context.Context, q RoutePolicyExecer, scheduleID, providerKey, versionID string, session SATSession, scope map[string]bool) error {
	if !session.Classroom {
		if providerKey != "sat" {
			return nil
		}
		// A plan-bearing version has modules students cannot all receive in
		// adaptive practice, so it may only be scheduled as a classroom session.
		plan, err := satpublish.LoadPlan(ctx, q, versionID)
		if err != nil {
			return err
		}
		for key := range plan {
			if AllowsSection(scope, key) {
				return apperrors.New(apperrors.CodeValidation, "This exam version has a classroom module plan; schedule it as a Classroom session.")
			}
		}
		return nil
	}
	if !classroomCreationEnabled.Load() {
		return apperrors.New(apperrors.CodeSATClassroomDisabled, "SAT Classroom sessions are not enabled yet.")
	}
	if providerKey != "sat" {
		return apperrors.New(apperrors.CodeValidation, "Classroom mode applies to SAT sessions only.")
	}
	policy := session.Route
	if policy == SATRouteStaffSelects {
		// A plan-shaped section fixes its branch, so there is no staff choice to
		// wait for; the session would route the student without a staff decision.
		plan, err := satpublish.LoadPlan(ctx, q, versionID)
		if err != nil {
			return err
		}
		for key := range plan {
			if AllowsSection(scope, key) {
				return apperrors.New(apperrors.CodeValidation, "The classroom module plan fixes Module 2 for section "+key+"; staff cannot select it.")
			}
		}
		_, err = q.ExecContext(ctx, "UPDATE exam_schedules SET sat_session_mode = 'classroom', sat_route_policy = ? WHERE id = ?", string(policy), scheduleID)
		return err
	}
	if policy != SATRouteForceLower && policy != SATRouteForceHigher {
		_, err := q.ExecContext(ctx, "UPDATE exam_schedules SET sat_session_mode = 'classroom' WHERE id = ?", scheduleID)
		return err
	}
	plan, err := satpublish.LoadPlan(ctx, q, versionID)
	if err != nil {
		return err
	}
	rows, err := q.QueryContext(ctx,
		"SELECT s.section_key, COUNT(eq.id) FROM assessment_sections s JOIN assessment_modules m ON m.section_id = s.id AND m.adaptive_role = ? LEFT JOIN assessment_exam_questions eq ON eq.module_id = m.id WHERE s.exam_version_id = ? GROUP BY s.id, s.section_key",
		policy.Branch(), versionID)
	if err != nil {
		return err
	}
	defer rows.Close()
	checked := 0
	for rows.Next() {
		var key string
		var questions int
		if err := rows.Scan(&key, &questions); err != nil {
			return err
		}
		if !AllowsSection(scope, key) {
			continue
		}
		checked++
		if !plan.Uses(key, policy.Branch()) {
			return apperrors.New(apperrors.CodeValidation, "The forced Module 2 route conflicts with the classroom module plan for section "+key+".")
		}
		if questions == 0 {
			return apperrors.New(apperrors.CodeValidation, "The forced Module 2 branch has no questions in section "+key+".")
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if checked == 0 {
		return apperrors.New(apperrors.CodeValidation, "The exam version has no adaptive sections for the forced route.")
	}
	_, err = q.ExecContext(ctx, "UPDATE exam_schedules SET sat_session_mode = 'classroom', sat_route_policy = ? WHERE id = ?", string(policy), scheduleID)
	return err
}

// AttemptSATRoutePolicy reads the session policy for an attempt. Missing rows
// (no schedule) are adaptive, the pre-classroom behavior.
func AttemptSATRoutePolicy(ctx context.Context, q RowQueryer, attemptID string) (SATRoutePolicy, error) {
	var raw string
	err := q.QueryRowContext(ctx,
		"SELECT COALESCE(sch.sat_route_policy, 'adaptive') FROM student_attempts sa JOIN exam_schedules sch ON sch.id = sa.schedule_id WHERE sa.id = ?",
		attemptID).Scan(&raw)
	if err == sql.ErrNoRows {
		return SATRouteAdaptive, nil
	}
	if err != nil {
		return "", err
	}
	return ParseSATRoutePolicy(raw)
}

// SATSessionForLink reads the classroom configuration of the schedule behind
// an access link (used when a link is duplicated).
func SATSessionForLink(ctx context.Context, q RowQueryer, linkID string) (SATSession, error) {
	var mode, route string
	err := q.QueryRowContext(ctx,
		"SELECT COALESCE(sch.sat_session_mode, 'practice'), COALESCE(sch.sat_route_policy, 'adaptive') FROM assessment_access_links l JOIN exam_schedules sch ON sch.id = l.schedule_id WHERE l.id = ?",
		linkID).Scan(&mode, &route)
	if err == sql.ErrNoRows {
		return SATSession{}, nil
	}
	if err != nil {
		return SATSession{}, err
	}
	return ParseSATSession(mode, route)
}
