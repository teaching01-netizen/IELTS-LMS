package authoringrealtime

import (
	"context"
	"errors"
	"strings"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// Phase 03 authorization. Every identity that reaches the socket is derived
// server-side: the session cookie gives the actor, the DB gives the tenant and
// the working draft. A client may supply ONLY an exam id, and even that is
// re-checked against the identity authorized before the upgrade.
//
// Role set is the authoring READ set (admin / admin_observer / builder).
// Observers subscribe read-only: there is no realtime mutation path at all, so
// least privilege holds by construction rather than by a runtime check.
//
// Denial shape is deliberately uniform: a cross-tenant builder and a genuinely
// unknown exam both surface as the same not-found family, so the socket can
// never be used as a tenant oracle.

// Role names mirrored from internal/auth (duplicated as constants so this
// package stays free of an auth import cycle).
const (
	RoleAdmin         = "admin"
	RoleAdminObserver = "admin_observer"
	RoleBuilder       = "builder"
)

// Binding is the server-resolved subscription identity. Everything is derived
// from the session + DB; the client cannot influence any field. The binding is
// deliberately minimal: this socket is RECEIVE-ONLY (HTTP owns every mutation),
// so it carries no write authority to leak or to keep in sync.
//
// Transport scope is ORGANIZATION + EXAM, never draft: a draft is replaceable
// state, so a collaborator must keep receiving frames (including the one that
// announces the replacement) while the working draft changes underneath them.
// Each event carries scope.draftVersionId for the client to compare against its
// own draft.
type Binding struct {
	OrganizationID *string
	ExamID         string
	DraftVersionID string
	ActorID        string

	// DisplayName is resolved server-side from the staff record and is
	// display-only: it is stamped onto presence frames so collaborators can be
	// shown by name. Empty when the record has none, in which case the client
	// falls back to a neutral label rather than showing a raw user id.
	DisplayName string

	// Capability posture negotiated for this connection. The client kill
	// switch can only narrow these, never widen them.
	DeliveryEnabled        bool
	PresenceEnabled        bool
	ConflictCompareEnabled bool
}

// ExamView is the narrow slice of an exam this package needs. Keeping it a
// plain struct (not the exams.Exam type) avoids an import cycle and lets unit
// tests inject a fake loader with no DB.
type ExamView struct {
	ID                    string
	OrganizationID        *string
	CurrentDraftVersionID *string
	ProviderKey           string
}

// ExamLoader is the only dependency the ACL needs from the exam service.
type ExamLoader interface {
	LoadExamForActor(ctx context.Context, actorID, role, examID string) (ExamView, error)
}

// DisplayNameResolver resolves a display-only collaborator name for presence
// frames. It is explicitly cosmetic: a failure yields "" and the client shows
// a neutral label, so a name lookup can never fail a subscription, and a raw
// user id is never shown in its place.
type DisplayNameResolver interface {
	DisplayNameForActor(ctx context.Context, actorID string) (string, error)
}

// BarrierSource resolves the monotonic server watermark used to split replay
// from live delivery. liveupdates.Bus satisfies it. Kept an interface so the
// handshake can be driven deterministically (and fail-closed behavior tested)
// without a live bus.
type BarrierSource interface {
	LatestSequence(ctx context.Context) (int64, error)
}

// SubscriptionDenial is a typed refusal carrying a Phase 01 domain code so
// the handler renders one stable error shape.
type SubscriptionDenial struct {
	Code    DomainCode
	Message string
}

func (d *SubscriptionDenial) Error() string { return d.Message }

// AsAppError converts a denial into the wire error envelope. The status and
// code come from the frozen DomainCode mapping (403 / 404 / 410 families).
func (d *SubscriptionDenial) AsAppError() *apperrors.Error {
	if d == nil {
		return nil
	}
	return d.Code.ToAppError(d.Message)
}

// Denial builds a typed subscription refusal.
func Denial(code DomainCode, message string) *SubscriptionDenial {
	return &SubscriptionDenial{Code: code, Message: message}
}

// Denied reports whether err is a subscription denial and returns it.
func Denied(err error) (*SubscriptionDenial, bool) {
	var d *SubscriptionDenial
	if errors.As(err, &d) {
		return d, true
	}
	return nil, false
}

// AuthoringReadRoles is the frozen read set (admin / admin_observer / builder).
var AuthoringReadRoles = []string{RoleAdmin, RoleAdminObserver, RoleBuilder}

// CanReadAuthoring reports whether a role may subscribe.
func CanReadAuthoring(role string) bool {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case RoleAdmin, RoleAdminObserver, RoleBuilder:
		return true
	default:
		return false
	}
}

// SubscriptionConfig carries the runtime posture the handler resolves from
// feature flags + config. Kept explicit so the ACL has no global state.
type SubscriptionConfig struct {
	DeliveryEnabled        bool
	PresenceEnabled        bool
	ConflictCompareEnabled bool
}

// VerifySubscriptionRead enforces, in order:
//
//  1. the role is in the authoring read set (else permission_denied);
//  2. the exam resolves FOR THIS ACTOR (tenant scope; a cross-tenant builder
//     and an unknown exam are indistinguishable — both not-found family);
//  3. the exam has a current editable draft (else draft_not_editable).
//
// The returned Binding is entirely server-derived. The delivery flag is NOT
// checked here: the handler refuses flag-off subscriptions with
// subscription_forbidden AFTER a successful ACL pass, so a flag-off server is
// indistinguishable from a forbidden one and leaks no authorization detail.
func VerifySubscriptionRead(ctx context.Context, loader ExamLoader, actorID, role, examID string, cfg SubscriptionConfig) (Binding, error) {
	actorID = strings.TrimSpace(actorID)
	examID = strings.TrimSpace(examID)
	if actorID == "" {
		return Binding{}, &SubscriptionDenial{Code: CodePermissionDenied, Message: "A session is required."}
	}
	if !CanReadAuthoring(role) {
		return Binding{}, &SubscriptionDenial{Code: CodePermissionDenied, Message: "Authoring read access is required."}
	}
	if examID == "" {
		return Binding{}, &SubscriptionDenial{Code: CodePermissionDenied, Message: "Exam not found."}
	}
	if loader == nil {
		return Binding{}, &SubscriptionDenial{Code: CodeSubscriptionForbidden, Message: "Authoring realtime is unavailable."}
	}
	exam, err := loader.LoadExamForActor(ctx, actorID, role, examID)
	if err != nil {
		// Uniform shape: never distinguish "does not exist" from "not yours".
		if _, ok := Denied(err); ok {
			return Binding{}, err
		}
		return Binding{}, &SubscriptionDenial{Code: CodeEntityDeleted, Message: "Exam not found."}
	}
	if exam.ID == "" {
		return Binding{}, &SubscriptionDenial{Code: CodeEntityDeleted, Message: "Exam not found."}
	}
	draftID := ""
	if exam.CurrentDraftVersionID != nil {
		draftID = strings.TrimSpace(*exam.CurrentDraftVersionID)
	}
	if draftID == "" {
		// Published (or draft-less) exam: there is no working copy to
		// collaborate on. Read-only inspection stays available over HTTP.
		return Binding{}, &SubscriptionDenial{Code: CodeDraftNotEditable, Message: "This exam has no editable draft."}
	}
	return Binding{
		OrganizationID:         exam.OrganizationID,
		ExamID:                 exam.ID,
		DraftVersionID:         draftID,
		ActorID:                actorID,
		DeliveryEnabled:        cfg.DeliveryEnabled,
		PresenceEnabled:        cfg.PresenceEnabled,
		ConflictCompareEnabled: cfg.ConflictCompareEnabled,
	}, nil
}

// Revalidate re-checks the binding against the CURRENT draft. It is called on
// every re-subscribe and before forwarding a lifecycle event.
//
// Returns draft_replaced when the working draft moved on: the client must
// re-subscribe against the new draft and refetch authoritatively.
func (b Binding) Revalidate(currentDraftVersionID string) error {
	current := strings.TrimSpace(currentDraftVersionID)
	if current == "" {
		return &SubscriptionDenial{Code: CodeDraftNotEditable, Message: "This exam no longer has an editable draft."}
	}
	if current != b.DraftVersionID {
		return &SubscriptionDenial{Code: CodeDraftReplaced, Message: "The working draft changed; re-subscribe."}
	}
	return nil
}

// MatchesExamScope reports whether an event belongs to this subscription's
// TRANSPORT scope: organization + exam. The draft is deliberately NOT part of
// that predicate. A same-draft predicate would suppress the very lifecycle
// event that tells a stale subscriber its working draft was replaced (Undo can
// swap Draft 7 for Draft 4 while subscribers remain bound to Draft 7).
//
// Cross-exam and cross-tenant events never match; the payload must also parse,
// so the caller drops (never crashes on) history it cannot interpret.
func (b Binding) MatchesExamScope(evt Event) bool {
	if strings.TrimSpace(evt.Scope.ExamID) != b.ExamID {
		return false
	}
	return sameOrg(evt.Scope.OrganizationID, b.OrganizationID)
}

// MatchesDraftScope reports whether an event was produced by the EXACT working
// draft this binding was created for. It is a classification hint, not a
// routing filter: the client uses a draft mismatch to choose between content
// reconciliation and lifecycle recovery, while delivery stays exam-scoped via
// MatchesExamScope.
func (b Binding) MatchesDraftScope(evt Event) bool {
	return strings.TrimSpace(evt.Scope.DraftVersionID) == b.DraftVersionID
}

// sameOrg compares two nullable org ids (nil = platform scope).
func sameOrg(a, b *string) bool {
	av, bv := "", ""
	if a != nil {
		av = *a
	}
	if b != nil {
		bv = *b
	}
	return av == bv
}
