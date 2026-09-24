package delivery

import (
	"context"
	"database/sql"
	"time"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// SatModuleEntryAck is the compact, authoritative answer to "where is this
// module entry right now?".
//
// It exists because the student's recovery path used to be a blind replay of
// the transition command: when the server had already committed (the response
// was lost, or the browser gave up on a saturated entry), replaying
// StartModule/EnterModule re-ran the expensive path against the same
// over-subscribed database, and only a full page refresh — which reads the
// authoritative bootstrap — discovered the committed state.
//
// Every field here is readable from one indexed row (plus the attempt's
// control epoch and the runtime revision as scalar subqueries), so the client
// can decide between "already active", "offer still valid", and "genuinely not
// started" without paying for an attempt projection.
type SatModuleEntryAck struct {
	ScheduleID      string           `json:"scheduleId"`
	AttemptID       string           `json:"attemptId"`
	ModuleID        string           `json:"moduleId"`
	ModuleAttemptID string           `json:"moduleAttemptId"`
	ModuleRevision  int              `json:"moduleRevision"`
	SelectedSection *DeliverySection `json:"selectedSection,omitempty"`

	// State is the raw assessment_module_attempts.state row value:
	// not_started / active / review / locked / submitted.
	State string `json:"state"`
	// TimingModel is the schedule runtime's model ('' when the schedule has no
	// runtime row yet). Entry offers only exist under TimingModelPersonal.
	TimingModel string `json:"timingModel"`
	// EntryState is the derived entry verdict the client acts on:
	//   none      — no offer and no start: the client must request an offer.
	//   armed     — a valid future offer exists but is not confirmed.
	//   confirmed — the offer was confirmed; the authored clock starts at
	//               EntryStartsAt and the client only has to paint.
	//   entered   — the first active frame was acknowledged; the offer is
	//               closed and a replay can only resume, never rearm.
	EntryState string `json:"entryState"`

	EntryGeneration  int        `json:"entryGeneration"`
	EntryStartsAt    *time.Time `json:"entryStartsAt,omitempty"`
	EntryConfirmedAt *time.Time `json:"entryConfirmedAt,omitempty"`
	EntryEnteredAt   *time.Time `json:"entryEnteredAt,omitempty"`

	StartedAt        *time.Time `json:"startedAt,omitempty"`
	DeadlineAt       *time.Time `json:"deadlineAt,omitempty"`
	RemainingSeconds *int64     `json:"remainingSeconds,omitempty"`

	// ServerNow is the database instant the client should offset its clock
	// against. The entry lead is judged from this, never from local wall time.
	ServerNow       time.Time `json:"serverNow"`
	ControlEpoch    int       `json:"controlEpoch"`
	RuntimeRevision int64     `json:"runtimeRevision"`
}

// satEntryStateQuery is the one-row entry read: it is a single query on purpose,
// because the recovery path must stay cheaper than the transition commands it is
// recovering (plan 2026-09-24, entry reliability). The two scalar subqueries are
// both keyed by the schedule, so they add one indexed lookup each and no join
// fan-out.
const satEntryStateQuery = "SELECT ma.id, ma.module_id, ma.state, ma.revision, ma.allocated_seconds, ma.available_at, ma.started_at, ma.paused_at, ma.accumulated_paused_seconds, ma.extension_seconds, ma.entry_generation, ma.entry_starts_at, ma.entry_confirmed_at, ma.entry_entered_at, (SELECT COALESCE(sa.control_epoch, 0) FROM student_attempts sa WHERE sa.id = ma.attempt_id), (SELECT COALESCE(rt.timing_model, '') FROM exam_session_runtimes rt WHERE rt.schedule_id = ?), (SELECT COALESCE(rt.revision, 0) FROM exam_session_runtimes rt WHERE rt.schedule_id = ?), UTC_TIMESTAMP(6) FROM assessment_module_attempts ma WHERE ma.attempt_id = ? AND ma.module_id = ?"

// SatStageVisibleAck is the compact response to the first-active-paint
// acknowledgment. The candidate is already looking at the module when it
// fires, so there is nothing in an attempt projection the client still needs —
// returning one meant every entry paid for a second full projection to
// acknowledge a one-row write.
type SatStageVisibleAck struct {
	Acknowledged    bool      `json:"acknowledged"`
	ModuleID        string    `json:"moduleId"`
	EntryGeneration int       `json:"entryGeneration"`
	ServerNow       time.Time `json:"serverNow"`
}

// moduleEntryAwaitingStart reports whether the requested module attempt row is
// already seeded and unstarted. Callers use it to decide whether entry has to
// pay for timeout reconciliation (plan 2026-09-24, entry reliability): an
// existing not_started row cannot be expired, so reconcile has no work to do
// for it. A missing row means the adaptive branch has not been created yet and
// the caller must reconcile; any read failure is reported so the caller can
// fail closed to the full reconcile path rather than skip work on uncertainty.
func (s *Service) moduleEntryAwaitingStart(ctx context.Context, attemptID, moduleID string) (bool, error) {
	var state string
	if err := s.db.QueryRowContext(ctx,
		"SELECT state FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?",
		attemptID, moduleID).Scan(&state); err != nil {
		return false, err
	}
	return state == "not_started", nil
}

// deriveEntryState is the one owner of the entry verdict precedence, so the
// client never re-implements it: an acknowledged first frame outranks a
// confirmation, which outranks a still-future unconfirmed offer.
func deriveEntryState(startsAt, confirmedAt, enteredAt *time.Time) string {
	if enteredAt != nil {
		return "entered"
	}
	if confirmedAt != nil {
		return "confirmed"
	}
	if startsAt != nil {
		return "armed"
	}
	return "none"
}

// EntryState is the authoritative, cheap entry read behind "Retry now" and the
// lost-response recovery path. It mutates nothing: no transaction, no attempt
// projection, no reconcile. A client that receives a terminal conflict from a
// transition command asks here first, and only replays the command when this
// answer says the work genuinely has not happened.
func (s *Service) EntryState(ctx context.Context, bearerScheduleID, bearerAttemptID, urlScheduleID, moduleID string) (*SatModuleEntryAck, error) {
	if urlScheduleID != bearerScheduleID {
		return nil, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule.")
	}
	scheduleID, examID, providerKey, _, err := s.startScheduleBinding(ctx, bearerScheduleID)
	if err != nil {
		return nil, err
	}
	if providerKey != "sat" {
		return nil, apperrors.New(apperrors.CodeUnsupportedProvider, "The assessment provider is not supported.")
	}
	if err := s.saveAttemptBinding(ctx, scheduleID, bearerAttemptID, examID); err != nil {
		return nil, err
	}
	return s.entryStateBound(ctx, scheduleID, bearerAttemptID, moduleID)
}

// entryStateBound is the one indexed post-commit read used by transition ACKs.
// The public recovery read performs its bearer/schedule binding first.
func (s *Service) entryStateBound(ctx context.Context, scheduleID, bearerAttemptID, moduleID string) (*SatModuleEntryAck, error) {
	var ack SatModuleEntryAck
	var startsAt, confirmedAt, enteredAt, startedAt, pausedAt, availableAt sql.NullTime
	var generation, allocatedSeconds, accumulatedPausedSeconds, extensionSeconds int
	err := s.db.QueryRowContext(ctx, satEntryStateQuery,
		scheduleID, scheduleID, bearerAttemptID, moduleID).
		Scan(&ack.ModuleAttemptID, &ack.ModuleID, &ack.State, &ack.ModuleRevision, &allocatedSeconds,
			&availableAt, &startedAt, &pausedAt,
			&accumulatedPausedSeconds, &extensionSeconds,
			&generation, &startsAt, &confirmedAt, &enteredAt,
			&ack.ControlEpoch, &ack.TimingModel, &ack.RuntimeRevision, &ack.ServerNow)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, apperrors.New(apperrors.CodeNotFound, "Module attempt not found for this module.")
		}
		return nil, err
	}

	ack.ScheduleID = scheduleID
	ack.AttemptID = bearerAttemptID
	ack.ServerNow = ack.ServerNow.UTC()
	ack.EntryGeneration = generation
	ack.EntryStartsAt = nullTime(startsAt)
	ack.EntryConfirmedAt = nullTime(confirmedAt)
	ack.EntryEnteredAt = nullTime(enteredAt)
	ack.StartedAt = nullTime(startedAt)
	ack.EntryState = deriveEntryState(ack.EntryStartsAt, ack.EntryConfirmedAt, ack.EntryEnteredAt)
	if ack.EntryState == "armed" && !ack.ServerNow.Before(*ack.EntryStartsAt) {
		ack.EntryState = "none"
	}

	if !examruntime.IsSatPersonal(ack.TimingModel) {
		// A cohort/legacy module has no entry offer: report the row and let the
		// client keep its existing path instead of inventing an offer.
		ack.EntryState = "none"
		ack.EntryGeneration = 0
		ack.EntryStartsAt = nil
		ack.EntryConfirmedAt = nil
		ack.EntryEnteredAt = nil
	}
	ack.DeadlineAt, ack.RemainingSeconds = computeModuleTiming(
		nullTime(availableAt), ack.StartedAt, nullTime(pausedAt), allocatedSeconds,
		accumulatedPausedSeconds, extensionSeconds, ack.ServerNow)
	return &ack, nil
}

// selectedModuleSection supplies only the chosen immutable module when a
// client's cold snapshot lacks it. The common entry path never calls this.
func (s *Service) selectedModuleSection(ctx context.Context, scheduleID, versionID, moduleID string) (*DeliverySection, error) {
	revision, err := s.versionRevision(ctx, versionID)
	if err != nil {
		return nil, err
	}
	sections, err := s.cachedSections(ctx, versionID, revision)
	if err != nil {
		return nil, err
	}
	scope, err := s.effectiveSectionScope(ctx, scheduleID, versionID)
	if err != nil {
		return nil, err
	}
	for _, section := range sections {
		if !examdomain.AllowsSection(scope, section.SectionKey) {
			continue
		}
		for _, module := range section.Modules {
			if module.ID == moduleID {
				section.Modules = []DeliveryModule{module}
				return &section, nil
			}
		}
	}
	return nil, apperrors.New(apperrors.CodeNotFound, "Selected module content not found.")
}
