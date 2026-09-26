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
	for _, section := range sections {
		if scope != nil && !examdomain.AllowsSection(scope, section.SectionKey) {
			continue
		}
		for _, module := range section.Modules {
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
						if ref.AssetID == assetID {
							return true, nil
						}
					}
				}
			}
		}
	}
	return false, nil
}
