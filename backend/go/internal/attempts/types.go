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
	ID        string        `json:"id"`
	Kind      string        `json:"kind"`
	Anchor    SATTextAnchor `json:"anchor"`
	Note      string        `json:"note,omitempty"`
	CreatedAt string        `json:"createdAt"`
	UpdatedAt string        `json:"updatedAt"`
}

// ResponseCommand is one question write inside a batch (plan 18).
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
}

// SubmitResult carries receipt + digest.
type SubmitResult struct {
	SubmissionID string    `json:"submissionId"`
	FinalDigest  string    `json:"finalDigest"`
	Replayed     bool      `json:"replayed"`
	Provisional  bool      `json:"provisional"`
	ServerTime   time.Time `json:"serverTime"`
}
