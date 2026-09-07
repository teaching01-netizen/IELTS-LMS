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
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
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

const scheduleColumns = "id, exam_id, provider_key, organization_id, exam_title, COALESCE(proctor_display_name, exam_title), COALESCE(grading_display_name, exam_title), published_version_id, cohort_name, institution, start_time, end_time, planned_duration_minutes, delivery_mode, status, revision, recurrence_type, recurrence_interval, recurrence_end_date, buffer_before_minutes, buffer_after_minutes, auto_start, auto_stop, created_at, created_by, updated_at"

func scanSchedule(row interface {
	Scan(dest ...any) error
}) (Schedule, error) {
	var s Schedule
	var orgID, institution sql.NullString
	if err := row.Scan(&s.ID, &s.ExamID, &s.ProviderKey, &orgID, &s.ExamTitle, &s.ProctorDisplayName, &s.GradingDisplayName, &s.PublishedVersionID, &s.CohortName, &institution, &s.StartTime, &s.EndTime, &s.PlannedDurationMinutes, &s.DeliveryMode, &s.Status, &s.Revision, &s.RecurrenceType, &s.RecurrenceInterval, &s.RecurrenceEndDate, &s.BufferBeforeMinutes, &s.BufferAfterMinutes, &s.AutoStart, &s.AutoStop, &s.CreatedAt, &s.CreatedBy, &s.UpdatedAt); err != nil {
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
	return s, nil
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
func (s *Service) Create(ctx context.Context, req CreateRequest) (Schedule, error) {
	if strings.TrimSpace(req.ExamID) == "" {
		return Schedule{}, validationError("Exam id is required.")
	}
	if strings.TrimSpace(req.PublishedVersionID) == "" {
		return Schedule{}, validationError("Published version id is required.")
	}
	if strings.TrimSpace(req.CohortName) == "" {
		return Schedule{}, validationError("Cohort name is required.")
	}
	if !req.EndTime.After(req.StartTime) {
		return Schedule{}, validationError("Schedule end time must be after start time.")
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

// Update applies schedule edits with revision fencing (mirrors
// update_schedule; stale revision is a CONFLICT; version changes on
// non-scheduled sessions are rejected).
func (s *Service) Update(ctx context.Context, id string, req UpdateRequest) (Schedule, error) {
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
// schedule attempt rows -> runtime row -> section rows.
func (s *Service) ApplyRuntimeCommand(ctx context.Context, scheduleID string, cmd RuntimeCommand) (Runtime, error) {
	cmd.Action = normalizeRuntimeCommandAction(cmd.Action)
	cmd.ActorID = strings.TrimSpace(cmd.ActorID)
	if cmd.ActorID == "" {
		cmd.ActorID = "system"
	}
	switch cmd.Action {
	case CommandStart, CommandPause, CommandResume, CommandComplete:
	default:
		return Runtime{}, validationError(fmt.Sprintf("Unknown runtime command %q.", cmd.Action))
	}

	sch, err := s.Get(ctx, scheduleID)
	if err != nil {
		return Runtime{}, err
	}
	fence := examruntime.RevisionFence{
		ExpectedRuntimeRevision:  cmd.ExpectedRuntimeRevision,
		ExpectedActiveSectionKey: cmd.ExpectedSectionKey,
	}
	switch cmd.Action {
	case CommandStart:
		plan, timingModel, err := s.runtimePlan(ctx, sch)
		if err != nil {
			return Runtime{}, err
		}
		if _, err := s.runtime.Start(ctx, scheduleID, sch.ExamID, plan, timingModel, cmd.ActorID); err != nil {
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

// runtimePlan derives the persisted cohort clock plan from the pinned
// published version. Disabled config sections are omitted so a proctor start
// cannot create clocks for a section the author turned off.
func (s *Service) runtimePlan(ctx context.Context, sch Schedule) ([]examruntime.PlanEntry, string, error) {
	var configRaw sql.NullString
	var examType string
	if err := s.db.QueryRowContext(ctx, "SELECT CAST(v.config_snapshot AS CHAR), e.exam_type FROM exam_versions v JOIN exam_entities e ON e.id = v.exam_id WHERE v.id = ?", sch.PublishedVersionID).Scan(&configRaw, &examType); err != nil {
		if err == sql.ErrNoRows {
			return nil, "", notFoundError("Published exam version not found.")
		}
		return nil, "", err
	}
	// Legacy ACT rows carry provider_key='ielts' with exam_type='ACT'; the
	// effective provider heals that mismatch so science survives planning.
	effectiveProvider := examdomain.EffectiveProviderKey(sch.ProviderKey, examType)
	enabled := configuredRuntimeSections(configRaw.String)
	rows, err := s.db.QueryContext(ctx, "SELECT section_key, title, display_order, duration_seconds, break_after_seconds FROM assessment_sections WHERE exam_version_id = ? ORDER BY display_order, id", sch.PublishedVersionID)
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
		if !examdomain.ValidSectionKey(effectiveProvider, key) || (enabled != nil && !enabled[key]) {
			continue
		}
		plan = append(plan, examruntime.PlanEntry{
			SectionKey:      key,
			Label:           strings.TrimSpace(label),
			Order:           order,
			DurationMinutes: ceilMinutes(durationSeconds),
			GapAfterMinutes: ceilMinutes(gapSeconds),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	if len(plan) == 0 {
		plan = configuredRuntimePlan(configRaw.String, effectiveProvider)
	}
	if len(plan) == 0 {
		plan = fallbackRuntimePlan(effectiveProvider, sch.PlannedDurationMinutes)
	}
	timingModel := "legacy_section_v1"
	if strings.EqualFold(sch.ProviderKey, examdomain.ProviderSAT) {
		timingModel = "cohort_section_v3"
	}
	return plan, timingModel, nil
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

func fallbackRuntimePlan(providerKey string, plannedMinutes int) []examruntime.PlanEntry {
	duration := plannedMinutes
	if duration <= 0 {
		duration = 1
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
func (s *Service) CreateRegistration(ctx context.Context, scheduleID string, req RegistrationRequest) (Registration, error) {
	wcode := NormalizeAccessCode(req.Wcode)
	if err := ValidateWcode(wcode); err != nil {
		return Registration{}, err
	}
	if err := ValidateEmail(req.Email); err != nil {
		return Registration{}, err
	}
	if strings.TrimSpace(req.StudentName) == "" {
		return Registration{}, validationError("Student name is required.")
	}
	if strings.TrimSpace(req.UserID) == "" {
		return Registration{}, validationError("User id is required.")
	}
	// The existence/status gate lives inside the tx below (locked read), so the
	// schedule cannot be cancelled, completed, or deleted between check and write.
	var out Registration
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		// Locked schedule gate first: rejects missing/cancelled/completed/deleted
		// rows inside the tx so the check cannot race the registration write.
		var schStatus string
		if err := q.QueryRowContext(ctx, "SELECT status FROM exam_schedules WHERE id = ? FOR UPDATE", scheduleID).Scan(&schStatus); err != nil {
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
	return out, err
}

// CreateScheduleAttempt mints one attempt row for a registration with
// protocol_version=2 (V1 retirement stage 1: new rows never mint V1).
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
			return nil
		} else if err != sql.ErrNoRows {
			return err
		}
		var userID any
		if regUserID.Valid {
			userID = regUserID.String
		}
		if _, err := q.ExecContext(ctx, "INSERT INTO student_attempts (id, schedule_id, registration_id, user_id, wcode, student_key, organization_id, exam_id, published_version_id, exam_title, candidate_id, candidate_name, candidate_email, phase, current_module, answers, writing_answers, flags, violations_snapshot, integrity, recovery, created_at, updated_at, revision, protocol_version, delivery_status, lease_epoch, control_epoch, response_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lobby', ?, '{}', '{}', '{}', '[]', '{}', ?, NOW(), NOW(), 0, ?, 'running', 1, 1, 0)", attemptID, scheduleID, regID, userID, regWcode, studentKey, nullableStrPtr(sch.OrganizationID), sch.ExamID, sch.PublishedVersionID, sch.ExamTitle, candidateID, candidateName, candidateEmail, currentModule, fmt.Sprintf("{\"clientSessionId\":%q}", clientSessionID), ProtocolVersionV2); err != nil {
			if isDuplicateKey(err) {
				return conflictError("Attempt already exists for this registration.")
			}
			return err
		}
		// A runtime may have started before this candidate checked in. Project
		// the active section's deadline onto the new V2 attempt immediately so
		// its first response is governed by the same server clock as existing
		// candidates.
		var runtimeID, activeSection string
		runtimeErr := q.QueryRowContext(ctx, "SELECT id, active_section_key FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE", scheduleID).Scan(&runtimeID, &activeSection)
		if runtimeErr != nil && runtimeErr != sql.ErrNoRows {
			return runtimeErr
		}
		if runtimeErr == nil && strings.TrimSpace(activeSection) != "" {
			running := "running"
			if err := examruntime.SyncV2TimingInTx(ctx, q, scheduleID, runtimeID, activeSection, &running); err != nil {
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
