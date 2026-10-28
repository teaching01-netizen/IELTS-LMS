package delivery

import (
	"sync"

	"context"
	"database/sql"
	"errors"
	"strings"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/media"
	"example.com/ielts-proctoring/internal/platform/apperrors"
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

	// One statement per figure for the attempt, its pinned version's revision
	// and release scope, and the link scope: a room loads every figure of a
	// module at once, so each round trip here is multiplied by the room.
	var storedSchedule string
	var publishedVersionID sql.NullString
	var codeRequired bool
	var codeAcceptedAt sql.NullTime
	var revision sql.NullInt64
	var releaseScope, linkScope sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT a.schedule_id, a.published_version_id, a.sat_start_code_required, a.sat_start_code_accepted_at,
		        v.revision, v.sat_publish_scope, l.enabled_sections
		   FROM student_attempts a
		   LEFT JOIN exam_versions v ON v.id = a.published_version_id
		   LEFT JOIN assessment_access_links l ON l.schedule_id = a.schedule_id
		  WHERE a.id = ? AND (a.recovery_control IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(a.recovery_control,'$.phase'))='working')`, attemptID,
	).Scan(&storedSchedule, &publishedVersionID, &codeRequired, &codeAcceptedAt, &revision, &releaseScope, &linkScope)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if storedSchedule != scheduleID || !publishedVersionID.Valid {
		return false, nil
	}
	// SAT access-code start: no protected asset before this candidate's own
	// code redemption, even one referenced by the seeded first module.
	if codeRequired && !codeAcceptedAt.Valid {
		return false, nil
	}
	if !revision.Valid {
		return false, apperrors.New(apperrors.CodeNotFound, "Published exam version not found.")
	}
	versionID := publishedVersionID.String
	sections, err := s.cachedSections(ctx, versionID, revision.Int64)
	if err != nil {
		return false, err
	}
	// The effectiveSectionScope rule, from the same row.
	scope := examdomain.IntersectSectionScopes(examdomain.ParseSATPublishScope(releaseScope.String), examdomain.ParseStoredSectionScope(linkScope))
	// An adaptive branch the attempt was never routed into has no module
	// attempt row. Its questions must not be reachable by asset id either, so
	// media authorization uses the same assigned-module fence as the delivery
	// payload.
	opened, err := s.attemptModuleIDs(ctx, attemptID)
	if err != nil {
		return false, err
	}
	index := s.mediaIndexFor(versionID, revision.Int64, sections)
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
						for _, id := range media.ManagedAssetIDs(string(content.raw)) {
							assets[id] = struct{}{}
						}
					}
				}
			}
			index[module.ID] = assets
		}
	}
	return index
}

type mediaIndexKey struct {
	versionID string
	revision  int64
}

// mediaIndexFor memoizes moduleMediaIndex beside the version cache: keyed by
// the same probed revision, so a republish is a new key, never a stale hit.
// Without the version cache the tree is reloaded per request anyway.
type mediaIndexCache struct {
	mu      sync.Mutex
	entries map[mediaIndexKey]map[string]map[string]struct{}
}

func (s *Service) mediaIndexFor(versionID string, revision int64, sections []DeliverySection) map[string]map[string]struct{} {
	c := s.mediaIndex
	if s.versions == nil || c == nil {
		return moduleMediaIndex(sections)
	}
	key := mediaIndexKey{versionID: versionID, revision: revision}
	c.mu.Lock()
	index, ok := c.entries[key]
	c.mu.Unlock()
	if ok {
		return index
	}
	index = moduleMediaIndex(sections)
	c.mu.Lock()
	// offcut: wholesale reset at the bound; an exam day runs a handful of versions
	if c.entries == nil || len(c.entries) >= VersionCacheMaxVersions {
		c.entries = map[mediaIndexKey]map[string]map[string]struct{}{}
	}
	c.entries[key] = index
	c.mu.Unlock()
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
		`SELECT module_id FROM assessment_module_attempts WHERE attempt_id = ? AND (state <> 'not_started' OR auto_start_at IS NULL)
AND EXISTS (SELECT 1 FROM student_attempts a WHERE a.id=assessment_module_attempts.attempt_id AND
(a.recovery_control IS NULL OR (JSON_UNQUOTE(JSON_EXTRACT(a.recovery_control,'$.phase'))='working' AND
(module_id=JSON_UNQUOTE(JSON_EXTRACT(a.recovery_control,'$.target.moduleId')) OR
(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.recovery_control,'$.target.moduleId')),'')='' AND module_id IN
(SELECT m.id FROM assessment_modules m JOIN assessment_sections s ON s.id=m.section_id
WHERE s.section_key=JSON_UNQUOTE(JSON_EXTRACT(a.recovery_control,'$.target.sectionKey'))))))))`, attemptID)
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
