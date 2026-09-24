// Package schedules owns thin explicit-SQL schedule CRUD, runtime reads,
// revision-fenced runtime commands, and registrations.
//
// It mirrors backend/crates/application/src/scheduling.rs: create/list/get/
// update/delete schedules, get_runtime, apply_runtime_command
// (start/pause/resume/complete with revision fencing), and
// create_student_registration (wcode + email validation, idempotent
// same-user replay, cross-user conflict).
//
// Schedule attempt creation sets protocol_version=2 for new attempts (V1
// retirement stage 1): V1 mutation writes drain but no new V1 attempt rows
// are minted here.
package schedules

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// Schedule statuses.
const (
	StatusScheduled = "scheduled"
	StatusLive      = "live"
	StatusCompleted = "completed"
	StatusCancelled = "cancelled"
)

// Runtime statuses.
const (
	RuntimeNotStarted = "not_started"
	RuntimeLive       = "live"
	RuntimePaused     = "paused"
	RuntimeCompleted  = "completed"
	RuntimeCancelled  = "cancelled"
)

// Runtime commands.
const (
	CommandStart    = "start"
	CommandPause    = "pause"
	CommandResume   = "resume"
	CommandComplete = "complete"
)

// normalizeRuntimeCommandAction accepts the public runtime command aliases
// used by the existing frontend while keeping the service-level vocabulary
// compact. The aliases remain important during the Rust-to-Go API drain.
func normalizeRuntimeCommandAction(action string) string {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case CommandStart, "start_runtime":
		return CommandStart
	case CommandPause, "pause_runtime":
		return CommandPause
	case CommandResume, "resume_runtime":
		return CommandResume
	case CommandComplete, "complete_runtime":
		return CommandComplete
	default:
		return strings.TrimSpace(action)
	}
}

// ValidateRuntimeCommandAction normalizes + validates a runtime command
// action WITHOUT touching the DB (round 57: fail-fast envelope). The
// handler calls this before authz + schedule Get so an unknown action
// 400s without burning a read; ApplyRuntimeCommand reuses it so the
// single switch stays the vocabulary authority.
func ValidateRuntimeCommandAction(action string) (string, error) {
	normalized := normalizeRuntimeCommandAction(action)
	switch normalized {
	case CommandStart, CommandPause, CommandResume, CommandComplete:
		return normalized, nil
	default:
		return "", validationError(fmt.Sprintf("Unknown runtime command %q.", strings.TrimSpace(action)))
	}
}

// ProtocolVersionV2 is the only version minted for new attempts (V1
// retirement stage 1; see plan 124 and migration 0049).
const ProtocolVersionV2 = 2

// Service wires schedule transitions explicitly.
type Service struct {
	db      *sql.DB
	runner  *tx.Runner
	runtime *examruntime.Service
}

// NewService wires dependencies explicitly.
func NewService(db *sql.DB, runner *tx.Runner) *Service {
	return &Service{db: db, runner: runner, runtime: examruntime.NewService(runner, nil)}
}

// Schedule is the exam_schedules row projection.
type Schedule struct {
	ID                     string     `json:"id"`
	ExamID                 string     `json:"examId"`
	ProviderKey            string     `json:"providerKey"`
	SatTimingModel         *string    `json:"satTimingModel,omitempty"`
	OrganizationID         *string    `json:"organizationId,omitempty"`
	ExamTitle              string     `json:"examTitle"`
	ProctorDisplayName     string     `json:"proctorDisplayName"`
	GradingDisplayName     string     `json:"gradingDisplayName"`
	PublishedVersionID     string     `json:"publishedVersionId"`
	CohortName             string     `json:"cohortName"`
	Institution            *string    `json:"institution,omitempty"`
	StartTime              time.Time  `json:"startTime"`
	EndTime                time.Time  `json:"endTime"`
	PlannedDurationMinutes int        `json:"plannedDurationMinutes"`
	DeliveryMode           string     `json:"deliveryMode"`
	RecurrenceType         string     `json:"recurrenceType"`
	RecurrenceInterval     int        `json:"recurrenceInterval"`
	RecurrenceEndDate      *time.Time `json:"recurrenceEndDate"`
	BufferBeforeMinutes    *int       `json:"bufferBeforeMinutes"`
	BufferAfterMinutes     *int       `json:"bufferAfterMinutes"`
	AutoStart              bool       `json:"autoStart"`
	AutoStop               bool       `json:"autoStop"`
	CreatedAt              time.Time  `json:"createdAt"`
	CreatedBy              string     `json:"createdBy"`
	UpdatedAt              time.Time  `json:"updatedAt"`
	Status                 string     `json:"status"`
	Revision               int        `json:"revision"`
}

// CreateRequest mirrors CreateScheduleRequest.
type CreateRequest struct {
	ExamID             string
	PublishedVersionID string
	CohortName         string
	ProctorDisplayName string
	GradingDisplayName string
	Institution        *string
	StartTime          time.Time
	EndTime            time.Time
	AutoStart          bool
	AutoStop           bool
	CreatedBy          string
}

// UpdateRequest mirrors UpdateScheduleRequest with revision fencing.
type UpdateRequest struct {
	PublishedVersionID *string
	CohortName         *string
	ProctorDisplayName *string
	GradingDisplayName *string
	Institution        *string
	StartTime          *time.Time
	EndTime            *time.Time
	AutoStart          *bool
	AutoStop           *bool
	Status             *string
	Revision           int
}

// RuntimeCommand mirrors RuntimeCommandRequest + revision fencing.
type RuntimeCommand struct {
	Action                  string
	Reason                  *string
	ExpectedRuntimeRevision *int64
	ExpectedSectionKey      *string
	ActorID                 string
}

// Runtime is the exam_session_runtimes header projection.
type Runtime struct {
	ID               string  `json:"id"`
	ScheduleID       string  `json:"scheduleId"`
	ExamID           string  `json:"examId"`
	ProviderKey      string  `json:"providerKey"`
	Status           string  `json:"status"`
	ActiveSectionKey *string `json:"activeSectionKey,omitempty"`
	Revision         int64   `json:"revision"`
}

// Registration is the schedule_registrations row projection.
type Registration struct {
	ID          string  `json:"id"`
	ScheduleID  string  `json:"scheduleId"`
	Wcode       string  `json:"wcode"`
	StudentKey  string  `json:"studentKey"`
	StudentName string  `json:"studentName"`
	Email       *string `json:"email,omitempty"`
	AccessState string  `json:"accessState"`
	Revision    int     `json:"revision"`
}

// AttemptRef is the created schedule-attempt reference.
type AttemptRef struct {
	AttemptID       string `json:"attemptId"`
	ScheduleID      string `json:"scheduleId"`
	ProtocolVersion int    `json:"protocolVersion"`
}

// RegistrationRequest mirrors the schedule registration handler payload.
type RegistrationRequest struct {
	Wcode       string
	Email       string
	StudentName string
	Nickname    *string
	IELTSCourse *string
	UserID      string
}

func validationError(msg string) *apperrors.Error {
	return apperrors.New(apperrors.CodeValidation, msg)
}

func notFoundError(msg string) *apperrors.Error {
	return apperrors.New(apperrors.CodeNotFound, msg)
}

func conflictError(msg string) *apperrors.Error {
	return apperrors.New(apperrors.CodeConflict, msg)
}

const scheduleColumns = "id, exam_id, provider_key, organization_id, exam_title, COALESCE(proctor_display_name, exam_title), COALESCE(grading_display_name, exam_title), published_version_id, cohort_name, institution, start_time, end_time, planned_duration_minutes, delivery_mode, status, revision, recurrence_type, recurrence_interval, recurrence_end_date, buffer_before_minutes, buffer_after_minutes, auto_start, auto_stop, created_at, created_by, updated_at, sat_timing_model"

func scanSchedule(row interface {
	Scan(dest ...any) error
}) (Schedule, error) {
	var s Schedule
	var orgID, institution, timingModel sql.NullString
	if err := row.Scan(&s.ID, &s.ExamID, &s.ProviderKey, &orgID, &s.ExamTitle, &s.ProctorDisplayName, &s.GradingDisplayName, &s.PublishedVersionID, &s.CohortName, &institution, &s.StartTime, &s.EndTime, &s.PlannedDurationMinutes, &s.DeliveryMode, &s.Status, &s.Revision, &s.RecurrenceType, &s.RecurrenceInterval, &s.RecurrenceEndDate, &s.BufferBeforeMinutes, &s.BufferAfterMinutes, &s.AutoStart, &s.AutoStop, &s.CreatedAt, &s.CreatedBy, &s.UpdatedAt, &timingModel); err != nil {
		return Schedule{}, err
	}
	if orgID.Valid {
		v := orgID.String
		s.OrganizationID = &v
	}
	if institution.Valid {
		v := institution.String
		s.Institution = &v
	}
	// scanSchedule is the single projection reader, so the stored timing choice
	// rides along on every Get/List (and on the Create/Update echo) instead of
	// only on the Create path that set it explicitly.
	if timingModel.Valid && strings.TrimSpace(timingModel.String) != "" {
		v := timingModel.String
		s.SatTimingModel = &v
	}
	return s, nil
}

// satTimingChoiceForSchedule reads the stored timing choice for one schedule.
// NULL means the deployed model (old rows). Query failures propagate; timing
// selection must not silently fall back when the database cannot be read.
func satTimingChoiceForSchedule(ctx context.Context, q planQuerier, scheduleID string) (string, error) {
	var raw sql.NullString
	if err := q.QueryRowContext(ctx, "SELECT sat_timing_model FROM exam_schedules WHERE id = ?", scheduleID).Scan(&raw); err != nil {
		return "", err
	}
	if !raw.Valid {
		return "", nil
	}
	return raw.String, nil
}

// satPersonalTimingEnv is the rollout switch for the personal (full-entry-time)
// timing model. It is default-on with an explicit off switch: the choice is
// stored per schedule in exam_schedules.sat_timing_model, so turning it off
// stops new schedules from opting in without rewriting any live session.
const satPersonalTimingEnv = "SAT_PERSONAL_TIMING"

// satPersonalTimingEnabled reports whether newly created SAT schedules opt into
// sat_personal_v1. A variable so tests can pin both sides of the rollout.
var satPersonalTimingEnabled = func() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(satPersonalTimingEnv))) {
	case "0", "false", "off", "no":
		return false
	default:
		return true
	}
}

// persistSatTimingChoice stores sat_personal_v1 for newly created SAT
// schedules. Null (no choice) keeps the deployed cohort model for old rows, and
// an off switch (or a non-SAT provider) leaves the choice null.
func persistSatTimingChoice(ctx context.Context, q tx.Tx, scheduleID, providerKey string) error {
	if !strings.EqualFold(strings.TrimSpace(providerKey), "sat") {
		return nil
	}
	if !satPersonalTimingEnabled() {
		return nil
	}
	_, err := q.ExecContext(ctx, "UPDATE exam_schedules SET sat_timing_model = ? WHERE id = ?", examruntime.TimingModelPersonal, scheduleID)
	return err
}

// List returns schedules ordered by start time (mirrors list_schedules).
func (s *Service) List(ctx context.Context) ([]Schedule, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT "+scheduleColumns+" FROM exam_schedules ORDER BY start_time ASC, created_at DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Schedule
	for rows.Next() {
		sch, err := scanSchedule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, sch)
	}
	return out, rows.Err()
}

// Create inserts a schedule row after validating the exam/version linkage
// (mirrors create_schedule_in_transaction: version must belong to exam).
// ValidateCreateRequest checks the schedule-create envelope WITHOUT
// touching the DB (round 59: fail-fast series). Create reuses it so the
// single gate stays authoritative; callers needing pre-tx validation
// (handlers) use it directly.
func ValidateCreateRequest(req CreateRequest) error {
	if strings.TrimSpace(req.ExamID) == "" {
		return validationError("Exam id is required.")
	}
	if strings.TrimSpace(req.PublishedVersionID) == "" {
		return validationError("Published version id is required.")
	}
	if strings.TrimSpace(req.CohortName) == "" {
		return validationError("Cohort name is required.")
	}
	if !req.EndTime.After(req.StartTime) {
		return validationError("Schedule end time must be after start time.")
	}
	return nil
}

func (s *Service) Create(ctx context.Context, req CreateRequest) (Schedule, error) {
	if err := ValidateCreateRequest(req); err != nil {
		return Schedule{}, err
	}
	id := uuid.NewString()
	var created Schedule
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		// SELECT ... FOR UPDATE on exam_entities locks the exam owner first.
		var title, providerKey string
		var orgID sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT title, provider_key, organization_id FROM exam_entities WHERE id = ? FOR UPDATE", req.ExamID).Scan(&title, &providerKey, &orgID); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Exam not found.")
			}
			return err
		}
		// SELECT ... FOR UPDATE on exam_versions locks the pinned version.
		var versionExamID string
		if err := q.QueryRowContext(ctx, "SELECT exam_id FROM exam_versions WHERE id = ? FOR UPDATE", req.PublishedVersionID).Scan(&versionExamID); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Exam version not found.")
			}
			return err
		}
		if versionExamID != req.ExamID {
			return validationError("Published version does not belong to the requested exam.")
		}
		planned := int(req.EndTime.Sub(req.StartTime).Minutes())
		if planned < 1 {
			planned = 1
		}
		proctorName := strings.TrimSpace(req.ProctorDisplayName)
		if proctorName == "" {
			proctorName = title
		}
		gradingName := strings.TrimSpace(req.GradingDisplayName)
		if gradingName == "" {
			gradingName = title
		}
		if _, err := q.ExecContext(ctx, "INSERT INTO exam_schedules (id, exam_id, provider_key, organization_id, exam_title, proctor_display_name, grading_display_name, published_version_id, cohort_name, institution, start_time, end_time, planned_duration_minutes, delivery_mode, recurrence_type, recurrence_interval, auto_start, auto_stop, status, created_at, created_by, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proctor_start', 'none', 1, ?, ?, 'scheduled', NOW(), ?, NOW(), 0)", id, req.ExamID, providerKey, nullableString(orgID), title, proctorName, gradingName, req.PublishedVersionID, strings.TrimSpace(req.CohortName), nullableStrPtr(req.Institution), req.StartTime, req.EndTime, planned, req.AutoStart, req.AutoStop, req.CreatedBy); err != nil {
			return err
		}
		// New SAT schedules select the attempt-owned timing model. Old rows
		// (NULL) keep the deployed cohort model; never rewrite in flight.
		if err := persistSatTimingChoice(ctx, q, id, providerKey); err != nil {
			return err
		}
		// scanSchedule is the single projection reader, so the timing choice just
		// persisted rides along on the created row without a second read.
		sch, err := scanSchedule(q.QueryRowContext(ctx, "SELECT "+scheduleColumns+" FROM exam_schedules WHERE id = ?", id))
		if err != nil {
			return err
		}
		created = sch
		return nil
	})
	return created, err
}

// Get loads one schedule or returns NOT_FOUND.
func (s *Service) Get(ctx context.Context, id string) (Schedule, error) {
	sch, err := scanSchedule(s.db.QueryRowContext(ctx, "SELECT "+scheduleColumns+" FROM exam_schedules WHERE id = ?", id))
	if err != nil {
		if err == sql.ErrNoRows {
			return Schedule{}, notFoundError("Schedule not found.")
		}
		return Schedule{}, err
	}
	return sch, nil
}

// ValidateUpdateWindow checks an explicit start/end pair WITHOUT touching
// the DB (round 62: fail-fast series). Both-nil means "keep existing"
// and always passes here; the merged-window check inside the tx stays
// authoritative (it sees the stored row). Handlers call this post-decode
// so an inverted explicit window 400s before any read.
func ValidateUpdateWindow(start, end *time.Time) error {
	if start != nil && end != nil && !end.After(*start) {
		return validationError("Schedule end time must be after start time.")
	}
	return nil
}

// Update applies schedule edits with revision fencing (mirrors
// update_schedule; stale revision is a CONFLICT; version changes on
// non-scheduled sessions are rejected).
func (s *Service) Update(ctx context.Context, id string, req UpdateRequest) (Schedule, error) {
	if err := ValidateUpdateWindow(req.StartTime, req.EndTime); err != nil {
		return Schedule{}, err
	}
	var updated Schedule
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		// SELECT ... FOR UPDATE on exam_schedules serializes editors.
		existing, err := scanSchedule(q.QueryRowContext(ctx, "SELECT "+scheduleColumns+" FROM exam_schedules WHERE id = ? FOR UPDATE", id))
		if err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Schedule not found.")
			}
			return err
		}
		if existing.Revision != req.Revision {
			return conflictError("Schedule has been modified by another user.")
		}
		if req.PublishedVersionID != nil && *req.PublishedVersionID != existing.PublishedVersionID && existing.Status != StatusScheduled {
			return validationError("Cannot change published version for a non-scheduled session.")
		}
		if req.PublishedVersionID != nil && *req.PublishedVersionID != existing.PublishedVersionID {
			var versionExamID string
			if err := q.QueryRowContext(ctx, "SELECT exam_id FROM exam_versions WHERE id = ?", *req.PublishedVersionID).Scan(&versionExamID); err != nil {
				if err == sql.ErrNoRows {
					return notFoundError("Exam version not found.")
				}
				return err
			}
			if versionExamID != existing.ExamID {
				return validationError("Published version does not belong to the schedule exam.")
			}
		}
		nextStart := existing.StartTime
		if req.StartTime != nil {
			nextStart = *req.StartTime
		}
		nextEnd := existing.EndTime
		if req.EndTime != nil {
			nextEnd = *req.EndTime
		}
		if !nextEnd.After(nextStart) {
			return validationError("Schedule end time must be after start time.")
		}
		res, err := q.ExecContext(ctx, "UPDATE exam_schedules SET published_version_id = COALESCE(?, published_version_id), proctor_display_name = COALESCE(?, proctor_display_name), grading_display_name = COALESCE(?, grading_display_name), cohort_name = COALESCE(?, cohort_name), institution = COALESCE(?, institution), start_time = COALESCE(?, start_time), end_time = COALESCE(?, end_time), auto_start = COALESCE(?, auto_start), auto_stop = COALESCE(?, auto_stop), status = COALESCE(?, status), updated_at = NOW(), revision = revision + 1 WHERE id = ? AND revision = ?", nullableStrPtr(req.PublishedVersionID), nullableStrPtr(req.ProctorDisplayName), nullableStrPtr(req.GradingDisplayName), nullableStrPtr(req.CohortName), nullableStrPtr(req.Institution), nullableTimePtr(req.StartTime), nullableTimePtr(req.EndTime), nullableBoolPtr(req.AutoStart), nullableBoolPtr(req.AutoStop), nullableStrPtr(req.Status), id, req.Revision)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return conflictError("Schedule has been modified by another user.")
		}
		sch, err := scanSchedule(q.QueryRowContext(ctx, "SELECT "+scheduleColumns+" FROM exam_schedules WHERE id = ?", id))
		if err != nil {
			return err
		}
		updated = sch
		return nil
	})
	return updated, err
}

// Delete removes a scheduled session (only pre-live sessions).
func (s *Service) Delete(ctx context.Context, id string) error {
	return s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		// SELECT ... FOR UPDATE serializes delete vs start.
		var status string
		if err := q.QueryRowContext(ctx, "SELECT status FROM exam_schedules WHERE id = ? FOR UPDATE", id).Scan(&status); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Schedule not found.")
			}
			return err
		}
		if status != StatusScheduled {
			return conflictError("Only scheduled sessions can be deleted.")
		}
		res, err := q.ExecContext(ctx, "DELETE FROM exam_schedules WHERE id = ?", id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return notFoundError("Schedule not found.")
		}
		return nil
	})
}

// GetRuntime loads the cohort runtime header for a schedule.
func (s *Service) GetRuntime(ctx context.Context, scheduleID string) (Runtime, error) {
	var r Runtime
	var active sql.NullString
	err := s.db.QueryRowContext(ctx, "SELECT id, schedule_id, exam_id, provider_key, status, active_section_key, revision FROM exam_session_runtimes WHERE schedule_id = ?", scheduleID).Scan(&r.ID, &r.ScheduleID, &r.ExamID, &r.ProviderKey, &r.Status, &active, &r.Revision)
	if err != nil {
		if err == sql.ErrNoRows {
			return Runtime{}, notFoundError("Runtime not found.")
		}
		return Runtime{}, err
	}
	if active.Valid {
		v := active.String
		r.ActiveSectionKey = &v
	}
	return r, nil
}

// ApplyRuntimeCommand applies start/pause/resume/complete with revision
// fencing (mirrors apply_runtime_command; stale expected revision is a 409
// "Runtime changed; refresh before retrying."). Lock order everywhere:
// schedule row (when the command writes it: start/complete) -> schedule
// attempt rows -> runtime row -> section rows. Check-in takes the schedule row
// first too, so the two can only ever queue behind each other, never cycle.
func (s *Service) ApplyRuntimeCommand(ctx context.Context, scheduleID string, cmd RuntimeCommand) (Runtime, error) {
	normalized, err := ValidateRuntimeCommandAction(cmd.Action)
	if err != nil {
		return Runtime{}, err
	}
	cmd.Action = normalized
	cmd.ActorID = strings.TrimSpace(cmd.ActorID)
	if cmd.ActorID == "" {
		cmd.ActorID = "system"
	}

	// Existence gate only: nothing below plans from this read. Start derives
	// its plan from the schedule row it locks inside its own transaction.
	if _, err := s.Get(ctx, scheduleID); err != nil {
		return Runtime{}, err
	}
	fence := examruntime.RevisionFence{
		ExpectedRuntimeRevision:  cmd.ExpectedRuntimeRevision,
		ExpectedActiveSectionKey: cmd.ExpectedSectionKey,
	}
	switch cmd.Action {
	case CommandStart:
		if _, err := s.runtime.Start(ctx, scheduleID, cmd.ActorID, s.startPlanner()); err != nil {
			return Runtime{}, err
		}
	case CommandPause:
		if err := s.runtime.Pause(ctx, scheduleID, fence, cmd.Reason, cmd.ActorID); err != nil {
			return Runtime{}, err
		}
	case CommandResume:
		if err := s.runtime.Resume(ctx, scheduleID, fence, cmd.ActorID); err != nil {
			return Runtime{}, err
		}
	case CommandComplete:
		if err := s.runtime.Complete(ctx, scheduleID, valueOrDefault(cmd.Reason, "proctor_complete"), cmd.ActorID); err != nil {
			return Runtime{}, err
		}
	}
	return s.GetRuntime(ctx, scheduleID)
}

// startPlanner derives the cohort clock plan INSIDE runtime.Start's
// transaction, from the schedule row Start locked, through Start's own tx
// handle. Planning from any other read — the pre-transaction Get this command
// used to plan from — let a concurrent version switch commit between the read
// and the live transition, so the runtime's section/timing topology described
// one version while the schedule (and every attempt minted after it) named
// another.
func (s *Service) startPlanner() examruntime.StartPlanner {
	return func(ctx context.Context, q tx.Tx, sch examruntime.StartSchedule) ([]examruntime.PlanEntry, string, error) {
		return runtimePlanIn(ctx, q, Schedule{
			ID:                     sch.ID,
			ProviderKey:            sch.ProviderKey,
			SatTimingModel:         optionalScheduleModel(sch.SatTimingModel),
			PublishedVersionID:     sch.PublishedVersionID,
			PlannedDurationMinutes: sch.PlannedDurationMinutes,
		})
	}
}

// planQuerier is the read surface plan derivation needs. Both *sql.DB and
// tx.Tx satisfy it, so the same derivation can run inside a caller's
// transaction (Start) or against the pool.
type planQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// runtimePlanIn derives the persisted cohort clock plan from the pinned
// published version, reading through q. Disabled config sections are omitted
// so a proctor start cannot create clocks for a section the author turned off.
// Adaptive section lengths come from the version's modules
// (candidateSectionSecondsByKey), not from the stored section row alone.
//
// The plan is then intersected with the backing Student Access link's section
// scope (when the schedule has one): a link may only NARROW the run, never
// re-enable a section the version disabled. Intersecting rather than replacing
// is what keeps the two levels of section on/off composable — the link toggle
// and config_snapshot.sections[key].enabled are ANDed, not merged.
func runtimePlanIn(ctx context.Context, q planQuerier, sch Schedule) ([]examruntime.PlanEntry, string, error) {
	var configRaw sql.NullString
	var publishedScopeRaw sql.NullString
	var examType string
	if err := q.QueryRowContext(ctx, "SELECT CAST(v.config_snapshot AS CHAR), e.exam_type, v.sat_publish_scope FROM exam_versions v JOIN exam_entities e ON e.id = v.exam_id WHERE v.id = ?", sch.PublishedVersionID).Scan(&configRaw, &examType, &publishedScopeRaw); err != nil {
		if err == sql.ErrNoRows {
			return nil, "", notFoundError("Published exam version not found.")
		}
		return nil, "", err
	}
	// Legacy ACT rows carry provider_key='ielts' with exam_type='ACT'; the
	// effective provider heals that mismatch so science survives planning.
	effectiveProvider := examdomain.EffectiveProviderKey(sch.ProviderKey, examType)
	linkSections, err := linkEnabledSections(ctx, q, sch.ID)
	if err != nil {
		return nil, "", err
	}
	releaseSections := examdomain.ParseSATPublishScope(publishedScopeRaw.String)
	effectiveSections := examdomain.IntersectSectionScopes(releaseSections, linkSections)
	enabled := configuredRuntimeSections(configRaw.String)
	// A candidate sits Module 1 plus exactly ONE adaptive branch, so an adaptive
	// section's clock is base + the LONGER branch — never the sum of every
	// authored module. assessment_sections.duration_seconds can still hold the
	// pre-CandidateSectionSeconds overstatement (0065 repaired the rows, but a
	// version published before it, or any future write path that forgets the
	// rule, would leak the inflated value straight into the student's countdown),
	// so the plan derives the candidate length itself whenever the section has
	// adaptive roles. Non-adaptive sections (IELTS/ACT) have none and keep their
	// authored duration.
	candidateSeconds, err := candidateSectionSecondsByKey(ctx, q, sch.PublishedVersionID)
	if err != nil {
		return nil, "", err
	}
	rows, err := q.QueryContext(ctx, "SELECT section_key, title, display_order, duration_seconds, break_after_seconds FROM assessment_sections WHERE exam_version_id = ? ORDER BY display_order, id", sch.PublishedVersionID)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	plan := make([]examruntime.PlanEntry, 0)
	for rows.Next() {
		var key, label string
		var order, durationSeconds, gapSeconds int
		if err := rows.Scan(&key, &label, &order, &durationSeconds, &gapSeconds); err != nil {
			return nil, "", err
		}
		if !examdomain.ValidSectionKey(effectiveProvider, key) || (enabled != nil && !enabled[key]) || !examdomain.AllowsSection(effectiveSections, key) {
			continue
		}
		if candidate, ok := candidateSeconds[key]; ok {
			durationSeconds = candidate
		}
		plan = append(plan, examruntime.PlanEntry{
			SectionKey:      key,
			Label:           strings.TrimSpace(label),
			Order:           order,
			DurationMinutes: ceilMinutes(durationSeconds),
			GapAfterMinutes: ceilGapMinutes(gapSeconds),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	// The fallbacks are filtered too: an unusable config must not silently
	// hand a narrowed link back its dropped section.
	if len(plan) == 0 {
		plan = filterPlanBySections(configuredRuntimePlan(configRaw.String, effectiveProvider), effectiveSections)
	}
	if len(plan) == 0 {
		plan = filterPlanBySections(fallbackRuntimePlan(effectiveProvider, sch.PlannedDurationMinutes), effectiveSections)
	}
	if len(plan) > 0 && effectiveProvider == examdomain.ProviderSAT {
		// The final delivered section has no cross-section break after it.
		plan[len(plan)-1].GapAfterMinutes = 0
	}
	// Timing model: the stored schedule choice wins; NULL keeps the deployed
	// model (cohort_section_v3 for SAT, legacy otherwise). Never reinterpret
	// an in-progress attempt's model here — this runs only at Start.
	choice := ""
	if sch.SatTimingModel != nil {
		choice = *sch.SatTimingModel
	}
	timingModel := examruntime.ResolveTimingModel(sch.ProviderKey, choice)
	// Legacy fallback: when the schedule has no stored choice, preserve the
	// historical provider default explicitly.
	if choice == "" {
		timingModel = examruntime.TimingModelLegacy
		if strings.EqualFold(sch.ProviderKey, examdomain.ProviderSAT) {
			timingModel = examruntime.TimingModelCohortSection
		}
	}
	return plan, timingModel, nil
}

func optionalScheduleModel(model string) *string {
	if model == "" {
		return nil
	}
	return &model
}

// candidateSectionSecondsByKey reads the candidate-facing length of every
// adaptive section in one version. The read stays role-agnostic: every authored
// module row is folded through exams.AdaptiveRoleSeconds, which owns the role
// vocabulary (matched with the collation semantics the SQL read relied on), the
// duplicate-role rule (largest wins) and the guard (a base and at least one
// branch prove a length). Section keys are preserved verbatim, exactly as the
// SQL read did — runtimePlanIn validates the raw key against the provider
// allowlist, so only a blank key is skipped here. A section the owner rejects is
// absent from the map and keeps the authored assessment_sections duration,
// because an incomplete shape cannot prove a candidate length and the authored
// value is what the author saw.
func candidateSectionSecondsByKey(ctx context.Context, q planQuerier, versionID string) (map[string]int, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT s.section_key, m.adaptive_role, m.duration_seconds
		FROM assessment_modules m
		JOIN assessment_sections s ON s.id = m.section_id
		WHERE s.exam_version_id = ?`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	clocks := map[string]*examdomain.AdaptiveRoleSeconds{}
	for rows.Next() {
		var key, role string
		var seconds int
		if err := rows.Scan(&key, &role, &seconds); err != nil {
			return nil, err
		}
		if strings.TrimSpace(key) == "" {
			continue
		}
		clock := clocks[key]
		if clock == nil {
			clock = &examdomain.AdaptiveRoleSeconds{}
			clocks[key] = clock
		}
		clock.AddModule(role, seconds)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// exams owns the guard and the arithmetic: the section proves a candidate
	// length only with a base and a branch, and then it is base + the LONGER
	// branch — never the sum of every authored module.
	out := map[string]int{}
	for key, clock := range clocks {
		if seconds, ok := clock.CandidateSeconds(); ok {
			out[key] = seconds
		}
	}
	return out, nil
}

// linkEnabledSections reads the section scope of the Student Access link
// backing the schedule (assessment_access_links_schedule_unique makes this a
// single indexed get). A schedule with no link — every admin-created schedule —
// returns nil, meaning "no narrowing". The stored shape, its fail-open read,
// and the section vocabulary are owned by internal/exams.
func linkEnabledSections(ctx context.Context, q planQuerier, scheduleID string) (map[string]bool, error) {
	if strings.TrimSpace(scheduleID) == "" {
		return nil, nil
	}
	var raw sql.NullString
	err := q.QueryRowContext(ctx,
		"SELECT enabled_sections FROM assessment_access_links WHERE schedule_id = ?", scheduleID).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return examdomain.ParseStoredSectionScope(raw.String), nil
}

// filterPlanBySections narrows an already-built plan to a link scope, keeping
// the plan's own order. Section order is left untouched: gaps are harmless
// (every consumer orders by section_order) and renumbering would rewrite the
// authored display order of a plan that was not narrowed at all.
func filterPlanBySections(plan []examruntime.PlanEntry, allowed map[string]bool) []examruntime.PlanEntry {
	if allowed == nil {
		return plan
	}
	filtered := make([]examruntime.PlanEntry, 0, len(plan))
	for _, entry := range plan {
		if allowed[entry.SectionKey] {
			filtered = append(filtered, entry)
		}
	}
	return filtered
}

func configuredRuntimePlan(raw, providerKey string) []examruntime.PlanEntry {
	var root map[string]any
	if strings.TrimSpace(raw) == "" || json.Unmarshal([]byte(raw), &root) != nil {
		return nil
	}
	sections, ok := root["sections"].(map[string]any)
	if !ok {
		return nil
	}
	plan := make([]examruntime.PlanEntry, 0, len(sections))
	for key, rawSection := range sections {
		if !examdomain.ValidSectionKey(providerKey, key) {
			continue
		}
		section, ok := rawSection.(map[string]any)
		if !ok {
			continue
		}
		if enabled, hasEnabled := section["enabled"].(bool); hasEnabled && !enabled {
			continue
		}
		label, _ := section["label"].(string)
		duration := jsonNumberInt(section["duration"])
		gap := jsonNumberInt(section["gapAfterMinutes"])
		order := jsonNumberInt(section["order"])
		if duration <= 0 {
			duration = 1
		}
		if gap < 0 {
			gap = 0
		}
		plan = append(plan, examruntime.PlanEntry{
			SectionKey:      key,
			Label:           strings.TrimSpace(label),
			Order:           order,
			DurationMinutes: duration,
			GapAfterMinutes: gap,
		})
	}
	sort.SliceStable(plan, func(i, j int) bool {
		if plan[i].Order == plan[j].Order {
			return plan[i].SectionKey < plan[j].SectionKey
		}
		return plan[i].Order < plan[j].Order
	})
	return plan
}

func jsonNumberInt(value any) int {
	switch number := value.(type) {
	case float64:
		return int(number)
	case int:
		return number
	case json.Number:
		parsed, _ := number.Int64()
		return int(parsed)
	default:
		return 0
	}
}

func configuredRuntimeSections(raw string) map[string]bool {
	var root map[string]any
	if strings.TrimSpace(raw) == "" || json.Unmarshal([]byte(raw), &root) != nil {
		return nil
	}
	sections, ok := root["sections"].(map[string]any)
	if !ok {
		return nil
	}
	enabled := make(map[string]bool, len(sections))
	for key, rawSection := range sections {
		section, ok := rawSection.(map[string]any)
		if !ok {
			continue
		}
		isEnabled, hasEnabled := section["enabled"].(bool)
		enabled[key] = !hasEnabled || isEnabled
	}
	return enabled
}

func ceilMinutes(seconds int) int {
	if seconds <= 0 {
		return 1
	}
	return (seconds + 59) / 60
}

// ceilGapMinutes converts an authored break into whole minutes. Unlike a
// duration, a gap of zero is meaningful — it is the documented "advance
// immediately" case — so it must not inherit ceilMinutes' one-minute floor.
// With the floor, a section authored with no break (break_after_seconds = 0,
// the SAT Math default) persisted gap_after_minutes = 1 and the cohort sat in
// the between-sections window for an unearned minute.
func ceilGapMinutes(seconds int) int {
	if seconds <= 0 {
		return 0
	}
	return (seconds + 59) / 60
}

func fallbackRuntimePlan(providerKey string, plannedMinutes int) []examruntime.PlanEntry {
	duration := plannedMinutes
	if duration <= 0 {
		duration = 1
	}
	// Phase 02: ACT fallback is a single Science section (default 40
	// minutes per the Phase 01 contract). It must never fall back to the
	// IELTS reading entry: a Science-less ACT plan silently drops the only
	// scorable section. Callers always pass the effective provider, so
	// legacy ACT rows (provider_key='ielts', exam_type='ACT') land here.
	if strings.EqualFold(providerKey, examdomain.ProviderACT) {
		if duration <= 1 {
			duration = 40
		}
		return []examruntime.PlanEntry{{SectionKey: "science", Label: "Science", Order: 0, DurationMinutes: duration, GapAfterMinutes: 0}}
	}
	if strings.EqualFold(providerKey, examdomain.ProviderSAT) {
		first := duration / 2
		if first < 1 {
			first = 1
		}
		second := duration - first
		if second < 1 {
			second = 1
		}
		return []examruntime.PlanEntry{
			{SectionKey: "reading-writing", Label: "Reading and Writing", Order: 0, DurationMinutes: first, GapAfterMinutes: 0},
			{SectionKey: "math", Label: "Math", Order: 1, DurationMinutes: second, GapAfterMinutes: 0},
		}
	}
	return []examruntime.PlanEntry{{SectionKey: "reading", Label: "Exam", Order: 0, DurationMinutes: duration, GapAfterMinutes: 0}}
}

func valueOrDefault(value *string, fallback string) string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return fallback
	}
	return *value
}

// CreateRegistration inserts or idempotently replays a schedule registration
// (mirrors create_student_registration: wcode + email validation, same-user
// replay updates contact, cross-user wcode reuse is a CONFLICT).
// ValidateRegistrationRequest checks the registration envelope WITHOUT
// touching the DB (round 63: fail-fast series, entry-wave hot path).
// CreateRegistration reuses it so the single gate stays authoritative;
// the schedule existence/status gate necessarily stays inside the tx
// (locked read — check and write cannot race).
func ValidateRegistrationRequest(req RegistrationRequest) (string, error) {
	wcode := NormalizeAccessCode(req.Wcode)
	if err := ValidateWcode(wcode); err != nil {
		return "", err
	}
	if err := ValidateEmail(req.Email); err != nil {
		return "", err
	}
	if strings.TrimSpace(req.StudentName) == "" {
		return "", validationError("Student name is required.")
	}
	if strings.TrimSpace(req.UserID) == "" {
		return "", validationError("User id is required.")
	}
	return wcode, nil
}

func (s *Service) CreateRegistration(ctx context.Context, scheduleID string, req RegistrationRequest) (Registration, error) {
	wcode, err := ValidateRegistrationRequest(req)
	if err != nil {
		return Registration{}, err
	}
	// The existence/status gate lives inside the tx below (locked read), so the
	// schedule cannot be cancelled, completed, or deleted between check and write.
	var out Registration
	err2 := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		// Locked schedule gate first: rejects missing/cancelled/completed/deleted
		// rows inside the tx so the check cannot race the registration write.
		var schStatus, providerKey string
		var schEndTime time.Time
		var model sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT status, provider_key, end_time, sat_timing_model FROM exam_schedules WHERE id = ? FOR UPDATE", scheduleID).Scan(&schStatus, &providerKey, &schEndTime, &model); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Schedule not found.")
			}
			return err
		}
		switch schStatus {
		case StatusScheduled, StatusLive:
		default:
			return conflictError("Registration is closed for this schedule.")
		}
		if examruntime.IsSatPersonal(examruntime.ResolveTimingModel(providerKey, model.String)) {
			var dbNow time.Time
			if err := q.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&dbNow); err != nil {
				return err
			}
			if !dbNow.Before(schEndTime) {
				return conflictError("Admission is closed for this schedule.")
			}
		}
		// SELECT ... FOR UPDATE on the existing registration serializes replays.
		var id, studentKey, studentName, accessState string
		var email, actorID, userID sql.NullString
		var rev int
		err := q.QueryRowContext(ctx, "SELECT id, student_key, student_name, student_email, actor_id, user_id, access_state, revision FROM schedule_registrations WHERE schedule_id = ? AND wcode = ? FOR UPDATE", scheduleID, wcode).Scan(&id, &studentKey, &studentName, &email, &actorID, &userID, &accessState, &rev)
		switch {
		case err == nil:
			sameUser := (userID.Valid && userID.String == req.UserID) || (actorID.Valid && actorID.String == req.UserID)
			if !sameUser {
				return conflictError(fmt.Sprintf("Wcode %s is already registered for this schedule", wcode))
			}
			if strings.TrimSpace(studentName) != "" && studentName != strings.TrimSpace(req.StudentName) {
				return conflictError("Student name is locked for this registration.")
			}
			if email.Valid && strings.TrimSpace(email.String) != "" && !strings.EqualFold(strings.TrimSpace(email.String), strings.TrimSpace(req.Email)) {
				return conflictError("Email is locked for this registration.")
			}
			if _, err := q.ExecContext(ctx, "UPDATE schedule_registrations SET student_email = ?, student_name = ?, user_id = ?, actor_id = ?, access_state = CASE WHEN access_state = 'invited' THEN 'checked_in' ELSE access_state END, updated_at = NOW(), revision = revision + 1 WHERE id = ?", strings.TrimSpace(req.Email), strings.TrimSpace(req.StudentName), req.UserID, req.UserID, id); err != nil {
				return err
			}
			reg, err := loadRegistration(ctx, q, id)
			if err != nil {
				return err
			}
			out = reg
			return nil
		case err == sql.ErrNoRows:
			// fall through to insert
		default:
			return err
		}
		newID := uuid.NewString()
		key := fmt.Sprintf("student-%s-%s", scheduleID, wcode)
		meta := registrationMetadata(req.Nickname, req.IELTSCourse)
		if _, err := q.ExecContext(ctx, "INSERT INTO schedule_registrations (id, schedule_id, user_id, actor_id, wcode, student_key, student_id, student_name, student_email, metadata, access_state, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'checked_in', NOW(), NOW(), 0)", newID, scheduleID, req.UserID, req.UserID, wcode, key, wcode, strings.TrimSpace(req.StudentName), strings.TrimSpace(req.Email), meta); err != nil {
			if isDuplicateKey(err) {
				return conflictError(fmt.Sprintf("Wcode %s is already registered for this schedule", wcode))
			}
			return err
		}
		reg, err := loadRegistration(ctx, q, newID)
		if err != nil {
			return err
		}
		out = reg
		return nil
	})
	return out, err2
}

// CreateScheduleAttempt mints one attempt row for a registration with
// protocol_version=2 (V1 retirement stage 1: new rows never mint V1).
// LookupAttemptByRegistration is the plan-D3 unique-key-first fast path: one
// unlocked committed-read SELECT turns check-in retries (and pre-provisioned
// attempts minted ahead of exam day) into 1 SELECT instead of the full mint
// tx. found=false means the caller proceeds to CreateScheduleAttempt. The
// scheduleID equality check keeps a cross-schedule registration_id collision
// (should be impossible via UNIQUE, but fail-closed) from binding the wrong
// schedule.
func (s *Service) LookupAttemptByRegistration(ctx context.Context, scheduleID, registrationID string) (AttemptRef, bool, error) {
	if s.db == nil {
		return AttemptRef{}, false, nil
	}
	var ref AttemptRef
	var proto sql.NullInt64
	if err := s.db.QueryRowContext(ctx,
		"SELECT id, schedule_id, protocol_version FROM student_attempts WHERE registration_id = ?",
		registrationID).Scan(&ref.AttemptID, &ref.ScheduleID, &proto); err != nil {
		if err == sql.ErrNoRows {
			return AttemptRef{}, false, nil
		}
		return AttemptRef{}, false, err
	}
	if ref.ScheduleID != scheduleID {
		return AttemptRef{}, false, nil
	}
	if proto.Valid {
		ref.ProtocolVersion = int(proto.Int64)
	}
	return ref, true, nil
}

func (s *Service) CreateScheduleAttempt(ctx context.Context, scheduleID, registrationID, studentKey, candidateID, candidateName, candidateEmail, clientSessionID string) (AttemptRef, error) {
	attemptID := uuid.NewString()
	protocolVersion := ProtocolVersionV2
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		// Locked schedule read first: the attempt must snapshot a live schedule
		// row, and a concurrent delete/cancel must fail the mint, not orphan it.
		var sch Schedule
		sch, err := scanSchedule(q.QueryRowContext(ctx, "SELECT "+scheduleColumns+" FROM exam_schedules WHERE id = ? FOR UPDATE", scheduleID))
		if err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Schedule not found.")
			}
			return err
		}
		switch sch.Status {
		case StatusScheduled, StatusLive:
		default:
			return conflictError("Attempt creation is closed for this schedule.")
		}
		// SELECT ... FOR UPDATE on the registration serializes attempt minting.
		var regID, regWcode string
		var regUserID sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT id, wcode, user_id FROM schedule_registrations WHERE id = ? AND schedule_id = ? FOR UPDATE", registrationID, scheduleID).Scan(&regID, &regWcode, &regUserID); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Registration not found.")
			}
			return err
		}
		currentModule := "listening"
		switch sch.ProviderKey {
		case "sat":
			currentModule = "reading"
		case "act":
			currentModule = "science"
		}
		// Check-in is retried by browsers when navigation or the first session
		// response is delayed. The registration lock makes this replay-safe and
		// avoids a unique-key conflict turning a successful attempt into a 409.
		var existingProtocol sql.NullInt64
		if err := q.QueryRowContext(ctx, "SELECT id, protocol_version FROM student_attempts WHERE registration_id = ? FOR UPDATE", registrationID).Scan(&attemptID, &existingProtocol); err == nil {
			if existingProtocol.Valid {
				protocolVersion = int(existingProtocol.Int64)
			}
			telemetry.IncCounter(telemetry.MDupAttemptReplay)
			return nil
		} else if err != sql.ErrNoRows {
			return err
		}
		choice, err := satTimingChoiceForSchedule(ctx, q, scheduleID)
		if err != nil {
			return err
		}
		if examruntime.IsSatPersonal(examruntime.ResolveTimingModel(sch.ProviderKey, choice)) {
			var dbNow time.Time
			if err := q.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&dbNow); err != nil {
				return err
			}
			if !dbNow.Before(sch.EndTime) {
				return conflictError("Admission is closed for this schedule.")
			}
		}
		var userID any
		if regUserID.Valid {
			userID = regUserID.String
		}
		if _, err := q.ExecContext(ctx, "INSERT INTO student_attempts (id, schedule_id, registration_id, user_id, wcode, student_key, organization_id, exam_id, published_version_id, exam_title, candidate_id, candidate_name, candidate_email, phase, current_module, answers, writing_answers, flags, violations_snapshot, integrity, recovery, created_at, updated_at, revision, protocol_version, delivery_status, lease_epoch, control_epoch, response_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lobby', ?, '{}', '{}', '{}', '[]', '{}', ?, NOW(), NOW(), 0, ?, 'running', 1, 1, 0)", attemptID, scheduleID, regID, userID, regWcode, studentKey, nullableStrPtr(sch.OrganizationID), sch.ExamID, sch.PublishedVersionID, sch.ExamTitle, candidateID, candidateName, candidateEmail, currentModule, fmt.Sprintf("{\"clientSessionId\":%q}", clientSessionID), ProtocolVersionV2); err != nil {
			if isDuplicateKey(err) {
				return conflictError("Attempt already exists for this registration.")
			}
			if isForeignKeyViolation(err) {
				return conflictError("Schedule references a missing exam or version; republish the schedule.")
			}
			return err
		}
		// A runtime may have started before this candidate checked in. Project
		// the active section's deadline onto the new V2 attempt immediately so
		// its first response is governed by the same server clock as existing
		// candidates. Scoped to THIS attempt: the other candidates' clocks did
		// not change, and re-projecting them bumped their control_epoch, so a
		// late arrival made every writing student's next save
		// CONTROL_EPOCH_STALE.
		var runtimeID, activeSection string
		runtimeErr := q.QueryRowContext(ctx, "SELECT id, active_section_key FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE", scheduleID).Scan(&runtimeID, &activeSection)
		if runtimeErr != nil && runtimeErr != sql.ErrNoRows {
			return runtimeErr
		}
		if runtimeErr == nil && strings.TrimSpace(activeSection) != "" {
			running := "running"
			if err := examruntime.SyncV2TimingForAttemptInTx(ctx, q, scheduleID, runtimeID, activeSection, attemptID, &running); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return AttemptRef{}, err
	}
	return AttemptRef{AttemptID: attemptID, ScheduleID: scheduleID, ProtocolVersion: protocolVersion}, nil
}

// NormalizeAccessCode uppercases W+6-digit codes, else trims (mirrors
// domain normalize_access_code).
func NormalizeAccessCode(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if len(trimmed) == 7 {
		upper := strings.ToUpper(trimmed)
		if strings.HasPrefix(upper, "W") {
			digits := true
			for _, ch := range upper[1:] {
				if ch < '0' || ch > '9' {
					digits = false
					break
				}
			}
			if digits {
				return upper
			}
		}
	}
	return trimmed
}

// ValidateWcode requires a non-empty access code. Any format is accepted
// (legacy W123456 codes are uppercased by NormalizeAccessCode; free-form
// codes pass through trimmed).
func ValidateWcode(wcode string) error {
	if NormalizeAccessCode(wcode) == "" {
		return validationError("Access code is required.")
	}
	return nil
}

// ValidateEmail requires a non-empty plausibly-shaped email.
func ValidateEmail(email string) error {
	e := strings.TrimSpace(email)
	if e == "" || !strings.Contains(e, "@") || !strings.Contains(strings.SplitN(e, "@", 2)[1], ".") {
		return validationError("A valid email is required.")
	}
	return nil
}

func registrationMetadata(nickname, course *string) string {
	m := map[string]any{}
	if nickname != nil && strings.TrimSpace(*nickname) != "" {
		m["nickname"] = strings.TrimSpace(*nickname)
	}
	if course != nil && strings.TrimSpace(*course) != "" {
		m["ieltsCourse"] = strings.TrimSpace(*course)
	}
	b, _ := json.Marshal(m)
	return string(b)
}

func loadRegistration(ctx context.Context, q tx.Tx, id string) (Registration, error) {
	var r Registration
	var email sql.NullString
	if err := q.QueryRowContext(ctx, "SELECT id, schedule_id, wcode, student_key, student_name, student_email, access_state, revision FROM schedule_registrations WHERE id = ?", id).Scan(&r.ID, &r.ScheduleID, &r.Wcode, &r.StudentKey, &r.StudentName, &email, &r.AccessState, &r.Revision); err != nil {
		return Registration{}, err
	}
	if email.Valid {
		v := email.String
		r.Email = &v
	}
	return r, nil
}

func nullableString(n sql.NullString) any {
	if !n.Valid {
		return nil
	}
	return n.String
}

func nullableStrPtr(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

func nullableTimePtr(p *time.Time) any {
	if p == nil {
		return nil
	}
	return *p
}

func nullableBoolPtr(p *bool) any {
	if p == nil {
		return nil
	}
	return *p
}

func isDuplicateKey(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "duplicate") && (strings.Contains(s, "entry") || strings.Contains(s, "unique") || strings.Contains(s, "1062"))
}

// isForeignKeyViolation reports a MySQL 1452 (child-row FK) failure:
// the mint snapshotted a schedule pin (exam/version) whose parent row is
// gone. Callers map it to a 409 naming the pin, never a 500 INTERNAL.
// (Round 73: live rehearsal proved the raw driver error escaped WriteError
// as unknown→500 on a stale-shaped DB.)
func isForeignKeyViolation(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "1452") || (strings.Contains(s, "foreign key") && strings.Contains(s, "fails"))
}
