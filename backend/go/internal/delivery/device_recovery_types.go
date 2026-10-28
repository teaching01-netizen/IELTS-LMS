package delivery

// Staff-assisted exam recovery: delivery-owned grant types.
//
// A grant is a transfer authority, not a second clock. It records the time
// policy staff chose (retain the original deadline, or award a bounded number
// of seconds), while the effective countdown stays in the provider-owned
// clock. Nothing here carries answer data, question content or an attempt
// bearer: the authenticated Continue step mints those inside its transaction.
//
// The JSON field names are the stable HTTP contract shared by the staff
// dialog and the student recovery route.

import (
	"context"
	"time"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// IssueDeviceRecoveryRequest is one staff issuance. OperationID makes the
// request replayable after an ambiguous response; ExpectedLeaseEpoch and
// ExpectedControlEpoch fence the decision against another staff action.
type IssueDeviceRecoveryRequest struct {
	OperationID          string                    `json:"operationId"`
	ExpectedLeaseEpoch   uint64                    `json:"expectedLeaseEpoch"`
	ExpectedControlEpoch uint64                    `json:"expectedControlEpoch"`
	Target               examdomain.RecoveryTarget `json:"target"`
	RemainingSeconds     *int                      `json:"remainingSeconds,omitempty"`
}

// DeviceRecoveryTarget is one stage staff may continue.
type DeviceRecoveryTarget struct {
	SectionKey         string              `json:"sectionKey"`
	Label              string              `json:"label"`
	ModuleAttemptID    string              `json:"moduleAttemptId,omitempty"`
	ModuleID           string              `json:"moduleId,omitempty"`
	State              string              `json:"state,omitempty"`
	ClosureReason      string              `json:"closureReason,omitempty"`
	OriginalDeadlineAt *time.Time          `json:"originalDeadlineAt,omitempty"`
	RemainingSeconds   *int64              `json:"remainingSeconds,omitempty"`
	Current            bool                `json:"current"`
	Eligibility        RecoveryEligibility `json:"eligibility"`
}

// DeviceRecoveryGrantStatus is the safe grant projection. It never contains
// the link secret or code; those are returned only by a live issuance or by
// the lost-response replay of the staff who issued it.
type DeviceRecoveryGrantStatus struct {
	GrantID                   string                    `json:"grantId"`
	State                     string                    `json:"state"`
	Target                    examdomain.RecoveryTarget `json:"target"`
	RequestedRemainingSeconds *int                      `json:"requestedRemainingSeconds,omitempty"`
	GrantRevision             uint64                    `json:"grantRevision"`
	FailedCodeCount           int                       `json:"failedCodeCount"`
	IssuedAt                  time.Time                 `json:"issuedAt"`
	ExpiresAt                 time.Time                 `json:"expiresAt"`
	ClaimExpiresAt            *time.Time                `json:"claimExpiresAt,omitempty"`
	ClaimedAt                 *time.Time                `json:"claimedAt,omitempty"`
	StartedAt                 *time.Time                `json:"startedAt,omitempty"`
	// SecretsAvailable reports whether the staff replay capsule is still
	// present. It is false once the code is consumed or the grant expires.
	SecretsAvailable bool `json:"secretsAvailable"`
}

// DeviceRecoveryOptions is the staff dialog's authoritative preview.
type DeviceRecoveryOptions struct {
	IssuanceEnabled    bool                       `json:"issuanceEnabled"`
	Issuance           *IssuedDeviceRecovery      `json:"issuance,omitempty"`
	AttemptID          string                     `json:"attemptId"`
	ScheduleID         string                     `json:"scheduleId"`
	CandidateName      string                     `json:"candidateName"`
	ProviderKey        string                     `json:"providerKey"`
	ExamTitle          string                     `json:"examTitle"`
	LeaseEpoch         uint64                     `json:"leaseEpoch"`
	ControlEpoch       uint64                     `json:"controlEpoch"`
	TerminalGeneration uint64                     `json:"terminalGeneration"`
	ServerNow          time.Time                  `json:"serverNow"`
	LastServerSaveAt   *time.Time                 `json:"lastServerSaveAt,omitempty"`
	Control            *RecoveryControlStatus     `json:"control,omitempty"`
	Eligibility        RecoveryEligibility        `json:"eligibility"`
	Targets            []DeviceRecoveryTarget     `json:"targets"`
	Grant              *DeviceRecoveryGrantStatus `json:"grant,omitempty"`
}

// RecoveryControlStatus is the public view of the attempt-owned control.
// The original browser session id stays server-side.
type RecoveryControlStatus struct {
	ID            string                    `json:"id"`
	Phase         string                    `json:"phase"`
	Target        examdomain.RecoveryTarget `json:"target"`
	GrantID       string                    `json:"grantId,omitempty"`
	RunGeneration uint64                    `json:"runGeneration,omitempty"`
}

// IssuedDeviceRecovery is the staff-only issuance response. LinkSecret and
// Code are the live secrets; a replay returns them only while the grant can
// still be claimed. RecoveryPath is relative (no origin): the client adds its
// own origin and renders the link/QR.
type IssuedDeviceRecovery struct {
	Grant        DeviceRecoveryGrantStatus `json:"grant"`
	LinkSecret   string                    `json:"linkSecret,omitempty"`
	Code         string                    `json:"code,omitempty"`
	RecoveryPath string                    `json:"recoveryPath,omitempty"`
	ServerNow    time.Time                 `json:"serverNow"`
	Replayed     bool                      `json:"replayed"`
}

// recoveryGrant states. `issued`, `claimed` and `started` are live and own
// the attempt's unique active marker; the rest release it.
const (
	recoveryGrantIssued   = "issued"
	recoveryGrantClaimed  = "claimed"
	recoveryGrantStarted  = "started"
	recoveryGrantExpired  = "expired"
	recoveryGrantReplaced = "replaced"
	recoveryGrantRestored = "restored"
	recoveryGrantLocked   = "locked"
)

func recoveryGrantLive(state string) bool {
	switch state {
	case recoveryGrantIssued, recoveryGrantClaimed, recoveryGrantStarted:
		return true
	default:
		return false
	}
}

func recoveryGrantTerminal(state string) bool {
	switch state {
	case recoveryGrantExpired, recoveryGrantReplaced, recoveryGrantRestored, recoveryGrantLocked:
		return true
	default:
		return false
	}
}

// ClaimDeviceRecoveryRequest is the student's first recovery action. The
// link secret arrives in the URL fragment and is sent only in this body;
// BrowserProof is an opaque browser-held random value that binds the
// preparation window. OperationID makes a lost claim response replayable.
type ClaimDeviceRecoveryRequest struct {
	OperationID  string `json:"operationId"`
	LinkSecret   string `json:"linkSecret"`
	Code         string `json:"code"`
	BrowserProof string `json:"browserProof"`
}

// RecoveryReadyTarget is the sanitized stage staff selected. It carries no
// question text, answer data or attempt bearer.
type RecoveryReadyTarget struct {
	SectionKey         string     `json:"sectionKey"`
	Label              string     `json:"label"`
	ModuleAttemptID    string     `json:"moduleAttemptId,omitempty"`
	ModuleID           string     `json:"moduleId,omitempty"`
	State              string     `json:"state,omitempty"`
	ClosureReason      string     `json:"closureReason,omitempty"`
	OriginalDeadlineAt *time.Time `json:"originalDeadlineAt,omitempty"`
}

// RecoveryTimePolicy is the staff decision the student must see before
// continuing. An explicit award is applied only at Begin, from that
// transaction's server time, never from the moment staff typed it.
type RecoveryTimePolicy struct {
	Mode               string     `json:"mode"` // original_deadline | awarded
	AwardedSeconds     *int       `json:"awardedSeconds,omitempty"`
	OriginalDeadlineAt *time.Time `json:"originalDeadlineAt,omitempty"`
	RemainingSeconds   *int64     `json:"remainingSeconds,omitempty"`
}

// RecoveryAudioCheckpoint is the durable listening position for the selected
// stage. It is a resume hint, not writable authority.
type RecoveryAudioCheckpoint struct {
	SectionKey     string    `json:"sectionKey"`
	PartID         string    `json:"partId"`
	MediaRevision  string    `json:"mediaRevision"`
	PositionMS     uint64    `json:"positionMs"`
	ClientSequence uint64    `json:"clientSequence"`
	RunGeneration  uint64    `json:"runGeneration"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// RecoveryCheckpointStatus is what the browser may safely resume: saved
// response metadata and audio positions, never answer content.
type RecoveryCheckpointStatus struct {
	ResponsesSaved   int                       `json:"responsesSaved"`
	LastServerSaveAt *time.Time                `json:"lastServerSaveAt,omitempty"`
	Audio            []RecoveryAudioCheckpoint `json:"audio,omitempty"`
}

// RecoveryReadyManifest is a preparation-only inventory: the browser can
// preload required figures and confirm the pinned content version. Question
// and media identities are not content, and no question text, option text,
// answer or transcript crosses this boundary.
type RecoveryReadyManifest struct {
	PublishedVersionID string   `json:"publishedVersionId"`
	SectionKeys        []string `json:"sectionKeys"`
	ModuleIDs          []string `json:"moduleIds"`
	QuestionIDs        []string `json:"questionIds"`
	MediaAssetIDs      []string `json:"mediaAssetIds"`
}

// RecoveryReadyView is returned by claim and by claim replay. It deliberately
// carries no session cookie and no attempt token: those exist only after the
// explicit Continue (Begin) transaction.
type RecoveryReadyView struct {
	GrantID        string                   `json:"grantId"`
	State          string                   `json:"state"`
	GrantRevision  uint64                   `json:"grantRevision"`
	CandidateName  string                   `json:"candidateName"`
	ExamTitle      string                   `json:"examTitle"`
	ProviderKey    string                   `json:"providerKey"`
	Target         RecoveryReadyTarget      `json:"target"`
	TimePolicy     RecoveryTimePolicy       `json:"timePolicy"`
	ClaimedAt      *time.Time               `json:"claimedAt,omitempty"`
	ClaimExpiresAt *time.Time               `json:"claimExpiresAt,omitempty"`
	StartedAt      *time.Time               `json:"startedAt,omitempty"`
	ServerNow      time.Time                `json:"serverNow"`
	Checkpoint     RecoveryCheckpointStatus `json:"checkpoint"`
	Manifest       RecoveryReadyManifest    `json:"manifest"`
}

// BeginDeviceRecoveryRequest is the student's explicit Continue. BrowserProof
// must be the proof that claimed the grant. OperationID makes a lost Begin
// response replayable; the same proof may refresh credentials after a lost
// response while this grant still owns the current lease/run.
type BeginDeviceRecoveryRequest struct {
	ExpectedGrantRevision uint64 `json:"expectedGrantRevision"`
	OperationID           string `json:"operationId"`
	BrowserProof          string `json:"browserProof"`
}

// RecoveryCredentialIdentity is the credential the browser receives after
// Begin. SessionToken/CSRFToken/AttemptToken are set-cookie and JSON-free
// values; the HTTP handlers must never serialize the raw tokens into a
// cacheable body.
type RecoveryCredentialIdentity struct {
	SessionID        string    `json:"-"`
	SessionToken     string    `json:"-"`
	CSRFToken        string    `json:"-"`
	AttemptToken     string    `json:"-"`
	AttemptExpiresAt time.Time `json:"attemptExpiresAt"`
	ClientSessionID  string    `json:"-"`
}

// RecoveryBeginReceipt is the immutable metadata projection stored on the
// grant. It contains no raw bearer and no answer content.
type RecoveryBeginReceipt struct {
	OperationID         string     `json:"operationId"`
	GrantRevision       uint64     `json:"grantRevision"`
	SessionID           string     `json:"sessionId"`
	ClientSessionID     string     `json:"clientSessionId"`
	LeaseEpoch          uint64     `json:"leaseEpoch"`
	ControlEpoch        uint64     `json:"controlEpoch"`
	RunGeneration       uint64     `json:"runGeneration"`
	TerminalGeneration  uint64     `json:"terminalGeneration"`
	TimeMode            string     `json:"timeMode"`
	AwardedSeconds      *int       `json:"awardedSeconds,omitempty"`
	EffectiveDeadlineAt *time.Time `json:"effectiveDeadlineAt,omitempty"`
}

// RecoveryBeginResult is the Begin response. RoutePath is where the browser
// continues the ordinary student experience after the credentials are set as
// cookies.
type RecoveryBeginResult struct {
	AttemptID           string     `json:"attemptId"`
	ScheduleID          string     `json:"scheduleId"`
	CandidateID         string     `json:"candidateId"`
	GrantID             string     `json:"grantId"`
	State               string     `json:"state"`
	GrantRevision       uint64     `json:"grantRevision"`
	RoutePath           string     `json:"routePath"`
	AttemptExpiresAt    time.Time  `json:"attemptExpiresAt"`
	EffectiveDeadlineAt *time.Time `json:"effectiveDeadlineAt,omitempty"`
	ServerNow           time.Time  `json:"serverNow"`
	Replayed            bool       `json:"replayed"`
}

// RecoveryCredentialRequest is the composition-root input for minting a
// scoped recovery session and attempt credential inside Begin's transaction.
type RecoveryCredentialRequest struct {
	GrantID         string
	UserID          string
	ScheduleID      string
	AttemptID       string
	ClientSessionID string
	OrganizationID  *string
	LeaseEpoch      uint64
	UserAgentHash   *string
	IPMetadata      *string
	Now             time.Time
}

// RecoveryCredentialIssuer mints the scoped user session and attempt token in
// the caller's transaction, returning credentials only after Begin commits.
type RecoveryCredentialIssuer func(ctx context.Context, q tx.Tx, req RecoveryCredentialRequest) (RecoveryCredentialIdentity, error)

// RecoveryReopenFunc reopens a sealed terminal generation inside Begin's
// transaction. It must fail closed if the generation cannot be reopened.
type RecoveryReopenFunc func(ctx context.Context, q tx.Tx, attemptID string, now time.Time) (uint64, error)
