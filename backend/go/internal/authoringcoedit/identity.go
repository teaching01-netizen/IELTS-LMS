// Package authoringcoedit owns the protocol-level vocabulary of SAT prompt
// co-editing: opaque document identity, the lifecycle/close-reason closed
// vocabularies, short-lived browser tokens, private service signatures, and
// the size limits the design pins ("Capacity", docs/sat-authoring-coedit.md).
//
// It deliberately holds no database code and does not import the authoring
// package. The atomic prompt/revision/event write lives in
// internal/authoring (which already owns assessment_question_revisions and the
// durable authoring event). This package is what both the Go HTTP layer and
// the Hocuspocus service contract against.
package authoringcoedit

import (
	"errors"
	"fmt"
	"strings"
)

// SchemaVersion is the on-wire document schema version. It participates in the
// unique logical document key, so a schema change gets NEW documents rather
// than reinterpreting stored binary state.
const SchemaVersion = 1

// WorkspaceSchemaVersion is the exam-level room used by the SAT authoring
// builder, delivery, and Student Access surfaces. The prompt room above is
// intentionally left at v1 so existing clients can migrate without having to
// reinterpret a persisted Y.Doc.
const WorkspaceSchemaVersion = 2

// FieldSetPrompt is the first (and for this slice, only) collaborative field
// set. Expansion adds explicitly versioned field names; UI components never
// invent fragments dynamically.
const FieldSetPrompt = "prompt"
const FieldSetWorkspace = "workspace"

// DocumentNamePrefix is the opaque room name prefix. The browser never builds
// this from raw identifiers: Go returns the fully-formed name from a token
// response, and Hocuspocus re-derives it from the signed claims.
const DocumentNamePrefix = "coedit:v1:"
const WorkspaceDocumentNamePrefix = "coedit:v2:"

// Size limits. Exceeding a limit rejects the change and preserves the last
// committed state; it never truncates.
const (
	// MaxYdocStateBytes caps the persisted Y.encodeStateAsUpdate output (4 MiB).
	MaxYdocStateBytes = 4 << 20
	// MaxPromptJSONBytes caps the materialized prompt JSON (1 MiB).
	MaxPromptJSONBytes = 1 << 20
	// MaxFrameBytes caps a single WebSocket message (2 MiB).
	MaxFrameBytes = 2 << 20
	// MaxStateVectorBytes matches the widened VARBINARY(8192) column (0063).
	//
	// The vector is a per-writer client-id ledger, so it grows with sessions
	// rather than with content and is the one state field that gets worse on a
	// room that is merely long-lived. 8192 is headroom: the Hocuspocus service
	// compacts a document once its vector passes 2 KiB, so a room should never
	// reach this limit without first failing to compact.
	MaxStateVectorBytes = 8192
	// MaxSeedPromptBytes bounds what the load endpoint will hand to Hocuspocus
	// for seeding; anything bigger can never round-trip under the cap above.
	MaxSeedPromptBytes = MaxPromptJSONBytes
	// MaxWorkspaceJSONBytes caps the recovery projection stored alongside the
	// exam-level Y.Doc. Rich fields remain in the Y.Doc binary; this projection
	// is deliberately bounded so a malformed client cannot turn the room into
	// an unbounded JSON log.
	MaxWorkspaceJSONBytes = 4 << 20
)

// TokenLifetime is the token TTL (five minutes). The provider refreshes before
// expiry; Hocuspocus requests a refresh every 60 seconds and closes a
// connection whose refresh is missing, expired, or changes identity.
const TokenLifetimeSeconds = 300

// ServiceSignatureWindowSeconds is the accepted clock skew for private
// Go <-> Hocuspocus calls. Anything outside it is rejected.
const ServiceSignatureWindowSeconds = 30

// FreezeLeaseSeconds is how long a freeze token remains valid before the
// rooms automatically unfreeze.
const FreezeLeaseSeconds = 30

// AuthMode is the token's authority level.
type AuthMode string

const (
	ModeWrite AuthMode = "write"
	ModeRead  AuthMode = "read"
)

// Valid reports whether the mode is in the closed vocabulary.
func (m AuthMode) Valid() bool { return m == ModeWrite || m == ModeRead }

// LifecycleState is the document row's lifecycle. Allowed transitions are
// enforced here (the state machine) and persisted by the authoring service.
//
//	initializing -> active -> freezing -> frozen -> closed
//	                          \-> active when an operation aborts
type LifecycleState string

const (
	StateInitializing LifecycleState = "initializing"
	StateActive       LifecycleState = "active"
	StateFreezing     LifecycleState = "freezing"
	StateFrozen       LifecycleState = "frozen"
	StateClosed       LifecycleState = "closed"
)

// ErrInvalidLifecycleOperation is returned by lifecycle boundaries when a
// caller attempts to fence or release a room without an operation owner.
// Keeping this error in the protocol package prevents callers from silently
// falling back to the old unscoped reopen behavior.
var ErrInvalidLifecycleOperation = errors.New("invalid co-edit lifecycle operation")

// ErrLifecycleOperationConflict identifies a room already owned by another
// lifecycle operation. The database service wraps it in CodeFreezeConflict
// when it can provide the stable application error vocabulary.
var ErrLifecycleOperationConflict = errors.New("co-edit lifecycle operation conflict")

// ParseLifecycleState accepts only the closed vocabulary.
func ParseLifecycleState(raw string) (LifecycleState, error) {
	switch LifecycleState(strings.TrimSpace(raw)) {
	case StateInitializing:
		return StateInitializing, nil
	case StateActive:
		return StateActive, nil
	case StateFreezing:
		return StateFreezing, nil
	case StateFrozen:
		return StateFrozen, nil
	case StateClosed:
		return StateClosed, nil
	default:
		return "", fmt.Errorf("unknown co-edit lifecycle state %q", raw)
	}
}

// CanTransition reports whether from -> to is an allowed edge of the state
// machine. Self-transitions are allowed (idempotent re-assertions).
func CanTransition(from, to LifecycleState) bool {
	if from == to {
		return true
	}
	switch from {
	case StateInitializing:
		// A room may be fenced before its first seed wins. It still cannot be
		// initialized while fenced; the persistence boundary applies that
		// operation-specific rule before using this generic transition check.
		return to == StateActive || to == StateFreezing || to == StateClosed
	case StateActive:
		return to == StateFreezing || to == StateClosed
	case StateFreezing:
		// A freeze either commits (frozen), aborts (active), or is closed
		// outright by a destructive lifecycle mutation.
		return to == StateFrozen || to == StateActive || to == StateClosed
	case StateFrozen:
		return to == StateActive || to == StateClosed
	case StateClosed:
		return false
	default:
		return false
	}
}

// AcceptingEdits reports whether a state may accept new collaborative edits.
func (s LifecycleState) AcceptingEdits() bool { return s == StateActive }

// CloseReason is the closed set of reasons a room closes.
type CloseReason string

const (
	CloseQuestionDeleted  CloseReason = "question_deleted"
	CloseDraftReplaced    CloseReason = "draft_replaced"
	CloseExamPublished    CloseReason = "exam_published"
	CloseWorkbookReplaced CloseReason = "workbook_replaced"
	CloseFeatureDisabled  CloseReason = "feature_disabled"
)

// AllCloseReasons is the frozen vocabulary.
var AllCloseReasons = []CloseReason{
	CloseQuestionDeleted, CloseDraftReplaced, CloseExamPublished,
	CloseWorkbookReplaced, CloseFeatureDisabled,
}

// Valid reports whether the reason is in the closed vocabulary.
func (r CloseReason) Valid() bool {
	for _, candidate := range AllCloseReasons {
		if candidate == r {
			return true
		}
	}
	return false
}

// DocumentName is the opaque room name. It is always "coedit:v1:<uuid>".
type DocumentName string

// ErrInvalidDocumentName is returned for a name outside the frozen shape.
var ErrInvalidDocumentName = errors.New("invalid co-edit document name")

// NewDocumentName builds a name from a bare uuid.
func NewDocumentName(id string) (DocumentName, error) {
	id = strings.TrimSpace(id)
	if id == "" || strings.ContainsAny(id, ":/ \t\n") {
		return "", ErrInvalidDocumentName
	}
	return DocumentName(DocumentNamePrefix + id), nil
}

// ParseDocumentName validates the frozen prefix and returns the bare uuid.
func ParseDocumentName(raw string) (DocumentName, string, error) {
	name := strings.TrimSpace(raw)
	if !strings.HasPrefix(name, DocumentNamePrefix) {
		return "", "", ErrInvalidDocumentName
	}
	id := strings.TrimPrefix(name, DocumentNamePrefix)
	if id == "" || strings.ContainsAny(id, ":/ \t\n") {
		return "", "", ErrInvalidDocumentName
	}
	return DocumentName(name), id, nil
}

// NewWorkspaceDocumentName builds the opaque exam-level room name.
func NewWorkspaceDocumentName(id string) (DocumentName, error) {
	id = strings.TrimSpace(id)
	if id == "" || strings.ContainsAny(id, ":/ \t\n") {
		return "", ErrInvalidDocumentName
	}
	return DocumentName(WorkspaceDocumentNamePrefix + id), nil
}

// ParseWorkspaceDocumentName validates an exam-level room name without
// changing the v1 prompt parser (older callers rely on that strictness).
func ParseWorkspaceDocumentName(raw string) (DocumentName, string, error) {
	name := strings.TrimSpace(raw)
	if !strings.HasPrefix(name, WorkspaceDocumentNamePrefix) {
		return "", "", ErrInvalidDocumentName
	}
	id := strings.TrimPrefix(name, WorkspaceDocumentNamePrefix)
	if id == "" || strings.ContainsAny(id, ":/ \t\n") {
		return "", "", ErrInvalidDocumentName
	}
	return DocumentName(name), id, nil
}

// ParseAnyDocumentName is used only at protocol boundaries that support both
// migration generations. Domain-specific v1 code continues using
// ParseDocumentName so a prompt room cannot accidentally bind to a workspace.
func ParseAnyDocumentName(raw string) (DocumentName, string, int, error) {
	if name, id, err := ParseDocumentName(raw); err == nil {
		return name, id, SchemaVersion, nil
	}
	if name, id, err := ParseWorkspaceDocumentName(raw); err == nil {
		return name, id, WorkspaceSchemaVersion, nil
	}
	return "", "", 0, ErrInvalidDocumentName
}

// CoeditTokenResponse is the public token issuance response. It is the ONLY
// place a browser learns the room name and the service URL: the browser never
// builds an opaque document name from raw identifiers.
type CoeditTokenResponse struct {
	Token         string `json:"token"`
	DocumentName  string `json:"documentName"`
	ServiceURL    string `json:"serviceUrl"`
	ExpiresAt     int64  `json:"expiresAt"`
	SchemaVersion int    `json:"schemaVersion"`
	FieldSet      string `json:"fieldSet"`
	Mode          string `json:"mode"`
	// ActorID and DisplayName are server-derived. Echoing them lets the caret
	// render the right label immediately; the service replaces awareness
	// identity with the same values, so a client that lies gains nothing.
	ActorID     string `json:"actorId"`
	DisplayName string `json:"displayName"`
	// Capability mirrors the effective server posture so a client that cached
	// a stale flag cannot keep trying to open rooms.
	Capability bool `json:"capability"`
	// Lifecycle counters are additive so old clients can continue to consume
	// token responses while the epoch/sequence rollout is staged.
	StateEpoch        DecimalString `json:"stateEpoch,omitempty"`
	CommitSequence    DecimalString `json:"commitSequence,omitempty"`
	WorkspaceRevision int           `json:"workspaceRevision,omitempty"`
}

// Identity is the server-resolved binding of a document to domain
// coordinates. Question revision counters are metadata and never part of room
// identity; the unique logical key is (draftVersionId, examQuestionId,
// schemaVersion).
type Identity struct {
	DocumentID           string         `json:"documentId"`
	DocumentName         DocumentName   `json:"documentName"`
	OrganizationID       *string        `json:"organizationId"`
	ExamID               string         `json:"examId"`
	DraftVersionID       string         `json:"draftVersionId"`
	ExamQuestionID       string         `json:"examQuestionId"`
	QuestionRevisionID   string         `json:"questionRevisionId"`
	SchemaVersion        int            `json:"schemaVersion"`
	FieldSet             string         `json:"fieldSet"`
	LifecycleState       LifecycleState `json:"lifecycleState"`
	SeedRevision         int            `json:"seedRevision"`
	MaterializedRevision int            `json:"materializedRevision"`
	ClosedReason         *CloseReason   `json:"closedReason"`
	StateEpoch           DecimalString  `json:"stateEpoch,omitempty"`
	CommitSequence       DecimalString  `json:"commitSequence,omitempty"`
	WorkspaceRevision    int            `json:"workspaceRevision,omitempty"`
}

// Role names mirrored from internal/auth (duplicated so this package stays
// free of an auth import cycle), matching the authoring realtime ACL.
const (
	RoleAdmin         = "admin"
	RoleAdminObserver = "admin_observer"
	RoleBuilder       = "builder"
)

// CanReadCoedit reports whether a role may subscribe to a room. Observers
// subscribe read-only, so the browser token is minted in read mode and the
// Hocuspocus connection is marked read-only.
func CanReadCoedit(role string) bool {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case RoleAdmin, RoleAdminObserver, RoleBuilder:
		return true
	default:
		return false
	}
}

// CanWriteCoedit reports whether a role may collaborate. Only admin and
// builder are write-capable; an observer that could write would be a
// privilege escalation on a socket the browser fully controls.
func CanWriteCoedit(role string) bool {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case RoleAdmin, RoleBuilder:
		return true
	default:
		return false
	}
}

// SameIdentity reports whether two resolutions describe the same document
// binding. Hocuspocus uses it to refuse a connection whose requested name does
// not equal the signed name.
func (i Identity) SameIdentity(other Identity) bool {
	return i.DocumentName == other.DocumentName &&
		i.DraftVersionID == other.DraftVersionID &&
		i.ExamQuestionID == other.ExamQuestionID &&
		i.SchemaVersion == other.SchemaVersion &&
		i.FieldSet == other.FieldSet
}
