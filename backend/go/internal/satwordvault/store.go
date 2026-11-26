// Package satwordvault owns the vocabulary snapshot attached to a SAT version.
package satwordvault

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"
)

type Entry struct {
	ModuleKey  string `json:"moduleKey"`
	QuestionID string `json:"questionId"`
	Word       string `json:"word"`
	Thai       string `json:"thai"`
	Definition string `json:"definition"`
	Example    string `json:"example"`
}

type PrintedEntry struct {
	ModuleKey  string `json:"moduleKey"`
	Module     string `json:"module"`
	Question   int    `json:"question"`
	Word       string `json:"word"`
	Thai       string `json:"thai"`
	Definition string `json:"definition"`
	Example    string `json:"example"`
}

type Queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

type Writer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func Load(ctx context.Context, q Queryer, versionID string) ([]Entry, error) {
	rows, err := q.QueryContext(ctx, "SELECT entries FROM sat_word_vaults WHERE exam_version_id = ?", versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, rows.Err()
	}
	var raw []byte
	if err := rows.Scan(&raw); err != nil {
		return nil, err
	}
	var entries []Entry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, err
	}
	return entries, nil
}

// Replace is called while the current draft is locked by the authoring transaction.
func Replace(ctx context.Context, q Writer, versionID string, entries []Entry) error {
	if len(entries) == 0 {
		_, err := q.ExecContext(ctx, "DELETE FROM sat_word_vaults WHERE exam_version_id = ?", versionID)
		return err
	}
	payload, err := json.Marshal(entries)
	if err != nil {
		return err
	}
	_, err = q.ExecContext(ctx, "INSERT INTO sat_word_vaults (exam_version_id, entries) VALUES (?, ?) ON DUPLICATE KEY UPDATE entries = ?", versionID, string(payload), string(payload))
	return err
}

func Copy(ctx context.Context, q Writer, source, target string) error {
	_, err := q.ExecContext(ctx, "INSERT INTO sat_word_vaults (exam_version_id, entries) SELECT ?, entries FROM sat_word_vaults WHERE exam_version_id = ?", target, source)
	return err
}

type Question struct {
	ID     string
	Number int
}

type Module struct {
	Key, Title string
	Questions  []Question
}

// Modules loads the complete Reading & Writing question roster, including both
// adaptive branches. The print renderer assigns the same order-based ordinals.
func Modules(ctx context.Context, q Queryer, versionID string) ([]Module, error) {
	query := `SELECT m.module_key, m.title, eq.question_id
		FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id
		LEFT JOIN assessment_exam_questions eq ON eq.module_id = m.id
		WHERE s.exam_version_id = ? AND s.section_key = 'reading-writing'
		ORDER BY s.display_order, m.display_order, m.module_key, eq.display_order, eq.id`
	rows, err := q.QueryContext(ctx, query, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var modules []Module
	for rows.Next() {
		var key, title string
		var id sql.NullString
		if err := rows.Scan(&key, &title, &id); err != nil {
			return nil, err
		}
		if len(modules) == 0 || modules[len(modules)-1].Key != key {
			modules = append(modules, Module{Key: key, Title: title})
		}
		if id.Valid {
			module := &modules[len(modules)-1]
			module.Questions = append(module.Questions, Question{ID: id.String, Number: len(module.Questions) + 1})
		}
	}
	return modules, rows.Err()
}

func Resolve(entries []Entry, modules []Module) ([]PrintedEntry, int) {
	order := make(map[string]int, len(modules))
	for index, module := range modules {
		order[module.Key] = index
	}
	var printed []PrintedEntry
	stale := 0
	for _, entry := range entries {
		index, exists := order[entry.ModuleKey]
		number := 0
		if exists {
			for _, question := range modules[index].Questions {
				if question.ID == entry.QuestionID {
					if number != 0 {
						number = 0
						break
					}
					number = question.Number
				}
			}
		}
		if number == 0 {
			stale++
			continue
		}
		printed = append(printed, PrintedEntry{
			ModuleKey: entry.ModuleKey, Module: modules[index].Title, Question: number,
			Word: entry.Word, Thai: entry.Thai, Definition: entry.Definition, Example: entry.Example,
		})
	}
	sort.SliceStable(printed, func(i, j int) bool { return order[printed[i].ModuleKey] < order[printed[j].ModuleKey] })
	return printed, stale
}

func Read(ctx context.Context, q Queryer, versionID string) ([]PrintedEntry, int, error) {
	entries, err := Load(ctx, q, versionID)
	if err != nil || len(entries) == 0 {
		return nil, 0, err
	}
	modules, err := Modules(ctx, q, versionID)
	if err != nil {
		return nil, 0, err
	}
	printed, stale := Resolve(entries, modules)
	return printed, stale, nil
}
