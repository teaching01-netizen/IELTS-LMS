package delivery

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"example.com/ielts-proctoring/internal/assessscore"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/satlearning"
)

// SampleAnsweredExam builds the authoring example from the exam's real
// version: every question is answered with its correct answer, so the review,
// the summary and the answer key describe the same paper.
//
// This is not an attempt. It returns a print projection only, with a synthetic
// "sample" attempt id and module attempts marked started so the paper prints
// every module. A question without a usable correct answer refuses the sample
// instead of printing a paper that is not actually all-correct.
func (s *Service) SampleAnsweredExam(ctx context.Context, versionID, examID, examTitle, candidateName string) (*AnsweredExam, json.RawMessage, error) {
	sections, err := s.LoadSectionsBulk(ctx, versionID)
	if err != nil {
		return nil, nil, err
	}
	answers, err := s.sampleAnswers(ctx, versionID)
	if err != nil {
		return nil, nil, err
	}
	return buildSampleAnsweredExam(versionID, examID, examTitle, candidateName, sections, answers)
}

// buildSampleAnsweredExam assembles the projection from a loaded tree and its
// answer map, so the assembly can be tested without a database.
func buildSampleAnsweredExam(versionID, examID, examTitle, candidateName string, sections []DeliverySection, answers map[string]sampleAnswer) (*AnsweredExam, json.RawMessage, error) {
	exam := &AnsweredExam{
		ExamID: examID, AttemptID: "sample", ExamTitle: examTitle,
		CandidateName: candidateName, VersionID: versionID, Sections: sections,
		AnswerKey: &AnsweredExamAnswerKey{Available: true, VersionID: versionID, Entries: []AnsweredExamKeyEntry{}},
	}
	started := time.Unix(0, 0).UTC()
	for _, section := range sections {
		for _, module := range section.Modules {
			if len(module.Questions) == 0 {
				continue
			}
			exam.Attempt.ModuleAttempts = append(exam.Attempt.ModuleAttempts, ModuleAttempt{
				ID: module.ID, ModuleID: module.ID, StartedAt: &started,
			})
			for _, question := range module.Questions {
				answer, ok := answers[question.ExamQuestionID]
				if !ok {
					return nil, nil, apperrors.New(apperrors.CodeValidation, fmt.Sprintf(
						"This exam has a question without a correct answer (%s, question %d). Finish it before downloading an example.",
						module.Title, question.DisplayOrder+1))
				}
				exam.Attempt.Responses = append(exam.Attempt.Responses, ResponseSnapshot{
					ModuleAttemptID: module.ID, ExamQuestionID: question.ExamQuestionID, Response: answer.response,
				})
				exam.AnswerKey.Entries = append(exam.AnswerKey.Entries, AnsweredExamKeyEntry{
					ModuleID: module.ID, ExamQuestionID: question.ExamQuestionID,
					CorrectAnswers: answer.key, Result: "correct",
				})
			}
		}
	}
	if len(exam.Attempt.Responses) == 0 {
		return nil, nil, apperrors.New(apperrors.CodeValidation, "Add questions to this exam before downloading a score report example.")
	}
	return exam, sampleViewFromSections(sections), nil
}

type sampleAnswer struct {
	key      []satlearning.AnswerKeyAnswer
	response json.RawMessage
}

// sampleAnswers reads the version's answer definitions once. The response is
// the same value the grader compares: the correct option id for a choice, or
// the first accepted response for a numeric answer.
func (s *Service) sampleAnswers(ctx context.Context, versionID string) (map[string]sampleAnswer, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT m.title, eq.display_order, eq.id, CAST(qr.answer_definition AS CHAR)
		FROM assessment_modules m
		JOIN assessment_sections s ON s.id = m.section_id
		JOIN assessment_exam_questions eq ON eq.module_id = m.id
		JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id
		WHERE s.exam_version_id = ?
		ORDER BY s.display_order, m.display_order, eq.display_order`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]sampleAnswer)
	for rows.Next() {
		var moduleTitle string
		var displayOrder int
		var examQuestionID, answerJSON string
		if err := rows.Scan(&moduleTitle, &displayOrder, &examQuestionID, &answerJSON); err != nil {
			return nil, err
		}
		var definition answerKeyDefinition
		if err := json.Unmarshal([]byte(answerJSON), &definition); err != nil {
			return nil, apperrors.New(apperrors.CodeAnswerKeyUnavailable, "This paper's answer key is unavailable.")
		}
		key, ok := correctAnswers(definition)
		if !ok {
			return nil, apperrors.New(apperrors.CodeValidation, fmt.Sprintf(
				"This exam has a question without a correct answer (%s, question %d). Finish it before downloading an example.",
				moduleTitle, displayOrder+1))
		}
		correct, ok := assessscore.SATCorrectAnswer(answerJSON)
		if !ok {
			return nil, apperrors.New(apperrors.CodeValidation, fmt.Sprintf(
				"This exam has a question without a correct answer (%s, question %d). Finish it before downloading an example.",
				moduleTitle, displayOrder+1))
		}
		response, err := json.Marshal(correct)
		if err != nil {
			return nil, err
		}
		out[examQuestionID] = sampleAnswer{key: key, response: response}
	}
	return out, rows.Err()
}

// sampleDomainLabels maps the stored taxonomy keys to the labels the report
// prints. An unrecognised value is already a label and passes through.
var sampleDomainLabels = map[string]string{
	"information-and-ideas":             "Information and Ideas",
	"craft-and-structure":               "Craft and Structure",
	"expression-of-ideas":               "Expression of Ideas",
	"standard-english-conventions":      "Standard English Conventions",
	"algebra":                           "Algebra",
	"advanced-math":                     "Advanced Math",
	"problem-solving-and-data-analysis": "Problem-Solving and Data Analysis",
	"geometry-and-trigonometry":         "Geometry and Trigonometry",
}

func sampleDomainLabel(domain string) string {
	if label, ok := sampleDomainLabels[domain]; ok {
		return label
	}
	return domain
}

// sampleViewFromSections is the perfect-score presentation of the real paper.
// Counts and domains come from the version, so the example's report matches
// the questions it prints.
func sampleViewFromSections(sections []DeliverySection) json.RawMessage {
	subjects := []map[string]any{}
	correctTotal, questionTotal := 0, 0
	type metadata struct {
		Domain string `json:"domain"`
	}
	for _, section := range sections {
		modules := []map[string]any{}
		correct, total := 0, 0
		domains := []string{}
		domainCount := map[string]int{}
		for _, module := range section.Modules {
			if len(module.Questions) == 0 {
				continue
			}
			count := len(module.Questions)
			correct += count
			total += count
			modules = append(modules, map[string]any{
				"key": module.ModuleKey, "label": module.Title,
				"rawCorrect": count, "rawTotal": count,
			})
			for _, question := range module.Questions {
				var meta metadata
				_ = json.Unmarshal(question.Metadata, &meta)
				if meta.Domain == "" {
					continue
				}
				name := sampleDomainLabel(meta.Domain)
				if _, seen := domainCount[name]; !seen {
					domains = append(domains, name)
				}
				domainCount[name]++
			}
		}
		if total == 0 {
			continue
		}
		correctTotal += correct
		questionTotal += total
		domainRows := make([]map[string]any, 0, len(domains))
		for _, name := range domains {
			domainRows = append(domainRows, map[string]any{
				"name": name, "correct": domainCount[name], "total": domainCount[name], "accuracy": 100,
			})
		}
		subjects = append(subjects, map[string]any{
			"key": section.SectionKey, "label": section.Title,
			"score":      map[string]any{"kind": "raw", "correct": correct, "total": total},
			"rawCorrect": correct, "rawTotal": total,
			"modules": modules, "domains": domainRows,
		})
	}
	layout := "partial-results"
	switch {
	case len(subjects) >= 2:
		layout = "full-sat"
	case len(subjects) == 1:
		layout = "single-subject"
	}
	view := map[string]any{
		"layout":            layout,
		"title":             "Score report & exam review",
		"primaryLabel":      "Raw score",
		"primaryScore":      map[string]any{"kind": "raw", "correct": correctTotal, "total": questionTotal},
		"subjects":          subjects,
		"showCombinedScore": len(subjects) >= 2,
		"notice":            "Sample report built from this exam: every question is answered correctly.",
		"methodology":       map[string]any{"isEstimated": false, "converterVersion": nil},
		"mode":              "test",
		"assistance":        map[string]any{"revealAnswers": false, "untimed": false},
		"issues":            []any{},
	}
	out, _ := json.Marshal(view)
	return out
}
