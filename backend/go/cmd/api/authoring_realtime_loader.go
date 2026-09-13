package main

import (
	"context"
	"strings"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/authoringrealtime"
)

// examAuthoringLoader adapts the exam service to the narrow ExamLoader the
// authoring realtime ACL needs. Tenant scoping, role checks, and permission
// flags all come from the service: this adapter adds no policy of its own.
type examAuthoringLoader struct{ app *App }

// LoadExamForActor resolves one exam FOR THIS ACTOR. A cross-tenant builder and
// a genuinely unknown exam both surface as the same not-found family, so the
// socket can never be used as a tenant oracle.
func (l examAuthoringLoader) LoadExamForActor(ctx context.Context, actorID, role, examID string) (authoringrealtime.ExamView, error) {
	// Identity is validated before wiring: a blank exam id is a client
	// error regardless of whether the service happens to be wired.
	examID = strings.TrimSpace(examID)
	if examID == "" {
		return authoringrealtime.ExamView{}, authoringrealtime.Denial(authoringrealtime.CodeEntityDeleted, "Exam not found.")
	}
	if l.app == nil || l.app.Exams == nil {
		return authoringrealtime.ExamView{}, authoringrealtime.Denial(authoringrealtime.CodeSubscriptionForbidden, "Exam service is unavailable.")
	}
	actor := auth.NewActorContext(strings.TrimSpace(actorID), strings.TrimSpace(role))
	exam, err := l.app.Exams.GetForActor(ctx, actor, examID)
	if err != nil {
		// Uniform shape: never leak whether the exam exists in another tenant.
		return authoringrealtime.ExamView{}, authoringrealtime.Denial(authoringrealtime.CodeEntityDeleted, "Exam not found.")
	}
	return authoringrealtime.ExamView{
		ID:                    exam.ID,
		OrganizationID:        exam.OrganizationID,
		CurrentDraftVersionID: exam.CurrentDraftVersionID,
		ProviderKey:           exam.ProviderKey,
	}, nil
}

// examAuthoringLoaderFor picks the injectable test loader when present, else
// the production exam-backed adapter. Production wiring never sets the field,
// so this is a pure pass-through in real deployments.
func examAuthoringLoaderFor(app *App) authoringrealtime.ExamLoader {
	if app != nil && app.AuthoringExamLoader != nil {
		return app.AuthoringExamLoader
	}
	return examAuthoringLoader{app: app}
}

// authoringSubscriptionConfig resolves the capability posture from config.
//
// Delivery is the Phase 03 gate. Presence and conflict-compare are NARROWING
// capabilities on top of the delivery socket: neither can be granted while
// delivery is withheld, because both ride the socket delivery gated. Each flag
// therefore has to be set deliberately in addition to delivery — a client can
// never negotiate a capability the server does not implement.
func authoringSubscriptionConfig(app *App) authoringrealtime.SubscriptionConfig {
	if app == nil {
		return authoringrealtime.SubscriptionConfig{}
	}
	delivery := app.Config.AuthoringRealtimeDelivery
	return authoringrealtime.SubscriptionConfig{
		DeliveryEnabled:        delivery,
		PresenceEnabled:        delivery && app.Config.AuthoringRealtimePresence,
		ConflictCompareEnabled: delivery && app.Config.AuthoringRealtimeConflictCompare,
	}
}

// authoringPresence returns the process-local presence registry, creating a
// default-configured hub on first use so production needs no constructor
// argument while tests can still inject one with a tiny TTL.
//
// A nil registry means presence is unavailable, which the caller degrades to
// "no presence frames" rather than failing the subscription: presence is
// advisory and collaboration without it still works.
func (a *App) authoringPresence() *authoringrealtime.PresenceHub {
	if a == nil {
		return nil
	}
	a.authoringPresenceOnce.Do(func() {
		if a.AuthoringPresence == nil {
			a.AuthoringPresence = authoringrealtime.NewPresenceHub(authoringrealtime.PresenceHubOptions{})
		}
	})
	return a.AuthoringPresence
}

// dbDisplayNameResolver reads the staff display name once per connection. The
// query and column are the same ones the auth handlers use, so there is no new
// schema dependency, and it is never on a hot path (one lookup per subscribe).
type dbDisplayNameResolver struct{ app *App }

func (r dbDisplayNameResolver) DisplayNameForActor(ctx context.Context, actorID string) (string, error) {
	if r.app == nil || r.app.DB == nil {
		return "", nil
	}
	id := strings.TrimSpace(actorID)
	if id == "" {
		return "", nil
	}
	var name string
	if err := r.app.DB.QueryRowContext(ctx, `SELECT COALESCE(display_name, '') FROM users WHERE id = ?`, id).Scan(&name); err != nil {
		return "", err
	}
	return strings.TrimSpace(name), nil
}

// authoringDisplayNameFor resolves the display-only collaborator name used on
// presence frames, preferring an injected resolver (tests) over the DB.
//
// Failure is deliberately non-fatal and silent at the subscription level: a
// name is cosmetic, so a lookup error yields "" and the client shows a neutral
// label. It must never fail a subscription, and it must never fall back to the
// raw user id.
func authoringDisplayNameFor(ctx context.Context, app *App, actorID string) string {
	if app == nil {
		return ""
	}
	resolver := app.AuthoringDisplayNames
	if resolver == nil {
		resolver = dbDisplayNameResolver{app: app}
	}
	name, err := resolver.DisplayNameForActor(ctx, actorID)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(name)
}
