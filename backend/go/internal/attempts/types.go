package attempts

import "time"

// ResponsePayload is the full per-question aggregate (plan 17).
type ResponsePayload struct {
	Answer            any          `json:"answer"`
	MarkedForReview   bool         `json:"markedForReview"`
	EliminatedOptions []string     `json:"eliminatedOptions"`
	Annotations       []Annotation `json:"annotations"`
}

// Annotation is a highlight/note owned by the response.
type Annotation struct {
	ID                 string              `json:"id"`
	Kind               string              `json:"kind"`
	Start              *int                `json:"start,omitempty"`
	End                *int                `json:"end,omitempty"`
	Text               string              `json:"text,omitempty"`
	Version            int                 `json:"version,omitempty"`
	Annotations        []SATTextAnnotation `json:"annotations,omitempty"`
	LegacyQuestionNote string              `json:"legacyQuestionNote,omitempty"`
}

type SATTextAnchor struct {
	NodeID      string `json:"nodeId"`
	StartOffset int    `json:"startOffset"`
	EndOffset   int    `json:"endOffset"`
	Exact       string `json:"exact"`
	Prefix      string `json:"prefix,omitempty"`
	Suffix      string `json:"suffix,omitempty"`
}

type SATTextAnnotation struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	// Color is the highlight ink (yellow default). Empty stays valid: every
	// payload written before colors existed decodes unchanged and renders
	// yellow on the client.
	Color     string        `json:"color,omitempty"`
	Anchor    SATTextAnchor `json:"anchor"`
	Note      string        `json:"note,omitempty"`
	CreatedAt string        `json:"createdAt"`
	UpdatedAt string        `json:"updatedAt"`
}

// ResponseCommand is one question write inside a batch (plan 18).
//
// Canonical answer envelope (Phase 01 contract, Phase 02 AT-07/AT02-05):
// the persisted per-question aggregate is ResponsePayload
// {answer, markedForReview, eliminatedOptions, annotations}. answer carries
// the Science response value; null/empty/whitespace-only decodes as
// unanswered (scores zero, never errors). Keys are canonical question IDs;
// unknown IDs persist for audit/detail but are excluded from scoring.
// Fencing identity: WriteID is the client write id (idempotency key — same
// id + same content replays, same id + different content conflicts 409);
// ClientVersion is the per-question monotonic version (stale versions
// supersede deterministically, never overwrite newer values). The V2
// transport stores both in attempt_mutations_v2 (write_id / version UNIQUEs)
// and the monotonic projection in attempt_responses_v2.server_revision;
// student_attempts.answer_write_revision / answer_client_write_id
// (migration 0059) carry the attempt-row write generation for the same
// fencing. Client score fields are never part of this envelope and are
// rejected or ignored at seal time.
type ResponseCommand struct {
	WriteID       string          `json:"writeId"`
	QuestionID    string          `json:"questionId"`
	ClientVersion uint64          `json:"clientVersion"`
	Response      ResponsePayload `json:"response"`
}

// SaveResponsesCommand is the request envelope (plan 18).
type SaveResponsesCommand struct {
	AttemptID    string
	LeaseEpoch   uint64
	ControlEpoch uint64
	Commands     []ResponseCommand
	// BearerTokenID threads the edge-resolved token id into the service
	// call path (smallest diff: optional field, no signature change).
	// When non-empty it must equal the crypto-resolved claims.TokenID or
	// the call fails closed 401; when empty the crypto-resolved TokenID
	// is used (older call paths keep working).
	BearerTokenID string
}

// Ack is the per-command acknowledgement.
type Ack struct {
	WriteID           string          `json:"writeId"`
	QuestionID        string          `json:"questionId"`
	ClientVersion     uint64          `json:"clientVersion"`
	Outcome           string          `json:"outcome"`
	ServerRevision    uint64          `json:"serverRevision"`
	Replayed          bool            `json:"replayed"`
	CanonicalResponse ResponsePayload `json:"canonicalResponse"`
	ContentHash       string          `json:"contentHash"`
}

// SaveResult is the batch outcome.
type SaveResult struct {
	Acks             []Ack     `json:"acks"`
	ResponseRevision uint64    `json:"responseRevision"`
	ServerTime       time.Time `json:"serverTime"`
	Replayed         bool      `json:"replayed"`
}

// AttemptState is the locked attempt row subset the engine needs.
type AttemptState struct {
	ID                string
	ScheduleID        string
	UserID            string
	OrganizationID    string
	ProtocolVersion   int
	DeliveryStatus    string
	Phase             string
	LeaseEpoch        uint64
	ControlEpoch      uint64
	ResponseRevision  uint64
	DeadlineAt        *time.Time
	ClosingGraceUntil *time.Time
	SubmittedAt       *time.Time
	FinalSubmission   *string
	ProctorStatus     string
}

// Provider identifies completion policy owner (plan 4.1, 28-32).
type Provider string

const (
	ProviderIELTS Provider = "ielts"
	ProviderSAT   Provider = "sat"
	ProviderACT   Provider = "act"
)

// SubmitCommand is the common submission preamble input (plan 28).
//
// Idempotency identity (Phase 02 AT02-08): SubmissionID is the client-minted
// submission key scoped to the attempt; submitRequestShape hashes
// {submissionId, attemptId, leaseEpoch, finalCommands,
// expectedAttemptRevision} into attempt_submissions_v2.request_hash. Exact
// replay (same id + same hash) returns the stored receipt; the same id with
// a different hash conflicts 409 (SUBMISSION_ID_MISUSE), and a submission id
// owned by another attempt conflicts 409. ExpectedRevision fences the seal
// against a racing autosave (409 VERSION_COLLISION on mismatch).
type SubmitCommand struct {
	AttemptID            string
	LeaseEpoch           uint64
	ExpectedControlEpoch uint64
	SubmissionID         string
	ExpectedRevision     *uint64
	FinalCommands        []ResponseCommand
	IdempotencyPayload   string
	ActorKind            string
	ActorID              string
	// BearerTokenID threads the edge-resolved token id into the service
	// call path (smallest diff: optional field, no signature change).
	// When non-empty it must equal the crypto-resolved claims.TokenID or
	// the call fails closed 401; when empty the crypto-resolved TokenID
	// is used (older call paths keep working).
	BearerTokenID string
}

// SubmitResult carries receipt + digest.
type SubmitResult struct {
	SubmissionID string    `json:"submissionId"`
	FinalDigest  string    `json:"finalDigest"`
	Replayed     bool      `json:"replayed"`
	Provisional  bool      `json:"provisional"`
	ServerTime   time.Time `json:"serverTime"`
}
