// Package delivery owns the assessment-delivery bootstrap slice for the Go
// backend.
//
// Bootstrap assembles the candidate-facing delivery payload: the schedule
// binding, the published-version content tree (sections -> modules ->
// questions), the attempt snapshot (module attempts + responses with
// Go-computed deadlines), attempt control fields, cohort timing, and an
// already-persisted result for terminal attempts. It never computes a score
// during a read.
package delivery

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/act"
	"example.com/ielts-proctoring/internal/assessscore"
	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/proctor"
	examruntime "example.com/ielts-proctoring/internal/runtime"
	"example.com/ielts-proctoring/internal/sat"
)

// Service wires delivery reads explicitly.
type Service struct {
	db     *sql.DB
	runner *tx.Runner
	// versions caches immutable published trees (plan D1, nil = off).
	versions *VersionCache
	// liveOrigin is this instance's bus origin id (mirrors App.LiveBus.Origin).
	// liveHub fans committed events to in-process subscribers (App.LiveHub).
	// Both are optional: nil hub disables fanout, empty origin writes an
	// empty origin on bus rows (tests leave them unset).
	liveOrigin string
	liveHub    *liveupdates.Hub
	// liveDirect selects the plan-C1 Hub-only posture: in-tx AppendInTx
	// INSERTs are skipped (zero live-bus SQL on hot paths); post-commit
	// Hub.Publish still fans out (single-deploy: no peers to forward to).
	liveDirect bool
	// liveSinkBus + liveSinkMode select the optional async debug sink
	// (plan C1): sample = ~1:1000 hub events also Append a bus row
	// post-commit (outside any business tx); off = zero bus writes.
	liveSinkBus  *liveupdates.Bus
	liveSinkMode config.LiveBusSinkMode
	// liveSinkCount counts hub events for deterministic 1:1000 sampling
	// (atomic: publishHubEvents runs concurrently per request).
	liveSinkCount atomic.Uint64
	// completer runs CompleteAssessment when reconcile finalizes the last open
	// module (Rust complete_assessment, submission_id=attempt_id). Optional:
	// nil disables the hook (tests leave it unset); invoked outside the tx.
	completer AssessmentCompleter
}

// NewService wires dependencies explicitly.
func NewService(db *sql.DB, runner *tx.Runner) *Service {
	return &Service{db: db, runner: runner}
}

// SetLive wires the live-update bus origin + hub explicitly. Callers (BuildApp)
// pass the LiveBus origin and LiveHub; Hub.Publish stays best-effort and never
// fails the request.
func (s *Service) SetLive(origin string, hub *liveupdates.Hub) *Service {
	s.liveOrigin = origin
	s.liveHub = hub
	return s
}

// SetLiveDirect toggles the plan-C1 Hub-only posture (chainable). Direct =
// in-tx bus INSERTs skipped; Hub.Publish post-commit still fans out.
func (s *Service) SetLiveDirect(on bool) *Service {
	s.liveDirect = on
	return s
}

// LiveDirect reports the Hub-only posture (assertable without a pool).
func (s *Service) LiveDirect() bool { return s != nil && s.liveDirect }

// SetLiveSink wires the optional async debug sink (plan C1, chainable):
// sample keeps ~1:1000 bus rows post-commit for debugging; off (default)
// writes nothing. A nil bus disables the sink regardless of mode.
func (s *Service) SetLiveSink(bus *liveupdates.Bus, mode config.LiveBusSinkMode) *Service {
	s.liveSinkBus = bus
	s.liveSinkMode = mode
	return s
}

// SetCompleter wires the terminal CompleteAssessment hook for reconcile.
// Callers (BuildApp) pass the sat adapter; nil disables the hook.
func (s *Service) SetCompleter(c AssessmentCompleter) *Service {
	s.completer = c
	return s
}

// SetVersionCache wires the plan-D1 immutable version cache (chainable).
// Nil disables caching (today's N+1 LoadSections on every bootstrap).
func (s *Service) SetVersionCache(c *VersionCache) *Service {
	s.versions = c
	return s
}

// VersionCached reports the D1 cache posture (assertable without a pool).
func (s *Service) VersionCached() bool { return s != nil && s.versions != nil }

// InvalidateVersion drops one cached tree (authoring publish path hook).
// Correctness does not depend on it — the revision probe fails closed on
// publish races — but calling it on publish avoids one redundant reload.
// No version-publish flow exists in Go today (authoring works on drafts),
// so this is wired for the future path, not an active call site.
func (s *Service) InvalidateVersion(versionID string) {
	if s != nil && s.versions != nil {
		s.versions.Invalidate(versionID)
	}
}

// DeliveredQuestion is one version-pinned question in delivery order.
//
// Security: no pretest marker crosses to candidates. IsPretest is a
// test-strategy signal (it tells a candidate which items don't count);
// the server still scores pretest exclusion internally via eq.is_pretest.
type DeliveredQuestion struct {
	ExamQuestionID string          `json:"examQuestionId"`
	QuestionID     string          `json:"questionId"`
	DisplayOrder   int             `json:"displayOrder"`
	QuestionType   string          `json:"questionType"`
	Stimulus       json.RawMessage `json:"stimulus"`
	Prompt         json.RawMessage `json:"prompt"`
	Answer         json.RawMessage `json:"answer"`
	Metadata       json.RawMessage `json:"metadata"`
	Accessibility  json.RawMessage `json:"accessibility"`
}

// DeliveryModule is one module with its delivered questions.
type DeliveryModule struct {
	ID                  string              `json:"id"`
	ModuleKey           string              `json:"moduleKey"`
	Title               string              `json:"title"`
	DisplayOrder        int                 `json:"displayOrder"`
	DurationSeconds     int                 `json:"durationSeconds"`
	TargetQuestionCount int                 `json:"targetQuestionCount"`
	AdaptiveRole        string              `json:"adaptiveRole"`
	Instructions        json.RawMessage     `json:"instructions"`
	ToolPolicy          json.RawMessage     `json:"toolPolicy"`
	Questions           []DeliveredQuestion `json:"questions"`
}

// DeliverySection is one section with its modules.
type DeliverySection struct {
	ID                string           `json:"id"`
	SectionKey        string           `json:"sectionKey"`
	Title             string           `json:"title"`
	DisplayOrder      int              `json:"displayOrder"`
	DurationSeconds   int              `json:"durationSeconds"`
	BreakAfterSeconds int              `json:"breakAfterSeconds"`
	Instructions      json.RawMessage  `json:"instructions"`
	Modules           []DeliveryModule `json:"modules"`
}

// ModuleAttempt is one attempt-scoped module row with Go-computed timing.
type ModuleAttempt struct {
	ID                       string     `json:"id"`
	ModuleID                 string     `json:"moduleId"`
	State                    string     `json:"state"`
	AllocatedSeconds         int        `json:"allocatedSeconds"`
	AvailableAt              *time.Time `json:"availableAt"`
	StartedAt                *time.Time `json:"startedAt"`
	PausedAt                 *time.Time `json:"pausedAt"`
	AccumulatedPausedSeconds int        `json:"accumulatedPausedSeconds"`
	ExtensionSeconds         int        `json:"extensionSeconds"`
	DeadlineAt               *time.Time `json:"deadlineAt"`
	RemainingSeconds         *int64     `json:"remainingSeconds"`
	// EntryWindowSeconds is what THIS candidate will be granted if they enter
	// this module right now: the room-anchored window StartModule writes, computed
	// by the same two functions the write path uses (cohortModuleWindowEnd,
	// cohortModuleWindowSeconds). It exists only where the authored length would
	// overstate — a SAT cohort-section module that has not started, whose row
	// carries an allotment, and whose section clock is the running stage — so a
	// late arrival is told the room's remainder instead of a fresh module. Nil
	// everywhere else: a started module's deadlineAt/remainingSeconds are the
	// truth, and a module in a section that has not opened has no room window yet.
	EntryWindowSeconds *int `json:"entryWindowSeconds"`
	// Personal-model future-start offer. Generation fences stale start/enter
	// requests; the offer is accepted only before startsAt, and enteredAt is
	// acknowledged after the first active frame paints.
	EntryGeneration          *int            `json:"entryGeneration,omitempty"`
	EntryStartsAt            *time.Time      `json:"entryStartsAt,omitempty"`
	EntryConfirmedAt         *time.Time      `json:"entryConfirmedAt,omitempty"`
	EntryEnteredAt           *time.Time      `json:"entryEnteredAt,omitempty"`
	CompletionReason         *string         `json:"completionReason"`
	RawCorrect               *int64          `json:"rawCorrect"`
	OperationalQuestionCount *int64          `json:"operationalQuestionCount"`
	ToolState                json.RawMessage `json:"toolState"`
	Revision                 int             `json:"revision"`
}

// ResponseSnapshot is one persisted question response.
type ResponseSnapshot struct {
	ID                string          `json:"id"`
	ModuleAttemptID   string          `json:"moduleAttemptId"`
	ExamQuestionID    string          `json:"examQuestionId"`
	Response          json.RawMessage `json:"response"`
	MarkedForReview   bool            `json:"markedForReview"`
	EliminatedOptions json.RawMessage `json:"eliminatedOptions"`
	Annotations       json.RawMessage `json:"annotations"`
	Revision          int             `json:"revision"`
}

// AttemptSnapshot groups module attempts with their responses.
type AttemptSnapshot struct {
	ID             string             `json:"id"`
	ModuleAttempts []ModuleAttempt    `json:"moduleAttempts"`
	Responses      []ResponseSnapshot `json:"responses"`
	PersonalBreaks []PersonalBreak    `json:"personalBreaks,omitempty"`
	// ProvisionalSubmitted is true while the SAT attempt holds the V2
	// provisional terminal claim (delivery_status='submitted', submitted_at
	// still NULL) without a scoring result yet. The client uses it to skip
	// response resubmission and drive straight to result completion (SAT-001).
	ProvisionalSubmitted bool `json:"provisionalSubmitted"`
}

// PersonalBreak is one attempt-owned scheduled break. Its countdown runs only
// from the confirmed future start; delayed reconciliation/rendering cannot
// consume the authored duration.
type PersonalBreak struct {
	ID                       string     `json:"id"`
	AfterSectionID           string     `json:"afterSectionId"`
	DurationSeconds          int        `json:"durationSeconds"`
	State                    string     `json:"state"`
	StartsAt                 *time.Time `json:"startsAt"`
	DeadlineAt               *time.Time `json:"deadlineAt"`
	EnteredAt                *time.Time `json:"enteredAt"`
	PausedAt                 *time.Time `json:"pausedAt"`
	AccumulatedPausedSeconds int        `json:"accumulatedPausedSeconds"`
	EntryGeneration          int        `json:"entryGeneration"`
	EntryStartsAt            *time.Time `json:"entryStartsAt"`
	EntryConfirmedAt         *time.Time `json:"entryConfirmedAt"`
	EntryEnteredAt           *time.Time `json:"entryEnteredAt"`
	RemainingSeconds         int64      `json:"remainingSeconds"`
	Revision                 int        `json:"revision"`
}

// TimingSnapshot is the cohort/legacy timing projection.
type TimingSnapshot struct {
	Authority        string     `json:"authority"`
	TimingModel      string     `json:"timingModel"`
	StageKey         *string    `json:"stageKey"`
	StageStatus      string     `json:"stageStatus"`
	ServerNow        time.Time  `json:"serverNow"`
	DeadlineAt       *time.Time `json:"deadlineAt"`
	RemainingSeconds int64      `json:"remainingSeconds"`
	// NextSectionStartAt is non-nil only in the between-sections window: the
	// server's authoritative instant the next section goes live. The client
	// counts the break down against it (the active section's own deadline is
	// already past, so its clock cannot drive the break countdown).
	NextSectionStartAt *time.Time `json:"nextSectionStartAt"`
	// WaitingForNextSection mirrors the runtime flag that defines the window:
	// the active section is complete and the next one has not gone live yet.
	// It is the state both sides read; NextSectionStartAt is its countdown
	// instant, so neither has to infer the window from the other.
	WaitingForNextSection bool  `json:"waitingForNextSection"`
	RuntimeRevision       int64 `json:"runtimeRevision"`
}

// Bootstrap is the assessment-delivery bootstrap payload.
type Bootstrap struct {
	ScheduleID  string `json:"scheduleId"`
	ExamID      string `json:"examId"`
	ProviderKey string `json:"providerKey"`
	VersionID   string `json:"versionId"`
	// VersionRevision is the exam_versions row revision backing Sections
	// (plan D1: ETag W/"v{versionID}-{revision}" + If-None-Match -> 304).
	VersionRevision       int64             `json:"versionRevision"`
	ServerNow             time.Time         `json:"serverNow"`
	CandidateName         string            `json:"candidateName"`
	ScheduleRuntimeStatus string            `json:"scheduleRuntimeStatus"`
	Timing                TimingSnapshot    `json:"timing"`
	ProctorStatus         string            `json:"proctorStatus"`
	ProctorNote           *string           `json:"proctorNote"`
	DeviceFingerprintHash *string           `json:"deviceFingerprintHash"`
	Sections              []DeliverySection `json:"sections"`
	Attempt               AttemptSnapshot   `json:"attempt"`
	Result                any               `json:"result"`
}

// Bootstrap assembles the delivery payload for one SAT or ACT attempt. The bearer
// schedule id (from the verified attempt token) must match the URL schedule
// id; callers map typed errors via the stable apperrors envelope.
func (s *Service) Bootstrap(ctx context.Context, bearerScheduleID, bearerAttemptID, urlScheduleID string) (*Bootstrap, error) {
	if urlScheduleID != bearerScheduleID {
		return nil, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule.")
	}
	var scheduleID, examID, providerKey, versionID string
	var examType string
	if err := s.db.QueryRowContext(ctx,
		"SELECT s.id, s.exam_id, e.provider_key, s.published_version_id, e.exam_type FROM exam_schedules s JOIN exam_entities e ON e.id = s.exam_id WHERE s.id = ?",
		bearerScheduleID).Scan(&scheduleID, &examID, &providerKey, &versionID, &examType); err != nil {
		if err == sql.ErrNoRows {
			return nil, apperrors.New(apperrors.CodeNotFound, "Schedule not found.")
		}
		return nil, err
	}
	// Phase 02 (blocker 4): the stored provider_key is not authoritative for
	// legacy ACT rows (provider_key='ielts', exam_type='ACT'). Resolve the
	// effective provider centrally via exams.EffectiveProviderKey so legacy
	// ACT attempts keep Science delivery instead of hitting the
	// unsupported-provider gate.
	providerKey = examdomain.EffectiveProviderKey(providerKey, examType)
	if providerKey != "sat" && providerKey != "act" {
		err := apperrors.New(apperrors.CodeValidation, "The assessment provider is not supported.")
		err.Details = map[string]any{"code": "UNSUPPORTED_PROVIDER"}
		return nil, err
	}
	var attemptID, attemptScheduleID, attemptExamID string
	if err := s.db.QueryRowContext(ctx,
		"SELECT id, schedule_id, exam_id FROM student_attempts WHERE id = ?",
		bearerAttemptID).Scan(&attemptID, &attemptScheduleID, &attemptExamID); err != nil {
		if err == sql.ErrNoRows {
			return nil, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
		}
		return nil, err
	}
	if attemptScheduleID != bearerScheduleID || attemptExamID != examID {
		return nil, apperrors.New(apperrors.CodeValidation, "Attempt does not belong to this assessment schedule.")
	}
	// Reconcile-then-read (Rust bootstrap:372-378): finalize modules whose
	// authoritative window elapsed before assembling the payload. A reconcile
	// failure blocks the read so the caller retries: a failed terminal
	// CompleteAssessment surfaces as a retryable error (never swallowed).
	now := time.Now().UTC()
	if _, err := s.ReconcileAttemptTimeout(ctx, bearerScheduleID, bearerAttemptID, now); err != nil {
		return nil, err
	}
	// Plan D1: immutable version cache. The revision probe (1 indexed PK
	// get) both fails closed on publish races and feeds the ETag; a cache
	// hit skips the sections/modules/questions N+1 entirely.
	versionRev, err := s.versionRevision(ctx, versionID)
	if err != nil {
		return nil, err
	}
	sections, err := s.cachedSections(ctx, versionID, versionRev)
	if err != nil {
		return nil, err
	}
	// Intersect the immutable release scope with any Student Access narrowing.
	// This read is repeated independently of schedules.runtimePlanIn so even a
	// malformed schedule cannot expose excluded release content.
	scope, err := s.effectiveSectionScope(ctx, scheduleID, versionID)
	if err != nil {
		return nil, err
	}
	sections = deliverySectionsForScope(sections, scope)
	if err := s.ensureBaseModuleAttempt(ctx, attemptID, sections); err != nil {
		return nil, err
	}
	moduleAttempts, err := s.loadModuleAttempts(ctx, attemptID, now)
	if err != nil {
		return nil, err
	}
	moduleAttempts = filterModuleAttemptsForSections(moduleAttempts, sections)
	responses, err := s.loadResponses(ctx, attemptID)
	if err != nil {
		return nil, err
	}
	responses = filterResponsesForModuleAttempts(responses, moduleAttempts)
	control, err := s.loadAttemptControl(ctx, attemptID, attemptControl{})
	if err != nil {
		return nil, err
	}
	result, err := s.loadBootstrapResult(ctx, providerKey, attemptID, control)
	if err != nil {
		return nil, err
	}
	timing, runtimeStatus, roomSections, err := s.loadTiming(ctx, scheduleID, providerKey, now)
	if err != nil {
		return nil, err
	}
	if examruntime.IsSatPersonal(timing.TimingModel) {
		if err := s.loadPersonalEntryOffers(ctx, attemptID, moduleAttempts); err != nil {
			return nil, err
		}
	}
	var personalBreaks []PersonalBreak
	if examruntime.IsSatPersonal(timing.TimingModel) {
		personalBreaks, err = s.loadPersonalBreaks(ctx, attemptID, now)
		if err != nil {
			return nil, err
		}
	}
	// Tell a candidate what entering each module would actually grant them, on
	// the same room clock the write path clamps to. Non-SAT/legacy payloads and
	// modules with no running section window keep their authored length.
	publishEntryWindows(moduleAttempts, sections, timing, roomSections, now)
	return &Bootstrap{
		ScheduleID:            scheduleID,
		ExamID:                examID,
		ProviderKey:           providerKey,
		VersionID:             versionID,
		VersionRevision:       versionRev,
		ServerNow:             now,
		CandidateName:         control.candidateName,
		ScheduleRuntimeStatus: runtimeStatus,
		Timing:                timing,
		ProctorStatus:         control.proctorStatus,
		ProctorNote:           control.proctorNote,
		DeviceFingerprintHash: control.deviceFingerprintHash,
		Sections:              sections,
		Attempt: AttemptSnapshot{
			ID:                   attemptID,
			ModuleAttempts:       moduleAttempts,
			Responses:            responses,
			PersonalBreaks:       personalBreaks,
			ProvisionalSubmitted: control.deliveryStatus == "submitted" && control.submittedAt == nil,
		},
		Result: result,
	}, nil
}

// loadBootstrapResult reads a result only after the attempt crossed its
// terminal projection boundary. Open attempts stay on the cheap read path and
// never expose a transient result while the receipt transaction is in flight.
func (s *Service) loadBootstrapResult(ctx context.Context, providerKey, attemptID string, control attemptControl) (any, error) {
	if control.submittedAt == nil && control.deliveryStatus != "terminated" && control.deliveryStatus != "locked" && control.deliveryStatus != "cancelled" {
		return nil, nil
	}
	switch providerKey {
	case "sat":
		return sat.LoadResultForAttempt(ctx, s.db, attemptID)
	case "act":
		return act.LoadResultForAttempt(ctx, s.db, attemptID)
	default:
		return nil, nil
	}
}

// VersionETag renders the weak ETag for a bootstrap/static payload:
// W/"v{versionID}-{revision}" (plan D1: client caches across reconnects).
func VersionETag(versionID string, revision int64) string {
	return "W/\"v" + versionID + "-" + strconv.FormatInt(revision, 10) + "\""
}

// VersionTag resolves the ETag inputs for a schedule (plan D1): versionID
// + revision via two indexed point gets (schedule row, version row). Handlers
// compare If-None-Match before running the full bootstrap/static assembly.
func (s *Service) VersionTag(ctx context.Context, scheduleID string) (versionID string, revision int64, etag string, err error) {
	if err := s.db.QueryRowContext(ctx,
		"SELECT published_version_id FROM exam_schedules WHERE id = ?", scheduleID).Scan(&versionID); err != nil {
		if err == sql.ErrNoRows {
			return "", 0, "", apperrors.New(apperrors.CodeNotFound, "Schedule not found.")
		}
		return "", 0, "", err
	}
	revision, err = s.versionRevision(ctx, versionID)
	if err != nil {
		return "", 0, "", err
	}
	return versionID, revision, VersionETag(versionID, revision), nil
}

// versionRevision probes the version row revision (1 indexed PK get). It
// fails closed: a missing row is NOT_FOUND (never a stale cached tree).
func (s *Service) versionRevision(ctx context.Context, versionID string) (int64, error) {
	var rev int64
	if err := s.db.QueryRowContext(ctx,
		"SELECT revision FROM exam_versions WHERE id = ?", versionID).Scan(&rev); err != nil {
		if err == sql.ErrNoRows {
			return 0, apperrors.New(apperrors.CodeNotFound, "Published exam version not found.")
		}
		return 0, err
	}
	return rev, nil
}

// cachedSections serves the assembled tree from the D1 cache when the
// probed revision matches, else loads via LoadSections under singleflight
// and stores with the probed revision. Cache disabled (nil) = today's N+1.
func (s *Service) cachedSections(ctx context.Context, versionID string, probedRev int64) ([]DeliverySection, error) {
	if s.versions == nil {
		return s.LoadSections(ctx, versionID)
	}
	return s.versions.GetChecked(ctx, versionID, probedRev, func() ([]DeliverySection, int64, error) {
		tree, err := s.LoadSections(ctx, versionID)
		if err != nil {
			return nil, 0, err
		}
		return tree, probedRev, nil
	})
}

// LoadSections projects a version into candidate content without grading keys.
// Authoring preview uses the same projection for its draft version.
func (s *Service) LoadSections(ctx context.Context, versionID string) ([]DeliverySection, error) {
	sections := []DeliverySection{}
	rows, err := s.db.QueryContext(ctx,
		"SELECT id, section_key, title, display_order, duration_seconds, break_after_seconds, instructions FROM assessment_sections WHERE exam_version_id = ? ORDER BY display_order",
		versionID)
	if err != nil {
		return nil, err
	}
	type sectionRow struct {
		sec          DeliverySection
		instructions sql.NullString
	}
	var order []sectionRow
	for rows.Next() {
		var r sectionRow
		if err := rows.Scan(&r.sec.ID, &r.sec.SectionKey, &r.sec.Title, &r.sec.DisplayOrder,
			&r.sec.DurationSeconds, &r.sec.BreakAfterSeconds, &r.instructions); err != nil {
			rows.Close()
			return nil, err
		}
		r.sec.Instructions = rawJSON(r.instructions)
		r.sec.Modules = []DeliveryModule{}
		order = append(order, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, r := range order {
		modules, err := s.loadModules(ctx, r.sec.ID)
		if err != nil {
			return nil, err
		}
		r.sec.Modules = modules
		sections = append(sections, r.sec)
	}
	return sections, nil
}

// loadModules loads one section's modules with their questions.
func (s *Service) loadModules(ctx context.Context, sectionID string) ([]DeliveryModule, error) {
	modules := []DeliveryModule{}
	rows, err := s.db.QueryContext(ctx,
		"SELECT id, module_key, title, display_order, duration_seconds, target_question_count, adaptive_role, instructions, tool_policy FROM assessment_modules WHERE section_id = ? ORDER BY display_order",
		sectionID)
	if err != nil {
		return nil, err
	}
	type moduleRow struct {
		mod          DeliveryModule
		instructions sql.NullString
		toolPolicy   sql.NullString
	}
	var order []moduleRow
	for rows.Next() {
		var r moduleRow
		if err := rows.Scan(&r.mod.ID, &r.mod.ModuleKey, &r.mod.Title, &r.mod.DisplayOrder,
			&r.mod.DurationSeconds, &r.mod.TargetQuestionCount, &r.mod.AdaptiveRole,
			&r.instructions, &r.toolPolicy); err != nil {
			rows.Close()
			return nil, err
		}
		r.mod.Instructions = rawJSON(r.instructions)
		r.mod.ToolPolicy = rawJSON(r.toolPolicy)
		r.mod.Questions = []DeliveredQuestion{}
		order = append(order, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, r := range order {
		questions, err := s.loadQuestions(ctx, r.mod.ID)
		if err != nil {
			return nil, err
		}
		r.mod.Questions = questions
		modules = append(modules, r.mod)
	}
	return modules, nil
}

// loadQuestions loads one module's delivered questions.
func (s *Service) loadQuestions(ctx context.Context, moduleID string) ([]DeliveredQuestion, error) {
	questions := []DeliveredQuestion{}
	rows, err := s.db.QueryContext(ctx,
		"SELECT eq.id AS exam_question_id, eq.question_id, eq.display_order, eq.is_pretest, qr.question_type, qr.stimulus, qr.prompt, qr.answer_definition, qr.metadata, qr.accessibility FROM assessment_exam_questions eq JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id WHERE eq.module_id = ? ORDER BY eq.display_order",
		moduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var q DeliveredQuestion
		var isPretest bool
		var stimulus, prompt, answer, metadata, accessibility sql.NullString
		if err := rows.Scan(&q.ExamQuestionID, &q.QuestionID, &q.DisplayOrder, &isPretest,
			&q.QuestionType, &stimulus, &prompt, &answer, &metadata, &accessibility); err != nil {
			return nil, err
		}
		_ = isPretest // server-side only; never serialized to candidates
		q.Stimulus = rawJSON(stimulus)
		q.Prompt = rawJSON(prompt)
		q.Answer, err = deliveredAnswer(rawJSON(answer))
		if err != nil {
			return nil, err
		}
		q.Metadata = rawJSON(metadata)
		q.Accessibility = rawJSON(accessibility)
		questions = append(questions, q)
	}
	return questions, rows.Err()
}

// ensureBaseModuleAttempt seeds the first base module attempt when the
// attempt has none yet, so bootstrap always returns at least the entry
// module in not_started state. The insert is idempotent on the
// (attempt_id, module_id) unique (uq_assessment_attempt_module): a lost seed
// race stays a no-op instead of surfacing a 1062.
// EnsureBaseModuleAttemptForSchedule is the exported V1-session entry
// point (round 83): the V1 student-session path knows only the schedule
// id, so it resolves the pinned version + sections itself, then reuses
// the same idempotent seeder the SAT Bootstrap path uses.
func (s *Service) EnsureBaseModuleAttemptForSchedule(ctx context.Context, attemptID, scheduleID string) error {
	var versionID string
	if err := s.db.QueryRowContext(ctx,
		"SELECT published_version_id FROM exam_schedules WHERE id = ?", scheduleID).Scan(&versionID); err != nil {
		if err == sql.ErrNoRows {
			return apperrors.New(apperrors.CodeNotFound, "Schedule not found.")
		}
		return err
	}
	versionRev, err := s.versionRevision(ctx, versionID)
	if err != nil {
		return err
	}
	sections, err := s.cachedSections(ctx, versionID, versionRev)
	if err != nil {
		return err
	}
	scope, err := s.effectiveSectionScope(ctx, scheduleID, versionID)
	if err != nil {
		return err
	}
	return s.ensureBaseModuleAttempt(ctx, attemptID, deliverySectionsForScope(sections, scope))
}

// linkSectionScope resolves the Student Access link's section scope for a
// schedule: nil means every section (no link at all — every admin-created
// schedule — or an unscoped link). One indexed get on
// assessment_access_links_schedule_unique.
func (s *Service) linkSectionScope(ctx context.Context, scheduleID string) (map[string]bool, error) {
	if strings.TrimSpace(scheduleID) == "" {
		return nil, nil
	}
	var raw sql.NullString
	err := s.db.QueryRowContext(ctx,
		"SELECT enabled_sections FROM assessment_access_links WHERE schedule_id = ?", scheduleID).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return examdomain.ParseStoredSectionScope(raw.String), nil
}

func (s *Service) effectiveSectionScope(ctx context.Context, scheduleID, versionID string) (map[string]bool, error) {
	var raw sql.NullString
	if err := s.db.QueryRowContext(ctx,
		"SELECT sat_publish_scope FROM exam_versions WHERE id = ?", versionID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return nil, apperrors.New(apperrors.CodeNotFound, "Published exam version not found.")
		}
		return nil, err
	}
	releaseScope := examdomain.ParseSATPublishScope(raw.String)
	linkScope, err := s.linkSectionScope(ctx, scheduleID)
	if err != nil {
		return nil, err
	}
	return examdomain.IntersectSectionScopes(releaseScope, linkScope), nil
}

// deliverySectionsForScope narrows a loaded version tree to the sections the
// run includes. The returned slice is a fresh copy: the version cache's tree is
// shared across schedules and must never be mutated in place.
func deliverySectionsForScope(sections []DeliverySection, scope map[string]bool) []DeliverySection {
	if scope == nil {
		return sections
	}
	filtered := make([]DeliverySection, 0, len(sections))
	for _, section := range sections {
		if examdomain.AllowsSection(scope, section.SectionKey) {
			filtered = append(filtered, section)
		}
	}
	return filtered
}

func filterModuleAttemptsForSections(attempts []ModuleAttempt, sections []DeliverySection) []ModuleAttempt {
	allowed := make(map[string]bool)
	for _, section := range sections {
		for _, module := range section.Modules {
			allowed[module.ID] = true
		}
	}
	filtered := make([]ModuleAttempt, 0, len(attempts))
	for _, attempt := range attempts {
		if allowed[attempt.ModuleID] {
			filtered = append(filtered, attempt)
		}
	}
	return filtered
}

func filterResponsesForModuleAttempts(responses []ResponseSnapshot, attempts []ModuleAttempt) []ResponseSnapshot {
	allowed := make(map[string]bool, len(attempts))
	for _, attempt := range attempts {
		allowed[attempt.ID] = true
	}
	filtered := make([]ResponseSnapshot, 0, len(responses))
	for _, response := range responses {
		if allowed[response.ModuleAttemptID] {
			filtered = append(filtered, response)
		}
	}
	return filtered
}

// attemptSectionScopeTx resolves the published release and Student Access
// scopes backing the attempt's schedule, inside the caller's transaction
// (read-only; no lock, so it never joins a lock-order cycle). Nil means "no
// narrowing".
func attemptSectionScopeTx(ctx context.Context, t tx.Tx, attemptID string) (map[string]bool, error) {
	var rawLink, rawRelease sql.NullString
	err := t.QueryRowContext(ctx,
		"SELECT l.enabled_sections, v.sat_publish_scope FROM student_attempts a JOIN exam_versions v ON v.id = a.published_version_id LEFT JOIN assessment_access_links l ON l.schedule_id = a.schedule_id WHERE a.id = ?",
		attemptID).Scan(&rawLink, &rawRelease)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return examdomain.IntersectSectionScopes(
		examdomain.ParseSATPublishScope(rawRelease.String),
		examdomain.ParseStoredSectionScope(rawLink.String),
	), nil
}

// sqlPlaceholders renders "?, ?, ?" for n bound arguments.
func sqlPlaceholders(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func (s *Service) ensureBaseModuleAttempt(ctx context.Context, attemptID string, sections []DeliverySection) error {
	var existing string
	err := s.db.QueryRowContext(ctx,
		"SELECT id FROM assessment_module_attempts WHERE attempt_id = ?", attemptID).Scan(&existing)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	for _, sec := range sections {
		for _, mod := range sec.Modules {
			if mod.AdaptiveRole != "base" {
				continue
			}
			_, err := s.db.ExecContext(ctx,
				"INSERT INTO assessment_module_attempts (id, attempt_id, module_id, state, allocated_seconds, tool_state) VALUES (?, ?, ?, 'not_started', ?, '{}') ON DUPLICATE KEY UPDATE id = id",
				uuid.NewString(), attemptID, mod.ID, mod.DurationSeconds)
			return err
		}
	}
	return nil
}

// loadModuleAttempts loads module rows with Go-computed deadlines.
func (s *Service) loadModuleAttempts(ctx context.Context, attemptID string, now time.Time) ([]ModuleAttempt, error) {
	out := []ModuleAttempt{}
	rows, err := s.db.QueryContext(ctx,
		"SELECT id, module_id, state, allocated_seconds, available_at, started_at, paused_at, accumulated_paused_seconds, extension_seconds, completion_reason, raw_correct, operational_question_count, tool_state, revision FROM assessment_module_attempts WHERE attempt_id = ? ORDER BY created_at, id",
		attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m ModuleAttempt
		var availableAt, startedAt, pausedAt sql.NullTime
		var completionReason sql.NullString
		var rawCorrect, operationalCount sql.NullInt64
		var toolState sql.NullString
		if err := rows.Scan(&m.ID, &m.ModuleID, &m.State, &m.AllocatedSeconds,
			&availableAt, &startedAt, &pausedAt, &m.AccumulatedPausedSeconds,
			&m.ExtensionSeconds, &completionReason, &rawCorrect, &operationalCount,
			&toolState, &m.Revision); err != nil {
			return nil, err
		}
		m.AvailableAt = nullTime(availableAt)
		m.StartedAt = nullTime(startedAt)
		m.PausedAt = nullTime(pausedAt)
		m.CompletionReason = nullString(completionReason)
		m.RawCorrect = nullInt(rawCorrect)
		m.OperationalQuestionCount = nullInt(operationalCount)
		m.ToolState = rawJSON(toolState)
		if len(m.ToolState) == 0 {
			m.ToolState = json.RawMessage("{}")
		}
		m.DeadlineAt, m.RemainingSeconds = computeModuleTiming(
			m.AvailableAt, m.StartedAt, m.PausedAt, m.AllocatedSeconds,
			m.AccumulatedPausedSeconds, m.ExtensionSeconds, now)
		out = append(out, m)
	}
	return out, rows.Err()
}

// loadPersonalEntryOffers projects future-start metadata only for the new SAT
// personal model. Older cohort bootstraps retain their existing query shape.
func (s *Service) loadPersonalEntryOffers(ctx context.Context, attemptID string, attempts []ModuleAttempt) error {
	rows, err := s.db.QueryContext(ctx,
		"SELECT id, entry_generation, entry_starts_at, entry_confirmed_at, entry_entered_at FROM assessment_module_attempts WHERE attempt_id = ?",
		attemptID)
	if err != nil {
		return err
	}
	defer rows.Close()
	byID := make(map[string]int, len(attempts))
	for i := range attempts {
		byID[attempts[i].ID] = i
	}
	for rows.Next() {
		var id string
		var generation int
		var startsAt, confirmedAt, enteredAt sql.NullTime
		if err := rows.Scan(&id, &generation, &startsAt, &confirmedAt, &enteredAt); err != nil {
			return err
		}
		index, ok := byID[id]
		if !ok {
			continue
		}
		attempts[index].EntryGeneration = &generation
		attempts[index].EntryStartsAt = nullTime(startsAt)
		attempts[index].EntryConfirmedAt = nullTime(confirmedAt)
		attempts[index].EntryEnteredAt = nullTime(enteredAt)
	}
	return rows.Err()
}

func (s *Service) loadPersonalBreaks(ctx context.Context, attemptID string, now time.Time) ([]PersonalBreak, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, after_section_id, duration_seconds, state, starts_at, deadline_at,
		       entered_at, paused_at, accumulated_paused_seconds, entry_generation,
		       entry_starts_at, entry_confirmed_at, entry_entered_at, revision
		FROM assessment_attempt_breaks
		WHERE attempt_id = ? ORDER BY created_at, id`, attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PersonalBreak
	for rows.Next() {
		var b PersonalBreak
		var startsAt, deadlineAt, enteredAt, pausedAt, entryStartsAt, entryConfirmedAt, entryEnteredAt sql.NullTime
		if err := rows.Scan(&b.ID, &b.AfterSectionID, &b.DurationSeconds, &b.State,
			&startsAt, &deadlineAt, &enteredAt, &pausedAt, &b.AccumulatedPausedSeconds,
			&b.EntryGeneration, &entryStartsAt, &entryConfirmedAt, &entryEnteredAt, &b.Revision); err != nil {
			return nil, err
		}
		b.StartsAt = nullTime(startsAt)
		b.DeadlineAt = nullTime(deadlineAt)
		b.EnteredAt = nullTime(enteredAt)
		b.PausedAt = nullTime(pausedAt)
		b.EntryStartsAt = nullTime(entryStartsAt)
		b.EntryConfirmedAt = nullTime(entryConfirmedAt)
		b.EntryEnteredAt = nullTime(entryEnteredAt)
		if b.DeadlineAt != nil && (b.State == "active" || b.State == "completed") {
			ref := now
			if b.PausedAt != nil {
				ref = *b.PausedAt
			}
			b.RemainingSeconds = int64(b.DeadlineAt.Sub(ref) / time.Second)
			if b.RemainingSeconds < 0 {
				b.RemainingSeconds = 0
			}
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// loadResponses loads persisted question responses for the attempt.
//
// V2-first read (exam-day P0): SAT answers written through the V2 durability
// transport live in attempt_responses_v2; legacy
// assessment_question_responses rows are the fallback for pre-V2 attempts.
// Per question the V2 row wins when present (response decoded from the
// canonical "answer" field, review flags from the same envelope); legacy
// fills only questions absent from V2. Ordering is deterministic: legacy
// first-seen order (each loader emits (updated_at, id)), V2-only questions
// appended in V2 order, V2 winners inheriting the legacy position they
// replace — so the merged read is stable across calls with identical rows.
func (s *Service) loadResponses(ctx context.Context, attemptID string) ([]ResponseSnapshot, error) {
	legacy, err := s.loadResponsesLegacy(ctx, attemptID)
	if err != nil {
		return nil, err
	}
	v2, err := s.loadResponsesV2(ctx, attemptID)
	if err != nil {
		return nil, err
	}
	if len(v2) == 0 {
		return legacy, nil
	}
	// Exam-day re-audit defect 10: map iteration order is random in Go, so
	// the merged read is re-sorted into the documented (updated_at, id)
	// sequence. Both loaders emit that order; V2 rows sort after legacy rows
	// for the same question only when they win (they replace, never append).
	byQuestion := make(map[string]ResponseSnapshot, len(legacy)+len(v2))
	order := make(map[string]int, len(legacy)+len(v2))
	for i, r := range legacy {
		byQuestion[r.ExamQuestionID] = r
		order[r.ExamQuestionID] = i
	}
	for _, r := range v2 {
		if _, ok := byQuestion[r.ExamQuestionID]; !ok {
			order[r.ExamQuestionID] = len(order)
		}
		byQuestion[r.ExamQuestionID] = r
	}
	out := make([]ResponseSnapshot, 0, len(byQuestion))
	for _, r := range byQuestion {
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool {
		oi, oj := order[out[i].ExamQuestionID], order[out[j].ExamQuestionID]
		if oi != oj {
			return oi < oj
		}
		return out[i].ExamQuestionID < out[j].ExamQuestionID
	})
	return out, nil
}

// loadResponsesLegacy is the pre-V2 response read, retained as the fallback
// for attempts whose answers exist only in the legacy table.
func (s *Service) loadResponsesLegacy(ctx context.Context, attemptID string) ([]ResponseSnapshot, error) {
	out := []ResponseSnapshot{}
	rows, err := s.db.QueryContext(ctx,
		"SELECT ar.id, ar.module_attempt_id, ar.exam_question_id, ar.response, ar.marked_for_review, ar.eliminated_options, ar.annotations, ar.revision FROM assessment_question_responses ar JOIN assessment_module_attempts ma ON ma.id = ar.module_attempt_id WHERE ma.attempt_id = ? ORDER BY ar.updated_at, ar.id",
		attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r ResponseSnapshot
		var response, eliminated, annotations sql.NullString
		if err := rows.Scan(&r.ID, &r.ModuleAttemptID, &r.ExamQuestionID,
			&response, &r.MarkedForReview, &eliminated, &annotations, &r.Revision); err != nil {
			return nil, err
		}
		r.Response = rawJSON(response)
		r.EliminatedOptions = rawJSON(eliminated)
		r.Annotations = rawJSON(annotations)
		out = append(out, r)
	}
	return out, rows.Err()
}

// loadResponsesV2 reads V2 canonical payloads for the attempt and projects
// each to the legacy ResponseSnapshot shape: the response is the canonical
// "answer" field (assessscore.V2ResponseToScorerInput), MarkedForReview
// comes from the same envelope, eliminatedOptions projects to [] when
// missing/null, and the wrapped sat_annotations element unwraps to the legacy
// per-question envelope ({} when missing/null). ModuleAttemptID is the
// resolved module
// ATTEMPT id (ma.id via v.module_id); when no module attempt exists yet it
// falls back to the raw v.module_id (a module id, not an attempt id) so
// hydrate/save paths can still key the question — callers must treat it as
// opaque and never pass it as ModuleAttemptID on save (lockActiveModuleTx
// re-resolves the live attempt and MODULE_MISMATCH-guards explicit ids).
// V2 question_id may be eq.id or eq.question_id; the exam question identity
// is normalized to eq.id so it merges cleanly with legacy.
func (s *Service) loadResponsesV2(ctx context.Context, attemptID string) ([]ResponseSnapshot, error) {
	out := []ResponseSnapshot{}
	// Read-path fence (mirrors the seal JOIN): the eq lookup joins through
	// the owning module + the attempt's published version with eq.id-match
	// preference, so a question_id reused across modules/versions can't
	// merge a foreign module's answer over this module's.
	rows, err := s.db.QueryContext(ctx,
		"SELECT v.question_id, v.module_id, CAST(v.response AS CHAR), v.server_revision, ma.id, eq.id FROM attempt_responses_v2 v LEFT JOIN assessment_module_attempts ma ON ma.attempt_id = v.attempt_id AND ma.module_id = v.module_id LEFT JOIN assessment_modules m ON m.id = v.module_id LEFT JOIN assessment_sections s ON s.id = m.section_id LEFT JOIN assessment_exam_questions eq ON (eq.id = v.question_id OR eq.question_id = v.question_id) AND eq.module_id = v.module_id AND s.exam_version_id = (SELECT published_version_id FROM student_attempts WHERE id = v.attempt_id) WHERE v.attempt_id = ? ORDER BY v.updated_at, CASE WHEN (CAST(v.question_id AS CHAR) COLLATE utf8mb4_unicode_ci) = eq.id THEN 0 ELSE 1 END, v.question_id",
		attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var vQuestionID, vModuleID string
		var canonical sql.NullString
		var serverRev uint64
		var moduleAttemptID, examQuestionID sql.NullString
		if err := rows.Scan(&vQuestionID, &vModuleID, &canonical, &serverRev, &moduleAttemptID, &examQuestionID); err != nil {
			return nil, err
		}
		examID := vQuestionID
		if examQuestionID.Valid && examQuestionID.String != "" {
			examID = examQuestionID.String
		}
		moduleID := vModuleID
		if moduleAttemptID.Valid && moduleAttemptID.String != "" {
			moduleID = moduleAttemptID.String
		}
		r := ResponseSnapshot{
			ID:              "v2:" + vQuestionID,
			ModuleAttemptID: moduleID,
			ExamQuestionID:  examID,
			Revision:        int(serverRev),
		}
		// Candidate-facing metadata defaults: missing/null optional metadata
		// projects to the canonical []/{} shapes, so V2 and legacy snapshots
		// merge into one aggregate shape (Phase 1 acceptance contract).
		r.EliminatedOptions = assessscore.V2EliminatedOptions(canonical.String)
		r.Annotations = assessscore.V2AnnotationsEnvelope(canonical.String)
		if canonical.Valid && canonical.String != "" {
			if input, ok := assessscore.V2ResponseToScorerInput(canonical.String); ok {
				r.Response = json.RawMessage(input)
			}
			r.MarkedForReview = assessscore.V2MarkedForReview(canonical.String)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// attemptControl carries the attempt-level control projection.
type attemptControl struct {
	candidateName         string
	proctorStatus         string
	proctorNote           *string
	deviceFingerprintHash *string
	deliveryStatus        string
	submittedAt           *time.Time
	phase                 string
}

// loadAttemptControl loads candidate/proctor/device/lifecycle fields.
// Round 145: the attempt-row fields ride the Bootstrap binding probe
// (same row, already read); only the device-fingerprint leg queries here.
// A zero bound (empty candidate + deliveryStatus) means the caller has no
// binding row (post-write assemble path): fall back to the full row read.
func (s *Service) loadAttemptControl(ctx context.Context, attemptID string, bound attemptControl) (attemptControl, error) {
	c := bound
	if c.candidateName == "" && c.deliveryStatus == "" {
		var proctorNote sql.NullString
		var submittedAt sql.NullTime
		if err := s.db.QueryRowContext(ctx,
			"SELECT candidate_name, COALESCE(proctor_status, 'active'), proctor_note, COALESCE(delivery_status, 'running'), submitted_at, COALESCE(phase, '') FROM student_attempts WHERE id = ?",
			attemptID).Scan(&c.candidateName, &c.proctorStatus, &proctorNote,
			&c.deliveryStatus, &submittedAt, &c.phase); err != nil {
			return c, err
		}
		c.proctorNote = nullStringToPtr(proctorNote)
		c.submittedAt = nullTime(submittedAt)
	}
	var fingerprint sql.NullString
	err := s.db.QueryRowContext(ctx,
		"SELECT device_fingerprint_hash FROM attempt_sessions WHERE attempt_id = ? ORDER BY issued_at DESC LIMIT 1",
		attemptID).Scan(&fingerprint)
	switch {
	case err == nil:
		c.deviceFingerprintHash = nullStringToPtr(fingerprint)
	case err == sql.ErrNoRows:
		// Attempts without a device-bound session carry no fingerprint.
	default:
		return c, err
	}
	return c, nil
}

// loadTiming loads the cohort runtime status; attempts without a runtime
// row fall back to the legacy attempt-level timing projection.
// Round 144: the schedule pre-probe SELECT status duplicated the identical
// probe inside LoadSessionRuntimeBySchedule (same row, twice, on the 2k-herd
// hot path). One probe row now: NoRows -> legacy fallback, else hydrate in
// the same call (runtime + sections legs, skipping the duplicate).
//
// Round 146: the NoRows branch is provider-aware. A SAT schedule with no
// runtime row has NOT started, but this branch used to project the legacy
// attempt clock ("live"), which opened the student entry gate before the
// proctor pressed Start and turned the waiting room into a 409
// RUNTIME_NOT_LIVE storm (the client re-fired /modules/start every
// SAT_ENTRY_RETRY_WINDOW_MS). providerKey is already resolved by Bootstrap,
// so this costs no extra query. The pre-start shape comes from
// proctor.NotStartedRuntimeForProvider — the same projection the proctor
// dashboard serves — so the two APIs cannot disagree about "not started"
// (pinned by TestTimingContractPreStartAgreesWithProctorProjection).
//
// Non-SAT providers keep the legacy attempt clock: a legacy run has no cohort
// runtime to wait for.
//
// Round 147: the runtime's own section rows ride back with the snapshot. They
// cost no extra statement (the sections leg is already loaded) and they are what
// publishEntryWindows reads to tell a candidate what entering a module will
// actually grant them — the same rows the write path's gate reads, so the
// promise and the grant cannot drift.
// scheduleTimingChoice reads exam_schedules.sat_timing_model. NULL/missing
// column (pre-migration DB) means the deployed model: fail open to "".
func (s *Service) scheduleTimingChoice(ctx context.Context, scheduleID string) (string, error) {
	var raw sql.NullString
	if err := s.db.QueryRowContext(ctx, "SELECT sat_timing_model FROM exam_schedules WHERE id = ?", scheduleID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return "", apperrors.New(apperrors.CodeNotFound, "Schedule not found.")
		}
		return "", err
	}
	if !raw.Valid {
		return "", nil
	}
	return raw.String, nil
}

func (s *Service) loadTiming(ctx context.Context, scheduleID, providerKey string, now time.Time) (TimingSnapshot, string, []proctor.SessionRuntimeSection, error) {
	var status string
	err := s.db.QueryRowContext(ctx, "SELECT status FROM exam_session_runtimes WHERE schedule_id = ?", scheduleID).Scan(&status)
	if err == sql.ErrNoRows {
		// Pre-start reads the stored schedule choice rather than inferring
		// all SAT schedules are cohort-timed. NULL keeps the deployed model.
		choice := ""
		if strings.EqualFold(strings.TrimSpace(providerKey), "sat") {
			choice, err = s.scheduleTimingChoice(ctx, scheduleID)
			if err != nil {
				return TimingSnapshot{}, "", nil, err
			}
		}
		model := examruntime.ResolveTimingModel(providerKey, choice)
		if examruntime.IsCohortTimed(model) {
			runtime := proctor.NotStartedRuntimeWithChoice(scheduleID, "", providerKey, choice, now)
			return timingFromRuntime(runtime), runtime.Status, runtime.Sections, nil
		}
		if examruntime.IsSatPersonal(model) {
			runtime := proctor.NotStartedRuntimeWithChoice(scheduleID, "", providerKey, choice, now)
			return timingFromRuntime(runtime), runtime.Status, runtime.Sections, nil
		}
		return TimingSnapshot{Authority: "legacy_attempt", TimingModel: examruntime.TimingModelLegacy, StageStatus: "live", ServerNow: now}, "live", nil, nil
	}
	if err != nil {
		return TimingSnapshot{}, "", nil, err
	}
	runtime, err := proctor.LoadSessionRuntimeByStatus(ctx, s.db, scheduleID, status)
	if err != nil {
		return TimingSnapshot{}, "", nil, err
	}
	return timingFromRuntime(runtime), runtime.Status, runtime.Sections, nil
}

func timingFromRuntime(runtime proctor.SessionRuntime) TimingSnapshot {
	key := runtime.ActiveSectionKey
	if key == nil {
		key = runtime.CurrentSectionKey
	}
	status := runtime.Status
	for _, section := range runtime.Sections {
		if key != nil && section.SectionKey == *key {
			status = section.Status
			break
		}
	}
	return TimingSnapshot{Authority: "cohort_runtime", TimingModel: runtime.TimingModel,
		StageKey: key, StageStatus: status, ServerNow: runtime.ServerNow,
		DeadlineAt: runtime.CurrentSectionDeadlineAt, RemainingSeconds: int64(runtime.CurrentSectionRemainingSeconds),
		NextSectionStartAt: runtime.NextSectionStartAt, WaitingForNextSection: runtime.WaitingForNextSection,
		RuntimeRevision: runtime.Revision}
}

// moduleDeadline is the single pause-aware deadline anchor shared by the
// bootstrap projection and the admission/recovery gates: the personal timer
// runs from started_at (falling back to available_at before start) over
// allocated + extension, and every accumulated paused second is given back
// (added) so pauses never consume the window. A live pause freezes the
// remaining window via the ref selection in computeModuleTiming, matching
// moduleRemainingSeconds in reconcile.go (elapsed minus accumulated pauses).
func moduleDeadline(availableAt, startedAt *time.Time, allocated, accumulated, extension int) *time.Time {
	anchor := availableAt
	if startedAt != nil {
		anchor = startedAt
	}
	if anchor == nil {
		return nil
	}
	total := int64(allocated + extension + accumulated)
	if total < 0 {
		total = 0
	}
	deadline := anchor.Add(time.Duration(total) * time.Second)
	return &deadline
}

// computeModuleTiming derives the authoritative deadline and remaining
// window from the single moduleDeadline anchor. A paused module freezes its
// remaining window at the pause instant.
func computeModuleTiming(availableAt, startedAt, pausedAt *time.Time, allocated, accumulated, extension int, now time.Time) (*time.Time, *int64) {
	deadline := moduleDeadline(availableAt, startedAt, allocated, accumulated, extension)
	if deadline == nil {
		return nil, nil
	}
	ref := now
	if pausedAt != nil {
		ref = *pausedAt
	}
	remaining := int64(deadline.Sub(ref) / time.Second)
	if remaining < 0 {
		remaining = 0
	}
	return deadline, &remaining
}

func rawJSON(v sql.NullString) json.RawMessage {
	if !v.Valid || v.String == "" {
		return nil
	}
	return json.RawMessage(v.String)
}

func nullTime(v sql.NullTime) *time.Time {
	if !v.Valid {
		return nil
	}
	t := v.Time.UTC()
	return &t
}

func nullString(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	s := v.String
	return &s
}

func nullStringToPtr(v sql.NullString) *string { return nullString(v) }

// SaveResponseRequest mirrors AssessmentResponseRequest (camelCase) on the
// Rust save_response_at flow
// (backend/crates/application/src/assessment_delivery.rs).
type SaveResponseRequest struct {
	Revision          int             `json:"revision"`
	Response          json.RawMessage `json:"response"`
	MarkedForReview   bool            `json:"markedForReview"`
	EliminatedOptions []string        `json:"eliminatedOptions"`
	Annotations       json.RawMessage `json:"annotations"`
	ModuleAttemptID   *string         `json:"moduleAttemptId"`
	StageKey          *string         `json:"stageKey"`
	RuntimeRevision   *int            `json:"runtimeRevision"`
	ClientWriteID     *string         `json:"clientWriteId"`
}

// saveActiveModule is the locked active (or timeout-finalized) module row.
type saveActiveModule struct {
	id                       string
	moduleID                 string
	state                    string
	allocatedSeconds         int
	availableAt              *time.Time
	startedAt                *time.Time
	pausedAt                 *time.Time
	accumulatedPausedSeconds int
	extensionSeconds         int
	completionReason         *string
}

// saveResponseRow is the locked existing response row.
type saveResponseRow struct {
	id                string
	moduleAttemptID   string
	examQuestionID    string
	response          json.RawMessage
	markedForReview   bool
	eliminatedOptions []string
	annotations       json.RawMessage
	revision          int
}

// SaveResponse persists one question response. It mirrors save_response_at
// (Rust assessment_delivery.rs ~470-722) using s.runner.WithTx for the whole
// write with lock order attempt -> runtime -> module -> response. The bearer
// schedule id (from the verified attempt token) must match the URL schedule
// id; callers map typed errors via the stable apperrors envelope.
// StructuredConflict reasons map to CodeAssessmentConflict with Details{reason}
// preserved.
// SaveResponse persists one question response. The variadic writerBinding
// is [clientSessionID, tokenID] from the verified bearer (edge-enforced
// non-empty); the in-tx fence re-checks token revocation + writer session.
func (s *Service) SaveResponse(ctx context.Context, bearerScheduleID, bearerAttemptID, urlScheduleID, examQuestionID string, req SaveResponseRequest, writerBinding ...string) (*ResponseSnapshot, error) {
	if urlScheduleID != bearerScheduleID {
		return nil, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule.")
	}
	if err := validateSaveResponseRequest(req); err != nil {
		return nil, err
	}
	scheduleID, examID, providerKey, err := s.saveScheduleBinding(ctx, bearerScheduleID)
	if err != nil {
		return nil, err
	}
	if providerKey != "sat" {
		return nil, apperrors.New(apperrors.CodeUnsupportedProvider, "The assessment provider is not supported.")
	}
	if err := s.saveAttemptBinding(ctx, scheduleID, bearerAttemptID, examID); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	var out *ResponseSnapshot
	// B1: single-response save is a point-write tx (RC-safe).
	if err := s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		if err := s.ensureAttemptCanWorkTx(ctx, t, scheduleID, bearerAttemptID); err != nil {
			return err
		}
		if err := enforceWriterSessionTx(ctx, t, scheduleID, bearerAttemptID, writerBinding...); err != nil {
			return err
		}
		active, timeoutRecovery, err := s.lockActiveModuleTx(ctx, t, bearerAttemptID, req)
		if err != nil {
			return err
		}
		if timeoutRecovery {
			if err := s.ensureTimeoutResponseRecoveryTx(ctx, t, scheduleID, bearerAttemptID, active, now, req); err != nil {
				return err
			}
		} else {
			// SAT-006: the gate owns the authoritative in-tx time; the legacy
			// personal-deadline check uses that same instant, not the pre-tx
			// wall clock this request captured before waiting for its locks.
			gated, err := s.moduleTimingGateTx(ctx, t, scheduleID, active.moduleID)
			if err != nil {
				return err
			}
			if gated.gate == timingGateLegacy {
				if err := ensureSaveModuleAdmitted(active, gated.now); err != nil {
					return err
				}
			}
		}
		var belongs string
		if err := t.QueryRowContext(ctx,
			"SELECT id FROM assessment_exam_questions WHERE id = ? AND module_id = ?",
			examQuestionID, active.moduleID).Scan(&belongs); err != nil {
			if err == sql.ErrNoRows {
				return assessmentConflict("MODULE_MISMATCH", "Question does not belong to the active SAT module.")
			}
			return err
		}
		existing, existingClientWriteID, err := s.lockResponseTx(ctx, t, active.id, examQuestionID)
		if err != nil {
			return err
		}
		responseID := ""
		if existing != nil {
			responseID = existing.id
			if req.ClientWriteID != nil && existingClientWriteID != nil && *req.ClientWriteID != *existingClientWriteID {
				return assessmentConflict("RESPONSE_REVISION_MISMATCH", "Response write identity does not match the stored revision.")
			}
			payloadMatches := savePayloadMatches(existing, req)
			if req.ClientWriteID != nil && existingClientWriteID != nil && *req.ClientWriteID == *existingClientWriteID && !payloadMatches {
				return assessmentConflict("RESPONSE_REVISION_MISMATCH", "Response write identity was reused with a different payload.")
			}
			// A historical row may have no client identity. Once a caller
			// supplies one, do not let an equal-revision payload silently
			// replace that unidentifiable state: the caller cannot prove it
			// authored the existing revision. Legacy callers without an
			// identity retain the original optimistic-revision behavior.
			if req.ClientWriteID != nil && existingClientWriteID == nil && !payloadMatches && req.Revision == existing.revision {
				return assessmentConflict("RESPONSE_REVISION_MISMATCH", "Response write identity does not match the stored revision.")
			}
			if payloadMatches {
				snap := &ResponseSnapshot{
					ID:                existing.id,
					ModuleAttemptID:   existing.moduleAttemptID,
					ExamQuestionID:    existing.examQuestionID,
					Response:          existing.response,
					MarkedForReview:   existing.markedForReview,
					EliminatedOptions: rawEliminated(existing.eliminatedOptions),
					Annotations:       existing.annotations,
					Revision:          existing.revision,
				}
				if timeoutRecovery {
					if err := s.repairTimeoutFinalizedModuleTx(ctx, t, active); err != nil {
						return err
					}
				}
				out = snap
				return nil
			}
		}
		if existing != nil {
			if existing.revision != req.Revision {
				return assessmentConflict("RESPONSE_REVISION_MISMATCH", "Question response revision is stale.")
			}
		} else if req.Revision != 0 {
			return assessmentConflict("RESPONSE_REVISION_MISMATCH", "Question response must start at revision zero.")
		}
		eliminated := req.EliminatedOptions
		if eliminated == nil {
			eliminated = []string{}
		}
		eliminatedJSON, err := json.Marshal(eliminated)
		if err != nil {
			return err
		}
		var clientWriteID any
		if req.ClientWriteID != nil {
			clientWriteID = *req.ClientWriteID
		}
		if existing != nil {
			res, err := t.ExecContext(ctx,
				"UPDATE assessment_question_responses SET response = ?, marked_for_review = ?, eliminated_options = ?, annotations = ?, client_write_id = COALESCE(?, client_write_id), revision = revision + 1, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND revision = ?",
				nullableSaveRaw(req.Response), req.MarkedForReview, string(eliminatedJSON), emptySaveJSON(req.Annotations), clientWriteID, responseID, req.Revision)
			if err != nil {
				return err
			}
			n, err := res.RowsAffected()
			if err != nil {
				return err
			}
			if n != 1 {
				return assessmentConflict("RESPONSE_REVISION_MISMATCH", "Response changed while this write was being applied.")
			}
		} else {
			responseID = uuid.NewString()
			if _, err := t.ExecContext(ctx,
				"INSERT INTO assessment_question_responses (id, module_attempt_id, exam_question_id, response, marked_for_review, eliminated_options, annotations, client_write_id, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
				responseID, active.id, examQuestionID, nullableSaveRaw(req.Response), req.MarkedForReview, string(eliminatedJSON), emptySaveJSON(req.Annotations), clientWriteID); err != nil {
				if isDuplicateKeyError(err) {
					return assessmentConflict("RESPONSE_REVISION_MISMATCH", "Response changed while this write was being applied.")
				}
				return err
			}
		}
		// delivery/mod.rs:287 increment SQL exact.
		res, err := t.ExecContext(ctx,
			"UPDATE student_attempts SET answer_revision = answer_revision + 1, updated_at = CURRENT_TIMESTAMP(6), revision = revision + 1 WHERE id = ? AND schedule_id = ? AND submitted_at IS NULL AND COALESCE(delivery_status, 'running') NOT IN ('submitted', 'terminated', 'locked', 'cancelled')",
			bearerAttemptID, scheduleID)
		if err != nil {
			return err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return err
		}
		if n != 1 {
			// A racing finalization sealed the attempt between the
			// entry writability check and this bump: the attempt
			// exists but is no longer writable — 422, never 404, so
			// clients retry finalization instead of dead-ending.
			return apperrors.New(apperrors.CodeAttemptNotWritable, "The attempt is no longer writable.")
		}
		row, err := s.readResponseTx(ctx, t, responseID)
		if err != nil {
			return err
		}
		if timeoutRecovery {
			if err := s.repairTimeoutFinalizedModuleTx(ctx, t, active); err != nil {
				return err
			}
		}
		out = row
		return nil
	}); err != nil {
		return nil, err
	}
	return out, nil
}

// assessmentConflict maps a Rust StructuredConflict (reason + message) to
// CodeAssessmentConflict (ASSESSMENT_CONFLICT, 409) with Details{reason},
// mirroring the Rust with_details reason. Plain Rust Conflict without a
// reason (the terminal-attempt guard) uses CodeAssessmentConflict bare.
func assessmentConflict(reason, msg string) *apperrors.Error {
	// Every structured SAT conflict is counted at its single construction
	// point, labeled by the stable reason. This is the release signal for the
	// waiting-room storm this work fixed: RUNTIME_NOT_LIVE from waiting
	// students must sit at zero, and if it reappears the reason label says
	// which read/write contract diverged.
	telemetry.IncCounter(telemetry.MAssessmentConflict, "reason", reason)
	err := apperrors.New(apperrors.CodeAssessmentConflict, msg)
	err.Details = map[string]any{"reason": reason}
	return err
}

// save payload size caps mirror the V2 attempts ValidatePayload aggregate
// rules so both write paths fence oversized payloads identically.
const (
	maxSaveResponseBytes    = 256 << 10
	maxSaveEliminated       = 16
	maxSaveEliminatedLen    = 64
	maxSaveAnnotations      = 64
	maxSaveAnnotationIDLen  = 255
	maxSaveAnnotationText   = 8 << 10
	maxSaveAnnotationKind   = 64
	maxSaveAnnotationRawLen = 64 << 10
)

// validateSaveResponseRequest mirrors validate_assessment_response_request.
func validateSaveResponseRequest(req SaveResponseRequest) error {
	if req.Revision < 0 {
		return apperrors.New(apperrors.CodeValidation, "Response revision cannot be negative.")
	}
	if req.RuntimeRevision != nil && *req.RuntimeRevision < 0 {
		return apperrors.New(apperrors.CodeValidation, "Runtime revision cannot be negative.")
	}
	if req.ModuleAttemptID != nil {
		trimmed := strings.TrimSpace(*req.ModuleAttemptID)
		if trimmed == "" || len(trimmed) > 64 {
			return apperrors.New(apperrors.CodeValidation, "moduleAttemptId must contain between 1 and 64 characters.")
		}
	}
	if req.StageKey != nil {
		trimmed := strings.TrimSpace(*req.StageKey)
		if trimmed == "" || len(trimmed) > 128 {
			return apperrors.New(apperrors.CodeValidation, "stageKey must contain between 1 and 128 characters.")
		}
	}
	if req.ClientWriteID != nil {
		trimmed := strings.TrimSpace(*req.ClientWriteID)
		if trimmed == "" || len(trimmed) > 128 {
			return apperrors.New(apperrors.CodeValidation, "clientWriteId must contain between 1 and 128 characters.")
		}
	}
	if len(req.Response) > maxSaveResponseBytes {
		return apperrors.New(apperrors.CodePayloadTooLarge, "Response payload too large.")
	}
	if len(req.Annotations) > maxSaveAnnotationRawLen {
		return apperrors.New(apperrors.CodePayloadTooLarge, "Annotations payload too large.")
	}
	if len(req.EliminatedOptions) > maxSaveEliminated {
		return apperrors.New(apperrors.CodeValidation, "Too many eliminated options.")
	}
	for _, o := range req.EliminatedOptions {
		if o == "" || len(o) > maxSaveEliminatedLen {
			return apperrors.New(apperrors.CodeValidation, "Invalid eliminated option.")
		}
	}
	if len(req.Annotations) > 0 && string(req.Annotations) != "null" {
		var anns []struct {
			ID   string `json:"id"`
			Kind string `json:"kind"`
			Text string `json:"text"`
		}
		if err := json.Unmarshal(req.Annotations, &anns); err == nil {
			if len(anns) > maxSaveAnnotations {
				return apperrors.New(apperrors.CodeValidation, "Too many annotations.")
			}
			for _, a := range anns {
				if a.ID == "" || len(a.ID) > maxSaveAnnotationIDLen {
					return apperrors.New(apperrors.CodeValidation, "Annotation id is required.")
				}
				if a.Kind == "" || len(a.Kind) > maxSaveAnnotationKind {
					return apperrors.New(apperrors.CodeValidation, "Annotation kind is required.")
				}
				if len(a.Text) > maxSaveAnnotationText {
					return apperrors.New(apperrors.CodeValidation, "Annotation text too large.")
				}
			}
		}
	}
	return nil
}

// saveScheduleBinding mirrors schedule_binding: schedule + exam + provider.
// It resolves the effective provider centrally (exams.EffectiveProviderKey)
// so legacy ACT rows (provider_key='ielts', exam_type='ACT') keep their
// Science write path instead of hitting the SAT-only gate (Phase 02
// blocker 4). The stored provider key is never authoritative on its own.
func (s *Service) saveScheduleBinding(ctx context.Context, scheduleID string) (id, examID, providerKey string, err error) {
	var versionID, examType string
	if err = s.db.QueryRowContext(ctx,
		"SELECT s.id, s.exam_id, e.provider_key, s.published_version_id, e.exam_type FROM exam_schedules s JOIN exam_entities e ON e.id = s.exam_id WHERE s.id = ?",
		scheduleID).Scan(&id, &examID, &providerKey, &versionID, &examType); err != nil {
		if err == sql.ErrNoRows {
			return "", "", "", apperrors.New(apperrors.CodeNotFound, "Schedule not found.")
		}
		return "", "", "", err
	}
	return id, examID, examdomain.EffectiveProviderKey(providerKey, examType), nil
}

// saveAttemptBinding mirrors ensure_attempt_binding: the attempt must belong
// to the schedule + exam.
func (s *Service) saveAttemptBinding(ctx context.Context, scheduleID, attemptID, examID string) error {
	var id, attemptScheduleID, attemptExamID string
	if err := s.db.QueryRowContext(ctx,
		"SELECT id, schedule_id, exam_id FROM student_attempts WHERE id = ?",
		attemptID).Scan(&id, &attemptScheduleID, &attemptExamID); err != nil {
		if err == sql.ErrNoRows {
			return apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
		}
		return err
	}
	if attemptScheduleID != scheduleID || attemptExamID != examID {
		return apperrors.New(apperrors.CodeValidation, "Attempt does not belong to this SAT schedule.")
	}
	return nil
}

// ensureAttemptCanWorkTx mirrors ensure_attempt_can_work_tx: attempt FOR
// UPDATE then runtime FOR UPDATE; proctor paused/terminated =>
// StructuredConflict AttemptProctorBlocked; submitted/delivery-terminal /
// post-exam => Conflict.
func (s *Service) ensureAttemptCanWorkTx(ctx context.Context, t tx.Tx, scheduleID, attemptID string) error {
	var proctorStatus, deliveryStatus string
	var submittedAt sql.NullTime
	var phase sql.NullString
	if err := t.QueryRowContext(ctx,
		"SELECT COALESCE(proctor_status, 'active'), COALESCE(delivery_status, 'running'), submitted_at, phase FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE",
		attemptID, scheduleID).Scan(&proctorStatus, &deliveryStatus, &submittedAt, &phase); err != nil {
		if err == sql.ErrNoRows {
			return apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
		}
		return err
	}
	// Writer-session binding is enforced separately by enforceWriterSessionTx
	// inside the same mutation tx (SELECT ... FOR UPDATE + equality), so a
	// takeover racing the pre-tx EnsureActiveWriter gate cannot slip through.
	switch proctorStatus {
	case "paused":
		return assessmentConflict("ATTEMPT_PROCTOR_BLOCKED", "Your SAT attempt is paused by the proctor.")
	case "terminated":
		return assessmentConflict("ATTEMPT_PROCTOR_BLOCKED", "Your SAT attempt has been terminated by the proctor.")
	}
	if submittedAt.Valid || deliveryStatus == "submitted" || deliveryStatus == "terminated" || deliveryStatus == "locked" || deliveryStatus == "cancelled" || (phase.Valid && phase.String == "post-exam") {
		return assessmentConflict("ATTEMPT_TERMINAL", "The SAT attempt is already terminal and cannot accept this command.")
	}
	var runtimeStatus sql.NullString
	if err := t.QueryRowContext(ctx,
		"SELECT status FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE",
		scheduleID).Scan(&runtimeStatus); err != nil {
		if err == sql.ErrNoRows {
			return assessmentConflict("RUNTIME_NOT_LIVE", "The SAT session has not been started by the proctor.")
		}
		return err
	}
	switch runtimeStatus.String {
	case "live":
		return nil
	case "paused":
		return assessmentConflict("RUNTIME_PAUSED", "The SAT session is paused by the proctor.")
	default:
		return assessmentConflict("RUNTIME_NOT_LIVE", "The SAT session has not been started by the proctor.")
	}
}

// lockActiveModuleTx mirrors the active module lookup: active/review FOR
// UPDATE; module_attempt_id mismatch => ModuleMismatch; no-active fallback to
// the locked/time_expired finalized row (recovery gate runs in SaveResponse)
// else ModuleNotActive.
func (s *Service) lockActiveModuleTx(ctx context.Context, t tx.Tx, attemptID string, req SaveResponseRequest) (saveActiveModule, bool, error) {
	var m saveActiveModule
	var availableAt, startedAt, pausedAt sql.NullTime
	var completionReason sql.NullString
	err := t.QueryRowContext(ctx,
		"SELECT id, module_id, state, allocated_seconds, available_at, started_at, paused_at, accumulated_paused_seconds, extension_seconds, completion_reason FROM assessment_module_attempts WHERE attempt_id = ? AND state IN ('active', 'review') ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
		attemptID).Scan(&m.id, &m.moduleID, &m.state, &m.allocatedSeconds, &availableAt, &startedAt, &pausedAt, &m.accumulatedPausedSeconds, &m.extensionSeconds, &completionReason)
	if err == nil {
		m.availableAt = nullTime(availableAt)
		m.startedAt = nullTime(startedAt)
		m.pausedAt = nullTime(pausedAt)
		m.completionReason = nullString(completionReason)
		if req.ModuleAttemptID != nil && *req.ModuleAttemptID != m.id {
			return saveActiveModule{}, false, assessmentConflict("MODULE_MISMATCH", "Response module attempt does not match the active SAT module.")
		}
		return m, false, nil
	}
	if err != sql.ErrNoRows {
		return saveActiveModule{}, false, err
	}
	if req.ModuleAttemptID == nil {
		return saveActiveModule{}, false, assessmentConflict("MODULE_NOT_ACTIVE", "There is no active SAT module.")
	}
	var f saveActiveModule
	var fAvailable, fStarted, fPaused sql.NullTime
	var fCompletion sql.NullString
	if err := t.QueryRowContext(ctx,
		"SELECT id, module_id, state, allocated_seconds, available_at, started_at, paused_at, accumulated_paused_seconds, extension_seconds, completion_reason FROM assessment_module_attempts WHERE id = ? AND attempt_id = ? FOR UPDATE",
		*req.ModuleAttemptID, attemptID).Scan(&f.id, &f.moduleID, &f.state, &f.allocatedSeconds, &fAvailable, &fStarted, &fPaused, &f.accumulatedPausedSeconds, &f.extensionSeconds, &fCompletion); err != nil {
		if err == sql.ErrNoRows {
			return saveActiveModule{}, false, assessmentConflict("MODULE_MISMATCH", "Response module attempt does not belong to this SAT attempt.")
		}
		return saveActiveModule{}, false, err
	}
	f.availableAt = nullTime(fAvailable)
	f.startedAt = nullTime(fStarted)
	f.pausedAt = nullTime(fPaused)
	f.completionReason = nullString(fCompletion)
	if f.state != "locked" || f.completionReason == nil || *f.completionReason != "time_expired" {
		return saveActiveModule{}, false, assessmentConflict("MODULE_NOT_ACTIVE", "The SAT module is finalized and does not accept responses.")
	}
	return f, true, nil
}

type timingGate int

const (
	timingGateLegacy timingGate = iota
	timingGateCohortStage
	timingGateCohortSection
	timingGatePersonal
)

// moduleTimingGateResult is what moduleTimingGateTx hands back: the model-narrowed
// gate, the authoritative in-tx instant, and — for a section-keyed cohort
// runtime — the ROOM's window for the module being started.
//
// roomWindowEnd exists because a module window must belong to the room, not to
// the candidate's arrival: Module 1's window is the section's start plus its
// authored length, and the adaptive branch module that closes a section ends
// with the section's own clock. StartModule clamps the new attempt's
// allocated_seconds to it, and every other reader keeps deriving the deadline
// from started_at + allocated_seconds, so one rule owns the window and a late
// joiner reads the clock the proctor and the run sheet are already on.
type moduleTimingGateResult struct {
	gate timingGate
	now  time.Time
	// roomWindowEnd is meaningful only alongside roomWindowKnown: a zero
	// instant is a legitimate boundary (a window that has already elapsed).
	roomWindowEnd   time.Time
	roomWindowKnown bool
}

// dbTimeTx reads the authoritative database instant inside the transaction.
// Deadline authority must be the time at which the transaction holds its
// locks, never a wall-clock sample taken before lock acquisition (SAT-006).
func dbTimeTx(ctx context.Context, t tx.Tx) (time.Time, error) {
	var now time.Time
	if err := t.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&now); err != nil {
		return time.Time{}, err
	}
	return now.UTC(), nil
}

// moduleTimingGateTx mirrors ensure_module_matches_runtime_stage_tx: unknown
// timing model => legacy; cohort models enforce stage identity + live/paused
// gates + deadline. It owns the authoritative time: the returned instant is
// read from the DB after the runtime/section rows are locked, so a request
// that waited past the deadline is judged by the moment it can mutate, not a
// timestamp captured before it entered the transaction (SAT-006).
func (s *Service) moduleTimingGateTx(ctx context.Context, t tx.Tx, scheduleID, moduleID string) (moduleTimingGateResult, error) {
	var timingModel sql.NullString
	var activeStage sql.NullString
	if err := t.QueryRowContext(ctx,
		"SELECT timing_model, active_section_key FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE",
		scheduleID).Scan(&timingModel, &activeStage); err != nil {
		if err == sql.ErrNoRows {
			now, nerr := dbTimeTx(ctx, t)
			return moduleTimingGateResult{gate: timingGateLegacy, now: now}, nerr
		}
		return moduleTimingGateResult{}, err
	}
	switch timingModel.String {
	case examruntime.TimingModelPersonal:
		now, nerr := dbTimeTx(ctx, t)
		if nerr != nil {
			return moduleTimingGateResult{}, nerr
		}
		var runtimeStatus string
		if err := t.QueryRowContext(ctx, "SELECT status FROM exam_session_runtimes WHERE schedule_id = ?", scheduleID).Scan(&runtimeStatus); err != nil {
			return moduleTimingGateResult{}, err
		}
		if runtimeStatus != "live" {
			return moduleTimingGateResult{}, assessmentConflict("RUNTIME_NOT_LIVE", "The SAT runtime is not live.")
		}
		return moduleTimingGateResult{gate: timingGatePersonal, now: now}, nil
	case examruntime.TimingModelCohortStage:
	case examruntime.TimingModelCohortSection:
	default:
		now, nerr := dbTimeTx(ctx, t)
		return moduleTimingGateResult{gate: timingGateLegacy, now: now}, nerr
	}
	var sectionKey, adaptiveRole string
	// duration_seconds rides along so the cohort window below can be derived
	// from the module's authored length without a second read of the same row.
	var authoredSeconds int
	if err := t.QueryRowContext(ctx,
		"SELECT s.section_key, m.adaptive_role, m.duration_seconds FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
		moduleID).Scan(&sectionKey, &adaptiveRole, &authoredSeconds); err != nil {
		if err == sql.ErrNoRows {
			return moduleTimingGateResult{}, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
		}
		return moduleTimingGateResult{}, err
	}
	expected := sectionKey
	if timingModel.String == examruntime.TimingModelCohortStage {
		suffix, err := saveStageSuffix(adaptiveRole)
		if err != nil {
			return moduleTimingGateResult{}, err
		}
		expected = sectionKey + ":" + suffix
	}
	if !activeStage.Valid || activeStage.String != expected {
		return moduleTimingGateResult{}, assessmentConflict("SECTION_NOT_ACTIVE", "SAT section `"+expected+"` is not active for this cohort.")
	}
	var status string
	var actualStart, pausedAt sql.NullTime
	var plannedMinutes, extensionMinutes, pausedSeconds sql.NullInt64
	if err := t.QueryRowContext(ctx,
		"SELECT rs.status, rs.actual_start_at, rs.paused_at, rs.planned_duration_minutes, rs.extension_minutes, rs.accumulated_paused_seconds FROM exam_session_runtime_sections rs JOIN exam_session_runtimes r ON r.id = rs.runtime_id WHERE r.schedule_id = ? AND rs.section_key = ? FOR UPDATE",
		scheduleID, expected).Scan(&status, &actualStart, &pausedAt, &plannedMinutes, &extensionMinutes, &pausedSeconds); err != nil {
		if err == sql.ErrNoRows {
			return moduleTimingGateResult{}, assessmentConflict("SECTION_CLOCK_MISSING", "The authoritative SAT section clock is missing.")
		}
		return moduleTimingGateResult{}, err
	}
	if pausedAt.Valid {
		return moduleTimingGateResult{}, assessmentConflict("RUNTIME_PAUSED", "The SAT cohort clock is paused.")
	}
	if status != "live" {
		return moduleTimingGateResult{}, assessmentConflict("RUNTIME_NOT_LIVE", "The SAT section is not live.")
	}
	if !actualStart.Valid {
		return moduleTimingGateResult{}, assessmentConflict("RUNTIME_NOT_LIVE", "The SAT section clock has not started.")
	}
	now, err := dbTimeTx(ctx, t)
	if err != nil {
		return moduleTimingGateResult{}, err
	}
	deadline := saveStageDeadline(actualStart.Time.UTC(), pausedInt(plannedMinutes), pausedInt(extensionMinutes), pausedInt(pausedSeconds))
	if !now.Before(deadline) {
		return moduleTimingGateResult{}, assessmentConflict("DEADLINE_EXPIRED", "The SAT section clock has expired.")
	}
	if timingModel.String == examruntime.TimingModelCohortStage {
		return moduleTimingGateResult{gate: timingGateCohortStage, now: now}, nil
	}
	return moduleTimingGateResult{
		gate:            timingGateCohortSection,
		now:             now,
		roomWindowEnd:   cohortModuleWindowEnd(actualStart.Time.UTC(), authoredSeconds, adaptiveRole, deadline),
		roomWindowKnown: true,
	}, nil
}

// cohortModuleWindowEnd is the room's boundary for one module of a
// section-keyed cohort section: Module 1 (the base module) ends at the
// SECTION's start plus its authored length, and the adaptive branch module that
// closes the section ends with the section's own clock. The section deadline
// caps either one — an extension, an accumulated pause or a repaired section
// length must never let a module window run past the clock every candidate in
// the room shares.
func cohortModuleWindowEnd(sectionStart time.Time, authoredSeconds int, adaptiveRole string, sectionDeadline time.Time) time.Time {
	if adaptiveRole != "base" || authoredSeconds <= 0 {
		return sectionDeadline
	}
	base := sectionStart.Add(time.Duration(authoredSeconds) * time.Second)
	if base.After(sectionDeadline) {
		return sectionDeadline
	}
	return base
}

// cohortModuleWindowSeconds is the window a cohort module may be given: its own
// allotment, never more than the room has left of the module's boundary. An
// elapsed boundary allocates zero — the module is over for the room, and the
// server's timeout path (never a fresh personal window) decides what happens
// next: the reconciler finalizes the module and the adaptive successor opens
// with whatever the section still has.
func cohortModuleWindowSeconds(allocatedSeconds int, roomWindowEnd, now time.Time) int {
	if allocatedSeconds <= 0 {
		return allocatedSeconds
	}
	remaining := int(roomWindowEnd.Sub(now) / time.Second)
	if remaining >= allocatedSeconds {
		return allocatedSeconds
	}
	if remaining < 0 {
		return 0
	}
	return remaining
}

// modulePlacement is one delivered module's section and authored length: what
// the entry-window projection needs to place a module row inside the room.
// Read off the delivered sections the same payload ships, so the projection
// costs no extra statement.
type modulePlacement struct {
	sectionKey      string
	adaptiveRole    string
	durationSeconds int
}

func deliveredModulePlacements(sections []DeliverySection) map[string]modulePlacement {
	placements := make(map[string]modulePlacement)
	for _, section := range sections {
		for _, module := range section.Modules {
			placements[module.ID] = modulePlacement{
				sectionKey:      section.SectionKey,
				adaptiveRole:    module.AdaptiveRole,
				durationSeconds: module.DurationSeconds,
			}
		}
	}
	return placements
}

// publishEntryWindows fills ModuleAttempt.EntryWindowSeconds for the modules the
// room's clock currently governs.
//
// This is the read-side twin of the StartModule clamp and deliberately runs the
// SAME functions over the same runtime facts, so the window a candidate is
// promised before they enter and the window the server grants them on entry
// cannot drift apart: the pre-entry screen used to quote the authored module
// length, which a late arrival never received. Only the active section's
// not-yet-started modules get one — a module whose section has not opened has no
// room window to publish, and a started module's own deadline is the truth.
//
// A paused room publishes the window the pause landed on (frozen, exactly as the
// candidates' own timers and the staff run sheet read it), so the promise made
// while the room is paused is the one that holds on resume.
func publishEntryWindows(attempts []ModuleAttempt, sections []DeliverySection, timing TimingSnapshot, room []proctor.SessionRuntimeSection, now time.Time) {
	if timing.TimingModel != examruntime.TimingModelCohortSection || timing.StageKey == nil {
		return
	}
	stage := sectionRuntimeByKey(room, *timing.StageKey)
	if stage == nil || stage.ActualStartAt == nil {
		return
	}
	if stage.Status != "live" && stage.Status != "paused" {
		return
	}
	reference := now
	if stage.PausedAt != nil {
		reference = *stage.PausedAt
	}
	sectionDeadline := saveStageDeadline(*stage.ActualStartAt,
		int64(stage.PlannedDurationMinutes), int64(stage.ExtensionMinutes),
		int64(stage.AccumulatedPausedSeconds))
	placements := deliveredModulePlacements(sections)
	for index := range attempts {
		attempt := &attempts[index]
		// A row with no allotment has no authored window to clamp: leave the
		// field nil rather than publish a zero the screen would read as "this
		// module has no time".
		if attempt.State != "not_started" || attempt.AllocatedSeconds <= 0 {
			continue
		}
		placement, ok := placements[attempt.ModuleID]
		if !ok || placement.sectionKey != *timing.StageKey {
			continue
		}
		boundary := cohortModuleWindowEnd(*stage.ActualStartAt,
			placement.durationSeconds, placement.adaptiveRole, sectionDeadline)
		window := cohortModuleWindowSeconds(attempt.AllocatedSeconds, boundary, reference)
		attempt.EntryWindowSeconds = &window
	}
}

// sectionRuntimeByKey finds one runtime section row, nil when the runtime has no
// row for that key (the run's version no longer carries the section).
func sectionRuntimeByKey(room []proctor.SessionRuntimeSection, key string) *proctor.SessionRuntimeSection {
	for index := range room {
		if room[index].SectionKey == key {
			return &room[index]
		}
	}
	return nil
}

func saveStageSuffix(adaptiveRole string) (string, error) {
	switch adaptiveRole {
	case "base":
		return "m1", nil
	case "lower_branch", "higher_branch":
		return "m2", nil
	default:
		return "", apperrors.New(apperrors.CodeInvalidAssessment, "SAT module adaptive role `"+adaptiveRole+"` has no cohort timing stage.")
	}
}

func saveStageDeadline(startedAt time.Time, plannedMinutes, extensionMinutes, pausedSeconds int64) time.Time {
	duration := (plannedMinutes + extensionMinutes) * 60
	if duration < 0 {
		duration = 0
	}
	if pausedSeconds < 0 {
		pausedSeconds = 0
	}
	return startedAt.Add(time.Duration(duration+pausedSeconds) * time.Second)
}

func pausedInt(v sql.NullInt64) int64 {
	if !v.Valid {
		return 0
	}
	return v.Int64
}

// ensureSaveModuleAdmitted mirrors ensure_module_response_admitted: the
// legacy personal module clock admits only active/review, started, unpaused
// rows before their deadline.
func ensureSaveModuleAdmitted(m saveActiveModule, now time.Time) error {
	if m.state != "active" && m.state != "review" {
		return assessmentConflict("MODULE_NOT_ACTIVE", "The SAT module is not active.")
	}
	if m.startedAt == nil {
		return assessmentConflict("RUNTIME_NOT_LIVE", "The SAT module has not been started.")
	}
	if m.pausedAt != nil {
		return assessmentConflict("RUNTIME_PAUSED", "The SAT module is paused by the proctor.")
	}
	deadline := moduleDeadline(m.availableAt, m.startedAt, m.allocatedSeconds, m.accumulatedPausedSeconds, m.extensionSeconds)
	if deadline == nil {
		return assessmentConflict("RUNTIME_NOT_LIVE", "The SAT module deadline is unavailable.")
	}
	if now.After(*deadline) {
		return assessmentConflict("DEADLINE_EXPIRED", "The SAT module timer has expired.")
	}
	return nil
}

// lockResponseTx loads the existing row FOR UPDATE plus its client_write_id.
func (s *Service) lockResponseTx(ctx context.Context, t tx.Tx, moduleAttemptID, examQuestionID string) (*saveResponseRow, *string, error) {
	var row saveResponseRow
	var response, eliminated, annotations sql.NullString
	if err := t.QueryRowContext(ctx,
		"SELECT id, module_attempt_id, exam_question_id, response, marked_for_review, eliminated_options, annotations, revision FROM assessment_question_responses WHERE module_attempt_id = ? AND exam_question_id = ? FOR UPDATE",
		moduleAttemptID, examQuestionID).Scan(&row.id, &row.moduleAttemptID, &row.examQuestionID, &response, &row.markedForReview, &eliminated, &annotations, &row.revision); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil, nil
		}
		return nil, nil, err
	}
	row.response = rawJSON(response)
	row.eliminatedOptions = saveEliminated(eliminated)
	row.annotations = rawJSON(annotations)
	var clientWriteID sql.NullString
	if err := t.QueryRowContext(ctx,
		"SELECT client_write_id FROM assessment_question_responses WHERE id = ? FOR UPDATE",
		row.id).Scan(&clientWriteID); err != nil {
		return nil, nil, err
	}
	if clientWriteID.Valid {
		v := clientWriteID.String
		return &row, &v, nil
	}
	return &row, nil, nil
}

// readResponseTx re-reads the written row for the snapshot.
func (s *Service) readResponseTx(ctx context.Context, t tx.Tx, responseID string) (*ResponseSnapshot, error) {
	var out ResponseSnapshot
	var response, eliminated, annotations sql.NullString
	if err := t.QueryRowContext(ctx,
		"SELECT id, module_attempt_id, exam_question_id, response, marked_for_review, eliminated_options, annotations, revision FROM assessment_question_responses WHERE id = ?",
		responseID).Scan(&out.ID, &out.ModuleAttemptID, &out.ExamQuestionID, &response, &out.MarkedForReview, &eliminated, &annotations, &out.Revision); err != nil {
		return nil, err
	}
	out.Response = rawJSON(response)
	out.EliminatedOptions = rawJSON(eliminated)
	out.Annotations = rawJSON(annotations)
	return &out, nil
}

// ensureTimeoutResponseRecoveryTx mirrors ensure_timeout_response_recovery_tx
// (Rust lines 1558-1740): locked+time_expired only; submission-exists =>
// TimeoutRecoveryClosed; downstream-started => TimeoutRecoveryClosed; cohort
// timing stage identity/deadline gates; legacy module deadline.
func (s *Service) ensureTimeoutResponseRecoveryTx(ctx context.Context, t tx.Tx, scheduleID, attemptID string, module saveActiveModule, now time.Time, req SaveResponseRequest) error {
	if module.state != "locked" || module.completionReason == nil || *module.completionReason != "time_expired" {
		return assessmentConflict("MODULE_NOT_ACTIVE", "Only a timeout-finalized SAT module can recover an admitted response.")
	}
	var submissionExists int
	if err := t.QueryRowContext(ctx,
		"SELECT EXISTS(SELECT 1 FROM student_submissions WHERE attempt_id = ? AND provider_key = 'sat')",
		attemptID).Scan(&submissionExists); err != nil {
		return err
	}
	if submissionExists != 0 {
		return assessmentConflict("TIMEOUT_RECOVERY_CLOSED", "The SAT result is already finalized; timeout recovery is closed.")
	}
	var downstreamStarted int
	if err := t.QueryRowContext(ctx,
		"SELECT EXISTS(SELECT 1 FROM assessment_module_attempts downstream JOIN assessment_modules dm ON dm.id = downstream.module_id JOIN assessment_sections ds ON ds.id = dm.section_id JOIN assessment_modules cm ON cm.id = ? JOIN assessment_sections cs ON cs.id = cm.section_id WHERE downstream.attempt_id = ? AND (ds.display_order > cs.display_order OR (ds.display_order = cs.display_order AND dm.display_order > cm.display_order)) AND downstream.state <> 'not_started')",
		module.moduleID, attemptID).Scan(&downstreamStarted); err != nil {
		return err
	}
	if downstreamStarted != 0 {
		return assessmentConflict("TIMEOUT_RECOVERY_CLOSED", "A later SAT module has already started; timeout recovery is closed.")
	}
	var timingModel sql.NullString
	if err := t.QueryRowContext(ctx,
		"SELECT timing_model FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE",
		scheduleID).Scan(&timingModel); err != nil && err != sql.ErrNoRows {
		return err
	}
	model := examruntime.TimingModelLegacy
	if timingModel.Valid && timingModel.String != "" {
		model = timingModel.String
	}
	if examruntime.IsCohortTimed(model) {
		var sectionKey, adaptiveRole string
		if err := t.QueryRowContext(ctx,
			"SELECT s.section_key, m.adaptive_role FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
			module.moduleID).Scan(&sectionKey, &adaptiveRole); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
			}
			return err
		}
		expected := sectionKey
		if model == examruntime.TimingModelCohortStage {
			suffix, err := saveStageSuffix(adaptiveRole)
			if err != nil {
				return err
			}
			expected = sectionKey + ":" + suffix
		}
		if req.StageKey != nil && *req.StageKey != expected {
			return assessmentConflict("STAGE_SECTION_MISMATCH", "Response stage identity does not match its SAT section.")
		}
		var startedAt sql.NullTime
		var plannedMinutes, extensionMinutes, pausedSeconds sql.NullInt64
		if err := t.QueryRowContext(ctx,
			"SELECT rs.actual_start_at, rs.planned_duration_minutes, rs.extension_minutes, rs.accumulated_paused_seconds FROM exam_session_runtime_sections rs JOIN exam_session_runtimes r ON r.id = rs.runtime_id WHERE r.schedule_id = ? AND rs.section_key = ? FOR UPDATE",
			scheduleID, expected).Scan(&startedAt, &plannedMinutes, &extensionMinutes, &pausedSeconds); err != nil {
			if err == sql.ErrNoRows {
				return assessmentConflict("SECTION_CLOCK_MISSING", "The authoritative SAT cohort clock is unavailable for recovery.")
			}
			return err
		}
		if !startedAt.Valid {
			return assessmentConflict("SECTION_CLOCK_MISSING", "The authoritative SAT cohort clock is unavailable for recovery.")
		}
		if now.After(saveStageDeadline(startedAt.Time.UTC(), pausedInt(plannedMinutes), pausedInt(extensionMinutes), pausedInt(pausedSeconds))) {
			return assessmentConflict("DEADLINE_EXPIRED", "The SAT response reached the server after the cohort deadline.")
		}
		if model == examruntime.TimingModelCohortSection {
			if module.startedAt == nil {
				return assessmentConflict("RUNTIME_NOT_LIVE", "The SAT module never started.")
			}
			if now.After(saveModuleDeadline(module)) {
				return assessmentConflict("DEADLINE_EXPIRED", "The SAT response reached the server after the module ended.")
			}
		}
		return nil
	}
	if module.startedAt == nil {
		return assessmentConflict("RUNTIME_NOT_LIVE", "The SAT module never started.")
	}
	if now.After(saveModuleDeadline(module)) {
		return assessmentConflict("DEADLINE_EXPIRED", "The SAT response reached the server after the module ended.")
	}
	return nil
}

func saveModuleDeadline(m saveActiveModule) time.Time {
	if m.startedAt == nil {
		return time.Time{}
	}
	deadline := moduleDeadline(m.availableAt, m.startedAt, m.allocatedSeconds, m.accumulatedPausedSeconds, m.extensionSeconds)
	if deadline == nil {
		return time.Time{}
	}
	return *deadline
}

// repairTimeoutFinalizedModuleTx mirrors repair_timeout_finalized_module_tx:
// rescore from the persisted answer definitions/responses, then conditionally
// update only a locked/time_expired module. A late response can therefore
// repair an aggregate without reopening the module or changing its terminal
// reason.
func (s *Service) repairTimeoutFinalizedModuleTx(ctx context.Context, t tx.Tx, module saveActiveModule) error {
	rows, err := loadScoringRowsTx(ctx, t, module.id, module.moduleID)
	if err != nil {
		return err
	}
	rawCorrect, operationalCount := scoreScoringRows(rows)
	_, err = t.ExecContext(ctx,
		"UPDATE assessment_module_attempts SET raw_correct = ?, operational_question_count = ?, revision = revision + 1 WHERE id = ? AND state = 'locked' AND completion_reason = 'time_expired'",
		rawCorrect, operationalCount, module.id)
	return err
}

func savePayloadMatches(existing *saveResponseRow, req SaveResponseRequest) bool {
	if string(existing.response) != string(json.RawMessage(nullableSaveString(req.Response))) {
		return false
	}
	if existing.markedForReview != req.MarkedForReview {
		return false
	}
	if string(jsonRawStrings(existing.eliminatedOptions)) != string(jsonRawStrings(req.EliminatedOptions)) {
		return false
	}
	return string(existing.annotations) == string(json.RawMessage(nullableSaveString(req.Annotations)))
}

func nullableSaveString(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	return string(raw)
}

func saveEliminated(v sql.NullString) []string {
	if !v.Valid || v.String == "" {
		return nil
	}
	var out []string
	if err := json.Unmarshal([]byte(v.String), &out); err != nil {
		return nil
	}
	return out
}

func jsonRawStrings(in []string) json.RawMessage {
	if in == nil {
		return json.RawMessage("null")
	}
	b, err := json.Marshal(in)
	if err != nil {
		return json.RawMessage("null")
	}
	return json.RawMessage(b)
}

func rawEliminated(in []string) json.RawMessage {
	if in == nil {
		return nil
	}
	b, err := json.Marshal(in)
	if err != nil {
		return nil
	}
	return json.RawMessage(b)
}

func nullableSaveRaw(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	if string(raw) == "null" {
		return nil
	}
	return string(raw)
}

// emptySaveJSON normalizes an optional JSON body for NOT NULL columns
// (round 84 live rehearsal: omitting `annotations` sent NULL into a
// NOT NULL column — 1048 escaped as a silent 500). Absent/null becomes
// the empty object '{}', matching the reader's rawJSON default.
func emptySaveJSON(raw json.RawMessage) any {
	if len(raw) == 0 || string(raw) == "null" {
		return "{}"
	}
	return string(raw)
}

// isDuplicateKeyError reports a MySQL duplicate-key violation (1062) without
// importing the driver: the assessment_question_responses
// (module_attempt_id, exam_question_id) unique turns a lost insert race into
// a revision conflict, not an internal error. No new migration: the unique
// already exists as uq_module_attempt_question.
func isDuplicateKeyError(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "duplicate") || strings.Contains(s, "1062")
}

func nullInt(v sql.NullInt64) *int64 {
	if !v.Valid {
		return nil
	}
	n := v.Int64
	return &n
}

// EnsureActiveWriter gates a delivery mutation behind the exclusive writer
// session. It mirrors ensure_active_writer + claim_provider_attempt_writer_in_tx
// (Rust assessment_delivery.rs ensure_active_writer and delivery/mod.rs
// claim_provider_attempt_writer_in_tx): in its own tx, claim the writer slot
// when free, then SELECT active_client_session_id FOR UPDATE and require
// equality with the bearer client session id. A mismatch surfaces
// ActiveSessionSuperseded, mapped here to CodeActiveSessionSuperseded (409,
// Details{reason:ACTIVE_SESSION_SUPERSEDED}). Callers run this in
// its own tx BEFORE the mutation tx (same as Rust: separate tx, commit, then
// the work tx). Bootstrap does not use it (schedule-match check only).
func (s *Service) EnsureActiveWriter(ctx context.Context, attemptID, scheduleID, clientSessionID string) error {
	// B1: claim-then-verify on one PK row; the conditional UPDATE + FOR UPDATE
	// re-read make RC safe (no snapshot dependency across statements).
	return s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		if _, err := t.ExecContext(ctx,
			"UPDATE student_attempts SET active_client_session_id = ? WHERE id = ? AND schedule_id = ? AND active_client_session_id IS NULL AND submitted_at IS NULL AND COALESCE(proctor_status, 'active') <> 'terminated' AND COALESCE(delivery_status, 'running') NOT IN ('submitted', 'terminated', 'locked', 'cancelled')",
			clientSessionID, attemptID, scheduleID); err != nil {
			return err
		}
		var active sql.NullString
		if err := t.QueryRowContext(ctx,
			"SELECT active_client_session_id FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE",
			attemptID, scheduleID).Scan(&active); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
			}
			return err
		}
		if !active.Valid || active.String != clientSessionID {
			err := apperrors.New(apperrors.CodeActiveSessionSuperseded, "A newer student session owns this attempt.")
			err.Details = map[string]any{"reason": "ACTIVE_SESSION_SUPERSEDED"}
			return err
		}
		return nil
	})
}

// claimWriterSessionTx claims + verifies the exclusive writer session INSIDE
// the mutation tx (plan B2.4 fold-in): bearer token row re-check (revocation
// landing between edge verify and commit fails closed) + conditional claim
// UPDATE (free slot -> bearer session; guarded by terminal/proctor
// predicates) + SELECT ... FOR UPDATE + equality. One tx — the separate
// pre-tx EnsureActiveWriter round trip is gone; the takeover race it raced
// is closed by construction (claim and write commit atomically). Empty
// session ids are rejected: the delivery edge guarantees non-empty (every
// minted bearer carries one), so an empty id here is a programming error,
// never a legacy case to silently weaken.
func claimWriterSessionTx(ctx context.Context, t tx.Tx, scheduleID, attemptID, clientSessionID, tokenID string) error {
	if clientSessionID == "" || tokenID == "" {
		return apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential.")
	}
	// TOCTOU close: the edge VerifyAttemptRead already checked this token
	// row, but a revocation/rotation landing after the edge and before
	// commit must not write. One indexed current read; revoked, rotated
	// (lease mismatch is enforced by the writer-session equality below),
	// or unknown rows fail closed. The attempt_sessions table predates
	// lease_epoch on some schemas; a missing column falls back to the
	// token/revocation probe (same rule as VerifyAttemptRead).
	var dbToken string
	var revokedAt sql.NullTime
	if err := t.QueryRowContext(ctx,
		"SELECT token_id, revoked_at FROM attempt_sessions WHERE token_id = ? AND revoked_at IS NULL",
		tokenID).Scan(&dbToken, &revokedAt); err != nil {
		return apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential.")
	}
	if dbToken != tokenID || revokedAt.Valid {
		return apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential.")
	}
	if _, err := t.ExecContext(ctx,
		"UPDATE student_attempts SET active_client_session_id = ? WHERE id = ? AND schedule_id = ? AND active_client_session_id IS NULL AND submitted_at IS NULL AND COALESCE(proctor_status, 'active') <> 'terminated' AND COALESCE(delivery_status, 'running') NOT IN ('submitted', 'terminated', 'locked', 'cancelled')",
		clientSessionID, attemptID, scheduleID); err != nil {
		return err
	}
	var active sql.NullString
	if err := t.QueryRowContext(ctx,
		"SELECT active_client_session_id FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE",
		attemptID, scheduleID).Scan(&active); err != nil {
		if err == sql.ErrNoRows {
			return apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
		}
		return err
	}
	if !active.Valid || active.String != clientSessionID {
		err := apperrors.New(apperrors.CodeActiveSessionSuperseded, "A newer student session owns this attempt.")
		err.Details = map[string]any{"reason": "ACTIVE_SESSION_SUPERSEDED"}
		return err
	}
	return nil
}

// enforceWriterSessionTx keeps the historical in-tx call shape (variadic
// bearer sessions + token) and routes into the folded claimWriterSessionTx:
// revocation re-check + claim + verify in one tx. All mutation-tx call
// sites keep working unchanged. The variadic tail is [clientSessionID,
// tokenID]; both are required (edge guarantees them).
func enforceWriterSessionTx(ctx context.Context, t tx.Tx, scheduleID, attemptID string, writerBinding ...string) error {
	if len(writerBinding) < 2 || writerBinding[0] == "" || writerBinding[1] == "" {
		return apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential.")
	}
	return claimWriterSessionTx(ctx, t, scheduleID, attemptID, writerBinding[0], writerBinding[1])
}

// enforceControlEpochTx fences an entry/arm command against the attempt control
// epoch the client believed it held. `student_attempts.control_epoch` is bumped
// by pause/resume (and by final submission), so a command that crossed a
// control boundary must not arm or confirm a module offer under a frozen clock:
// the candidate would enter with a stale timing projection. A nil/zero expected
// epoch means the caller opted out (legacy clients), which is exactly the
// pre-existing behaviour for those paths.
//
// The caller must already hold the attempt row lock (ensureAttemptCanWorkTx),
// which makes the comparison stable for the rest of the transaction.
func enforceControlEpochTx(ctx context.Context, t tx.Tx, attemptID string, expected *int) error {
	if expected == nil || *expected <= 0 {
		return nil
	}
	var current int
	if err := t.QueryRowContext(ctx, "SELECT control_epoch FROM student_attempts WHERE id = ?", attemptID).Scan(&current); err != nil {
		if err == sql.ErrNoRows {
			return apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
		}
		return err
	}
	if current != *expected {
		return &apperrors.Error{
			Code:       apperrors.CodeControlEpochStale,
			Message:    "Command crossed a pause/resume control boundary.",
			HTTPStatus: 409,
			Details:    map[string]any{"requestControlEpoch": uint64(*expected), "currentControlEpoch": uint64(current)},
		}
	}
	return nil
}

// Only fields in DeliveredAnswerDefinition may cross the candidate boundary.
//
// Key-universe contract (mirrored by redactAnswerValue in cmd/api, which
// must not import this package): the scorer (assessscore.answerField)
// resolves camelCase AND snake_case twins, so the allowlist accepts both
// spellings on input but emits canonical camelCase. Unknown kinds and
// unparseable envelopes fail closed.
func deliveredAnswer(raw json.RawMessage) (json.RawMessage, error) {
	var source map[string]json.RawMessage
	if err := json.Unmarshal(raw, &source); err != nil {
		return nil, err
	}
	kind, _ := answerKindOf(source)
	if kind == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "Unsupported delivered answer kind.")
	}
	out := map[string]json.RawMessage{}
	if rawKind, ok := source["kind"]; ok {
		out["kind"] = rawKind
	} else {
		encoded, _ := json.Marshal(kind)
		out["kind"] = encoded
	}
	switch kind {
	case "single_choice":
		if rawOptions, ok := firstPresent(source, "options"); ok {
			// Options are re-allowlisted per element ({id, content}
			// only): a nested isCorrect/is_correct flag would otherwise
			// survive the allowlist and leak the key inside options.
			if redacted, err := redactOptions(rawOptions); err == nil {
				out["options"] = redacted
			}
		}
	case "student_produced_response":
		for _, key := range []string{"normalizeFraction", "normalizeDecimal", "numericTolerance"} {
			if value, ok := firstPresent(source, key, snakeOf(key)); ok {
				out[key] = value
			}
		}
		// acceptedResponses is key material: never emitted. The
		// candidate needs only the normalization contract.
	default:
		return nil, apperrors.New(apperrors.CodeValidation, "Unsupported delivered answer kind.")
	}
	return json.Marshal(out)
}

// answerKindOf reads the answer kind tolerating a missing/duplicated key;
// empty means unsupported (fail closed).
func answerKindOf(source map[string]json.RawMessage) (string, bool) {
	if raw, ok := source["kind"]; ok {
		var kind string
		if err := json.Unmarshal(raw, &kind); err == nil && (kind == "single_choice" || kind == "student_produced_response") {
			return kind, true
		}
	}
	return "", false
}

// firstPresent returns the first present spelling (canonical first).
func firstPresent(source map[string]json.RawMessage, spellings ...string) (json.RawMessage, bool) {
	for _, key := range spellings {
		if value, ok := source[key]; ok {
			return value, true
		}
	}
	return nil, false
}

// snakeOf maps a canonical camelCase answer key to its snake_case twin
// (the scorer accepts both; the redactor must cover both).
func snakeOf(camel string) string {
	var out []rune
	for _, r := range camel {
		if r >= 'A' && r <= 'Z' {
			out = append(out, '_', r+('a'-'A'))
		} else {
			out = append(out, r)
		}
	}
	return string(out)
}

// redactOptions re-emits a single_choice options array keeping only the
// display fields {id, content} per element. Correctness flags
// (isCorrect/is_correct), explanations, and any future key-adjacent
// fields are dropped — the allowlist is per-element, not per-array.
func redactOptions(raw json.RawMessage) (json.RawMessage, error) {
	var options []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &options); err != nil {
		return nil, err
	}
	redacted := make([]map[string]json.RawMessage, 0, len(options))
	for _, opt := range options {
		keep := map[string]json.RawMessage{}
		if id, ok := opt["id"]; ok {
			keep["id"] = id
		}
		if content, ok := opt["content"]; ok {
			keep["content"] = content
		}
		redacted = append(redacted, keep)
	}
	return json.Marshal(redacted)
}
