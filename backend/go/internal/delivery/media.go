package delivery

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/satpublish"
)

// CanAttemptReadMedia limits attempt-bearer image reads to media referenced
// by that attempt's pinned version and enabled sections.
func (s *Service) CanAttemptReadMedia(ctx context.Context, scheduleID, attemptID, assetID string) (bool, error) {
	if s == nil || s.db == nil {
		return false, errors.New("delivery database is unavailable")
	}
	scheduleID = strings.TrimSpace(scheduleID)
	attemptID = strings.TrimSpace(attemptID)
	assetID = strings.TrimSpace(assetID)
	if scheduleID == "" || attemptID == "" || assetID == "" {
		return false, nil
	}

	var storedSchedule string
	var publishedVersionID sql.NullString
	err := s.db.QueryRowContext(ctx,
		"SELECT schedule_id, published_version_id FROM student_attempts WHERE id = ?", attemptID,
	).Scan(&storedSchedule, &publishedVersionID)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if storedSchedule != scheduleID || !publishedVersionID.Valid {
		return false, nil
	}

	versionID := publishedVersionID.String
	revision, err := s.versionRevision(ctx, versionID)
	if err != nil {
		return false, err
	}
	sections, err := s.cachedSections(ctx, versionID, revision)
	if err != nil {
		return false, err
	}
	scope, err := s.effectiveSectionScope(ctx, scheduleID, versionID)
	if err != nil {
		return false, err
	}
	// An adaptive branch the attempt was never routed into has no module
	// attempt row. Its questions must not be reachable by asset id either, so
	// media authorization uses the same assigned-module fence as the delivery
	// payload.
	opened, err := s.attemptModuleIDs(ctx, attemptID)
	if err != nil {
		return false, err
	}
	index := s.mediaIndexFor(versionID, revision, sections)
	for _, section := range deliverySectionsForOpenedModules(sections, opened) {
		if scope != nil && !examdomain.AllowsSection(scope, section.SectionKey) {
			continue
		}
		for _, module := range section.Modules {
			if _, ok := index[module.ID][assetID]; ok {
				return true, nil
			}
		}
	}
	return false, nil
}

// moduleMediaIndex maps each module to the assets its questions reference.
// Building it parses every question's rich content, so it is done once per
// published revision rather than once per image request.
func moduleMediaIndex(sections []DeliverySection) map[string]map[string]struct{} {
	index := map[string]map[string]struct{}{}
	for _, section := range sections {
		for _, module := range section.Modules {
			assets := map[string]struct{}{}
			for _, question := range module.Questions {
				for _, content := range []struct {
					raw  []byte
					path string
				}{
					{raw: question.Stimulus, path: "stimulus"},
					{raw: question.Prompt, path: "prompt"},
					{raw: question.Answer, path: "answer"},
				} {
					refs := satpublish.CollectRichContentAssetReferences(string(content.raw), "examQuestion:"+question.ExamQuestionID+":"+content.path, question.ExamQuestionID)
					for _, ref := range refs {
						assets[ref.AssetID] = struct{}{}
					}
					// ACT Science passages can still contain legacy HTML <img src>
					// URLs. The structured-content walker above only sees image nodes
					// with assetId fields, so index exact managed-media paths from the
					// pinned Science version too. Other exam sections remain unchanged.
					if section.SectionKey == "science" {
						addLegacyManagedMediaReferences(assets, string(content.raw))
					}
				}
			}
			index[module.ID] = assets
		}
	}
	return index
}

func addLegacyManagedMediaReferences(assets map[string]struct{}, raw string) {
	const pathPrefix = "/api/v1/media/"
	const contentSuffix = "/content"
	for {
		prefixIndex := strings.Index(raw, pathPrefix)
		if prefixIndex < 0 {
			return
		}
		raw = raw[prefixIndex+len(pathPrefix):]
		suffixIndex := strings.Index(raw, contentSuffix)
		if suffixIndex < 0 {
			return
		}
		assetID := raw[:suffixIndex]
		if assetID != "" && !strings.ContainsAny(assetID, "/\\?#\"'<> \t\r\n") {
			assets[assetID] = struct{}{}
		}
		raw = raw[suffixIndex+len(contentSuffix):]
	}
}

type mediaIndexKey struct {
	versionID string
	revision  int64
}

// mediaIndexFor memoizes moduleMediaIndex beside the version cache: keyed by
// the same probed revision, so a republish is a new key, never a stale hit.
// Without the version cache the tree is reloaded per request anyway.
func (s *Service) mediaIndexFor(versionID string, revision int64, sections []DeliverySection) map[string]map[string]struct{} {
	if s.versions == nil {
		return moduleMediaIndex(sections)
	}
	key := mediaIndexKey{versionID: versionID, revision: revision}
	s.mediaIndexMu.Lock()
	index, ok := s.mediaIndex[key]
	s.mediaIndexMu.Unlock()
	if ok {
		return index
	}
	index = moduleMediaIndex(sections)
	s.mediaIndexMu.Lock()
	// offcut: wholesale reset at the bound; an exam day runs a handful of versions
	if s.mediaIndex == nil || len(s.mediaIndex) >= VersionCacheMaxVersions {
		s.mediaIndex = map[mediaIndexKey]map[string]map[string]struct{}{}
	}
	s.mediaIndex[key] = index
	s.mediaIndexMu.Unlock()
	return index
}

// AttemptOpenedModuleIDs exposes the assigned-module set to the other
// student-facing content projections (the V1 session/static content snapshot),
// so they can apply the same adaptive-branch fence as the delivery payload
// instead of re-deriving it. A read error fails the caller closed.
func (s *Service) AttemptOpenedModuleIDs(ctx context.Context, attemptID string) (map[string]bool, error) {
	return s.attemptModuleIDs(ctx, attemptID)
}

// attemptModuleIDs reads which modules this attempt actually owns. The row for
// the routed adaptive branch is inserted with the route decision
// (nextModuleTx), so this set is exactly the set of modules the candidate may
// read content for.
func (s *Service) attemptModuleIDs(ctx context.Context, attemptID string) (map[string]bool, error) {
	rows, err := s.db.QueryContext(ctx,
		"SELECT module_id FROM assessment_module_attempts WHERE attempt_id = ? AND (state <> 'not_started' OR auto_start_at IS NULL)", attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var moduleID string
		if err := rows.Scan(&moduleID); err != nil {
			return nil, err
		}
		out[moduleID] = true
	}
	return out, rows.Err()
}
