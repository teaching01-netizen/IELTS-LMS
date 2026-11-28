package satpdflayout

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/objectstore"
)

type Service struct {
	db    *sql.DB
	store objectstore.Store
}

func New(db *sql.DB, store objectstore.Store) *Service {
	return &Service{db: db, store: store}
}

type queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

// loadSaved reads the stored layout row. A missing row is the default
// layout: revision 0, no slides, and the bundled brand marks.
func loadSaved(ctx context.Context, q queryer, examID string) (int64, Layout, sql.NullTime, sql.NullString, error) {
	var revision int64
	var raw []byte
	var updatedAt sql.NullTime
	var updatedBy sql.NullString
	err := q.QueryRowContext(ctx, "SELECT revision, layout, updated_at, updated_by FROM sat_exam_pdf_layouts WHERE exam_id = ?", examID).
		Scan(&revision, &raw, &updatedAt, &updatedBy)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, Layout{Slides: []Slide{}}, sql.NullTime{}, sql.NullString{}, nil
	}
	if err != nil {
		return 0, Layout{}, sql.NullTime{}, sql.NullString{}, err
	}
	layout := Layout{Slides: []Slide{}}
	if err := json.Unmarshal(raw, &layout); err != nil {
		return 0, Layout{}, sql.NullTime{}, sql.NullString{}, err
	}
	if layout.Slides == nil {
		layout.Slides = []Slide{}
	}
	return revision, layout, updatedAt, updatedBy, nil
}

func load(ctx context.Context, q queryer, examID string) (Snapshot, error) {
	revision, layout, _, _, err := loadSaved(ctx, q, examID)
	if err != nil {
		return Snapshot{}, err
	}
	return Snapshot{Revision: revision, Layout: layout}, nil
}

func lockExam(ctx context.Context, tx *sql.Tx, examID string, organization *string) error {
	query := "SELECT id FROM exam_entities WHERE id = ? AND provider_key = 'sat'"
	args := []any{examID}
	if organization != nil {
		query += " AND organization_id = ?"
		args = append(args, *organization)
	}
	var id string
	err := tx.QueryRowContext(ctx, query+" FOR UPDATE", args...).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return apperrors.New(apperrors.CodeNotFound, "SAT exam not found.")
	}
	return err
}

func targets(ctx context.Context, q queryer, examID string) ([]Option, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT s.section_key, s.title, m.module_key, m.title
		FROM exam_entities e
		JOIN assessment_sections s ON s.exam_version_id = COALESCE(e.current_draft_version_id, e.current_published_version_id)
		LEFT JOIN assessment_modules m ON m.section_id = s.id
		WHERE e.id = ?
		ORDER BY s.display_order,s.id,m.display_order,m.id`, examID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := baseOptions()
	seen := make(map[string]bool)
	for rows.Next() {
		var key, title string
		var module, label sql.NullString
		if err := rows.Scan(&key, &title, &module, &label); err != nil {
			return nil, err
		}
		if !seen[key] {
			seen[key] = true
			out = append(out, Option{Target: Target{Kind: "reviewSubject", SectionKey: key}, Label: title})
		}
		if module.Valid {
			name := label.String
			if strings.TrimSpace(name) == "" {
				name = module.String
			}
			if strings.HasSuffix(module.String, "-lower") && !strings.Contains(strings.ToLower(name), "lower") {
				name += " · Lower"
			}
			if strings.HasSuffix(module.String, "-higher") && !strings.Contains(strings.ToLower(name), "higher") {
				name += " · Higher"
			}
			out = append(out, Option{Target: Target{Kind: "reviewModule", SectionKey: key, ModuleKey: module.String}, Label: name})
		}
	}
	return out, rows.Err()
}

func (s *Service) Read(ctx context.Context, examID string) (Editor, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return Editor{}, err
	}
	defer tx.Rollback()
	return readEditor(ctx, tx, examID)
}

func readEditor(ctx context.Context, q queryer, examID string) (Editor, error) {
	revision, layout, updatedAt, updatedBy, err := loadSaved(ctx, q, examID)
	if err != nil {
		return Editor{}, err
	}
	options, err := targets(ctx, q, examID)
	if err != nil {
		return Editor{}, err
	}
	assets, err := assetsFor(ctx, q, examID, layout, false)
	if err != nil {
		return Editor{}, err
	}
	editor := Editor{Snapshot: Snapshot{Revision: revision, Layout: layout}, Targets: options, Assets: assets}
	if updatedAt.Valid {
		saved := updatedAt.Time.UTC()
		editor.UpdatedAt = &saved
	}
	if updatedBy.Valid {
		editor.UpdatedBy = updatedBy.String
	}
	return editor, nil
}

func validateTargets(layout, saved Layout, options []Option) error {
	available := make(map[Target]bool, len(options))
	for _, option := range options {
		available[option.Target] = true
	}
	old := make(map[string]Slide, len(saved.Slides))
	for _, slide := range saved.Slides {
		old[slide.ID] = slide
	}
	for _, slide := range layout.Slides {
		previous := old[slide.ID]
		if !available[slide.Target] && (previous.Target != slide.Target || previous.Side != slide.Side) {
			return slideIssue(slide.ID, "Choose a placement from the current exam outline.")
		}
	}
	return nil
}

func (s *Service) Save(ctx context.Context, examID, actorID string, organization *string, expected int64, layout Layout) (Editor, error) {
	layout, err := layout.normalize()
	if err != nil {
		return Editor{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Editor{}, err
	}
	defer tx.Rollback()
	if err := lockExam(ctx, tx, examID, organization); err != nil {
		return Editor{}, err
	}
	current, err := readEditor(ctx, tx, examID)
	if err != nil {
		return Editor{}, err
	}
	if reflect.DeepEqual(layout, current.Layout) {
		return current, nil
	}
	if expected != current.Revision {
		conflict := apperrors.New(apperrors.CodeConflict, "Another person changed this layout.")
		conflict.Details = map[string]any{"currentRevision": current.Revision}
		return Editor{}, conflict
	}
	if err := validateTargets(layout, current.Layout, current.Targets); err != nil {
		return Editor{}, err
	}
	live, err := assetsFor(ctx, tx, examID, layout, true)
	if err != nil {
		return Editor{}, err
	}
	for _, asset := range live {
		if _, err = tx.ExecContext(ctx, "UPDATE sat_exam_pdf_assets SET expires_at = NULL WHERE id = ?", asset.ID); err != nil {
			return Editor{}, err
		}
	}
	for _, asset := range current.Assets {
		if slices.ContainsFunc(live, func(next Asset) bool { return next.ID == asset.ID }) {
			continue
		}
		if _, err = tx.ExecContext(ctx, "UPDATE sat_exam_pdf_assets SET expires_at = UTC_TIMESTAMP(6) + INTERVAL 24 HOUR WHERE id = ?", asset.ID); err != nil {
			return Editor{}, err
		}
	}
	raw, err := json.Marshal(layout)
	if err != nil {
		return Editor{}, err
	}
	revision := current.Revision + 1
	if _, err := tx.ExecContext(ctx, `INSERT INTO sat_exam_pdf_layouts (exam_id, revision, layout, updated_by)
		VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE revision=?, layout=?, updated_by=?, updated_at=UTC_TIMESTAMP(6)`,
		examID, revision, raw, actorID, revision, raw, actorID); err != nil {
		return Editor{}, err
	}
	if err := tx.Commit(); err != nil {
		return Editor{}, err
	}
	savedAt := time.Now().UTC()
	return Editor{
		Snapshot:  Snapshot{Revision: revision, Layout: layout},
		Targets:   current.Targets,
		Assets:    live,
		UpdatedAt: &savedAt,
		UpdatedBy: actorID,
	}, nil
}

func (s *Service) ResolveSaved(ctx context.Context, examID string, visible map[Target]bool, scoreAllowed func(*sql.Tx) (bool, error)) (*Resolved, error) {
	return s.resolve(ctx, examID, nil, visible, scoreAllowed)
}

func (s *Service) ResolvePreview(ctx context.Context, examID string, draft *Layout, visible map[Target]bool) (*Resolved, error) {
	return s.resolve(ctx, examID, draft, visible, nil)
}

func (s *Service) resolve(ctx context.Context, examID string, draft *Layout, visible map[Target]bool, scoreAllowed func(*sql.Tx) (bool, error)) (*Resolved, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	saved, err := load(ctx, tx, examID)
	if err != nil {
		return nil, err
	}
	if draft != nil {
		layout, err := draft.normalize()
		if err != nil {
			return nil, err
		}
		options, err := targets(ctx, tx, examID)
		if err != nil {
			return nil, err
		}
		if err := validateTargets(layout, saved.Layout, options); err != nil {
			return nil, err
		}
		if _, err := assetsFor(ctx, tx, examID, layout, false); err != nil {
			return nil, err
		}
		saved.Layout = layout
	}
	score := Target{Kind: "scoreReport"}
	if scoreAllowed != nil && visible[score] && slices.ContainsFunc(saved.Layout.Slides, func(slide Slide) bool { return slide.Target == score }) {
		visible[score], err = scoreAllowed(tx)
		if err != nil {
			return nil, err
		}
	}
	saved.Layout = saved.Layout.visible(visible)
	if saved.Layout.empty() {
		return nil, nil
	}
	assets, err := assetsFor(ctx, tx, examID, saved.Layout, false)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	images := make(map[string]string, len(assets))
	for _, asset := range assets {
		body, err := s.readObject(ctx, asset)
		if err != nil {
			return nil, err
		}
		images[asset.ID] = fmt.Sprintf("data:%s;base64,%s", asset.ContentType, base64.StdEncoding.EncodeToString(body))
	}
	return &Resolved{Snapshot: saved, Images: images}, nil
}
