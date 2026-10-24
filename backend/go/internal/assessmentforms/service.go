// Package assessmentforms owns SAT registration answers, native Eva SIM
// responses, mode-aware Eva state, explicit End Exam closure and the staff
// response list (docs/plans/SAT-configurable-forms-and-eva-sim.md §3).
// Definitions come only from the attempt's pinned exam version; embedded Eva
// never writes a response row or receipt.
package assessmentforms

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/assessmentforms/definition"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/lifecycle"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// Stable conflict reasons (error details.reason).
const (
	ReasonFormVersionChanged   = "FORM_VERSION_CHANGED"
	ReasonFormResponseChanged  = "FORM_RESPONSE_CHANGED"
	ReasonEvaClosed            = "EVA_SIM_CLOSED"
	ReasonEvaModeMismatch      = "EVA_MODE_MISMATCH"
	ReasonRegistrationRequired = "REGISTRATION_REQUIRED"
	ReasonEvaNotEligible       = "EVA_SIM_NOT_ELIGIBLE"
)

const opKindEvaSubmit = "eva_sim_submit"

type Service struct {
	db     *sql.DB
	runner *tx.Runner
}

func New(db *sql.DB, runner *tx.Runner) *Service { return &Service{db: db, runner: runner} }

type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func conflict(reason, msg string, extra map[string]any) *apperrors.Error {
	e := apperrors.New(apperrors.CodeConflict, msg)
	e.Details = map[string]any{"reason": reason}
	for k, v := range extra {
		e.Details[k] = v
	}
	return e
}

func fieldErrors(errs map[string]string) *apperrors.Error {
	msg := "Check the highlighted answers."
	if m, ok := errs[""]; ok {
		msg = m
	}
	e := apperrors.New(apperrors.CodeValidation, msg)
	e.Details = map[string]any{"fields": errs}
	return e
}

func invalidStoredForms() *apperrors.Error {
	return apperrors.New(apperrors.CodeInvalidAssessment, "This exam's form settings are invalid. Ask your proctor for help.")
}

// attemptContext is everything a form decision needs about one attempt. The
// definition comes from the attempt's immutable published version.
type attemptContext struct {
	AttemptID, ScheduleID, ExamID, VersionID, UserID string
	DeliveryStatus, ProctorStatus, ScheduleStatus    string
	ClosedAt                                         sql.NullTime
	Forms                                            *definition.Forms
	Sections                                         map[string]bool
}

// completed is the authoritative successful-completion condition: a sealed
// submission that was not proctor-terminated, in a room that was not
// cancelled. A timer at zero or an unconfirmed client submit is not enough.
func (c attemptContext) completed() bool {
	return c.DeliveryStatus == "submitted" && c.ProctorStatus != "terminated" && c.ScheduleStatus != "cancelled"
}

func loadAttemptContext(ctx context.Context, q queryer, attemptID string) (attemptContext, error) {
	var c attemptContext
	var config, delivery, proctorStatus sql.NullString
	err := q.QueryRowContext(ctx, `SELECT a.id, a.schedule_id, a.exam_id, a.published_version_id, COALESCE(a.user_id, ''), a.delivery_status, a.proctor_status, s.status, s.eva_sim_closed_at, CAST(v.config_snapshot AS CHAR)
FROM student_attempts a JOIN exam_schedules s ON s.id = a.schedule_id JOIN exam_versions v ON v.id = a.published_version_id WHERE a.id = ?`, attemptID).
		Scan(&c.AttemptID, &c.ScheduleID, &c.ExamID, &c.VersionID, &c.UserID, &delivery, &proctorStatus, &c.ScheduleStatus, &c.ClosedAt, &config)
	if err == sql.ErrNoRows {
		return c, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
	}
	if err != nil {
		return c, err
	}
	c.DeliveryStatus = delivery.String
	c.ProctorStatus = proctorStatus.String
	if c.ProctorStatus == "" {
		c.ProctorStatus = "active"
	}
	forms, err := definition.FromSnapshot([]byte(config.String))
	if err != nil {
		return c, invalidStoredForms()
	}
	c.Forms = forms
	if forms != nil {
		sections, err := exams.AttemptSectionScope(ctx, q, attemptID)
		if err != nil {
			return c, err
		}
		c.Sections = sections
	}
	return c, nil
}

// ---------------------------------------------------------------- registration

// PublicRegistrationForm is the candidate-safe projection: only the pinned
// version's registration fields that apply to the room's effective sections.
type PublicRegistrationForm struct {
	VersionID     string             `json:"versionId"`
	SchemaVersion int                `json:"schemaVersion"`
	Fields        []definition.Field `json:"fields"`
}

// ScheduleRegistrationForm projects the registration form for new entries
// into a room: its pinned version intersected with its access-link scope.
// Nil means legacy or no applicable question.
func ScheduleRegistrationForm(ctx context.Context, q queryer, scheduleID string) (*PublicRegistrationForm, error) {
	var versionID string
	var config, rawLink, rawRelease sql.NullString
	err := q.QueryRowContext(ctx, `SELECT s.published_version_id, CAST(v.config_snapshot AS CHAR), l.enabled_sections, v.sat_publish_scope
FROM exam_schedules s JOIN exam_versions v ON v.id = s.published_version_id LEFT JOIN assessment_access_links l ON l.schedule_id = s.id WHERE s.id = ?`, scheduleID).
		Scan(&versionID, &config, &rawLink, &rawRelease)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	forms, err := definition.FromSnapshot([]byte(config.String))
	if err != nil {
		return nil, invalidStoredForms()
	}
	if forms == nil {
		return nil, nil
	}
	sections := exams.IntersectSectionScopes(exams.ParseSATPublishScope(rawRelease.String), exams.ParseStoredSectionScope(rawLink))
	fields := definition.ApplicableFields(forms.Registration.Fields, sections)
	if len(fields) == 0 {
		return nil, nil
	}
	return &PublicRegistrationForm{VersionID: versionID, SchemaVersion: forms.SchemaVersion, Fields: fields}, nil
}

// RegistrationSubmission is the entry-time answer set and the version the
// student saw.
type RegistrationSubmission struct {
	VersionID string          `json:"versionId"`
	Answers   json.RawMessage `json:"answers"`
}

// EnsureRegistrationTx is the admission gate. It runs inside the credential
// issuer of attempts.Admit (after the attempt lock, before the token insert)
// for an attempt that has never been admitted: an applicable enabled
// registration form needs either a stored response or valid submitted
// answers, which are inserted in the same transaction as the credential.
func EnsureRegistrationTx(ctx context.Context, q tx.Tx, attemptID string, sub *RegistrationSubmission) error {
	c, err := loadAttemptContext(ctx, q, attemptID)
	if err != nil {
		return err
	}
	if c.Forms == nil {
		return nil
	}
	if c.Forms.SchemaVersion == definition.SchemaVersionSections {
		var model string
		if err := q.QueryRowContext(ctx, "SELECT COALESCE(sat_timing_model, '') FROM exam_schedules WHERE id = ?", c.ScheduleID).Scan(&model); err != nil {
			return err
		}
		if model != "sat_personal_v1" {
			return conflict("SECTION_FORMS_REQUIRE_PERSONAL_TIMING", "Separate section forms require individual student timers.", nil)
		}
	}
	fields := definition.ApplicableFields(c.Forms.Registration.Fields, c.Sections)
	if len(fields) == 0 {
		return nil
	}
	var exists bool
	if err := q.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM assessment_form_responses WHERE attempt_id = ? AND form_key = ?)", attemptID, definition.FormRegistration).Scan(&exists); err != nil {
		return err
	}
	if exists {
		// Sealed: a stale entry screen cannot replace recorded answers.
		return nil
	}
	if sub == nil {
		e := apperrors.New(apperrors.CodeValidation, "Complete the exam details to check in.")
		e.Details = map[string]any{"reason": ReasonRegistrationRequired}
		return e
	}
	if strings.TrimSpace(sub.VersionID) != c.VersionID {
		return conflict(ReasonFormVersionChanged, "The registration form changed. Review your details and continue.", nil)
	}
	answers, errs := definition.ValidateAnswers(fields, sub.Answers)
	if len(errs) > 0 {
		return fieldErrors(errs)
	}
	encoded, err := json.Marshal(answers)
	if err != nil {
		return err
	}
	_, err = q.ExecContext(ctx, "INSERT INTO assessment_form_responses (attempt_id, form_key, answers, revision, first_submitted_at, updated_at) VALUES (?, ?, ?, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", attemptID, definition.FormRegistration, string(encoded))
	return err
}

// ------------------------------------------------------------------- Eva state

// EvaState is the discriminated student-facing Eva state.
type EvaState struct {
	Eligibility         string             `json:"eligibility"`
	Reason              string             `json:"reason,omitempty"`
	Mode                *string            `json:"mode"`
	Collection          string             `json:"collection,omitempty"`
	VersionID           string             `json:"versionId,omitempty"`
	ClosedAt            *time.Time         `json:"closedAt"`
	CanReturnToComplete bool               `json:"canReturnToComplete"`
	Response            string             `json:"response,omitempty"`
	CanSubmit           bool               `json:"canSubmit"`
	Fields              []definition.Field `json:"fields,omitempty"`
	Answers             definition.Answers `json:"answers,omitempty"`
	Revision            *int64             `json:"revision,omitempty"`
	FirstSubmittedAt    *time.Time         `json:"firstSubmittedAt,omitempty"`
	UpdatedAt           *time.Time         `json:"updatedAt,omitempty"`
	CanOpen             *bool              `json:"canOpen,omitempty"`
	EmbedURL            *string            `json:"embedUrl,omitempty"`
	ExternalOpenURL     *string            `json:"externalOpenUrl,omitempty"`
	EmbedHost           string             `json:"embedHost,omitempty"`
}

func notApplicable(reason string) EvaState {
	return EvaState{Eligibility: "not_applicable", Reason: reason, CanReturnToComplete: true}
}

// evaEligibility reports why an attempt can or cannot use Eva.
func evaEligibility(c attemptContext) string {
	switch {
	case c.Forms == nil:
		return "legacy"
	case !c.Forms.EvaSim.Enabled:
		return "disabled"
	case !definition.IncludesMath(c.Sections):
		return "no_math"
	case !c.completed():
		return "not_completed"
	}
	return ""
}

type responseRow struct {
	Answers          definition.Answers
	Revision         int64
	FirstSubmittedAt time.Time
	UpdatedAt        time.Time
}

func loadResponse(ctx context.Context, q queryer, attemptID, formKey, lock string) (*responseRow, error) {
	var raw []byte
	var r responseRow
	err := q.QueryRowContext(ctx, "SELECT answers, revision, first_submitted_at, updated_at FROM assessment_form_responses WHERE attempt_id = ? AND form_key = ?"+lock, attemptID, formKey).
		Scan(&raw, &r.Revision, &r.FirstSubmittedAt, &r.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &r.Answers); err != nil {
		return nil, err
	}
	return &r, nil
}

func buildEvaState(c attemptContext, resp *responseRow) EvaState {
	if reason := evaEligibility(c); reason != "" {
		return notApplicable(reason)
	}
	mode := c.Forms.EvaSim.Mode
	open := !c.ClosedAt.Valid
	st := EvaState{Eligibility: "eligible", Mode: &mode, Collection: "closed", VersionID: c.VersionID}
	if open {
		st.Collection = "open"
	}
	if c.ClosedAt.Valid {
		at := c.ClosedAt.Time.UTC()
		st.ClosedAt = &at
	}
	switch mode {
	case definition.ModeEmbed:
		st.Response = "not_tracked"
		st.CanReturnToComplete = true
		canOpen := open
		st.CanOpen = &canOpen
		st.EmbedHost = definition.EmbedHost(c.Forms.EvaSim.URL)
		if open {
			u := c.Forms.EvaSim.URL
			st.EmbedURL, st.ExternalOpenURL = &u, &u
		}
	default:
		st.Fields = c.Forms.EvaSim.Fields
		rev := int64(0)
		st.Response = "not_submitted"
		if resp != nil {
			st.Response = "submitted"
			st.Answers = resp.Answers
			rev = resp.Revision
			first, upd := resp.FirstSubmittedAt.UTC(), resp.UpdatedAt.UTC()
			st.FirstSubmittedAt, st.UpdatedAt = &first, &upd
		}
		st.Revision = &rev
		st.CanSubmit = open
		st.CanReturnToComplete = !open || resp != nil
	}
	return st
}

// EvaStateFor returns the authoritative Eva state for an authenticated
// attempt owner. Mutable state is never cached.
func (s *Service) EvaStateFor(ctx context.Context, scheduleID, attemptID string) (EvaState, error) {
	c, err := loadAttemptContext(ctx, s.db, attemptID)
	if err != nil {
		return EvaState{}, err
	}
	if c.ScheduleID != scheduleID {
		return EvaState{}, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
	}
	var resp *responseRow
	if c.Forms != nil && c.Forms.EvaSim.Mode == definition.ModeNative {
		if resp, err = loadResponse(ctx, s.db, attemptID, definition.FormEvaSim, ""); err != nil {
			return EvaState{}, err
		}
	}
	return buildEvaState(c, resp), nil
}

// --------------------------------------------------------------- native submit

// Credential is the server-established attempt bearer binding.
type Credential struct {
	TokenID, UserID, ScheduleID, AttemptID string
	LeaseEpoch                             *uint64
}

type SubmitEvaCommand struct {
	OperationID      string          `json:"operationId"`
	ExpectedRevision int64           `json:"expectedRevision"`
	VersionID        string          `json:"versionId"`
	Answers          json.RawMessage `json:"answers"`
}

// EvaAck is the acknowledged native write (also the receipt payload).
type EvaAck struct {
	Revision         int64              `json:"revision"`
	FirstSubmittedAt time.Time          `json:"firstSubmittedAt"`
	UpdatedAt        time.Time          `json:"updatedAt"`
	Answers          definition.Answers `json:"answers"`
}

func compactJSON(raw json.RawMessage) string {
	var buf bytes.Buffer
	if err := json.Compact(&buf, raw); err != nil {
		return string(raw)
	}
	return buf.String()
}

// SubmitEva accepts a native Eva first submission or edit. Lock order follows
// End Exam: room fence FOR SHARE, then the owning attempt, then its session
// row. Authorization precedes receipt replay; replay precedes closure.
func (s *Service) SubmitEva(ctx context.Context, cred Credential, cmd SubmitEvaCommand) (EvaAck, error) {
	cmd.OperationID = strings.TrimSpace(cmd.OperationID)
	var canonicalAnswers map[string]any
	if err := json.Unmarshal(cmd.Answers, &canonicalAnswers); err != nil && len(bytes.TrimSpace(cmd.Answers)) > 0 {
		return EvaAck{}, fieldErrors(map[string]string{"": "Answers must be an object keyed by question ID."})
	}
	hash, err := lifecycle.Hash(opKindEvaSubmit, struct {
		ExpectedRevision int64          `json:"expectedRevision"`
		VersionID        string         `json:"versionId"`
		Answers          map[string]any `json:"answers"`
	}{cmd.ExpectedRevision, strings.TrimSpace(cmd.VersionID), canonicalAnswers})
	if err != nil {
		return EvaAck{}, err
	}
	var out EvaAck
	err = s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		var closedAt sql.NullTime
		if err := q.QueryRowContext(ctx, "SELECT eva_sim_closed_at FROM exam_schedules WHERE id = ? FOR SHARE", cred.ScheduleID).Scan(&closedAt); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
			}
			return err
		}
		var owner sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT user_id FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE", cred.AttemptID, cred.ScheduleID).Scan(&owner); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
			}
			return err
		}
		if !owner.Valid || owner.String != cred.UserID {
			return apperrors.New(apperrors.CodeForbidden, "This sitting is not bound to the authenticated principal.")
		}
		if err := verifySessionTx(ctx, q, cred); err != nil {
			return err
		}
		scope := lifecycle.Scope{ScheduleID: cred.ScheduleID, AttemptID: cred.AttemptID}
		stored, err := lifecycle.Load(ctx, q, scope, cmd.OperationID, opKindEvaSubmit, hash)
		if err != nil {
			return err
		}
		if stored != nil {
			return json.Unmarshal(stored, &out)
		}
		c, err := loadAttemptContext(ctx, q, cred.AttemptID)
		if err != nil {
			return err
		}
		c.ClosedAt = closedAt
		if reason := evaEligibility(c); reason != "" {
			return conflict(ReasonEvaNotEligible, "Eva SIM is not available for this sitting.", map[string]any{"eligibility": reason})
		}
		if c.Forms.EvaSim.Mode != definition.ModeNative {
			return conflict(ReasonEvaModeMismatch, "This Eva SIM form is external and is not submitted here.", nil)
		}
		if c.ClosedAt.Valid {
			return conflict(ReasonEvaClosed, "Eva SIM is closed. Your proctor ended the exam.", nil)
		}
		if strings.TrimSpace(cmd.VersionID) != c.VersionID {
			return conflict(ReasonFormVersionChanged, "Eva SIM changed. Reload before submitting.", nil)
		}
		current, err := loadResponse(ctx, q, cred.AttemptID, definition.FormEvaSim, " FOR UPDATE")
		if err != nil {
			return err
		}
		currentRev := int64(0)
		if current != nil {
			currentRev = current.Revision
		}
		if cmd.ExpectedRevision != currentRev {
			return conflict(ReasonFormResponseChanged, "This response changed in another tab. Load the latest response before editing.", map[string]any{"revision": currentRev})
		}
		answers, errs := definition.ValidateAnswers(c.Forms.EvaSim.Fields, cmd.Answers)
		if len(errs) > 0 {
			return fieldErrors(errs)
		}
		encoded, err := json.Marshal(answers)
		if err != nil {
			return err
		}
		if current == nil {
			_, err = q.ExecContext(ctx, "INSERT INTO assessment_form_responses (attempt_id, form_key, answers, revision, first_submitted_at, updated_at) VALUES (?, ?, ?, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", cred.AttemptID, definition.FormEvaSim, string(encoded))
		} else {
			_, err = q.ExecContext(ctx, "UPDATE assessment_form_responses SET answers = ?, revision = revision + 1, updated_at = UTC_TIMESTAMP(6) WHERE attempt_id = ? AND form_key = ? AND revision = ?", string(encoded), cred.AttemptID, definition.FormEvaSim, currentRev)
		}
		if err != nil {
			return err
		}
		written, err := loadResponse(ctx, q, cred.AttemptID, definition.FormEvaSim, "")
		if err != nil {
			return err
		}
		out = EvaAck{Revision: written.Revision, FirstSubmittedAt: written.FirstSubmittedAt.UTC(), UpdatedAt: written.UpdatedAt.UTC(), Answers: written.Answers}
		return lifecycle.Store(ctx, q, scope, cmd.OperationID, opKindEvaSubmit, hash, out)
	})
	return out, err
}

// verifySessionTx holds the bearer's attempt_sessions row FOR SHARE so a
// concurrent revocation/rotation serializes with acceptance.
func verifySessionTx(ctx context.Context, q tx.Tx, cred Credential) error {
	var userID, scheduleID, attemptID string
	var revokedAt sql.NullTime
	var expiresAt time.Time
	var lease sql.NullInt64
	err := q.QueryRowContext(ctx, "SELECT user_id, schedule_id, attempt_id, revoked_at, expires_at, lease_epoch FROM attempt_sessions WHERE token_id = ? FOR SHARE", cred.TokenID).
		Scan(&userID, &scheduleID, &attemptID, &revokedAt, &expiresAt, &lease)
	if err == sql.ErrNoRows {
		return apperrors.New(apperrors.CodeAttemptTokenInvalid, "Attempt session is no longer valid.")
	}
	if err != nil {
		return err
	}
	var now time.Time
	if err := q.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&now); err != nil {
		return err
	}
	if revokedAt.Valid || !expiresAt.After(now) || userID != cred.UserID || scheduleID != cred.ScheduleID || attemptID != cred.AttemptID {
		return apperrors.New(apperrors.CodeAttemptTokenInvalid, "Attempt session is no longer valid.")
	}
	if lease.Valid && (cred.LeaseEpoch == nil || int64(*cred.LeaseEpoch) != lease.Int64) {
		return apperrors.New(apperrors.CodeAttemptTokenInvalid, "Attempt session is no longer valid.")
	}
	return nil
}

// --------------------------------------------------------------------- closure

// CloseEvaTx records explicit staff End Exam closure. The caller must hold
// the exclusive schedule lock. Monotonic: the first closure time/actor is
// kept. Automatic completion paths must never call this.
func CloseEvaTx(ctx context.Context, q tx.Tx, scheduleID, actorID string) error {
	_, err := q.ExecContext(ctx, "UPDATE exam_schedules SET eva_sim_closed_at = UTC_TIMESTAMP(6), eva_sim_closed_by = ? WHERE id = ? AND eva_sim_closed_at IS NULL", actorID, scheduleID)
	return err
}

// ScheduleFormState is the room-level Eva summary for proctor controls.
type ScheduleFormState struct {
	EvaSimEnabled bool       `json:"evaSimEnabled"`
	Mode          *string    `json:"mode"`
	Collection    string     `json:"collection"`
	ClosedAt      *time.Time `json:"closedAt"`
}

func (s *Service) ScheduleState(ctx context.Context, scheduleID string) (ScheduleFormState, error) {
	var config, rawLink, rawRelease sql.NullString
	var closedAt sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT CAST(v.config_snapshot AS CHAR), l.enabled_sections, v.sat_publish_scope, s.eva_sim_closed_at
FROM exam_schedules s JOIN exam_versions v ON v.id = s.published_version_id LEFT JOIN assessment_access_links l ON l.schedule_id = s.id WHERE s.id = ?`, scheduleID).
		Scan(&config, &rawLink, &rawRelease, &closedAt)
	if err == sql.ErrNoRows {
		return ScheduleFormState{}, apperrors.New(apperrors.CodeNotFound, "Resource not found.")
	}
	if err != nil {
		return ScheduleFormState{}, err
	}
	forms, err := definition.FromSnapshot([]byte(config.String))
	if err != nil {
		return ScheduleFormState{}, invalidStoredForms()
	}
	out := ScheduleFormState{Collection: "not_applicable"}
	if closedAt.Valid {
		at := closedAt.Time.UTC()
		out.ClosedAt = &at
	}
	sections := exams.IntersectSectionScopes(exams.ParseSATPublishScope(rawRelease.String), exams.ParseStoredSectionScope(rawLink))
	if forms == nil || !forms.EvaSim.Enabled || !definition.IncludesMath(sections) {
		return out, nil
	}
	mode := forms.EvaSim.Mode
	out.EvaSimEnabled, out.Mode, out.Collection = true, &mode, "open"
	if closedAt.Valid {
		out.Collection = "closed"
	}
	return out, nil
}
