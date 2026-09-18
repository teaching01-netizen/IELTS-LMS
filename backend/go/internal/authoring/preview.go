package authoring

import (
	"context"

	"example.com/ielts-proctoring/internal/delivery"
)

// Preview contains renderable candidate content, not authoring summaries.
type Preview struct {
	ExamID          string                     `json:"examId"`
	ProviderKey     string                     `json:"providerKey"`
	VersionID       string                     `json:"versionId"`
	VersionRevision int                        `json:"versionRevision"`
	Sections        []delivery.DeliverySection `json:"sections"`
}

// Preview loads the candidate-facing projection of the current draft
// (identity + revision once, sat gate BEFORE any cache read, then exactly
// the delivery projection via the bulk loader — never the discarded authoring
// Shell() call the old implementation paid for).
//
// Single build: identity+revision resolve once (inside the snapshot when the
// cache is off, via a single snapshot query when it is on), the sat 422 gate
// runs BEFORE any cache lookup or population (non-sat drafts never touch the
// cache), and the delivery tree comes from the injected loader:
//   - cache on  -> deliverySvc.LoadSectionsBulkWithRevision loader through
//     previewCache.GetChecked(versionID, probedRevision) — a revision
//     mismatch reloads inside the same snapshot (never a stale tree);
//   - cache off -> deliverySvc.LoadSectionsBulk directly (3 statements).
//
// Revision-keyed safety notes: every mutation path bumps
// exam_versions.revision (touchModuleDraft/touchQuestionDraft cover
// create/batch/update/delete/duplicate/bulk/reorder/save-revision;
// UpdateDeliverySettings bumps directly; replaceCompleteSATDraft bumps), so a
// revision mismatch always forces a reload. UndoSATWorkbook swaps the draft
// pointer WITHOUT bumping exam_versions.revision — safe under the
// (versionID, revision) key because the pointer change yields a different
// versionID, whose probe+load describe the restored content. Authz ordering is
// unchanged: handlers gate (role -> tenant GetForActor) before this service.
func (s *Service) Preview(ctx context.Context, examID string) (Preview, error) {
	if s == nil {
		return Preview{}, errNoDatabase
	}
	deliver := s.previewDelivery()
	// Identity+revision resolve once, inside one snapshot-backed query. The
	// sat gate runs BEFORE any cache lookup or population: a non-sat draft
	// returns 422 and never touches the cache.
	var identity shellIdentity
	if err := s.withReadSnapshot(ctx, func(ctx context.Context, q queryRowContexter) error {
		resolution, err := resolveShellIdentity(ctx, q, examID)
		if err != nil {
			return err
		}
		if !resolution.draftPresent {
			// Preview is candidate-facing: there is nothing to preview without
			// a draft. This keeps its long-standing 404 without reintroducing
			// that shape on the authoring shell read, which now answers
			// NO_DRAFT as a 200 lifecycle state.
			return notFoundError("Draft version not found.")
		}
		identity = resolution.identity
		return nil
	}); err != nil {
		return Preview{}, err
	}
	if identity.providerKey != "sat" {
		return Preview{}, validationError("Assessment provider is not supported.")
	}
	if s.previewCache == nil {
		// Cache off (nil-safe default, also the VERSION_CACHE=off
		// kill-switch posture): one bulk delivery build, 3 statements.
		deliverySections, err := deliver.LoadSectionsBulk(ctx, identity.versionID)
		if err != nil {
			return Preview{}, err
		}
		return Preview{ExamID: examID, ProviderKey: identity.providerKey, VersionID: identity.versionID, VersionRevision: identity.revision, Sections: deliverySections}, nil
	}
	// Cache on: serve the delivery tree through GetChecked singleflight keyed
	// on (versionID, probedRevision). Hit = zero tree statements; miss = the
	// BulkSectionsLoader's 4 statements (3 tree + revision probe INSIDE the
	// same snapshot, so the stored revision describes the stored tree).
	probedRev := int64(identity.revision)
	loader := deliver.BulkSectionsLoader(ctx, identity.versionID)
	sections, err := s.previewCache.GetChecked(ctx, identity.versionID, probedRev, loader)
	if err != nil {
		return Preview{}, err
	}
	return Preview{ExamID: examID, ProviderKey: identity.providerKey, VersionID: identity.versionID, VersionRevision: identity.revision, Sections: sections}, nil
}
