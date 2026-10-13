package results

import (
	"context"
	"database/sql"
	"strings"
)

// SATDomainAccuracy is raw operational-question accuracy for one section +
// question domain (assessment_question_revisions.metadata.domain). It is a
// raw classroom measure, not an official College Board skill band.
type SATDomainAccuracy struct {
	SectionKey string `json:"sectionKey"`
	Domain     string `json:"domain"`
	Correct    int    `json:"correct"`
	Total      int    `json:"total"`
}

// SATDomainAccuracyQ groups the attempt's administered operational questions
// by domain, using the same authoritative verdicts as the staff result view.
// Questions without domain metadata are left out rather than bucketed.
func SATDomainAccuracyQ(ctx context.Context, db rowQuerier, attemptID string) ([]SATDomainAccuracy, error) {
	questions, err := satQuestionsQ(ctx, db, attemptID)
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `
		SELECT s.section_key, m.module_key, eq.question_id,
			COALESCE(JSON_UNQUOTE(JSON_EXTRACT(qr.metadata, '$.domain')), '')
		FROM assessment_module_attempts ma
		JOIN assessment_modules m ON m.id = ma.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		JOIN assessment_exam_questions eq ON eq.module_id = m.id
		JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id
		WHERE ma.attempt_id = ?`, attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	domains := map[[3]string]string{}
	for rows.Next() {
		var section, module, question string
		var domain sql.NullString
		if err := rows.Scan(&section, &module, &question, &domain); err != nil {
			return nil, err
		}
		domains[[3]string{section, module, question}] = strings.TrimSpace(domain.String)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := []SATDomainAccuracy{}
	index := map[[2]string]int{}
	for _, q := range questions {
		domain := domains[[3]string{q.SectionKey, q.ModuleKey, q.QuestionID}]
		if q.IsPretest || domain == "" || domain == "null" {
			continue
		}
		key := [2]string{q.SectionKey, domain}
		i, ok := index[key]
		if !ok {
			i = len(out)
			index[key] = i
			out = append(out, SATDomainAccuracy{SectionKey: q.SectionKey, Domain: domain})
		}
		out[i].Total++
		if q.IsCorrect != nil && *q.IsCorrect {
			out[i].Correct++
		}
	}
	return out, nil
}
