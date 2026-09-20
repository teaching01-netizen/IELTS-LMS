// Package accesslinks owns the Student Access (assessment-access-links) domain
// for the Go backend.
//
// It mirrors backend/crates/application/src/assessment_access_links.rs:
// audience/mode/availability/lifecycle enums, distribution overview,
// list/get/public projections, create/update/set-lifecycle/duplicate with
// revision fencing, member roster reads, participation activity, and entry
// resolution. Backing exam_schedules rows are maintained inline (the Rust
// service delegates those writes to SchedulingService; no Go equivalent
// owns that cross-table write, so the schedule INSERT/UPDATE shape follows
// internal/schedules and migration 0005).
//
// Role gating (require_exam_staff Admin/Builder in the Rust routes) lives
// with the HTTP handlers; this package returns NotFound/validation errors
// only and performs no auth checks.
package accesslinks

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// Field limits mirrored from the Rust service.
const (
	MaxLinkNameChars      = 160
	MaxAudienceLabelChars = 255
	MaxSelectedStudents   = 10000
)

// AnytimeBackingHorizonDays mirrors ANYTIME_BACKING_HORIZON_DAYS: anytime
// links ride on a wide backing schedule window.
const AnytimeBackingHorizonDays = 3650

// AudienceType is the link audience classifier.
type AudienceType string

// Audience types.
const (
	AudienceAnyone           AudienceType = "anyone"
	AudienceCohort           AudienceType = "cohort"
	AudienceSelectedStudents AudienceType = "selected_students"
)

// ParseAudienceType validates an audience type value.
func ParseAudienceType(value string) (AudienceType, error) {
	switch AudienceType(value) {
	case AudienceAnyone, AudienceCohort, AudienceSelectedStudents:
		return AudienceType(value), nil
	}
	return "", badRequest("Unknown access-link audience type.")
}

// Mode is the link entry mode.
type Mode string

// Access modes.
const (
	ModeStudentCode Mode = "student_code"
	ModeOpen        Mode = "open"
)

// ParseMode validates an access mode value.
func ParseMode(value string) (Mode, error) {
	switch Mode(value) {
	case ModeStudentCode, ModeOpen:
		return Mode(value), nil
	}
	return "", badRequest("Unknown access-link access mode.")
}

// AvailabilityType is the link availability classifier.
type AvailabilityType string

// Availability types.
const (
	AvailabilityScheduled AvailabilityType = "scheduled"
	AvailabilityAnytime   AvailabilityType = "anytime"
)

// ParseAvailabilityType validates an availability type value.
func ParseAvailabilityType(value string) (AvailabilityType, error) {
	switch AvailabilityType(value) {
	case AvailabilityScheduled, AvailabilityAnytime:
		return AvailabilityType(value), nil
	}
	return "", badRequest("Unknown access-link availability type.")
}

// LifecycleState is the operator lifecycle gate.
type LifecycleState string

// Lifecycle states.
const (
	LifecycleActive  LifecycleState = "active"
	LifecyclePaused  LifecycleState = "paused"
	LifecycleRevoked LifecycleState = "revoked"
)

// ParseLifecycleState validates a lifecycle state value.
func ParseLifecycleState(value string) (LifecycleState, error) {
	switch LifecycleState(value) {
	case LifecycleActive, LifecyclePaused, LifecycleRevoked:
		return LifecycleState(value), nil
	}
	return "", badRequest("Unknown access-link lifecycle state.")
}

// Section keys a Student Link can be scoped to. The vocabulary and the stored
// JSON shape are owned by internal/exams (exams.NormalizeSectionScope) so the
// runtime seam and the delivery gates read the same definition.
const (
	SectionReadingWriting = examdomain.LinkSectionReadingWriting
	SectionMath           = examdomain.LinkSectionMath
)

// NormalizeEnabledSections validates and canonicalizes a link's section scope.
// nil/empty means "all sections" (stored NULL) — which is what every link
// created before this feature gets, so nothing about them changes. Unknown or
// blank keys fail closed: silently dropping a typo would scope the link to a
// different sitting than the operator picked.
func NormalizeEnabledSections(sections []string) ([]string, error) {
	normalized, err := examdomain.NormalizeSectionScope(sections)
	if err != nil {
		return nil, badRequest(err.Error())
	}
	return normalized, nil
}

// equalSections reports whether two normalized scopes describe the same
// selection (nil/empty and an explicit all-sections list are NOT equal: the
// stored shape differs and the seam treats the explicit list as a real
// narrowing request to be intersected).
func equalSections(a, b []string) bool {
	return examdomain.EqualSectionScopes(a, b)
}

// parseEnabledSections decodes the stored JSON scope. A NULL/absent column, an
// empty array, or a malformed value all mean "all sections": a corrupted scope
// must not strand a run with no sections at all, and every fail-open path here
// matches pre-migration behaviour.
func parseEnabledSections(raw sql.NullString) []string {
	keys := examdomain.SectionScopeKeys(examdomain.ParseStoredSectionScope(raw.String))
	if len(keys) == 0 {
		return nil
	}
	return keys
}

// enabledSectionsJSON renders a scope for storage: NULL for "all sections",
// otherwise the canonical JSON array.
func enabledSectionsJSON(sections []string) any {
	normalized, err := NormalizeEnabledSections(sections)
	if err != nil || len(normalized) == 0 {
		return nil
	}
	payload, err := json.Marshal(normalized)
	if err != nil {
		return nil
	}
	return string(payload)
}

// Status is the derived link status (lifecycle first, then time window).
type Status string

// Link statuses.
const (
	StatusLive     Status = "live"
	StatusUpcoming Status = "upcoming"
	StatusEnded    Status = "ended"
	StatusPaused   Status = "paused"
	StatusRevoked  Status = "revoked"
)

// Metrics mirrors AccessLinkMetrics.
type Metrics struct {
	Registered int64 `json:"registered"`
	Started    int64 `json:"started"`
	Submitted  int64 `json:"submitted"`
}

// PublishedVersionSummary mirrors PublishedAccessVersionSummary.
type PublishedVersionSummary struct {
	ID            string    `json:"id"`
	VersionNumber int32     `json:"versionNumber"`
	Revision      int32     `json:"revision"`
	PublishNotes  *string   `json:"publishNotes"`
	CreatedAt     time.Time `json:"createdAt"`
}

// Overview mirrors AccessDistributionOverview.
type Overview struct {
	CurrentPublishedVersion *PublishedVersionSummary `json:"currentPublishedVersion"`
	Links                   []AccessLink             `json:"links"`
}

// AccessLink mirrors AssessmentAccessLink.
type AccessLink struct {
	ID                 string `json:"id"`
	ExamID             string `json:"examId"`
	ExamTitle          string `json:"examTitle"`
	ProviderKey        string `json:"providerKey"`
	PublishedVersionID string `json:"publishedVersionId"`
	VersionNumber      int32  `json:"versionNumber"`
	ScheduleID         string `json:"scheduleId"`
	Name               string `json:"name"`
	// EnabledSections is the link's section scope; nil/null means every
	// section the published version enables (today's behaviour).
	EnabledSections      []string         `json:"enabledSections"`
	AudienceType         AudienceType     `json:"audienceType"`
	AudienceLabel        *string          `json:"audienceLabel"`
	AccessMode           Mode             `json:"accessMode"`
	AvailabilityType     AvailabilityType `json:"availabilityType"`
	OpensAt              *time.Time       `json:"opensAt"`
	ClosesAt             *time.Time       `json:"closesAt"`
	LifecycleState       LifecycleState   `json:"lifecycleState"`
	Status               Status           `json:"status"`
	SelectedStudentCount int64            `json:"selectedStudentCount"`
	Metrics              Metrics          `json:"metrics"`
	IsCurrentRelease     bool             `json:"isCurrentRelease"`
	HasParticipation     bool             `json:"hasParticipation"`
	Revision             int32            `json:"revision"`
	CreatedAt            time.Time        `json:"createdAt"`
	UpdatedAt            time.Time        `json:"updatedAt"`
}

// PublicAccessLink mirrors PublicAssessmentAccessLink.
type PublicAccessLink struct {
	ID               string           `json:"id"`
	ExamTitle        string           `json:"examTitle"`
	ProviderKey      string           `json:"providerKey"`
	VersionNumber    int32            `json:"versionNumber"`
	Name             string           `json:"name"`
	EnabledSections  []string         `json:"enabledSections"`
	AudienceType     AudienceType     `json:"audienceType"`
	AudienceLabel    *string          `json:"audienceLabel"`
	AccessMode       Mode             `json:"accessMode"`
	AvailabilityType AvailabilityType `json:"availabilityType"`
	OpensAt          *time.Time       `json:"opensAt"`
	ClosesAt         *time.Time       `json:"closesAt"`
	Status           Status           `json:"status"`
}

// MemberInput mirrors AccessLinkMemberInput.
type MemberInput struct {
	StudentCode  string  `json:"studentCode"`
	StudentName  *string `json:"studentName,omitempty"`
	StudentEmail *string `json:"studentEmail,omitempty"`
}

// Member mirrors AccessLinkMember.
type Member struct {
	StudentCode  string  `json:"studentCode"`
	StudentName  *string `json:"studentName"`
	StudentEmail *string `json:"studentEmail"`
}

// CreateRequest mirrors CreateAssessmentAccessLinkRequest.
type CreateRequest struct {
	PublishedVersionID *string
	Name               string
	// EnabledSections nil = all sections.
	EnabledSections  []string
	AudienceType     AudienceType
	AudienceLabel    *string
	AccessMode       Mode
	AvailabilityType AvailabilityType
	OpensAt          *time.Time
	ClosesAt         *time.Time
	SelectedStudents []MemberInput
}

// UpdateRequest mirrors UpdateAssessmentAccessLinkRequest (revision fenced;
// nil SelectedStudents keeps the existing roster).
type UpdateRequest struct {
	Revision int32
	Name     string
	// EnabledSections is a pointer so "omitted" (keep the current scope) is
	// distinct from "cleared" (all sections), mirroring SelectedStudents.
	EnabledSections  *[]string
	AudienceType     AudienceType
	AudienceLabel    *string
	AccessMode       Mode
	AvailabilityType AvailabilityType
	OpensAt          *time.Time
	ClosesAt         *time.Time
	SelectedStudents *[]MemberInput
}

// SetLifecycleRequest mirrors SetAccessLinkLifecycleRequest.
type SetLifecycleRequest struct {
	Revision int32
	State    LifecycleState
}

// DuplicateReleaseTarget mirrors DuplicateReleaseTarget.
type DuplicateReleaseTarget string

// Duplicate release targets.
const (
	ReleaseTargetSource  DuplicateReleaseTarget = "source"
	ReleaseTargetCurrent DuplicateReleaseTarget = "current"
)

// ParseDuplicateReleaseTarget validates a release target; "" defaults to
// source (mirrors the Rust Default impl).
func ParseDuplicateReleaseTarget(value string) (DuplicateReleaseTarget, error) {
	switch DuplicateReleaseTarget(value) {
	case ReleaseTargetSource, "":
		return ReleaseTargetSource, nil
	case ReleaseTargetCurrent:
		return ReleaseTargetCurrent, nil
	}
	return "", badRequest("Unknown access-link release target.")
}

// DuplicateRequest mirrors DuplicateAssessmentAccessLinkRequest.
type DuplicateRequest struct {
	Revision         int32
	Name             *string
	ReleaseTarget    DuplicateReleaseTarget
	AvailabilityType *AvailabilityType
	OpensAt          *time.Time
	ClosesAt         *time.Time
}

// Activity mirrors AccessLinkActivity.
type Activity struct {
	Kind        string    `json:"kind"`
	StudentName string    `json:"studentName"`
	OccurredAt  time.Time `json:"occurredAt"`
}

// ResolvedEntry mirrors ResolvedAccessLinkEntry.
type ResolvedEntry struct {
	ScheduleID   string       `json:"scheduleId"`
	ProviderKey  string       `json:"providerKey"`
	AccessMode   Mode         `json:"accessMode"`
	AudienceType AudienceType `json:"audienceType"`
	// EnabledSections lets the entry card state the scope before the student
	// commits to the sitting; nil means all sections.
	EnabledSections []string `json:"enabledSections"`
}

// Service wires access-link transitions explicitly.
type Service struct {
	db     *sql.DB
	runner *tx.Runner
}

// NewService wires dependencies explicitly.
func NewService(db *sql.DB, runner *tx.Runner) *Service {
	return &Service{db: db, runner: runner}
}

func badRequest(msg string) *apperrors.Error {
	return apperrors.New(apperrors.CodeBadRequest, msg)
}

func notFound(msg string) *apperrors.Error {
	return apperrors.New(apperrors.CodeNotFound, msg)
}

func conflict(msg string) *apperrors.Error {
	return apperrors.New(apperrors.CodeConflict, msg)
}

// unavailable maps the Rust Unavailable variant (HTTP 403
// ACCESS_LINK_UNAVAILABLE) onto CodeForbidden.
func unavailable(msg string) *apperrors.Error {
	return apperrors.New(apperrors.CodeForbidden, msg)
}

// linkSelectSQL mirrors link_select_sql(): the link row plus roster counts,
// registration/attempt metrics, current-release flag, and participation
// flag. Column order is load-bearing for scanAccessLink.
func linkSelectSQL() string {
	return "SELECT l.id, l.exam_id, e.title AS exam_title, e.provider_key," +
		" l.published_version_id, v.version_number, l.schedule_id, l.name, l.enabled_sections," +
		" l.audience_type, l.audience_label, l.access_mode, l.availability_type," +
		" l.opens_at, l.closes_at, l.lifecycle_state, l.revision, l.created_at, l.updated_at," +
		" (SELECT COUNT(*) FROM assessment_access_link_members m WHERE m.link_id = l.id) AS selected_student_count," +
		" (SELECT COUNT(*) FROM schedule_registrations r WHERE r.schedule_id = l.schedule_id) AS registered_count," +
		" (SELECT COUNT(*) FROM student_attempts a WHERE a.schedule_id = l.schedule_id) AS started_count," +
		" (SELECT COUNT(*) FROM student_attempts a WHERE a.schedule_id = l.schedule_id AND a.submitted_at IS NOT NULL) AS submitted_count," +
		" (l.published_version_id = e.current_published_version_id) AS is_current_release," +
		" (EXISTS(SELECT 1 FROM schedule_registrations r WHERE r.schedule_id = l.schedule_id LIMIT 1)" +
		" OR EXISTS(SELECT 1 FROM student_attempts a WHERE a.schedule_id = l.schedule_id LIMIT 1)) AS has_participation" +
		" FROM assessment_access_links l" +
		" JOIN exam_entities e ON e.id = l.exam_id" +
		" JOIN exam_versions v ON v.id = l.published_version_id"
}

func scanAccessLink(row interface {
	Scan(dest ...any) error
}) (AccessLink, error) {
	var l AccessLink
	var audience, mode, availability, lifecycle string
	var label, enabledSections sql.NullString
	var opensAt, closesAt sql.NullTime
	var selected, registered, started, submitted int64
	var isCurrent, hasParticipation sql.NullInt64
	if err := row.Scan(
		&l.ID, &l.ExamID, &l.ExamTitle, &l.ProviderKey,
		&l.PublishedVersionID, &l.VersionNumber, &l.ScheduleID, &l.Name, &enabledSections,
		&audience, &label, &mode, &availability,
		&opensAt, &closesAt, &lifecycle, &l.Revision, &l.CreatedAt, &l.UpdatedAt,
		&selected, &registered, &started, &submitted,
		&isCurrent, &hasParticipation,
	); err != nil {
		return AccessLink{}, err
	}
	audienceType, err := ParseAudienceType(audience)
	if err != nil {
		return AccessLink{}, err
	}
	accessMode, err := ParseMode(mode)
	if err != nil {
		return AccessLink{}, err
	}
	availabilityType, err := ParseAvailabilityType(availability)
	if err != nil {
		return AccessLink{}, err
	}
	lifecycleState, err := ParseLifecycleState(lifecycle)
	if err != nil {
		return AccessLink{}, err
	}
	l.AudienceType = audienceType
	l.AccessMode = accessMode
	l.AvailabilityType = availabilityType
	l.LifecycleState = lifecycleState
	l.EnabledSections = parseEnabledSections(enabledSections)
	if label.Valid {
		v := label.String
		l.AudienceLabel = &v
	}
	if opensAt.Valid {
		v := opensAt.Time
		l.OpensAt = &v
	}
	if closesAt.Valid {
		v := closesAt.Time
		l.ClosesAt = &v
	}
	l.SelectedStudentCount = selected
	l.Metrics = Metrics{Registered: registered, Started: started, Submitted: submitted}
	l.IsCurrentRelease = isCurrent.Valid && isCurrent.Int64 != 0
	l.HasParticipation = hasParticipation.Valid && hasParticipation.Int64 != 0
	l.Status = deriveStatus(lifecycleState, availabilityType, l.OpensAt, l.ClosesAt, time.Now().UTC())
	return l, nil
}

// deriveStatus mirrors derive_status(): lifecycle gates before the window;
// anytime links are live once active.
func deriveStatus(lifecycle LifecycleState, availability AvailabilityType, opensAt, closesAt *time.Time, now time.Time) Status {
	switch lifecycle {
	case LifecycleRevoked:
		return StatusRevoked
	case LifecyclePaused:
		return StatusPaused
	}
	if availability == AvailabilityAnytime {
		return StatusLive
	}
	if opensAt != nil && now.Before(*opensAt) {
		return StatusUpcoming
	}
	if closesAt != nil && !now.Before(*closesAt) {
		return StatusEnded
	}
	return StatusLive
}

// NormalizeAccessCode mirrors domain normalize_access_code (and
// internal/schedules NormalizeAccessCode): W+6-digit codes uppercase,
// everything else trims.
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

func normalizeName(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", badRequest("Student Link name is required.")
	}
	if len([]rune(trimmed)) > MaxLinkNameChars {
		return "", badRequest("Student Link name must be 160 characters or fewer.")
	}
	return trimmed, nil
}

func normalizeOptionalLabel(value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil, nil
	}
	if len([]rune(trimmed)) > MaxAudienceLabelChars {
		return nil, badRequest("Audience name must be 255 characters or fewer.")
	}
	return &trimmed, nil
}

func normalizeMembers(members []MemberInput) ([]MemberInput, error) {
	if len(members) > MaxSelectedStudents {
		return nil, badRequest("A Student Link can include at most 10000 selected students.")
	}
	seen := make(map[string]struct{}, len(members))
	normalized := make([]MemberInput, 0, len(members))
	for _, member := range members {
		code := NormalizeAccessCode(member.StudentCode)
		if code == "" {
			return nil, badRequest("Every selected student needs a student code.")
		}
		key := strings.ToLower(code)
		if _, dup := seen[key]; dup {
			return nil, badRequest("Student code " + code + " appears more than once.")
		}
		seen[key] = struct{}{}
		out := MemberInput{StudentCode: code}
		if member.StudentName != nil {
			if trimmed := strings.TrimSpace(*member.StudentName); trimmed != "" {
				v := trimmed
				out.StudentName = &v
			}
		}
		if member.StudentEmail != nil {
			if trimmed := strings.TrimSpace(*member.StudentEmail); trimmed != "" {
				v := trimmed
				out.StudentEmail = &v
			}
		}
		normalized = append(normalized, out)
	}
	return normalized, nil
}

// validateRequestFields mirrors validate_request_fields().
func validateRequestFields(name string, audience AudienceType, label *string, mode Mode, availability AvailabilityType, opensAt, closesAt *time.Time, members []MemberInput) error {
	if _, err := normalizeName(name); err != nil {
		return err
	}
	normalizedLabel, err := normalizeOptionalLabel(label)
	if err != nil {
		return err
	}
	if audience != AudienceAnyone && normalizedLabel == nil {
		return badRequest("An audience name is required for cohort and selected-student links.")
	}
	if audience == AudienceSelectedStudents {
		if mode != ModeStudentCode {
			return badRequest("Selected-student links must require a student code.")
		}
		if len(members) == 0 {
			return badRequest("Add at least one selected student.")
		}
	}
	if _, err := normalizeMembers(members); err != nil {
		return err
	}
	if availability == AvailabilityAnytime {
		return nil
	}
	if opensAt != nil && closesAt != nil {
		if closesAt.After(*opensAt) {
			return nil
		}
		return badRequest("Closing time must be after opening time.")
	}
	return badRequest("Scheduled Student Links need both an opening and closing time.")
}

// backingScheduleWindow mirrors backing_schedule_window().
func backingScheduleWindow(availability AvailabilityType, opensAt, closesAt *time.Time, now time.Time) (time.Time, time.Time, error) {
	if availability == AvailabilityAnytime {
		return now.Add(-time.Minute), now.AddDate(0, 0, AnytimeBackingHorizonDays), nil
	}
	if opensAt != nil && closesAt != nil && closesAt.After(*opensAt) {
		return *opensAt, *closesAt, nil
	}
	if opensAt != nil && closesAt != nil {
		return time.Time{}, time.Time{}, badRequest("Closing time must be after opening time.")
	}
	return time.Time{}, time.Time{}, badRequest("Scheduled Student Links need both an opening and closing time.")
}

func validateSelectedStudentIdentity(expectedName, expectedEmail sql.NullString, actualName, actualEmail string) error {
	if expectedName.Valid && !strings.EqualFold(strings.TrimSpace(expectedName.String), strings.TrimSpace(actualName)) {
		return unavailable("The entered student name does not match this Student Link.")
	}
	if expectedEmail.Valid && !strings.EqualFold(strings.TrimSpace(expectedEmail.String), strings.TrimSpace(actualEmail)) {
		return unavailable("The entered email does not match this Student Link.")
	}
	return nil
}

func nullableTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return *t
}

func nullableStr(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

func nullableOrg(org sql.NullString) any {
	if !org.Valid {
		return nil
	}
	return org.String
}

// examPin is the locked exam header plus the resolved published version.
type examPin struct {
	title       string
	providerKey string
	orgID       sql.NullString
	versionID   string
}

// pinExamVersionTx mirrors resolve_published_version_tx(): it locks the exam
// row (SELECT ... FOR UPDATE) and resolves the immutable published version
// the link must target. An explicit version id is honored; otherwise the
// exam current release is used (missing release is a validation error).
func pinExamVersionTx(ctx context.Context, q tx.Tx, examID string, requested *string) (examPin, error) {
	var pin examPin
	var current sql.NullString
	err := q.QueryRowContext(ctx,
		"SELECT title, provider_key, organization_id, current_published_version_id FROM exam_entities WHERE id = ? FOR UPDATE",
		examID).Scan(&pin.title, &pin.providerKey, &pin.orgID, &current)
	if err == sql.ErrNoRows {
		return pin, notFound("Exam not found.")
	}
	if err != nil {
		return pin, err
	}
	if requested != nil && strings.TrimSpace(*requested) != "" {
		pin.versionID = strings.TrimSpace(*requested)
	} else {
		if !current.Valid || strings.TrimSpace(current.String) == "" {
			return pin, badRequest("Publish the exam before creating Student Access.")
		}
		pin.versionID = current.String
	}
	var published sql.NullBool
	err = q.QueryRowContext(ctx,
		"SELECT is_published FROM exam_versions WHERE id = ? AND exam_id = ?",
		pin.versionID, examID).Scan(&published)
	if err == sql.ErrNoRows {
		return pin, notFound("Exam version not found.")
	}
	if err != nil {
		return pin, err
	}
	if !published.Valid || !published.Bool {
		return pin, badRequest("Student Access can only target an immutable published version.")
	}
	return pin, nil
}

// validateWindowForExistingScheduleTx mirrors
// validate_window_for_existing_schedule_tx(): the link window must fit the
// backing schedule planned duration.
func validateWindowForExistingScheduleTx(ctx context.Context, q tx.Tx, scheduleID string, start, end time.Time) (int, error) {
	var planned, rev int
	err := q.QueryRowContext(ctx,
		"SELECT planned_duration_minutes, revision FROM exam_schedules WHERE id = ? FOR UPDATE",
		scheduleID).Scan(&planned, &rev)
	if err == sql.ErrNoRows {
		return 0, notFound("Schedule not found.")
	}
	if err != nil {
		return 0, err
	}
	if !end.After(start) || end.Sub(start).Minutes() < float64(planned) {
		return 0, badRequest(fmt.Sprintf("Student Link availability must allow at least %d minutes for the exam.", planned))
	}
	return rev, nil
}

// linkLock mirrors LinkLockRow.
type linkLock struct {
	scheduleID string
	lifecycle  LifecycleState
	revision   int32
	// enabledSections is the stored scope (nil = all sections).
	enabledSections []string
	// hasParticipation reports whether any student joined or started the
	// backing schedule. It is read under the same FOR UPDATE lock as the
	// revision so the "sections may only change until the first student
	// participates" gate cannot race a concurrent registration.
	hasParticipation bool
}

// lockLinkTx mirrors lock_link_tx(): SELECT ... FOR UPDATE serializes link
// editors.
func lockLinkTx(ctx context.Context, q tx.Tx, linkID string) (linkLock, error) {
	var lock linkLock
	var lifecycle string
	var enabledSections sql.NullString
	var hasParticipation sql.NullInt64
	err := q.QueryRowContext(ctx,
		"SELECT schedule_id, lifecycle_state, revision, enabled_sections,"+
			" (EXISTS(SELECT 1 FROM schedule_registrations r WHERE r.schedule_id = assessment_access_links.schedule_id LIMIT 1)"+
			" OR EXISTS(SELECT 1 FROM student_attempts a WHERE a.schedule_id = assessment_access_links.schedule_id LIMIT 1)) AS has_participation"+
			" FROM assessment_access_links WHERE id = ? FOR UPDATE",
		linkID).Scan(&lock.scheduleID, &lifecycle, &lock.revision, &enabledSections, &hasParticipation)
	if err == sql.ErrNoRows {
		return lock, notFound("Access link was not found.")
	}
	if err != nil {
		return lock, err
	}
	state, err := ParseLifecycleState(lifecycle)
	if err != nil {
		return lock, err
	}
	lock.lifecycle = state
	lock.enabledSections = parseEnabledSections(enabledSections)
	lock.hasParticipation = hasParticipation.Valid && hasParticipation.Int64 != 0
	return lock, nil
}

func replaceMembersTx(ctx context.Context, q tx.Tx, linkID string, members []MemberInput) error {
	if _, err := q.ExecContext(ctx,
		"DELETE FROM assessment_access_link_members WHERE link_id = ?", linkID); err != nil {
		return err
	}
	for _, member := range members {
		if _, err := q.ExecContext(ctx,
			"INSERT INTO assessment_access_link_members (link_id, student_code, student_name, student_email) VALUES (?, ?, ?, ?)",
			linkID, member.StudentCode, nullableStr(member.StudentName), nullableStr(member.StudentEmail)); err != nil {
			return err
		}
	}
	return nil
}

func listMembersTx(ctx context.Context, q tx.Tx, linkID string) ([]MemberInput, error) {
	rows, err := q.QueryContext(ctx,
		"SELECT student_code, student_name, student_email FROM assessment_access_link_members WHERE link_id = ? ORDER BY student_code",
		linkID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MemberInput{}
	for rows.Next() {
		var m MemberInput
		var name, email sql.NullString
		if err := rows.Scan(&m.StudentCode, &name, &email); err != nil {
			return nil, err
		}
		if name.Valid {
			v := name.String
			m.StudentName = &v
		}
		if email.Valid {
			v := email.String
			m.StudentEmail = &v
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// insertBackingScheduleTx writes the exam_schedules row behind a link. The
// column shape follows internal/schedules Create.
func insertBackingScheduleTx(ctx context.Context, q tx.Tx, scheduleID, examID string, pin examPin, cohort string, start, end time.Time, createdBy string) error {
	planned := int(end.Sub(start).Minutes())
	if planned < 1 {
		planned = 1
	}
	_, err := q.ExecContext(ctx,
		"INSERT INTO exam_schedules (id, exam_id, provider_key, organization_id, exam_title, proctor_display_name, grading_display_name, published_version_id, cohort_name, institution, start_time, end_time, planned_duration_minutes, delivery_mode, recurrence_type, recurrence_interval, auto_start, auto_stop, status, created_at, created_by, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'proctor_start', 'none', 1, false, false, 'scheduled', NOW(), ?, NOW(), 0)",
		scheduleID, examID, pin.providerKey, nullableOrg(pin.orgID), pin.title, pin.title, pin.title, pin.versionID,
		cohort, start, end, planned, createdBy)
	return err
}

func insertLinkTx(ctx context.Context, q tx.Tx, linkID, examID, versionID, scheduleID, name string, enabledSections []string, audience AudienceType, label *string, mode Mode, availability AvailabilityType, opensAt, closesAt *time.Time, createdBy string) error {
	_, err := q.ExecContext(ctx,
		"INSERT INTO assessment_access_links (id, exam_id, published_version_id, schedule_id, name, enabled_sections, audience_type, audience_label, access_mode, availability_type, opens_at, closes_at, lifecycle_state, created_by, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0)",
		linkID, examID, versionID, scheduleID, name, enabledSectionsJSON(enabledSections), string(audience), nullableStr(label),
		string(mode), string(availability), nullableTime(opensAt), nullableTime(closesAt), createdBy)
	return err
}

// Overview mirrors overview(): the current published version (if any) plus
// every link for the exam.
func (s *Service) Overview(ctx context.Context, examID string) (Overview, error) {
	var out Overview
	row := s.db.QueryRowContext(ctx,
		"SELECT v.id, v.version_number, v.revision, v.publish_notes, v.created_at"+
			" FROM exam_entities e JOIN exam_versions v ON v.id = e.current_published_version_id"+
			" WHERE e.id = ? AND v.is_published = TRUE", examID)
	var current PublishedVersionSummary
	var notes sql.NullString
	if err := row.Scan(&current.ID, &current.VersionNumber, &current.Revision, &notes, &current.CreatedAt); err != nil {
		if err != sql.ErrNoRows {
			return Overview{}, err
		}
	} else {
		if notes.Valid {
			v := notes.String
			current.PublishNotes = &v
		}
		out.CurrentPublishedVersion = &current
	}
	links, err := s.ListForExam(ctx, examID)
	if err != nil {
		return Overview{}, err
	}
	out.Links = links
	return out, nil
}

// ListForExam mirrors list_for_exam(): links for one exam, newest first.
func (s *Service) ListForExam(ctx context.Context, examID string) ([]AccessLink, error) {
	rows, err := s.db.QueryContext(ctx,
		linkSelectSQL()+" WHERE l.exam_id = ? ORDER BY l.updated_at DESC, l.id", examID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AccessLink{}
	for rows.Next() {
		l, err := scanAccessLink(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// Get mirrors get(): one link by id or NotFound.
func (s *Service) Get(ctx context.Context, linkID string) (AccessLink, error) {
	l, err := scanAccessLink(s.db.QueryRowContext(ctx, linkSelectSQL()+" WHERE l.id = ?", linkID))
	if err == sql.ErrNoRows {
		return AccessLink{}, notFound("Access link was not found.")
	}
	return l, err
}

// PublicLink mirrors public_link(): the unauthenticated entry projection.
func (s *Service) PublicLink(ctx context.Context, linkID string) (PublicAccessLink, error) {
	link, err := s.Get(ctx, linkID)
	if err != nil {
		return PublicAccessLink{}, err
	}
	return PublicAccessLink{
		ID: link.ID, ExamTitle: link.ExamTitle, ProviderKey: link.ProviderKey,
		VersionNumber: link.VersionNumber, Name: link.Name, EnabledSections: link.EnabledSections,
		AudienceType:  link.AudienceType,
		AudienceLabel: link.AudienceLabel, AccessMode: link.AccessMode,
		AvailabilityType: link.AvailabilityType, OpensAt: link.OpensAt, ClosesAt: link.ClosesAt,
		Status: link.Status,
	}, nil
}

// Create mirrors create(): validates, resolves the published version, mints
// a backing schedule plus link row and roster atomically, then re-reads.
// createdBy is the actor id for the created_by column; role gating stays
// with the handlers.
func (s *Service) Create(ctx context.Context, examID, createdBy string, req CreateRequest) (AccessLink, error) {
	var zero AccessLink
	if strings.TrimSpace(examID) == "" {
		return zero, badRequest("Exam id is required.")
	}
	if strings.TrimSpace(createdBy) == "" {
		return zero, badRequest("Created-by actor is required.")
	}
	if err := validateRequestFields(req.Name, req.AudienceType, req.AudienceLabel, req.AccessMode, req.AvailabilityType, req.OpensAt, req.ClosesAt, req.SelectedStudents); err != nil {
		return zero, err
	}
	now := time.Now().UTC()
	start, end, err := backingScheduleWindow(req.AvailabilityType, req.OpensAt, req.ClosesAt, now)
	if err != nil {
		return zero, err
	}
	name, err := normalizeName(req.Name)
	if err != nil {
		return zero, err
	}
	label, err := normalizeOptionalLabel(req.AudienceLabel)
	if err != nil {
		return zero, err
	}
	members, err := normalizeMembers(req.SelectedStudents)
	if err != nil {
		return zero, err
	}
	enabledSections, err := NormalizeEnabledSections(req.EnabledSections)
	if err != nil {
		return zero, err
	}
	cohort := name
	if label != nil {
		cohort = *label
	}
	linkID := uuid.NewString()
	scheduleID := uuid.NewString()
	err = s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		pin, err := pinExamVersionTx(ctx, q, examID, req.PublishedVersionID)
		if err != nil {
			return err
		}
		if err := insertBackingScheduleTx(ctx, q, scheduleID, examID, pin, cohort, start, end, createdBy); err != nil {
			return err
		}
		if err := insertLinkTx(ctx, q, linkID, examID, pin.versionID, scheduleID, name, enabledSections, req.AudienceType, label, req.AccessMode, req.AvailabilityType, req.OpensAt, req.ClosesAt, createdBy); err != nil {
			return err
		}
		return replaceMembersTx(ctx, q, linkID, members)
	})
	if err != nil {
		return zero, err
	}
	return s.Get(ctx, linkID)
}

// Update mirrors update(): locks the link (FOR UPDATE), fences on revision,
// rejects edits to revoked links, revalidates, resizes the backing schedule
// window, and refreshes the roster per the Rust replace/clear rules.
func (s *Service) Update(ctx context.Context, linkID string, req UpdateRequest) (AccessLink, error) {
	var zero AccessLink
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		current, err := lockLinkTx(ctx, q, linkID)
		if err != nil {
			return err
		}
		if current.revision != req.Revision {
			return conflict("Student Link changed while you were editing it. Refresh and try again.")
		}
		if current.lifecycle == LifecycleRevoked {
			return conflict("Revoked Student Links are immutable. Duplicate it to create a new link.")
		}
		// Section scope may only change until the first student participates:
		// runtime sections freeze at proctor start, so a scope edit after a
		// student joined either does nothing to that run or — before the
		// proctor starts — silently changes the sitting a registered student
		// was told to expect. The participation read rode this same FOR
		// UPDATE lock, so a registration cannot slip in between.
		enabledSections := current.enabledSections
		if req.EnabledSections != nil {
			requested, err := NormalizeEnabledSections(*req.EnabledSections)
			if err != nil {
				return err
			}
			if !equalSections(requested, current.enabledSections) {
				if current.hasParticipation {
					return conflict("Sections cannot change after a student has joined this Student Link. Duplicate it to create a new link.")
				}
				enabledSections = requested
			}
		}
		var memberInputs []MemberInput
		if req.SelectedStudents == nil {
			memberInputs, err = listMembersTx(ctx, q, linkID)
			if err != nil {
				return err
			}
		} else {
			memberInputs = *req.SelectedStudents
		}
		if err := validateRequestFields(req.Name, req.AudienceType, req.AudienceLabel, req.AccessMode, req.AvailabilityType, req.OpensAt, req.ClosesAt, memberInputs); err != nil {
			return err
		}
		members, err := normalizeMembers(memberInputs)
		if err != nil {
			return err
		}
		name, err := normalizeName(req.Name)
		if err != nil {
			return err
		}
		label, err := normalizeOptionalLabel(req.AudienceLabel)
		if err != nil {
			return err
		}
		start, end, err := backingScheduleWindow(req.AvailabilityType, req.OpensAt, req.ClosesAt, time.Now().UTC())
		if err != nil {
			return err
		}
		scheduleRev, err := validateWindowForExistingScheduleTx(ctx, q, current.scheduleID, start, end)
		if err != nil {
			return err
		}
		cohort := name
		if label != nil {
			cohort = *label
		}
		// The validator above holds a FOR UPDATE lock on the backing schedule
		// row and returns its locked revision; fencing this resize on it gives
		// optimistic concurrency (AND revision = ?) without changing the
		// locked-write serialization.
		res, err := q.ExecContext(ctx,
			"UPDATE exam_schedules SET cohort_name = ?, start_time = ?, end_time = ?, updated_at = NOW(), revision = revision + 1 WHERE id = ? AND revision = ?",
			cohort, start, end, current.scheduleID, scheduleRev)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return conflict("Student Link changed while you were editing it.")
		}
		res2, err := q.ExecContext(ctx,
			"UPDATE assessment_access_links SET name = ?, enabled_sections = ?, audience_type = ?, audience_label = ?, access_mode = ?, availability_type = ?, opens_at = ?, closes_at = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND revision = ?",
			name, enabledSectionsJSON(enabledSections), string(req.AudienceType), nullableStr(label), string(req.AccessMode),
			string(req.AvailabilityType), nullableTime(req.OpensAt), nullableTime(req.ClosesAt),
			linkID, req.Revision)
		if err != nil {
			return err
		}
		if n, _ := res2.RowsAffected(); n != 1 {
			return conflict("Student Link changed while you were editing it.")
		}
		if req.SelectedStudents != nil || req.AudienceType == AudienceSelectedStudents {
			return replaceMembersTx(ctx, q, linkID, members)
		}
		return replaceMembersTx(ctx, q, linkID, nil)
	})
	if err != nil {
		return zero, err
	}
	return s.Get(ctx, linkID)
}

// SetLifecycle mirrors set_lifecycle(): revision-fenced lifecycle moves;
// revoked links stay revoked.
func (s *Service) SetLifecycle(ctx context.Context, linkID string, req SetLifecycleRequest) (AccessLink, error) {
	var zero AccessLink
	if _, err := ParseLifecycleState(string(req.State)); err != nil {
		return zero, err
	}
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		current, err := lockLinkTx(ctx, q, linkID)
		if err != nil {
			return err
		}
		if current.revision != req.Revision {
			return conflict("Student Link changed while you were editing it. Refresh and try again.")
		}
		if current.lifecycle == LifecycleRevoked && req.State != LifecycleRevoked {
			return conflict("A revoked Student Link cannot be reactivated.")
		}
		res, err := q.ExecContext(ctx,
			"UPDATE assessment_access_links SET lifecycle_state = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND revision = ?",
			string(req.State), linkID, req.Revision)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return conflict("Student Link changed while you were editing it.")
		}
		return nil
	})
	if err != nil {
		return zero, err
	}
	return s.Get(ctx, linkID)
}

// Duplicate mirrors duplicate(): locks the source (FOR UPDATE), fences on
// revision, revalidates under the effective name/window, resolves the
// release target (source pin vs current), and mints a fresh schedule, link,
// and roster copy.
func (s *Service) Duplicate(ctx context.Context, linkID, createdBy string, req DuplicateRequest) (AccessLink, error) {
	var zero AccessLink
	if strings.TrimSpace(createdBy) == "" {
		return zero, badRequest("Created-by actor is required.")
	}
	target, err := ParseDuplicateReleaseTarget(string(req.ReleaseTarget))
	if err != nil {
		return zero, err
	}
	newLinkID := uuid.NewString()
	newScheduleID := uuid.NewString()
	err = s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		var source struct {
			examID          string
			versionID       string
			name            string
			enabledSections sql.NullString
			audience        string
			label           sql.NullString
			mode            string
			availability    string
			opensAt         sql.NullTime
			closesAt        sql.NullTime
			revision        int32
		}
		err := q.QueryRowContext(ctx,
			"SELECT exam_id, published_version_id, name, enabled_sections, audience_type, audience_label, access_mode, availability_type, opens_at, closes_at, revision FROM assessment_access_links WHERE id = ? FOR UPDATE",
			linkID).Scan(&source.examID, &source.versionID, &source.name, &source.enabledSections, &source.audience,
			&source.label, &source.mode, &source.availability, &source.opensAt, &source.closesAt, &source.revision)
		if err == sql.ErrNoRows {
			return notFound("Access link was not found.")
		}
		if err != nil {
			return err
		}
		if source.revision != req.Revision {
			return conflict("Student Link changed before it could be duplicated. Refresh and try again.")
		}
		audienceType, err := ParseAudienceType(source.audience)
		if err != nil {
			return err
		}
		accessMode, err := ParseMode(source.mode)
		if err != nil {
			return err
		}
		sourceAvailability, err := ParseAvailabilityType(source.availability)
		if err != nil {
			return err
		}
		availability := sourceAvailability
		if req.AvailabilityType != nil {
			if _, err := ParseAvailabilityType(string(*req.AvailabilityType)); err != nil {
				return err
			}
			availability = *req.AvailabilityType
		}
		name := source.name + " Copy"
		if req.Name != nil {
			name = *req.Name
		}
		var sourceLabel *string
		if source.label.Valid {
			v := source.label.String
			sourceLabel = &v
		}
		var opensAt, closesAt *time.Time
		if availability == AvailabilityScheduled {
			if source.opensAt.Valid {
				v := source.opensAt.Time
				opensAt = &v
			}
			if source.closesAt.Valid {
				v := source.closesAt.Time
				closesAt = &v
			}
			if req.OpensAt != nil {
				opensAt = req.OpensAt
			}
			if req.ClosesAt != nil {
				closesAt = req.ClosesAt
			}
		}
		members, err := listMembersTx(ctx, q, linkID)
		if err != nil {
			return err
		}
		if err := validateRequestFields(name, audienceType, sourceLabel, accessMode, availability, opensAt, closesAt, members); err != nil {
			return err
		}
		normalizedName, err := normalizeName(name)
		if err != nil {
			return err
		}
		label, err := normalizeOptionalLabel(sourceLabel)
		if err != nil {
			return err
		}
		normalizedMembers, err := normalizeMembers(members)
		if err != nil {
			return err
		}
		start, end, err := backingScheduleWindow(availability, opensAt, closesAt, time.Now().UTC())
		if err != nil {
			return err
		}
		var requested *string
		if target == ReleaseTargetSource {
			requested = &source.versionID
		}
		pin, err := pinExamVersionTx(ctx, q, source.examID, requested)
		if err != nil {
			return err
		}
		cohort := normalizedName
		if label != nil {
			cohort = *label
		}
		if err := insertBackingScheduleTx(ctx, q, newScheduleID, source.examID, pin, cohort, start, end, createdBy); err != nil {
			return err
		}
		if err := insertLinkTx(ctx, q, newLinkID, source.examID, pin.versionID, newScheduleID, normalizedName, parseEnabledSections(source.enabledSections), audienceType, label, accessMode, availability, opensAt, closesAt, createdBy); err != nil {
			return err
		}
		return replaceMembersTx(ctx, q, newLinkID, normalizedMembers)
	})
	if err != nil {
		return zero, err
	}
	return s.Get(ctx, newLinkID)
}

// ListMembers mirrors list_members(): locks the link (proving it exists)
// then returns the roster ordered by code.
func (s *Service) ListMembers(ctx context.Context, linkID string) ([]Member, error) {
	var out []Member
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if _, err := lockLinkTx(ctx, q, linkID); err != nil {
			return err
		}
		inputs, err := listMembersTx(ctx, q, linkID)
		if err != nil {
			return err
		}
		out = make([]Member, 0, len(inputs))
		for _, in := range inputs {
			out = append(out, Member(in))
		}
		return nil
	})
	return out, err
}

// Activity mirrors activity(): the latest 50 join/start/submit events for
// the backing schedule, newest first.
func (s *Service) Activity(ctx context.Context, linkID string) ([]Activity, error) {
	link, err := s.Get(ctx, linkID)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx,
		"SELECT kind, student_name, occurred_at FROM ("+
			"SELECT 'joined' AS kind, student_name, created_at AS occurred_at FROM schedule_registrations WHERE schedule_id = ?"+
			" UNION ALL "+
			"SELECT 'started' AS kind, candidate_name AS student_name, created_at AS occurred_at FROM student_attempts WHERE schedule_id = ?"+
			" UNION ALL "+
			"SELECT 'submitted' AS kind, candidate_name AS student_name, submitted_at AS occurred_at FROM student_attempts WHERE schedule_id = ? AND submitted_at IS NOT NULL"+
			") activity ORDER BY occurred_at DESC LIMIT 50",
		link.ScheduleID, link.ScheduleID, link.ScheduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Activity{}
	for rows.Next() {
		var a Activity
		if err := rows.Scan(&a.Kind, &a.StudentName, &a.OccurredAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ResolveEntry mirrors resolve_entry(): it re-reads the link row, its roster
// entry (for selected-student links), and the backing schedule window inside
// one transaction, then gates on lifecycle, roster/identity, and window. Empty
// studentCode means "not provided". The existence precheck above keeps the
// NOT_FOUND shape; every gate below re-reads locked rows so lifecycle,
// roster/identity, and window cannot race. Wire this behind a public
// POST /public/access-links/{linkID}/resolve-entry handler (see summary);
// main.go currently routes only publicLinkGet.
func (s *Service) ResolveEntry(ctx context.Context, linkID, studentCode, studentName, studentEmail string) (ResolvedEntry, error) {
	var zero ResolvedEntry
	if _, err := s.Get(ctx, linkID); err != nil {
		return zero, err
	}
	var gated ResolvedEntry
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		// Locked link + schedule read: the window/lifecycle gate observes the
		// latest committed state, not the unlocked Get above.
		var lifecycle, availability string
		var opensAt, closesAt sql.NullTime
		var enabledSections sql.NullString
		var scheduleID, providerKey, accessMode, audienceType string
		if err := q.QueryRowContext(ctx, "SELECT l.schedule_id, e.provider_key, l.access_mode, l.audience_type, l.lifecycle_state, l.availability_type, l.opens_at, l.closes_at, l.enabled_sections FROM assessment_access_links l JOIN exam_entities e ON e.id = l.exam_id WHERE l.id = ? FOR UPDATE", linkID).Scan(&scheduleID, &providerKey, &accessMode, &audienceType, &lifecycle, &availability, &opensAt, &closesAt, &enabledSections); err != nil {
			if err == sql.ErrNoRows {
				return notFound("Access link was not found.")
			}
			return err
		}
		state, err := ParseLifecycleState(lifecycle)
		if err != nil {
			return err
		}
		audience, err := ParseAudienceType(audienceType)
		if err != nil {
			return err
		}
		mode, err := ParseMode(accessMode)
		if err != nil {
			return err
		}
		avail, err := ParseAvailabilityType(availability)
		if err != nil {
			return err
		}
		var o, c *time.Time
		if opensAt.Valid {
			v := opensAt.Time
			o = &v
		}
		if closesAt.Valid {
			v := closesAt.Time
			c = &v
		}
		switch deriveStatus(state, avail, o, c, time.Now().UTC()) {
		case StatusLive:
		case StatusUpcoming:
			return unavailable("This Student Link is not open yet.")
		case StatusEnded:
			return unavailable("This Student Link has ended.")
		case StatusPaused:
			return unavailable("This Student Link is paused.")
		case StatusRevoked:
			return unavailable("This Student Link has been revoked.")
		}
		var start, end time.Time
		if err := q.QueryRowContext(ctx, "SELECT start_time, end_time FROM exam_schedules WHERE id = ? FOR UPDATE", scheduleID).Scan(&start, &end); err != nil {
			if err == sql.ErrNoRows {
				return notFound("Schedule not found.")
			}
			return err
		}
		now := time.Now().UTC()
		if now.Before(start) {
			return unavailable("This Student Link is not open yet.")
		}
		if !now.Before(end) {
			return unavailable("This Student Link has ended.")
		}
		if audience == AudienceSelectedStudents {
			code := NormalizeAccessCode(studentCode)
			if code == "" {
				return unavailable("A student code is required for this Student Link.")
			}
			var expectedName, expectedEmail sql.NullString
			if err := q.QueryRowContext(ctx, "SELECT student_name, student_email FROM assessment_access_link_members WHERE link_id = ? AND student_code = ? LIMIT 1", linkID, code).Scan(&expectedName, &expectedEmail); err != nil {
				if err == sql.ErrNoRows {
					return unavailable("This student code is not included in this Student Link.")
				}
				return err
			}
			if err := validateSelectedStudentIdentity(expectedName, expectedEmail, studentName, studentEmail); err != nil {
				return err
			}
		}
		gated = ResolvedEntry{ScheduleID: scheduleID, ProviderKey: providerKey, AccessMode: mode, AudienceType: audience, EnabledSections: parseEnabledSections(enabledSections)}
		return nil
	})
	if err != nil {
		return zero, err
	}
	return gated, nil
}
