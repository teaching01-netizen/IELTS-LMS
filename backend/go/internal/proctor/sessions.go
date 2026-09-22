// Proctor session reads: GET /proctor/sessions (list) and
// GET /proctor/sessions/{scheduleID} (detail).
//
// Mirrors backend/crates/api/src/routes/proctor.rs list_sessions/get_session
// and backend/crates/application/src/proctoring.rs list_sessions/
// get_session_detail_with_options, serialized with the Rust camelCase DTO
// shapes (backend/crates/domain/src/schedule.rs ProctorSessionSummary/
// ProctorSessionDetail).
//
// DTO ownership: the schedule/runtime projections below are local (NOT the
// internal/schedules types) on purpose. schedules.Schedule is a 14-column
// header subset and schedules.Runtime is a 7-column header subset (no
// sections, plan snapshot, timing model, or computed clocks), while the Rust
// wire shapes these endpoints must return are the FULL ExamSchedule (26
// columns incl. provider key, display names, recurrence, buffers, auto
// flags, audit stamps) and the FULL hydrated ExamSessionRuntime (sections,
// plan snapshot, timing model, computed remaining/deadline/overrun clocks
// that the TS dashboard mappers in src/services/backendBridge.ts consume:
// mapBackendSchedule/mapBackendRuntime). The spec's "reuse schedules.Runtime
// if one exists" check was done; it exists but cannot carry the required
// wire shape, so the full shapes are defined here and read with explicit
// column lists (never SELECT *). Runtime hydration (sections + clock math)
// and the student-session projection have no Go equivalent anywhere, so
// they are raw SQL here per the task brief.
//
// Reads run on the Service's own *sql.DB handle (recovered via a narrow
// interface assertion so service.go stays untouched). Role gate is
// Admin|AdminObserver|Proctor; reads never require CSRF (the middleware only
// binds CSRF on state-changing methods, and GET carries none). Proctor
// assignment scoping and the ?providerKey= filter live in the HTTP handlers
// (same split as the Rust routes); the service lists what SchedulingService
// would list. Go's proctor.Actor carries no organization id, so the Rust
// org-scoping of list_schedules has no equivalent to enforce here; the
// handler assignment filter is the proctor boundary.
//
// Known deviations from Rust, kept deliberate and small:
//   - Not-started runtime synthesis uses empty plan/sections arrays. Rust
//     rebuilds the section plan from the published version + config
//     snapshot; that plan loader has no Go equivalent and duplicating it
//     here would fork scheduling internals. Empty arrays keep the wire
//     shape (the TS mappers tolerate sections: []). The detail read adds
//     the authored examPlan back (loadExamPlan) for the staff run sheet,
//     so a not-started session still shows the planned section/module
//     windows even though its runtime sections array is empty.
//   - auto_stop runtime completion is not re-evaluated on read (that is a
//     scheduling write path with no Go equivalent in this package).
package proctor

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// roleAdminObserver is the read-only admin role allowed on session reads.
// It mirrors auth.RoleAdminObserver without importing the auth tree into
// this package (service.go already avoids that dependency).
const roleAdminObserver = "admin_observer"

// Nil UUID rendered for synthesized not-started runtimes, mirroring Rust
// build_not_started_runtime (Uuid::nil()).
const nilUUID = "00000000-0000-0000-0000-000000000000"

// SessionSchedule is the exam_schedules row projection for the proctor
// session reads. It mirrors the Rust ExamSchedule camelCase wire shape
// (all fields always present; unsets render null like Rust Options).
type SessionSchedule struct {
	ID                     string     `json:"id"`
	ExamID                 string     `json:"examId"`
	ProviderKey            string     `json:"providerKey"`
	OrganizationID         *string    `json:"organizationId"`
	ExamTitle              string     `json:"examTitle"`
	ProctorDisplayName     string     `json:"proctorDisplayName"`
	GradingDisplayName     string     `json:"gradingDisplayName"`
	PublishedVersionID     string     `json:"publishedVersionId"`
	CohortName             string     `json:"cohortName"`
	Institution            *string    `json:"institution"`
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
	Status                 string     `json:"status"`
	CreatedAt              time.Time  `json:"createdAt"`
	CreatedBy              string     `json:"createdBy"`
	UpdatedAt              time.Time  `json:"updatedAt"`
	Revision               int64      `json:"revision"`
}

// SessionPlanEntry mirrors Rust ScheduleSectionPlanEntry (camelCase).
type SessionPlanEntry struct {
	SectionKey         string `json:"sectionKey"`
	Label              string `json:"label"`
	Order              int    `json:"order"`
	DurationMinutes    int    `json:"durationMinutes"`
	GapAfterMinutes    int    `json:"gapAfterMinutes"`
	StartOffsetMinutes int    `json:"startOffsetMinutes"`
	EndOffsetMinutes   int    `json:"endOffsetMinutes"`
}

// SessionRuntimeSection mirrors Rust RuntimeSectionState (camelCase).
type SessionRuntimeSection struct {
	ID                       string     `json:"id"`
	RuntimeID                string     `json:"runtimeId"`
	SectionKey               string     `json:"sectionKey"`
	Label                    string     `json:"label"`
	SectionOrder             int        `json:"sectionOrder"`
	PlannedDurationMinutes   int        `json:"plannedDurationMinutes"`
	GapAfterMinutes          int        `json:"gapAfterMinutes"`
	Status                   string     `json:"status"`
	AvailableAt              *time.Time `json:"availableAt"`
	ActualStartAt            *time.Time `json:"actualStartAt"`
	ActualEndAt              *time.Time `json:"actualEndAt"`
	PausedAt                 *time.Time `json:"pausedAt"`
	AccumulatedPausedSeconds int        `json:"accumulatedPausedSeconds"`
	ExtensionMinutes         int        `json:"extensionMinutes"`
	CompletionReason         *string    `json:"completionReason"`
	ProjectedStartAt         *time.Time `json:"projectedStartAt"`
	ProjectedEndAt           *time.Time `json:"projectedEndAt"`
}

// SessionPlanModule is one authored module inside a section plan.
type SessionPlanModule struct {
	ModuleKey       string `json:"moduleKey"`
	Title           string `json:"title"`
	AdaptiveRole    string `json:"adaptiveRole"`
	DurationMinutes int    `json:"durationMinutes"`
}

// SessionPlanSection is one authored section of the published version a
// schedule runs, carrying the candidate-facing length (Module 1 + the longer
// adaptive branch) and its modules. The staff run sheet renders it; the live
// clocks still come from SessionRuntimeSection, so the two can be compared.
type SessionPlanSection struct {
	SectionKey      string              `json:"sectionKey"`
	Label           string              `json:"label"`
	Order           int                 `json:"order"`
	DurationMinutes int                 `json:"durationMinutes"`
	GapAfterMinutes int                 `json:"gapAfterMinutes"`
	Modules         []SessionPlanModule `json:"modules"`
}

// SessionRuntime mirrors Rust ExamSessionRuntime (camelCase): the full
// hydrated projection with sections and computed clocks.
type SessionRuntime struct {
	ID                             string             `json:"id"`
	ScheduleID                     string             `json:"scheduleId"`
	ExamID                         string             `json:"examId"`
	ProviderKey                    string             `json:"providerKey"`
	Status                         string             `json:"status"`
	PlanSnapshot                   []SessionPlanEntry `json:"planSnapshot"`
	TimingModel                    string             `json:"timingModel"`
	ActualStartAt                  *time.Time         `json:"actualStartAt"`
	ActualEndAt                    *time.Time         `json:"actualEndAt"`
	ActiveSectionKey               *string            `json:"activeSectionKey"`
	CurrentSectionKey              *string            `json:"currentSectionKey"`
	CurrentSectionRemainingSeconds int                `json:"currentSectionRemainingSeconds"`
	CurrentSectionDeadlineAt       *time.Time         `json:"currentSectionDeadlineAt"`
	// NextSectionStartAt is set only inside the between-sections window: the
	// active section is complete and the next one starts at this instant
	// (previous section end + its authored gap). nil outside that window.
	NextSectionStartAt    *time.Time              `json:"nextSectionStartAt"`
	ServerNow             time.Time               `json:"serverNow"`
	WaitingForNextSection bool                    `json:"waitingForNextSection"`
	IsOverrun             bool                    `json:"isOverrun"`
	TotalPausedSeconds    int                     `json:"totalPausedSeconds"`
	CreatedAt             time.Time               `json:"createdAt"`
	UpdatedAt             time.Time               `json:"updatedAt"`
	Revision              int64                   `json:"revision"`
	Sections              []SessionRuntimeSection `json:"sections"`
	// ExamPlan is the authored run sheet of the schedule's published version:
	// every section with its modules and their lengths. Present only on the
	// proctor session detail read (loadExamPlan); summary and student reads
	// leave it null, so the student hot paths keep their single sections leg.
	ExamPlan []SessionPlanSection `json:"examPlan"`
}

// StudentSessionSummary mirrors Rust StudentSessionSummary (camelCase).
type StudentSessionSummary struct {
	AttemptID                   string     `json:"attemptId"`
	StudentID                   string     `json:"studentId"`
	StudentName                 string     `json:"studentName"`
	StudentEmail                string     `json:"studentEmail"`
	ScheduleID                  string     `json:"scheduleId"`
	Status                      string     `json:"status"`
	CurrentSection              string     `json:"currentSection"`
	TimeRemaining               int        `json:"timeRemaining"`
	RuntimeStatus               string     `json:"runtimeStatus"`
	RuntimeCurrentSection       *string    `json:"runtimeCurrentSection"`
	RuntimeTimeRemainingSeconds int        `json:"runtimeTimeRemainingSeconds"`
	RuntimeDeadlineAt           *time.Time `json:"runtimeDeadlineAt"`
	RuntimeServerNow            *time.Time `json:"runtimeServerNow"`
	// RuntimeCurrentModuleRole is the active SAT module's adaptive slot
	// (base / lower_branch / higher_branch). The staff room labels the module a
	// candidate is sitting (Module 1, Module 2 — Lower) from it instead of
	// re-parsing the authored title. Null outside SAT and between modules.
	RuntimeCurrentModuleRole *string `json:"runtimeCurrentModuleRole"`
	// RuntimeModuleDeadlineAt and RuntimeModuleRemainingSeconds are the
	// candidate's MODULE clock — the countdown their own screen shows, which is
	// room-anchored now (a late entry is given what the room has left of the
	// module) and can end before its section does. The section clock above stays
	// the room's shared clock, so staff read the two side by side. Live modules
	// publish a deadline for the client to tick from; a paused module publishes
	// its frozen remainder and no deadline, and a module that never started
	// publishes neither.
	RuntimeModuleDeadlineAt       *time.Time      `json:"runtimeModuleDeadlineAt"`
	RuntimeModuleRemainingSeconds *int            `json:"runtimeModuleRemainingSeconds"`
	RuntimeSectionStatus          *string         `json:"runtimeSectionStatus"`
	RuntimeWaiting                bool            `json:"runtimeWaiting"`
	Violations                    json.RawMessage `json:"violations"`
	Warnings                      int             `json:"warnings"`
	LastActivity                  time.Time       `json:"lastActivity"`
	ExamID                        string          `json:"examId"`
	ExamName                      string          `json:"examName"`
}

// ProctorAlert mirrors Rust ProctorAlert (camelCase; "type" is the JSON key).
type ProctorAlert struct {
	ID             string    `json:"id"`
	Severity       string    `json:"severity"`
	AlertType      string    `json:"type"`
	StudentName    string    `json:"studentName"`
	StudentID      string    `json:"studentId"`
	Timestamp      time.Time `json:"timestamp"`
	Message        string    `json:"message"`
	IsAcknowledged bool      `json:"isAcknowledged"`
}

// SessionAuditLog mirrors Rust SessionAuditLog (camelCase).
type SessionAuditLog struct {
	ID              string          `json:"id"`
	ScheduleID      string          `json:"scheduleId"`
	Actor           string          `json:"actor"`
	ActionType      string          `json:"actionType"`
	TargetStudentID *string         `json:"targetStudentId"`
	Payload         json.RawMessage `json:"payload"`
	AcknowledgedAt  *time.Time      `json:"acknowledgedAt"`
	AcknowledgedBy  *string         `json:"acknowledgedBy"`
	CreatedAt       time.Time       `json:"createdAt"`
}

// SessionNote mirrors Rust SessionNote (camelCase).
type SessionNote struct {
	ID         string    `json:"id"`
	ScheduleID string    `json:"scheduleId"`
	Author     string    `json:"author"`
	Category   string    `json:"category"`
	Content    string    `json:"content"`
	IsResolved bool      `json:"isResolved"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// ProctorPresence mirrors Rust ProctorPresence (camelCase).
type ProctorPresence struct {
	ID              string     `json:"id"`
	ScheduleID      string     `json:"scheduleId"`
	ProctorID       string     `json:"proctorId"`
	ProctorName     string     `json:"proctorName"`
	Status          string     `json:"status"`
	JoinedAt        time.Time  `json:"joinedAt"`
	LastHeartbeatAt time.Time  `json:"lastHeartbeatAt"`
	LeftAt          *time.Time `json:"leftAt"`
}

// ViolationRule mirrors Rust ViolationRule (camelCase).
type ViolationRule struct {
	ID                    string    `json:"id"`
	ScheduleID            string    `json:"scheduleId"`
	TriggerType           string    `json:"triggerType"`
	Threshold             int       `json:"threshold"`
	SpecificViolationType *string   `json:"specificViolationType"`
	SpecificSeverity      *string   `json:"specificSeverity"`
	Action                string    `json:"action"`
	IsEnabled             bool      `json:"isEnabled"`
	CreatedAt             time.Time `json:"createdAt"`
	CreatedBy             string    `json:"createdBy"`
}

// ProctorSessionSummary mirrors Rust ProctorSessionSummary (camelCase).
type ProctorSessionSummary struct {
	Schedule         SessionSchedule `json:"schedule"`
	Runtime          SessionRuntime  `json:"runtime"`
	StudentCount     int64           `json:"studentCount"`
	ActiveCount      int64           `json:"activeCount"`
	JoinReadyCount   *int64          `json:"joinReadyCount"`
	JoinTotalCount   *int64          `json:"joinTotalCount"`
	AlertCount       int64           `json:"alertCount"`
	ViolationCount   int64           `json:"violationCount"`
	DegradedLiveMode bool            `json:"degradedLiveMode"`
}

// ProctorSessionDetail mirrors Rust ProctorSessionDetail (camelCase).
type ProctorSessionDetail struct {
	Schedule         SessionSchedule         `json:"schedule"`
	Runtime          SessionRuntime          `json:"runtime"`
	Sessions         []StudentSessionSummary `json:"sessions"`
	Alerts           []ProctorAlert          `json:"alerts"`
	AuditLogs        []SessionAuditLog       `json:"auditLogs"`
	Notes            []SessionNote           `json:"notes"`
	Presence         []ProctorPresence       `json:"presence"`
	ViolationRules   []ViolationRule         `json:"violationRules"`
	DegradedLiveMode bool                    `json:"degradedLiveMode"`
}

// sessionQuerier is the narrow direct-read surface needed by the session
// reads. *sql.DB satisfies it; the assertion below recovers query access
// from the tx.DB handle without touching service.go.
type sessionQuerier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// sessionDB recovers direct-read access from the service handle.
func (s *Service) sessionDB() (sessionQuerier, error) {
	if s == nil || s.db == nil {
		return nil, &apperrors.Error{Code: apperrors.CodeServiceUnavailable, Message: "Proctor session reads are unavailable.", HTTPStatus: 503}
	}
	q, ok := s.db.(sessionQuerier)
	if !ok {
		return nil, &apperrors.Error{Code: apperrors.CodeServiceUnavailable, Message: "Proctor session reads are unavailable.", HTTPStatus: 503}
	}
	return q, nil
}

// requireSessionReader enforces the Admin|AdminObserver|Proctor read gate.
// Like the write gate it maps denials to NOT_FOUND so schedule existence
// never leaks across roles.
func requireSessionReader(actor Actor) error {
	if actor.Role != RoleAdmin && actor.Role != roleAdminObserver && actor.Role != RoleProctor {
		return &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Schedule not found.", HTTPStatus: 404}
	}
	return nil
}

// sessionScheduleColumns is the explicit exam_schedules projection (never
// SELECT *), mirroring the Rust ExamSchedule field set.
const sessionScheduleColumns = "id, exam_id, provider_key, organization_id, exam_title, proctor_display_name, grading_display_name, published_version_id, cohort_name, institution, start_time, end_time, planned_duration_minutes, delivery_mode, recurrence_type, recurrence_interval, recurrence_end_date, buffer_before_minutes, buffer_after_minutes, auto_start, auto_stop, status, created_at, created_by, updated_at, revision"

func scanSessionSchedule(row interface{ Scan(dest ...any) error }) (SessionSchedule, error) {
	var s SessionSchedule
	var orgID, institution sql.NullString
	var recEnd sql.NullTime
	var bufBefore, bufAfter sql.NullInt64
	var autoStart, autoStop sql.NullBool
	var planned, recInterval, revision int64
	if err := row.Scan(
		&s.ID, &s.ExamID, &s.ProviderKey, &orgID, &s.ExamTitle,
		&s.ProctorDisplayName, &s.GradingDisplayName, &s.PublishedVersionID, &s.CohortName,
		&institution, &s.StartTime, &s.EndTime, &planned, &s.DeliveryMode,
		&s.RecurrenceType, &recInterval, &recEnd, &bufBefore, &bufAfter,
		&autoStart, &autoStop, &s.Status, &s.CreatedAt, &s.CreatedBy, &s.UpdatedAt, &revision,
	); err != nil {
		return SessionSchedule{}, err
	}
	s.OrganizationID = nullStringPtr(orgID)
	s.Institution = nullStringPtr(institution)
	s.PlannedDurationMinutes = int(planned)
	s.RecurrenceInterval = int(recInterval)
	s.RecurrenceEndDate = nullTimePtr(recEnd)
	s.BufferBeforeMinutes = nullIntPtr(bufBefore)
	s.BufferAfterMinutes = nullIntPtr(bufAfter)
	s.AutoStart = autoStart.Valid && autoStart.Bool
	s.AutoStop = autoStop.Valid && autoStop.Bool
	s.Revision = revision
	return s, nil
}

// loadSessionSchedules lists schedules ordered by start time, mirroring
// SchedulingService::list_schedules for platform readers.
func loadSessionSchedules(ctx context.Context, q sessionQuerier) ([]SessionSchedule, error) {
	rows, err := q.QueryContext(ctx, "SELECT "+sessionScheduleColumns+" FROM exam_schedules ORDER BY start_time ASC, created_at DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SessionSchedule{}
	for rows.Next() {
		s, err := scanSessionSchedule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// loadSessionSchedule reads one schedule; sql.ErrNoRows maps to NOT_FOUND.
func loadSessionSchedule(ctx context.Context, q sessionQuerier, scheduleID string) (SessionSchedule, error) {
	s, err := scanSessionSchedule(q.QueryRowContext(ctx, "SELECT "+sessionScheduleColumns+" FROM exam_schedules WHERE id = ?", scheduleID))
	if err != nil {
		if err == sql.ErrNoRows {
			return SessionSchedule{}, &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Schedule not found.", HTTPStatus: 404}
		}
		return SessionSchedule{}, err
	}
	return s, nil
}

// sessionRuntimeRow is the raw exam_session_runtimes header.
type sessionRuntimeRow struct {
	id, scheduleID, examID, providerKey, status string
	planSnapshot                                sql.NullString
	timingModel                                 string
	actualStartAt, actualEndAt                  sql.NullTime
	activeSectionKey, currentSectionKey         sql.NullString
	remaining                                   int64
	waiting, overrun                            sql.NullBool
	totalPaused                                 int64
	createdAt, updatedAt                        time.Time
	revision                                    int64
}

const sessionRuntimeColumns = "id, schedule_id, exam_id, provider_key, status, plan_snapshot, timing_model, actual_start_at, actual_end_at, active_section_key, current_section_key, current_section_remaining_seconds, waiting_for_next_section, is_overrun, total_paused_seconds, created_at, updated_at, revision"

func scanSessionRuntimeRow(row interface{ Scan(dest ...any) error }) (sessionRuntimeRow, error) {
	var r sessionRuntimeRow
	if err := row.Scan(
		&r.id, &r.scheduleID, &r.examID, &r.providerKey, &r.status,
		&r.planSnapshot, &r.timingModel, &r.actualStartAt, &r.actualEndAt,
		&r.activeSectionKey, &r.currentSectionKey, &r.remaining,
		&r.waiting, &r.overrun, &r.totalPaused, &r.createdAt, &r.updatedAt, &r.revision,
	); err != nil {
		return sessionRuntimeRow{}, err
	}
	return r, nil
}

const sessionRuntimeSectionColumns = "id, runtime_id, section_key, label, section_order, planned_duration_minutes, gap_after_minutes, status, available_at, actual_start_at, actual_end_at, paused_at, accumulated_paused_seconds, extension_minutes, completion_reason, projected_start_at, projected_end_at"

func scanSessionRuntimeSection(row interface{ Scan(dest ...any) error }) (SessionRuntimeSection, error) {
	var s SessionRuntimeSection
	var runtimeID string
	var availableAt, actualStartAt, actualEndAt, pausedAt sql.NullTime
	var accum, extension int64
	var order int64
	var planned, gap int64
	var completionReason sql.NullString
	var projectedStartAt, projectedEndAt sql.NullTime
	if err := row.Scan(
		&s.ID, &runtimeID, &s.SectionKey, &s.Label, &order, &planned, &gap,
		&s.Status, &availableAt, &actualStartAt, &actualEndAt, &pausedAt,
		&accum, &extension, &completionReason, &projectedStartAt, &projectedEndAt,
	); err != nil {
		return SessionRuntimeSection{}, err
	}
	s.RuntimeID = runtimeID
	s.SectionOrder = int(order)
	s.PlannedDurationMinutes = int(planned)
	s.GapAfterMinutes = int(gap)
	s.AvailableAt = nullTimePtr(availableAt)
	s.ActualStartAt = nullTimePtr(actualStartAt)
	s.ActualEndAt = nullTimePtr(actualEndAt)
	s.PausedAt = nullTimePtr(pausedAt)
	s.AccumulatedPausedSeconds = int(accum)
	s.ExtensionMinutes = int(extension)
	s.CompletionReason = nullStringPtr(completionReason)
	s.ProjectedStartAt = nullTimePtr(projectedStartAt)
	s.ProjectedEndAt = nullTimePtr(projectedEndAt)
	return s, nil
}

// computedSectionTime is the live-clock result for one section.
type computedSectionTime struct {
	remaining int
	overrun   bool
}

// computeSectionRemaining ports Rust compute_section_remaining_seconds:
// duration = (planned + extension) * 60, frozen at paused_at while paused,
// elapsed net of accumulated pause, remaining clamped to [0, duration].
func computeSectionRemaining(actualStart time.Time, planned, extension int, pausedAt *time.Time, pausedAccum int, status string, now time.Time) computedSectionTime {
	duration := int64(planned+extension) * 60
	if duration < 0 {
		duration = 0
	}
	base := now
	if status == "paused" || pausedAt != nil {
		base = now
		if pausedAt != nil {
			base = *pausedAt
		}
	}
	elapsed := base.Unix() - actualStart.Unix()
	if elapsed < 0 {
		elapsed = 0
	}
	acc := int64(pausedAccum)
	if acc < 0 {
		acc = 0
	}
	elapsed -= acc
	remaining := duration - elapsed
	if remaining < 0 {
		remaining = 0
	}
	if remaining > duration {
		remaining = duration
	}
	return computedSectionTime{remaining: int(remaining), overrun: elapsed > duration}
}

// sectionDeadline ports Rust section_deadline.
func sectionDeadline(actualStart time.Time, planned, extension, pausedAccum int) time.Time {
	acc := int64(pausedAccum)
	if acc < 0 {
		acc = 0
	}
	duration := int64(planned+extension)*60 + acc
	return actualStart.Add(time.Duration(duration) * time.Second)
}

// hydrateSessionRuntime ports SchedulingService::hydrate_runtime: sections
// attach to the header row, live/paused clocks recompute remaining/overrun,
// and the deadline resolves from the live unpaused active section.
func hydrateSessionRuntime(row sessionRuntimeRow, sections []SessionRuntimeSection, now time.Time) SessionRuntime {
	if sections == nil {
		sections = []SessionRuntimeSection{}
	}
	var computed *computedSectionTime
	var nextSectionStartAt *time.Time
	if row.status == "live" || row.status == "paused" {
		active := nullStringPtr(row.activeSectionKey)
		if active == nil {
			active = nullStringPtr(row.currentSectionKey)
		}
		if active != nil {
			for i := range sections {
				sec := &sections[i]
				if sec.SectionKey != *active {
					continue
				}
				if sec.Status == "completed" || sec.Status == "cancelled" {
					// Between sections: the section clock is over, so never
					// recompute remaining/overrun from its past deadline. The next
					// section's start is the only live clock, and only while the
					// runtime is explicitly waiting for it — otherwise the
					// finished section projects as it always has.
					if row.waiting.Valid && row.waiting.Bool && sec.ActualEndAt != nil {
						start := sec.ActualEndAt.Add(time.Duration(sec.GapAfterMinutes) * time.Minute)
						nextSectionStartAt = &start
					}
					break
				}
				if sec.ActualStartAt == nil {
					break
				}
				c := computeSectionRemaining(*sec.ActualStartAt, sec.PlannedDurationMinutes, sec.ExtensionMinutes, sec.PausedAt, sec.AccumulatedPausedSeconds, sec.Status, now)
				computed = &c
				break
			}
		}
	}
	remaining := int(row.remaining)
	overrun := row.overrun.Valid && row.overrun.Bool
	if computed != nil {
		remaining = computed.remaining
		overrun = computed.overrun
	}
	var deadline *time.Time
	active := nullStringPtr(row.activeSectionKey)
	if active == nil {
		active = nullStringPtr(row.currentSectionKey)
	}
	if active != nil {
		for i := range sections {
			sec := &sections[i]
			if sec.SectionKey != *active {
				continue
			}
			if sec.Status != "live" || sec.PausedAt != nil || sec.ActualStartAt == nil {
				break
			}
			d := sectionDeadline(*sec.ActualStartAt, sec.PlannedDurationMinutes, sec.ExtensionMinutes, sec.AccumulatedPausedSeconds)
			deadline = &d
			break
		}
	}
	plan := []SessionPlanEntry{}
	if row.planSnapshot.Valid && strings.TrimSpace(row.planSnapshot.String) != "" {
		var parsed []SessionPlanEntry
		if err := json.Unmarshal([]byte(row.planSnapshot.String), &parsed); err == nil && parsed != nil {
			plan = parsed
		}
	}
	return SessionRuntime{
		ID:                             row.id,
		ScheduleID:                     row.scheduleID,
		ExamID:                         row.examID,
		ProviderKey:                    row.providerKey,
		Status:                         row.status,
		PlanSnapshot:                   plan,
		TimingModel:                    row.timingModel,
		ActualStartAt:                  nullTimePtr(row.actualStartAt),
		ActualEndAt:                    nullTimePtr(row.actualEndAt),
		ActiveSectionKey:               nullStringPtr(row.activeSectionKey),
		CurrentSectionKey:              nullStringPtr(row.currentSectionKey),
		CurrentSectionRemainingSeconds: remaining,
		CurrentSectionDeadlineAt:       deadline,
		NextSectionStartAt:             nextSectionStartAt,
		ServerNow:                      now,
		WaitingForNextSection:          row.waiting.Valid && row.waiting.Bool,
		IsOverrun:                      overrun,
		TotalPausedSeconds:             int(row.totalPaused),
		CreatedAt:                      row.createdAt,
		UpdatedAt:                      row.updatedAt,
		Revision:                       row.revision,
		Sections:                       sections,
	}
}

// notStartedSessionRuntime synthesizes the pre-start projection, mirroring
// Rust build_not_started_runtime minus the version-plan load (see package
// doc): empty plan/sections arrays keep the wire shape.
func notStartedSessionRuntime(schedule SessionSchedule, now time.Time) SessionRuntime {
	return NotStartedRuntimeForProvider(schedule.ID, schedule.ExamID, schedule.ProviderKey, now)
}

// NotStartedRuntimeForProvider is the ONE pre-start projection for a schedule
// whose exam_session_runtimes row does not exist yet: status not_started, no
// active section, no deadline, zero remaining seconds.
//
// Both readers of "what is this schedule doing right now?" call it: the
// proctor dashboard (loadSessionRuntimes / loadSessionRuntime /
// LoadSessionRuntimeByStatus) and the student bootstrap
// (delivery.loadTiming). They used to answer differently — the proctor said
// not_started while the student bootstrap said "live legacy attempt", so a
// waiting SAT student's entry gate opened, POSTed /modules/start, and got a
// 409 RUNTIME_NOT_LIVE every retry window.
//
// examID may be empty when the caller keyed off a schedule id it did not
// re-read; the wire projection only needs it for the id echo.
func NotStartedRuntimeForProvider(scheduleID, examID, providerKey string, now time.Time) SessionRuntime {
	return SessionRuntime{
		ID:                             nilUUID,
		ScheduleID:                     scheduleID,
		ExamID:                         examID,
		ProviderKey:                    providerKey,
		Status:                         examruntime.StatusNotStarted,
		PlanSnapshot:                   []SessionPlanEntry{},
		TimingModel:                    examruntime.ProviderTimingModel(providerKey),
		CurrentSectionRemainingSeconds: 0,
		ServerNow:                      now,
		CreatedAt:                      now,
		UpdatedAt:                      now,
		Sections:                       []SessionRuntimeSection{},
	}
}

// loadSessionRuntimes batch-hydrates runtimes for every schedule, mirroring
// Rust load_existing_runtimes. Schedules without a runtime row get the
// not-started synthesis (mirroring SchedulingService::get_runtime).
func loadSessionRuntimes(ctx context.Context, q sessionQuerier, schedules []SessionSchedule, now time.Time) (map[string]SessionRuntime, error) {
	out := map[string]SessionRuntime{}
	if len(schedules) == 0 {
		return out, nil
	}
	ids := make([]string, 0, len(schedules))
	for _, s := range schedules {
		ids = append(ids, s.ID)
	}
	rows, err := q.QueryContext(ctx, "SELECT "+sessionRuntimeColumns+" FROM exam_session_runtimes WHERE schedule_id IN ("+placeholders(len(ids))+")", stringArgs(ids)...)
	if err != nil {
		return nil, err
	}
	bySchedule := map[string]sessionRuntimeRow{}
	runtimeIDs := []string{}
	func() {
		defer rows.Close()
		for rows.Next() {
			r, err := scanSessionRuntimeRow(rows)
			if err != nil {
				return
			}
			bySchedule[r.scheduleID] = r
			runtimeIDs = append(runtimeIDs, r.id)
		}
	}()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sectionsByRuntime := map[string][]SessionRuntimeSection{}
	if len(runtimeIDs) > 0 {
		srows, err := q.QueryContext(ctx, "SELECT "+sessionRuntimeSectionColumns+" FROM exam_session_runtime_sections WHERE runtime_id IN ("+placeholders(len(runtimeIDs))+") ORDER BY runtime_id, section_order ASC", stringArgs(runtimeIDs)...)
		if err != nil {
			return nil, err
		}
		func() {
			defer srows.Close()
			for srows.Next() {
				sec, err := scanSessionRuntimeSection(srows)
				if err != nil {
					return
				}
				sectionsByRuntime[sec.RuntimeID] = append(sectionsByRuntime[sec.RuntimeID], sec)
			}
		}()
		if err := srows.Err(); err != nil {
			return nil, err
		}
	}
	byID := map[string]SessionSchedule{}
	for _, s := range schedules {
		byID[s.ID] = s
	}
	for _, id := range ids {
		row, ok := bySchedule[id]
		if !ok {
			out[id] = notStartedSessionRuntime(byID[id], now)
			continue
		}
		out[id] = hydrateSessionRuntime(row, sectionsByRuntime[row.id], now)
	}
	return out, nil
}

// loadSessionRuntime hydrates one schedule runtime (detail path).
func loadSessionRuntime(ctx context.Context, q sessionQuerier, schedule SessionSchedule, now time.Time) (SessionRuntime, error) {
	row, err := scanSessionRuntimeRow(q.QueryRowContext(ctx, "SELECT "+sessionRuntimeColumns+" FROM exam_session_runtimes WHERE schedule_id = ?", schedule.ID))
	if err != nil {
		if err == sql.ErrNoRows {
			return notStartedSessionRuntime(schedule, now), nil
		}
		return SessionRuntime{}, err
	}
	sections, err := loadRuntimeSections(ctx, q, row.id)
	if err != nil {
		return SessionRuntime{}, err
	}
	return hydrateSessionRuntime(row, sections, now), nil
}

// loadRuntimeSections runs the sections leg shared by loadSessionRuntime
// and LoadSessionRuntimeByStatus.
func loadRuntimeSections(ctx context.Context, q sessionQuerier, runtimeID string) ([]SessionRuntimeSection, error) {
	srows, err := q.QueryContext(ctx, "SELECT "+sessionRuntimeSectionColumns+" FROM exam_session_runtime_sections WHERE runtime_id = ? ORDER BY section_order ASC", runtimeID)
	if err != nil {
		return nil, err
	}
	sections := []SessionRuntimeSection{}
	defer srows.Close()
	for srows.Next() {
		sec, err := scanSessionRuntimeSection(srows)
		if err != nil {
			return nil, err
		}
		sections = append(sections, sec)
	}
	if err := srows.Err(); err != nil {
		return nil, err
	}
	return sections, nil
}

// planMinutes converts authored seconds to whole minutes (ceil), with zero
// staying zero: an authored zero-length break is the documented "advance
// immediately" case, and a zero here must never become an invented minute.
func planMinutes(seconds int) int {
	if seconds <= 0 {
		return 0
	}
	return (seconds + 59) / 60
}

// loadExamPlan reads the authored run sheet of one published version: its
// sections in display order, each with its modules and the candidate-facing
// length.
//
// The section length is derived exactly like the runtime clock
// (exams.AdaptiveRoleSeconds: Module 1 plus the LONGER adaptive branch, with
// the guard owned there), so the staff projection agrees with what the student
// sits instead of repeating the stored duration_seconds overstatement 0065
// repaired — a section that still sums both branches is visible here as the
// derived value, not as the stale one. A section with no adaptive roles
// (IELTS/ACT) or with an incomplete adaptive shape keeps its authored length.
//
// Detail-read only: the roster poll and every student bootstrap must not pay for
// this second sections leg.
func loadExamPlan(ctx context.Context, q sessionQuerier, versionID string) ([]SessionPlanSection, error) {
	if strings.TrimSpace(versionID) == "" {
		return nil, nil
	}
	type sectionRow struct {
		id       string
		authored int
		section  SessionPlanSection
	}
	rows, err := q.QueryContext(ctx,
		"SELECT id, section_key, title, display_order, duration_seconds, break_after_seconds FROM assessment_sections WHERE exam_version_id = ? ORDER BY display_order, id",
		versionID)
	if err != nil {
		return nil, err
	}
	ordered := []sectionRow{}
	index := map[string]int{}
	for rows.Next() {
		var row sectionRow
		var breakSeconds int
		if err := rows.Scan(&row.id, &row.section.SectionKey, &row.section.Label, &row.section.Order, &row.authored, &breakSeconds); err != nil {
			rows.Close()
			return nil, err
		}
		row.section.DurationMinutes = planMinutes(row.authored)
		row.section.GapAfterMinutes = planMinutes(breakSeconds)
		row.section.Modules = []SessionPlanModule{}
		index[row.id] = len(ordered)
		ordered = append(ordered, row)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	roles := map[string]*examdomain.AdaptiveRoleSeconds{}
	moduleRows, err := q.QueryContext(ctx, `
		SELECT m.section_id, m.module_key, m.title, m.adaptive_role, m.duration_seconds
		FROM assessment_modules m
		JOIN assessment_sections s ON s.id = m.section_id
		WHERE s.exam_version_id = ?
		ORDER BY s.display_order, m.display_order, m.id`, versionID)
	if err != nil {
		return nil, err
	}
	defer moduleRows.Close()
	for moduleRows.Next() {
		var sectionID string
		var module SessionPlanModule
		var role string
		var seconds int
		if err := moduleRows.Scan(&sectionID, &module.ModuleKey, &module.Title, &role, &seconds); err != nil {
			return nil, err
		}
		idx, ok := index[sectionID]
		if !ok {
			continue
		}
		module.AdaptiveRole = role
		module.DurationMinutes = planMinutes(seconds)
		ordered[idx].section.Modules = append(ordered[idx].section.Modules, module)
		clock := roles[sectionID]
		if clock == nil {
			clock = &examdomain.AdaptiveRoleSeconds{}
			roles[sectionID] = clock
		}
		clock.AddModule(role, seconds)
	}
	if err := moduleRows.Err(); err != nil {
		return nil, err
	}

	plan := make([]SessionPlanSection, 0, len(ordered))
	for i := range ordered {
		row := &ordered[i]
		// exams owns the guard (a base plus at least one branch) and the
		// arithmetic (base + the LONGER branch): a section with an incomplete
		// adaptive shape keeps its authored length.
		if clock := roles[row.id]; clock != nil {
			if seconds, ok := clock.CandidateSeconds(); ok {
				row.section.DurationMinutes = planMinutes(seconds)
			}
		}
		plan = append(plan, row.section)
	}
	return plan, nil
}

// LoadSessionRuntimeBySchedule returns the same hydrated runtime projection
// used by the proctor dashboard for a schedule-backed student session.  The
// student API used to duplicate this read and consequently exposed the
// persisted remaining-seconds value instead of the live clock/deadline.
func LoadSessionRuntimeBySchedule(ctx context.Context, db *sql.DB, scheduleID string) (SessionRuntime, error) {
	var schedule SessionSchedule
	if err := db.QueryRowContext(ctx, `
		SELECT id, exam_id, provider_key
		FROM exam_schedules
		WHERE id = ?`, scheduleID).Scan(&schedule.ID, &schedule.ExamID, &schedule.ProviderKey); err != nil {
		return SessionRuntime{}, err
	}
	return loadSessionRuntime(ctx, db, schedule, time.Now().UTC())
}

// LoadExamPlanBySchedule returns the authored run sheet for the published
// version pinned by one schedule. The live staff socket uses this alongside
// the hydrated runtime so its initial snapshot has the same comparison data
// as the proctor detail route.
func LoadExamPlanBySchedule(ctx context.Context, db *sql.DB, scheduleID string) ([]SessionPlanSection, error) {
	var versionID string
	if err := db.QueryRowContext(ctx,
		"SELECT published_version_id FROM exam_schedules WHERE id = ?", scheduleID,
	).Scan(&versionID); err != nil {
		return nil, err
	}
	return loadExamPlan(ctx, db, versionID)
}

// LoadSessionRuntimeByStatus hydrates the same projection when the caller
// already probed the runtime header (round 144: delivery.loadTiming holds
// the status row, so the header re-probe inside loadSessionRuntime is
// skipped — one fewer statement per bootstrap on the 2k-herd hot path).
// Only the schedule row (exam link) + sections leg run here; the hydrated
// status comes from the pre-probed row the caller already holds.
func LoadSessionRuntimeByStatus(ctx context.Context, db *sql.DB, scheduleID, status string) (SessionRuntime, error) {
	var schedule SessionSchedule
	if err := db.QueryRowContext(ctx, `
		SELECT id, exam_id, provider_key
		FROM exam_schedules
		WHERE id = ?`, scheduleID).Scan(&schedule.ID, &schedule.ExamID, &schedule.ProviderKey); err != nil {
		return SessionRuntime{}, err
	}
	now := time.Now().UTC()
	var row sessionRuntimeRow
	if err := db.QueryRowContext(ctx,
		"SELECT "+sessionRuntimeColumns+" FROM exam_session_runtimes WHERE schedule_id = ?",
		schedule.ID).Scan(
		&row.id, &row.scheduleID, &row.examID, &row.providerKey, &row.status,
		&row.planSnapshot, &row.timingModel, &row.actualStartAt, &row.actualEndAt,
		&row.activeSectionKey, &row.currentSectionKey, &row.remaining,
		&row.waiting, &row.overrun, &row.totalPaused, &row.createdAt, &row.updatedAt, &row.revision,
	); err != nil {
		if err == sql.ErrNoRows {
			return notStartedSessionRuntime(schedule, now), nil
		}
		return SessionRuntime{}, err
	}
	// Belt-and-braces: the row raced the probe (publish/start between the
	// two reads). Trust the row, not the stale status argument.
	_ = status
	return hydrateSessionRuntimeByRow(ctx, db, row, now)
}

// hydrateSessionRuntimeByRow runs the sections leg + hydrate for a header
// row the caller already holds (shared with loadSessionRuntime).
func hydrateSessionRuntimeByRow(ctx context.Context, db *sql.DB, row sessionRuntimeRow, now time.Time) (SessionRuntime, error) {
	sections, err := loadRuntimeSections(ctx, db, row.id)
	if err != nil {
		return SessionRuntime{}, err
	}
	return hydrateSessionRuntime(row, sections, now), nil
}

// studentSessionRow is the raw detail projection row.
type studentSessionRow struct {
	id, candidateID, candidateName, candidateEmail, scheduleID string
	currentModule, phase                                       string
	integrity, violations                                      sql.NullString
	examID, examTitle                                          string
	updatedAt                                                  time.Time
	proctorStatus                                              string
	lastWarningID                                              sql.NullString
	presenceHBAt                                               sql.NullTime
	presenceHBStatus                                           sql.NullString
	providerKey                                                string
	satModuleTitle, satModuleKey, satModuleRole                sql.NullString
	satStartedAt, satPausedAt                                  sql.NullTime
	satAllocated, satExtension, satAccum                       sql.NullInt64
}

// studentSessionColumns mirrors Rust load_student_sessions (explicit list).
const studentSessionColumns = "sa.id, sa.candidate_id, sa.candidate_name, sa.candidate_email, sa.schedule_id, " +
	"sa.current_module, sa.phase, sa.integrity, sa.violations_snapshot, " +
	"sa.exam_id, sa.exam_title, sa.updated_at, " +
	"COALESCE(sa.proctor_status, 'active'), sa.last_warning_id, " +
	"presence.last_heartbeat_at, presence.last_heartbeat_status, " +
	"e.provider_key, " +
	"sat_module.title, sat_module.module_key, sat_module.adaptive_role, " +
	"sat_attempt.started_at, sat_attempt.paused_at, " +
	"sat_attempt.allocated_seconds, sat_attempt.extension_seconds, sat_attempt.accumulated_paused_seconds"

const studentSessionFrom = "FROM student_attempts sa " +
	"JOIN exam_entities e ON e.id = sa.exam_id " +
	"LEFT JOIN student_attempt_presence presence ON presence.attempt_id = sa.id " +
	"LEFT JOIN assessment_module_attempts sat_attempt ON sat_attempt.id = (" +
	"SELECT ma2.id FROM assessment_module_attempts ma2 " +
	"WHERE ma2.attempt_id = sa.id AND ma2.state = 'active' " +
	"ORDER BY ma2.created_at DESC, ma2.id DESC LIMIT 1" +
	") " +
	"LEFT JOIN assessment_modules sat_module ON sat_module.id = sat_attempt.module_id"

func scanStudentSessionRow(row interface{ Scan(dest ...any) error }) (studentSessionRow, error) {
	var r studentSessionRow
	if err := row.Scan(
		&r.id, &r.candidateID, &r.candidateName, &r.candidateEmail, &r.scheduleID,
		&r.currentModule, &r.phase, &r.integrity, &r.violations,
		&r.examID, &r.examTitle, &r.updatedAt,
		&r.proctorStatus, &r.lastWarningID,
		&r.presenceHBAt, &r.presenceHBStatus,
		&r.providerKey,
		&r.satModuleTitle, &r.satModuleKey, &r.satModuleRole,
		&r.satStartedAt, &r.satPausedAt,
		&r.satAllocated, &r.satExtension, &r.satAccum,
	); err != nil {
		return studentSessionRow{}, err
	}
	return r, nil
}

// loadStudentSessions ports Rust load_student_sessions.
func loadStudentSessions(ctx context.Context, q sessionQuerier, scheduleID string) ([]studentSessionRow, error) {
	rows, err := q.QueryContext(ctx, "SELECT "+studentSessionColumns+" "+studentSessionFrom+" WHERE sa.schedule_id = ? ORDER BY sa.updated_at DESC", scheduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []studentSessionRow{}
	for rows.Next() {
		r, err := scanStudentSessionRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// jsonStringField reads one string member from a JSON object (or "").
func jsonStringField(raw json.RawMessage, key string) string {
	if len(raw) == 0 {
		return ""
	}
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return ""
	}
	s, _ := obj[key].(string)
	return s
}

// satModuleInts reads one SAT module attempt's clock columns (allocated
// seconds, extension, accumulated pause), defaulting each to zero. One reader
// for the two projections below so the legacy module clock and the room-anchored
// one can never disagree about what the row holds.
func satModuleInts(row studentSessionRow) (int, int, int) {
	alloc, ext, acc := 0, 0, 0
	if row.satAllocated.Valid {
		alloc = int(row.satAllocated.Int64)
	}
	if row.satExtension.Valid {
		ext = int(row.satExtension.Int64)
	}
	if row.satAccum.Valid {
		acc = int(row.satAccum.Int64)
	}
	return alloc, ext, acc
}

// satModuleClock projects one SAT module's own clock: the deadline the client
// ticks from plus the remaining window at `now`, both derived from the same
// window the delivery service hands the candidate (started_at over
// allocated + extension + returned pause time). A live module publishes a
// deadline; a paused one publishes only its frozen remainder (its window is not
// running, so a ticking deadline would be a lie); a module that never started
// publishes neither.
func satModuleClock(started, paused *time.Time, allocated, extension, accumulated int, now time.Time) (*time.Time, *int) {
	if started == nil {
		return nil, nil
	}
	remaining := satAttemptRemaining(started, paused, allocated, extension, accumulated, now)
	if paused != nil {
		return nil, &remaining
	}
	total := allocated + extension + accumulated
	if total < 0 {
		total = 0
	}
	deadline := started.Add(time.Duration(total) * time.Second)
	return &deadline, &remaining
}

// satAttemptRemaining ports Rust compute_sat_attempt_remaining_seconds.
func satAttemptRemaining(started, paused *time.Time, allocated, extension int, accum int, now time.Time) int {
	total := allocated + extension
	if total < 0 {
		total = 0
	}
	if started == nil {
		return total
	}
	base := now
	if paused != nil {
		base = *paused
	}
	elapsed := base.Unix() - started.Unix()
	if elapsed < 0 {
		elapsed = 0
	}
	acc := int64(accum)
	if acc < 0 {
		acc = 0
	}
	elapsed -= acc
	rem := int64(total) - elapsed
	if rem < 0 {
		rem = 0
	}
	if rem > int64(total) {
		rem = int64(total)
	}
	return int(rem)
}

// attemptRowToSession ports Rust attempt_row_to_session.
func attemptRowToSession(row studentSessionRow, runtime SessionRuntime) StudentSessionSummary {
	integrity := json.RawMessage(nil)
	if row.integrity.Valid {
		integrity = json.RawMessage(row.integrity.String)
	}
	heartbeatStatus := ""
	if row.presenceHBStatus.Valid && strings.TrimSpace(row.presenceHBStatus.String) != "" {
		heartbeatStatus = row.presenceHBStatus.String
	} else {
		heartbeatStatus = jsonStringField(integrity, "lastHeartbeatStatus")
	}
	if heartbeatStatus == "" {
		heartbeatStatus = "idle"
	}
	status := "idle"
	switch {
	case row.proctorStatus == "terminated" || row.phase == "post-exam":
		status = "terminated"
	case row.proctorStatus == "paused":
		status = "paused"
	case heartbeatStatus == "lost":
		status = "connecting"
	case row.proctorStatus == "warned":
		status = "warned"
	case row.phase == "exam":
		status = "active"
	}
	var runtimeSectionStatus *string
	for i := range runtime.Sections {
		sec := &runtime.Sections[i]
		if runtime.ActiveSectionKey != nil && sec.SectionKey == *runtime.ActiveSectionKey {
			v := sec.Status
			runtimeSectionStatus = &v
			break
		}
	}
	lastActivity := row.updatedAt
	if row.presenceHBAt.Valid {
		lastActivity = row.presenceHBAt.Time
	} else if s := jsonStringField(integrity, "lastHeartbeatAt"); s != "" {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			lastActivity = t.UTC()
		}
	}
	warnings := 0
	counted := false
	if row.violations.Valid && strings.TrimSpace(row.violations.String) != "" {
		var entries []map[string]any
		if err := json.Unmarshal([]byte(row.violations.String), &entries); err == nil {
			counted = true
			for _, e := range entries {
				if t, _ := e["type"].(string); t == "PROCTOR_WARNING" || t == "AUTO_WARNING" {
					warnings++
				}
			}
		}
	}
	if !counted && row.lastWarningID.Valid && strings.TrimSpace(row.lastWarningID.String) != "" {
		warnings = 1
	}
	isSAT := row.providerKey == "sat"
	cohortTimedSAT := isSAT && examruntime.IsCohortTimed(runtime.TimingModel)
	timeRemaining := runtime.CurrentSectionRemainingSeconds
	// The candidate's own MODULE clock, for every SAT timing model: the module a
	// candidate is sitting has its own window, and since the window is the room's
	// (delivery clamps a late entry to the room's remaining time) it is comparable
	// across the roster. Projected for cohort-timed SAT too — that is the clock the
	// student's screen shows, and the proctor needs both it and the section clock.
	var moduleDeadline *time.Time
	var moduleRemaining *int
	var moduleRole *string
	if isSAT {
		alloc, ext, acc := satModuleInts(row)
		moduleDeadline, moduleRemaining = satModuleClock(
			nullTimePtr(row.satStartedAt), nullTimePtr(row.satPausedAt), alloc, ext, acc, runtime.ServerNow)
		if row.satModuleRole.Valid && strings.TrimSpace(row.satModuleRole.String) != "" {
			role := strings.TrimSpace(row.satModuleRole.String)
			moduleRole = &role
		}
		if !cohortTimedSAT {
			timeRemaining = satAttemptRemaining(nullTimePtr(row.satStartedAt), nullTimePtr(row.satPausedAt), alloc, ext, acc, runtime.ServerNow)
		}
	}
	currentSection := row.currentModule
	if isSAT {
		if row.satModuleTitle.Valid && strings.TrimSpace(row.satModuleTitle.String) != "" {
			currentSection = row.satModuleTitle.String
		} else if row.satModuleKey.Valid && strings.TrimSpace(row.satModuleKey.String) != "" {
			currentSection = row.satModuleKey.String
		}
	}
	runtimeCurrentSection := runtime.CurrentSectionKey
	runtimeRemaining := runtime.CurrentSectionRemainingSeconds
	// Legacy SAT has no authoritative section clock, so the roster shows the
	// student's module clock instead. Cohort-timed SAT does have one, and must
	// report the same section state as every other cohort exam — otherwise the
	// proctor row cannot show the between-sections window.
	if isSAT && !cohortTimedSAT {
		v := currentSection
		runtimeCurrentSection = &v
		runtimeRemaining = timeRemaining
	}
	var runtimeDeadline *time.Time
	if !isSAT || cohortTimedSAT {
		runtimeDeadline = runtime.CurrentSectionDeadlineAt
	}
	sectionStatus := runtimeSectionStatus
	if isSAT && !cohortTimedSAT {
		var v string
		switch {
		case row.proctorStatus == "paused" || row.satPausedAt.Valid:
			v = "paused"
		case row.satStartedAt.Valid:
			v = "live"
		default:
			v = "locked"
		}
		sectionStatus = &v
	}
	// The waiting window is a real server state now (the section reconciler sets
	// it for the authored gap). Suppressing it here shadowed the room-level flag
	// on the one projection the proctor dashboard reads per student, so a room
	// sitting on its break still read as running. Only legacy SAT has no cohort
	// clock to wait on.
	runtimeWaiting := runtime.WaitingForNextSection
	if isSAT && !cohortTimedSAT {
		runtimeWaiting = false
	}
	violations := json.RawMessage([]byte("[]"))
	if row.violations.Valid && strings.TrimSpace(row.violations.String) != "" {
		violations = json.RawMessage(row.violations.String)
	}
	serverNow := runtime.ServerNow
	return StudentSessionSummary{
		AttemptID:                     row.id,
		StudentID:                     row.candidateID,
		StudentName:                   row.candidateName,
		StudentEmail:                  row.candidateEmail,
		ScheduleID:                    row.scheduleID,
		Status:                        status,
		CurrentSection:                currentSection,
		TimeRemaining:                 timeRemaining,
		RuntimeStatus:                 runtime.Status,
		RuntimeCurrentSection:         runtimeCurrentSection,
		RuntimeTimeRemainingSeconds:   runtimeRemaining,
		RuntimeDeadlineAt:             runtimeDeadline,
		RuntimeServerNow:              &serverNow,
		RuntimeCurrentModuleRole:      moduleRole,
		RuntimeModuleDeadlineAt:       moduleDeadline,
		RuntimeModuleRemainingSeconds: moduleRemaining,
		RuntimeSectionStatus:          sectionStatus,
		RuntimeWaiting:                runtimeWaiting,
		Violations:                    violations,
		Warnings:                      warnings,
		LastActivity:                  lastActivity,
		ExamID:                        row.examID,
		ExamName:                      row.examTitle,
	}
}

// defaultAlertMessage ports Rust default_alert_message.
func defaultAlertMessage(actionType string) string {
	switch actionType {
	case "HEARTBEAT_LOST":
		return "Candidate heartbeat was lost."
	case "DEVICE_CONTINUITY_FAILED":
		return "Device continuity validation failed."
	case "NETWORK_DISCONNECTED":
		return "Candidate went offline."
	case "STUDENT_WARN":
		return "Proctor warning issued."
	case "STUDENT_PAUSE":
		return "Candidate session paused by proctor."
	case "STUDENT_TERMINATE":
		return "Candidate session terminated by proctor."
	case "VIOLATION_DETECTED":
		return "Candidate violation detected."
	default:
		return "Monitoring alert detected."
	}
}

// buildSessionAlerts ports Rust build_alerts: same alert-type filter (with
// the high/critical-only rule for VIOLATION_DETECTED), same severity
// defaults, same message fallback, same unknown-student fallback.
func buildSessionAlerts(logs []SessionAuditLog, sessions []StudentSessionSummary) []ProctorAlert {
	out := []ProctorAlert{}
	for _, log := range logs {
		if log.ActionType == "VIOLATION_DETECTED" {
			if sev := jsonStringField(log.Payload, "severity"); sev != "high" && sev != "critical" {
				continue
			}
		} else {
			switch log.ActionType {
			case "HEARTBEAT_LOST", "DEVICE_CONTINUITY_FAILED", "NETWORK_DISCONNECTED",
				"AUTO_ACTION", "STUDENT_WARN", "STUDENT_PAUSE", "STUDENT_TERMINATE":
			default:
				continue
			}
		}
		studentName := "Candidate"
		studentID := "unknown"
		if log.TargetStudentID != nil {
			for i := range sessions {
				if sessions[i].AttemptID == *log.TargetStudentID {
					studentName = sessions[i].StudentName
					studentID = sessions[i].StudentID
					break
				}
			}
		}
		severity := jsonStringField(log.Payload, "severity")
		if severity == "" {
			switch log.ActionType {
			case "DEVICE_CONTINUITY_FAILED", "STUDENT_TERMINATE":
				severity = "critical"
			case "HEARTBEAT_LOST", "NETWORK_DISCONNECTED":
				severity = "high"
			default:
				severity = "medium"
			}
		}
		message := jsonStringField(log.Payload, "message")
		if message == "" {
			message = jsonStringField(log.Payload, "reason")
		}
		if message == "" {
			message = defaultAlertMessage(log.ActionType)
		}
		out = append(out, ProctorAlert{
			ID:             log.ID,
			Severity:       severity,
			AlertType:      log.ActionType,
			StudentName:    studentName,
			StudentID:      studentID,
			Timestamp:      log.CreatedAt,
			Message:        message,
			IsAcknowledged: log.AcknowledgedAt != nil,
		})
	}
	return out
}

func scanSessionAuditLog(row interface{ Scan(dest ...any) error }) (SessionAuditLog, error) {
	var l SessionAuditLog
	var target, ackBy, payload sql.NullString
	var ackAt sql.NullTime
	if err := row.Scan(&l.ID, &l.ScheduleID, &l.Actor, &l.ActionType, &target, &payload, &ackAt, &ackBy, &l.CreatedAt); err != nil {
		return SessionAuditLog{}, err
	}
	l.TargetStudentID = nullStringPtr(target)
	if payload.Valid {
		l.Payload = json.RawMessage(payload.String)
	}
	l.AcknowledgedAt = nullTimePtr(ackAt)
	l.AcknowledgedBy = nullStringPtr(ackBy)
	return l, nil
}

// loadAuditLogs ports Rust load_audit_logs (newest first; limit <= 0 means
// unbounded, matching Rust None).
func loadAuditLogs(ctx context.Context, q sessionQuerier, scheduleID string, limit int) ([]SessionAuditLog, error) {
	query := "SELECT id, schedule_id, actor, action_type, target_student_id, payload, acknowledged_at, acknowledged_by, created_at FROM session_audit_logs WHERE schedule_id = ? ORDER BY created_at DESC"
	var rows *sql.Rows
	var err error
	if limit > 0 {
		query += " LIMIT ?"
		rows, err = q.QueryContext(ctx, query, scheduleID, limit)
	} else {
		rows, err = q.QueryContext(ctx, query, scheduleID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SessionAuditLog{}
	for rows.Next() {
		l, err := scanSessionAuditLog(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// alertLogFilter is the Rust load_alert_logs predicate verbatim.
const alertLogFilter = "acknowledged_at IS NULL AND action_type IN (" +
	"'HEARTBEAT_LOST', 'DEVICE_CONTINUITY_FAILED', 'NETWORK_DISCONNECTED', " +
	"'AUTO_ACTION', 'STUDENT_WARN', 'STUDENT_PAUSE', 'STUDENT_TERMINATE')"

// loadAlertLogs ports Rust load_alert_logs (unacked monitor actions only).
func loadAlertLogs(ctx context.Context, q sessionQuerier, scheduleID string, limit int) ([]SessionAuditLog, error) {
	query := "SELECT id, schedule_id, actor, action_type, target_student_id, payload, acknowledged_at, acknowledged_by, created_at FROM session_audit_logs WHERE schedule_id = ? AND " + alertLogFilter + " ORDER BY created_at DESC"
	var rows *sql.Rows
	var err error
	if limit > 0 {
		query += " LIMIT ?"
		rows, err = q.QueryContext(ctx, query, scheduleID, limit)
	} else {
		rows, err = q.QueryContext(ctx, query, scheduleID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SessionAuditLog{}
	for rows.Next() {
		l, err := scanSessionAuditLog(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func loadSessionNotes(ctx context.Context, q sessionQuerier, scheduleID string) ([]SessionNote, error) {
	rows, err := q.QueryContext(ctx, "SELECT id, schedule_id, author, category, content, is_resolved, created_at, updated_at FROM session_notes WHERE schedule_id = ? ORDER BY created_at DESC", scheduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SessionNote{}
	for rows.Next() {
		var n SessionNote
		var resolved sql.NullBool
		if err := rows.Scan(&n.ID, &n.ScheduleID, &n.Author, &n.Category, &n.Content, &resolved, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, err
		}
		n.IsResolved = resolved.Valid && resolved.Bool
		out = append(out, n)
	}
	return out, rows.Err()
}

func loadSessionPresence(ctx context.Context, q sessionQuerier, scheduleID string) ([]ProctorPresence, error) {
	rows, err := q.QueryContext(ctx, "SELECT id, schedule_id, proctor_id, proctor_name, status, joined_at, last_heartbeat_at, left_at FROM proctor_presence WHERE schedule_id = ? AND left_at IS NULL ORDER BY last_heartbeat_at DESC", scheduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProctorPresence{}
	for rows.Next() {
		var p ProctorPresence
		var left sql.NullTime
		if err := rows.Scan(&p.ID, &p.ScheduleID, &p.ProctorID, &p.ProctorName, &p.Status, &p.JoinedAt, &p.LastHeartbeatAt, &left); err != nil {
			return nil, err
		}
		p.LeftAt = nullTimePtr(left)
		out = append(out, p)
	}
	return out, rows.Err()
}

func loadViolationRules(ctx context.Context, q sessionQuerier, scheduleID string) ([]ViolationRule, error) {
	rows, err := q.QueryContext(ctx, "SELECT id, schedule_id, trigger_type, threshold, specific_violation_type, specific_severity, action, is_enabled, created_at, created_by FROM violation_rules WHERE schedule_id = ? ORDER BY created_at DESC", scheduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ViolationRule{}
	for rows.Next() {
		var v ViolationRule
		var threshold int64
		var specType, specSev sql.NullString
		var enabled sql.NullBool
		if err := rows.Scan(&v.ID, &v.ScheduleID, &v.TriggerType, &threshold, &specType, &specSev, &v.Action, &enabled, &v.CreatedAt, &v.CreatedBy); err != nil {
			return nil, err
		}
		v.Threshold = int(threshold)
		v.SpecificViolationType = nullStringPtr(specType)
		v.SpecificSeverity = nullStringPtr(specSev)
		v.IsEnabled = enabled.Valid && enabled.Bool
		out = append(out, v)
	}
	return out, rows.Err()
}

// alertCountFilter is the Rust list_sessions alert-count predicate verbatim,
// including the high/critical-only sub-filter for VIOLATION_DETECTED.
const alertCountFilter = "acknowledged_at IS NULL AND action_type IN (" +
	"'HEARTBEAT_LOST', 'DEVICE_CONTINUITY_FAILED', 'NETWORK_DISCONNECTED', " +
	"'AUTO_ACTION', 'STUDENT_WARN', 'STUDENT_PAUSE', 'STUDENT_TERMINATE', 'VIOLATION_DETECTED'" +
	") AND (action_type != 'VIOLATION_DETECTED' OR " +
	"JSON_UNQUOTE(JSON_EXTRACT(payload, '$.severity')) IN ('high', 'critical'))"

// loadGroupedCounts ports Rust load_grouped_counts: one grouped COUNT over
// the given ids (empty ids short-circuit with no query).
func loadGroupedCounts(ctx context.Context, q sessionQuerier, prefix, suffix string, ids []string) (map[string]int64, error) {
	out := map[string]int64{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.QueryContext(ctx, prefix+"("+placeholders(len(ids))+")"+suffix, stringArgs(ids)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var n int64
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}

// admissionQueueExists ports Rust admission_queue_table_exists.
func admissionQueueExists(ctx context.Context, q sessionQuerier) (bool, error) {
	const sel = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'student_admission_queue'"
	var n int64
	if err := q.QueryRowContext(ctx, sel).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
}

// loadAdmissionTotals ports Rust load_admission_queue_totals.
func loadAdmissionTotals(ctx context.Context, q sessionQuerier, ids []string) (map[string]int64, error) {
	out := map[string]int64{}
	if len(ids) == 0 {
		return out, nil
	}
	exists, err := admissionQueueExists(ctx, q)
	if err != nil || !exists {
		return out, err
	}
	return loadGroupedCounts(ctx, q,
		"SELECT schedule_id, COUNT(*) FROM student_admission_queue WHERE schedule_id IN ",
		" AND status <> 'cancelled' GROUP BY schedule_id", ids)
}

// loadDegradedMap ports Rust load_degraded_schedule_ids: with live mode on,
// schedules owning stale unpublished schedule_runtime outbox rows are
// degraded (same 15s threshold + predicate as liveModeStaleOutboxCount on
// the HTTP layer).
func loadDegradedMap(ctx context.Context, q sessionQuerier, liveModeEnabled bool, ids []string) (map[string]bool, error) {
	out := map[string]bool{}
	if !liveModeEnabled || len(ids) == 0 {
		return out, nil
	}
	threshold := time.Now().UTC().Add(-15 * time.Second)
	rows, err := q.QueryContext(ctx,
		"SELECT aggregate_id, COUNT(*) FROM outbox_events WHERE aggregate_kind = 'schedule_runtime' AND published_at IS NULL AND failed_at IS NULL AND created_at < ? AND aggregate_id IN ("+placeholders(len(ids))+") GROUP BY aggregate_id",
		append([]any{threshold}, stringArgs(ids)...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var n int64
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n > 0
	}
	return out, rows.Err()
}

// ListSessions returns one summary per schedule: schedule + hydrated
// runtime + grouped student/active counts + admission totals + alert/
// violation counts + degraded flags. It mirrors Rust list_sessions before
// the handler-side assignment/provider filters.
func (s *Service) ListSessions(ctx context.Context, actor Actor, liveModeEnabled bool) ([]ProctorSessionSummary, error) {
	if err := requireSessionReader(actor); err != nil {
		return nil, err
	}
	q, err := s.sessionDB()
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	schedules, err := loadSessionSchedules(ctx, q)
	if err != nil {
		return nil, err
	}
	out := []ProctorSessionSummary{}
	if len(schedules) == 0 {
		return out, nil
	}
	ids := make([]string, 0, len(schedules))
	for _, schedule := range schedules {
		ids = append(ids, schedule.ID)
	}
	runtimes, err := loadSessionRuntimes(ctx, q, schedules, now)
	if err != nil {
		return nil, err
	}
	studentCounts, err := loadGroupedCounts(ctx, q,
		"SELECT schedule_id, COUNT(*) FROM student_attempts WHERE schedule_id IN ",
		" GROUP BY schedule_id", ids)
	if err != nil {
		return nil, err
	}
	activeCounts, err := loadGroupedCounts(ctx, q,
		"SELECT schedule_id, COUNT(*) FROM student_attempts WHERE schedule_id IN ",
		" AND COALESCE(proctor_status, 'active') NOT IN ('terminated', 'paused') AND phase = 'exam' GROUP BY schedule_id", ids)
	if err != nil {
		return nil, err
	}
	joinTotals, err := loadAdmissionTotals(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	alertCounts, err := loadGroupedCounts(ctx, q,
		"SELECT schedule_id, COUNT(*) FROM session_audit_logs WHERE schedule_id IN ",
		" AND "+alertCountFilter+" GROUP BY schedule_id", ids)
	if err != nil {
		return nil, err
	}
	violationCounts, err := loadGroupedCounts(ctx, q,
		"SELECT schedule_id, COUNT(*) FROM student_violation_events WHERE schedule_id IN ",
		" GROUP BY schedule_id", ids)
	if err != nil {
		return nil, err
	}
	degraded, err := loadDegradedMap(ctx, q, liveModeEnabled, ids)
	if err != nil {
		return nil, err
	}
	for _, schedule := range schedules {
		students := studentCounts[schedule.ID]
		joinTotal := joinTotals[schedule.ID]
		if joinTotal < students {
			joinTotal = students
		}
		ready := students
		total := joinTotal
		out = append(out, ProctorSessionSummary{
			Schedule:         schedule,
			Runtime:          runtimes[schedule.ID],
			StudentCount:     students,
			ActiveCount:      activeCounts[schedule.ID],
			JoinReadyCount:   &ready,
			JoinTotalCount:   &total,
			AlertCount:       alertCounts[schedule.ID],
			ViolationCount:   violationCounts[schedule.ID],
			DegradedLiveMode: degraded[schedule.ID],
		})
	}
	return out, nil
}

// GetSessionDetail returns the full session view: schedule + hydrated
// runtime + degraded snapshot + student sessions + audit/alert logs + notes
// + presence + violation rules. It mirrors Rust
// get_session_detail_with_options: auditLimit/alertLimit <= 0 mean unbounded
// (Rust None), and equal limits build alerts from the audit rows with no
// second query (Rust alert_limit == audit_limit, which is also how the
// default non-dashboard path behaves).
func (s *Service) GetSessionDetail(ctx context.Context, actor Actor, scheduleID string, auditLimit, alertLimit int) (ProctorSessionDetail, error) {
	if err := requireSessionReader(actor); err != nil {
		return ProctorSessionDetail{}, err
	}
	q, err := s.sessionDB()
	if err != nil {
		return ProctorSessionDetail{}, err
	}
	now := time.Now().UTC()
	schedule, err := loadSessionSchedule(ctx, q, scheduleID)
	if err != nil {
		return ProctorSessionDetail{}, err
	}
	runtime, err := loadSessionRuntime(ctx, q, schedule, now)
	if err != nil {
		return ProctorSessionDetail{}, err
	}
	// Staff run sheet: the authored section/module windows of the version this
	// schedule runs, attached to the detail runtime only (the summary and
	// student reads keep ExamPlan null).
	plan, err := loadExamPlan(ctx, q, schedule.PublishedVersionID)
	if err != nil {
		return ProctorSessionDetail{}, err
	}
	runtime.ExamPlan = plan
	// Degraded stays false here: the service signature carries no live-mode
	// flag (the Rust handler owns state.live_mode_enabled and passes it
	// into the service). The HTTP handler overwrites DegradedLiveMode from
	// app.Config.LiveModeEnabled via the stale-outbox check after this call.
	rows, err := loadStudentSessions(ctx, q, scheduleID)
	if err != nil {
		return ProctorSessionDetail{}, err
	}
	sessions := []StudentSessionSummary{}
	for _, row := range rows {
		sessions = append(sessions, attemptRowToSession(row, runtime))
	}
	auditLogs, err := loadAuditLogs(ctx, q, scheduleID, auditLimit)
	if err != nil {
		return ProctorSessionDetail{}, err
	}
	var alerts []ProctorAlert
	if auditLimit == alertLimit {
		alerts = buildSessionAlerts(auditLogs, sessions)
	} else {
		alertLogs, err := loadAlertLogs(ctx, q, scheduleID, alertLimit)
		if err != nil {
			return ProctorSessionDetail{}, err
		}
		alerts = buildSessionAlerts(alertLogs, sessions)
	}
	notes, err := loadSessionNotes(ctx, q, scheduleID)
	if err != nil {
		return ProctorSessionDetail{}, err
	}
	presence, err := loadSessionPresence(ctx, q, scheduleID)
	if err != nil {
		return ProctorSessionDetail{}, err
	}
	rules, err := loadViolationRules(ctx, q, scheduleID)
	if err != nil {
		return ProctorSessionDetail{}, err
	}
	return ProctorSessionDetail{
		Schedule:         schedule,
		Runtime:          runtime,
		Sessions:         sessions,
		Alerts:           alerts,
		AuditLogs:        auditLogs,
		Notes:            notes,
		Presence:         presence,
		ViolationRules:   rules,
		DegradedLiveMode: false,
	}, nil
}

// placeholders renders "(?, ?, ...)"-style bind lists without parens.
func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.Repeat("?, ", n-1) + "?"
}

// stringArgs boxes ids for QueryContext.
func stringArgs(ids []string) []any {
	args := make([]any, 0, len(ids))
	for _, id := range ids {
		args = append(args, id)
	}
	return args
}

func nullStringPtr(n sql.NullString) *string {
	if !n.Valid {
		return nil
	}
	v := n.String
	return &v
}

func nullTimePtr(n sql.NullTime) *time.Time {
	if !n.Valid {
		return nil
	}
	v := n.Time
	return &v
}

func nullIntPtr(n sql.NullInt64) *int {
	if !n.Valid {
		return nil
	}
	v := int(n.Int64)
	return &v
}
