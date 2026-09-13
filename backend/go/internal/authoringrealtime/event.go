// Package authoringrealtime owns the SAT authoring realtime DOMAIN contract
// (Phase 01): the versioned AuthoringEventV1 envelope, kind vocabulary,
// validation, and ordering helpers. It holds no transport, socket, or DB
// code: persistence (Phase 02, emit.go) and subscription/replay (Phase 03)
// build on top of these types. The generic bus stays in liveupdates.
//
// Boundary rules (four distinct concepts — never collapse them):
//
//	sequence_id    -> transportation ordering (added by the bus, never in the
//	                  domain payload)
//	DraftRevision  -> working-copy generation of the exam draft (a hint; NOT
//	                  monotonic across Undo, so never order events by it)
//	Revision       -> fencing revision of the affected entity, when applicable
//	EventID        -> logical event identity
//	CausationID    -> operation/idempotency correlation
//
// Validation split (forward compatibility):
//
//	ValidateEnvelope  = structural; readers/replay use it; unknown future
//	                    kinds PASS so old clients tolerate new vocabulary.
//	ValidateForEmit   = envelope + producer rules (must be current known
//	                    kind); servers use it before persisting a row.
//
// Privacy: events may carry an opaque internal actor id. Events must NEVER
// carry displayName, email, phone, question content, or student data.
package authoringrealtime

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Version is the only envelope version Phase 01 defines.
const Version = 1

// Kind is a realtime domain event name.
type Kind string

// Kind vocabulary (question part only). Frozen: additions need a
// version-compat review; readers must tolerate unknown kinds.
const (
	KindQuestionChanged     Kind = "question.changed"
	KindQuestionCreated     Kind = "question.created"
	KindQuestionDeleted     Kind = "question.deleted"
	KindQuestionMoved       Kind = "question.moved"
	KindQuestionDuplicated  Kind = "question.duplicated"
	KindQuestionBulkChanged Kind = "question.bulk_changed"
	KindExamChanged         Kind = "exam.changed"
	KindDraftOpened         Kind = "draft.opened"
	KindDraftReplaced       Kind = "draft.replaced"
	KindExamPublished       Kind = "exam.published"
)

// KnownKinds is the frozen vocabulary set.
var KnownKinds = map[Kind]struct{}{
	KindQuestionChanged: {}, KindQuestionCreated: {}, KindQuestionDeleted: {},
	KindQuestionMoved: {}, KindQuestionDuplicated: {}, KindQuestionBulkChanged: {},
	KindExamChanged: {}, KindDraftOpened: {}, KindDraftReplaced: {}, KindExamPublished: {},
}

// IsKnownKind reports vocabulary membership (unknown future kinds tolerated).
func IsKnownKind(k Kind) bool { _, ok := KnownKinds[k]; return ok }

// EntityKind discriminates Entity.
type EntityKind string

const (
	EntityQuestion EntityKind = "question"
	EntityModule   EntityKind = "module"
	EntityExam     EntityKind = "exam"
	EntityDraft    EntityKind = "draft"
)

// Entity is the identity union. Nullable question members are pointers
// WITHOUT omitempty so a tombstone serializes questionId/moduleId as JSON
// null (never absent), matching the TypeScript wire contract exactly.
type Entity struct {
	Kind           EntityKind `json:"kind"`
	ExamQuestionID string     `json:"examQuestionId,omitempty"`
	QuestionID     *string    `json:"questionId"`
	ModuleID       *string    `json:"moduleId"`
	ExamID         string     `json:"examId,omitempty"`
	DraftVersionID string     `json:"draftVersionId,omitempty"`
}

// Scope binds tenant + exam + draft. Always server-resolved.
//
// OrganizationID is a POINTER on purpose: null means platform scope
// (exam_entities.organization_id IS NULL). An empty string is never used to
// mean platform scope — that would make a missing field, a failed query, and
// a deliberate platform exam indistinguishable.
//
// Security invariant (enforced Phase 03): a correctly authorized server
// never delivers an event whose scope differs from the subscription. A
// mismatched delivery must drop the frame, close the subscription, record
// security telemetry, and require a clean resubscribe — never render it.
type Scope struct {
	OrganizationID *string `json:"organizationId"`
	ExamID         string  `json:"examId"`
	DraftVersionID string  `json:"draftVersionId"`
}

// Actor is informational (server-derived from session + DB).
type Actor struct {
	ID   string `json:"id"`
	Kind string `json:"kind"` // always "staff"
}

// ChangedField is a changed-field NAME (never a value). The producer-side
// constructor (NewChangedFields) accepts only known vocabulary names, so a
// buggy producer cannot smuggle content into the hint list. The decoder
// stays tolerant: unknown future names pass validation and readers ignore
// them (forward compat).
type ChangedField string

const (
	FieldPrompt           ChangedField = "prompt"
	FieldStimulus         ChangedField = "stimulus"
	FieldAnswer           ChangedField = "answer"
	FieldRationale        ChangedField = "rationale"
	FieldMetadataDomain   ChangedField = "metadata.domain"
	FieldMetadataSkill    ChangedField = "metadata.skill"
	FieldMetadataDiff     ChangedField = "metadata.difficulty"
	FieldMetadataTags     ChangedField = "metadata.tags"
	FieldAccessibility    ChangedField = "accessibility"
	FieldDisplayOrder     ChangedField = "displayOrder"
	FieldModuleID         ChangedField = "moduleId"
	FieldIsPretest        ChangedField = "isPretest"
	FieldQuestionType     ChangedField = "questionType"
	FieldReadiness        ChangedField = "readiness"
	FieldDeliverySettings ChangedField = "deliverySettings"
	FieldDraftRevision    ChangedField = "draftRevision"
)

// KnownChangedFields is the producer allow-list (names only).
var KnownChangedFields = map[string]struct{}{
	"prompt": {}, "stimulus": {}, "answer": {}, "rationale": {},
	"metadata.domain": {}, "metadata.skill": {}, "metadata.difficulty": {},
	"metadata.tags": {}, "accessibility": {}, "displayOrder": {},
	"moduleId": {}, "isPretest": {}, "questionType": {}, "readiness": {},
	"deliverySettings": {}, "draftRevision": {},
}

// NewChangedFields builds the producer-side hint list: unknown names are
// dropped (never content — names only), output capped at MaxChangedFields.
func NewChangedFields(names ...string) []string {
	out := make([]string, 0, len(names))
	for _, n := range names {
		if _, ok := KnownChangedFields[n]; !ok {
			continue
		}
		out = append(out, n)
		if len(out) >= MaxChangedFields {
			break
		}
	}
	return out
}

// Event is AuthoringEventV1 (domain only — NO transport cursor). No content
// payloads: prompt/answer/rationale/stimulus VALUES must never be added
// here (changedFields carries names only, via NewChangedFields).
type Event struct {
	Version    int       `json:"version"`
	Kind       Kind      `json:"kind"`
	EventID    string    `json:"eventId"`
	OccurredAt time.Time `json:"occurredAt"`
	Actor      Actor     `json:"actor"`
	Scope      Scope     `json:"scope"`
	Entity     Entity    `json:"entity"`

	// Revision is the fencing revision of the affected entity when
	// applicable (e.g. the question revision after a save); 0 otherwise.
	Revision int `json:"revision"`
	// DraftRevision is the working-draft generation (exam_versions.revision
	// after the in-tx bump). It is a STATE HINT, not an ordering key: Undo
	// restores an older checkpoint and can move it backwards.
	DraftRevision int `json:"draftRevision"`

	ChangedFields           []string `json:"changedFields"`
	AffectedExamQuestionIDs []string `json:"affectedExamQuestionIds,omitempty"`
	CausationID             string   `json:"causationId,omitempty"`
}

// Frame is the TRANSPORT frame: domain event plus the opaque bus cursor.
// The cursor is added at frame-construction time from
// live_update_events.sequence_id — never persisted inside Event.
type Frame struct {
	Type   string `json:"type"` // always "authoring.event"
	Cursor int64  `json:"cursor"`
	Event  Event  `json:"event"`
}

// Capabilities is the server-negotiated posture delivered after a
// successful subscription (authoring.capabilities). The frontend kill
// switch can only disable a granted capability, never enable one withheld.
type Capabilities struct {
	Delivery        bool `json:"delivery"`
	Presence        bool `json:"presence"`
	ConflictCompare bool `json:"conflictCompare"`
}

// MaxAffectedIDs bounds coarse events (bulk/move) — ids only, never content.
const MaxAffectedIDs = 200

// MaxChangedFields bounds the hint list.
const MaxChangedFields = 64

// Parse decodes one domain envelope for a READER: unknown kinds are NOT
// errors (forward compat) and unknown top-level fields are ignored (additive
// v1 evolution). Malformed shapes are errors. Use Classify for version
// negotiation.
func Parse(raw []byte) (Event, error) {
	var e Event
	if err := json.Unmarshal(raw, &e); err != nil {
		return Event{}, fmt.Errorf("authoringrealtime: decode envelope: %w", err)
	}
	if err := e.ValidateEnvelope(); err != nil {
		return Event{}, err
	}
	return e, nil
}

// Classification is the version/kind negotiation result. A v1 reader must
// never execute v2 semantics: any version != 1 is UnsupportedVersion and
// resolves to an authoritative refetch, even for familiar kind names.
type Classification struct {
	Status  string // "known", "unknown-kind", "unsupported-version"
	Event   Event
	RawKind Kind
	Version int
}

// Classify negotiates version + kind without interpreting semantics.
func Classify(raw []byte) (Classification, error) {
	var probe struct {
		Version int    `json:"version"`
		Kind    Kind   `json:"kind"`
		EventID string `json:"eventId"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		return Classification{}, fmt.Errorf("authoringrealtime: decode envelope: %w", err)
	}
	if probe.Version != Version {
		return Classification{Status: "unsupported-version", Version: probe.Version}, nil
	}
	e, err := Parse(raw)
	if err != nil {
		return Classification{}, err
	}
	if !IsKnownKind(e.Kind) {
		return Classification{Status: "unknown-kind", Event: e, RawKind: e.Kind, Version: e.Version}, nil
	}
	return Classification{Status: "known", Event: e, Version: e.Version}, nil
}

// ValidateEnvelope enforces STRUCTURAL invariants only (reader path).
// Unknown Kind and unknown changed-field names pass so older readers keep
// working when the vocabulary grows.
func (e Event) ValidateEnvelope() error {
	if e.Version != Version {
		return fmt.Errorf("authoringrealtime: unsupported version %d", e.Version)
	}
	if strings.TrimSpace(string(e.Kind)) == "" {
		return fmt.Errorf("authoringrealtime: kind is required")
	}
	if strings.TrimSpace(e.EventID) == "" {
		return fmt.Errorf("authoringrealtime: eventId is required")
	}
	if e.OccurredAt.IsZero() {
		return fmt.Errorf("authoringrealtime: occurredAt is required")
	}
	if strings.TrimSpace(e.Actor.ID) == "" || e.Actor.Kind != "staff" {
		return fmt.Errorf("authoringrealtime: actor must be server-resolved staff")
	}
	// OrganizationID may be nil (platform scope); examId and draftVersionId
	// are always required.
	if strings.TrimSpace(e.Scope.ExamID) == "" ||
		strings.TrimSpace(e.Scope.DraftVersionID) == "" {
		return fmt.Errorf("authoringrealtime: scope examId/draftVersionId required")
	}
	if err := e.Entity.Validate(); err != nil {
		return err
	}
	if e.Revision < 0 {
		return fmt.Errorf("authoringrealtime: revision must be >= 0")
	}
	if e.DraftRevision < 0 {
		return fmt.Errorf("authoringrealtime: draftRevision must be >= 0")
	}
	if len(e.ChangedFields) > MaxChangedFields {
		return fmt.Errorf("authoringrealtime: changedFields exceeds %d", MaxChangedFields)
	}
	if len(e.AffectedExamQuestionIDs) > MaxAffectedIDs {
		return fmt.Errorf("authoringrealtime: affectedExamQuestionIds exceeds %d", MaxAffectedIDs)
	}
	return nil
}

// ValidateForEmit is the PRODUCER rule set: envelope validity plus current
// known kind. Servers call this before persisting; readers must not.
func (e Event) ValidateForEmit() error {
	if err := e.ValidateEnvelope(); err != nil {
		return err
	}
	if !IsKnownKind(e.Kind) {
		return fmt.Errorf("authoringrealtime: unknown kind %q cannot be emitted", string(e.Kind))
	}
	return nil
}

// Validate enforces per-entity identity invariants.
func (en Entity) Validate() error {
	switch en.Kind {
	case EntityQuestion:
		if strings.TrimSpace(en.ExamQuestionID) == "" {
			return fmt.Errorf("authoringrealtime: question entity requires examQuestionId")
		}
	case EntityModule:
		if en.ModuleID == nil || strings.TrimSpace(*en.ModuleID) == "" {
			return fmt.Errorf("authoringrealtime: module entity requires moduleId")
		}
	case EntityExam:
		if strings.TrimSpace(en.ExamID) == "" {
			return fmt.Errorf("authoringrealtime: exam entity requires examId")
		}
	case EntityDraft:
		if strings.TrimSpace(en.ExamID) == "" || strings.TrimSpace(en.DraftVersionID) == "" {
			return fmt.Errorf("authoringrealtime: draft entity requires examId+draftVersionId")
		}
	default:
		return fmt.Errorf("authoringrealtime: unknown entity kind %q", string(en.Kind))
	}
	return nil
}

// ShouldProcessCursor admits any cursor strictly newer than the last
// processed one. 381 -> 384 is valid: skipped values belong to other
// exams, kinds, or origins. Loss is signaled explicitly by the protocol
// (snapshot_required / expiry / overflow / replay failure), never inferred
// from arithmetic.
func ShouldProcessCursor(lastProcessed, next int64) bool { return next > lastProcessed }

// CompareByCursor orders by transport cursor; ties break on EventID (stable).
func CompareByCursor(aCursor, bCursor int64, aID, bID string) int {
	if aCursor != bCursor {
		if aCursor < bCursor {
			return -1
		}
		return 1
	}
	return strings.Compare(aID, bID)
}

// SortFramesByCursor sorts frames in place (ascending cursor).
func SortFramesByCursor(in []Frame) {
	sort.Slice(in, func(i, j int) bool {
		if in[i].Cursor != in[j].Cursor {
			return in[i].Cursor < in[j].Cursor
		}
		return in[i].Event.EventID < in[j].Event.EventID
	})
}
