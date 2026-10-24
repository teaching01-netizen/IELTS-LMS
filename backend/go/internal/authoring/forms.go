package authoring

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"

	"example.com/ielts-proctoring/internal/assessmentforms/definition"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// FormLimits mirrors the definition bounds so the editor never hardcodes them.
type FormLimits struct {
	MaxFields          int `json:"maxFields"`
	MaxOptions         int `json:"maxOptions"`
	MaxLabelChars      int `json:"maxLabelChars"`
	MaxHelpChars       int `json:"maxHelpChars"`
	MaxTextAnswerChars int `json:"maxTextAnswerChars"`
	MaxURLChars        int `json:"maxUrlChars"`
}

// ExamForms is the authoring projection of a version's forms subtree. Forms
// is nil for a legacy/unconfigured version; Standard carries the default SAT
// fields for the explicit "Add standard SAT fields" action.
type ExamForms struct {
	VersionID       string             `json:"versionId"`
	VersionRevision int                `json:"versionRevision"`
	Editable        bool               `json:"editable"`
	Forms           *definition.Forms  `json:"forms"`
	Standard        definition.Forms   `json:"standard"`
	Issues          []definition.Issue `json:"issues"`
	Limits          FormLimits         `json:"limits"`
}

type SaveFormsRequest struct {
	ExpectedVersionID string          `json:"expectedVersionId"`
	ExpectedRevision  int             `json:"expectedRevision"`
	Forms             json.RawMessage `json:"forms"`
	// AppHosts are the application's own hosts; an embed URL may not target
	// them. Supplied by the HTTP boundary, never by the client.
	AppHosts []string `json:"-"`
}

func formLimits() FormLimits {
	return FormLimits{
		MaxFields: definition.MaxFields, MaxOptions: definition.MaxOptions, MaxLabelChars: definition.MaxLabelChars,
		MaxHelpChars: definition.MaxHelpChars, MaxTextAnswerChars: definition.MaxTextAnswerChars, MaxURLChars: definition.MaxURLChars,
	}
}

func formsProjection(versionID string, revision int, editable bool, config string) (ExamForms, error) {
	forms, err := definition.FromSnapshot([]byte(config))
	if err != nil {
		return ExamForms{}, apperrors.New(apperrors.CodeInvalidAssessment, "Stored registration or Eva SIM settings are invalid.")
	}
	out := ExamForms{VersionID: versionID, VersionRevision: revision, Editable: editable, Forms: forms,
		Standard: definition.DefaultSectionSATForms(), Issues: []definition.Issue{}, Limits: formLimits()}
	if forms != nil {
		out.Issues = append(out.Issues, forms.ReadinessIssues()...)
	}
	return out, nil
}

// GetForms returns the current draft's forms, or the pinned published
// version's as read-only when no draft exists. GET never creates a draft.
func (s *Service) GetForms(ctx context.Context, examID string) (ExamForms, error) {
	var draftID, publishedID, versionID, config sql.NullString
	var isDraft, isPublished sql.NullBool
	var revision sql.NullInt64
	err := s.db.QueryRowContext(ctx, `
SELECT e.current_draft_version_id, e.current_published_version_id,
       v.id, v.is_draft, v.is_published, v.revision, CAST(v.config_snapshot AS CHAR)
FROM exam_entities e
LEFT JOIN exam_versions v
  ON v.id = COALESCE(NULLIF(e.current_draft_version_id, ''), NULLIF(e.current_published_version_id, ''))
 AND v.exam_id = e.id
WHERE e.id = ?`, examID).Scan(&draftID, &publishedID, &versionID, &isDraft, &isPublished, &revision, &config)
	if err == sql.ErrNoRows {
		return ExamForms{}, examNotFoundError("Exam not found.")
	}
	if err != nil {
		return ExamForms{}, err
	}
	editable := false
	if draftID.Valid && strings.TrimSpace(draftID.String) != "" {
		if !versionID.Valid || !isDraft.Valid || !isDraft.Bool {
			return ExamForms{}, draftIntegrityError(examID, strings.TrimSpace(draftID.String))
		}
		editable = true
	} else if publishedID.Valid && strings.TrimSpace(publishedID.String) != "" {
		if !versionID.Valid || !isPublished.Valid || !isPublished.Bool {
			return ExamForms{}, notFoundError("The exam's published version is missing.")
		}
	} else {
		return ExamForms{}, conflictError("The exam has no current draft or published version.")
	}
	return formsProjection(versionID.String, int(revision.Int64), editable, config.String)
}

func formDraftChanged(versionID string, revision int) *apperrors.Error {
	e := conflictError("Settings changed in another session. Load the latest version before saving.")
	e.Details = map[string]any{"reason": "FORM_DRAFT_CHANGED", "versionId": versionID, "versionRevision": revision}
	return e
}

func formValidationError(issues []definition.Issue) *apperrors.Error {
	e := validationError(issues[0].Message)
	fields := map[string]string{}
	for _, issue := range issues {
		if _, ok := fields[issue.Path]; !ok {
			fields[issue.Path] = issue.Message
		}
	}
	e.Details = map[string]any{"path": issues[0].Path, "fields": fields}
	return e
}

// SaveForms merges only the owned forms property into the locked current
// draft under an exact version/revision fence and advances the draft revision
// (which invalidates readiness). Unrelated config keys are never replaced.
func (s *Service) SaveForms(ctx context.Context, examID string, req SaveFormsRequest) (ExamForms, error) {
	forms, issues := definition.Parse(req.Forms)
	if len(issues) > 0 {
		return ExamForms{}, formValidationError(issues)
	}
	if forms.EvaSim.Mode == definition.ModeEmbed && strings.TrimSpace(forms.EvaSim.URL) != "" {
		canonical, _ := definition.CanonicalEmbedURL(forms.EvaSim.URL)
		if definition.SameHost(canonical, req.AppHosts...) {
			return ExamForms{}, formValidationError([]definition.Issue{{Path: "evaSim.url", Message: "The form URL cannot point to this SAT system."}})
		}
		forms.EvaSim.URL = canonical
	} else if forms.EvaSim.Mode == definition.ModeEmbed {
		forms.EvaSim.URL = ""
	}
	encoded, err := json.Marshal(forms)
	if err != nil {
		return ExamForms{}, err
	}
	var out ExamForms
	err = s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		var draftID, config string
		var revision int
		err := q.QueryRowContext(ctx, "SELECT v.id, v.revision, CAST(v.config_snapshot AS CHAR) FROM exam_versions v JOIN exam_entities e ON e.id = v.exam_id WHERE v.exam_id = ? AND v.is_draft = TRUE AND e.current_draft_version_id = v.id FOR UPDATE", examID).Scan(&draftID, &revision, &config)
		if err == sql.ErrNoRows {
			return formDraftChanged("", 0)
		}
		if err != nil {
			return err
		}
		if draftID != strings.TrimSpace(req.ExpectedVersionID) || revision != req.ExpectedRevision {
			return formDraftChanged(draftID, revision)
		}
		top := map[string]json.RawMessage{}
		if strings.TrimSpace(config) != "" {
			if err := json.Unmarshal([]byte(config), &top); err != nil || top == nil {
				return validationError("Draft configuration must be a JSON object.")
			}
		}
		top[definition.SnapshotKey] = encoded
		merged, err := json.Marshal(top)
		if err != nil {
			return err
		}
		res, err := q.ExecContext(ctx, "UPDATE exam_versions SET config_snapshot = ?, revision = revision + 1 WHERE id = ? AND revision = ?", string(merged), draftID, revision)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return formDraftChanged(draftID, revision)
		}
		out, err = formsProjection(draftID, revision+1, true, string(merged))
		return err
	})
	return out, err
}
