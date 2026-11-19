package answeredpdf

import (
	"bytes"
	"encoding/json"
	"fmt"
	"time"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/satlearning"
	"example.com/ielts-proctoring/internal/satpdflayout"
)

func IncludesScore(view json.RawMessage) bool {
	view = bytes.TrimSpace(view)
	return len(view) > 0 && !bytes.Equal(view, []byte("null"))
}

// VisibleLayoutTargets follows the same administered modules and released key
// projection as AnsweredExamPaper. Resolve these targets before any layout
// images enter the print payload.
func VisibleLayoutTargets(exam *delivery.AnsweredExam, score bool) map[satpdflayout.Target]bool {
	targets := map[satpdflayout.Target]bool{
		{Kind: "cover"}:         true,
		{Kind: "answerSummary"}: true,
		{Kind: "scoreReport"}:   score,
	}
	started := make(map[string]bool)
	for _, attempt := range exam.Attempt.ModuleAttempts {
		if attempt.StartedAt != nil {
			started[attempt.ModuleID] = true
		}
	}
	printed := make(map[string]bool)
	for _, section := range exam.Sections {
		for _, module := range section.Modules {
			if !started[module.ID] || module.ContentWithheld {
				continue
			}
			printed[module.ID] = true
			targets[satpdflayout.Target{Kind: "examReview"}] = true
			targets[satpdflayout.Target{Kind: "reviewSubject", SectionKey: section.SectionKey}] = true
			targets[satpdflayout.Target{Kind: "reviewModule", SectionKey: section.SectionKey, ModuleKey: module.ModuleKey}] = true
		}
	}
	if exam.AnswerKey != nil && exam.AnswerKey.Available {
		for _, entry := range exam.AnswerKey.Entries {
			if printed[entry.ModuleID] && entry.ExamQuestionID != "" && entry.CorrectAnswers != nil &&
				(entry.Result == "correct" || entry.Result == "incorrect" || entry.Result == "unanswered") {
				targets[satpdflayout.Target{Kind: "answerKey"}] = true
				break
			}
		}
	}
	return targets
}

func LayoutSample(title string, targets []satpdflayout.Option, answerKey bool) (*delivery.AnsweredExam, json.RawMessage) {
	exam := &delivery.AnsweredExam{
		ExamTitle: title, CandidateName: "Sample Student",
		Sections: []delivery.DeliverySection{},
		Attempt:  delivery.AttemptSnapshot{ModuleAttempts: []delivery.ModuleAttempt{}, Responses: []delivery.ResponseSnapshot{}},
	}
	if answerKey {
		exam.AnswerKey = &delivery.AnsweredExamAnswerKey{Available: true, Entries: []delivery.AnsweredExamKeyEntry{}}
	}
	now := time.Unix(0, 0).UTC()
	indices := make(map[string]int)
	for _, option := range targets {
		target := option.Target
		switch target.Kind {
		case "reviewSubject":
			indices[target.SectionKey] = len(exam.Sections)
			exam.Sections = append(exam.Sections, delivery.DeliverySection{
				ID: target.SectionKey, SectionKey: target.SectionKey, Title: option.Label, Modules: []delivery.DeliveryModule{},
			})
		case "reviewModule":
			index, ok := indices[target.SectionKey]
			if !ok {
				continue
			}
			section := &exam.Sections[index]
			id := fmt.Sprintf("sample-%d-%d", index, len(section.Modules))
			section.Modules = append(section.Modules, delivery.DeliveryModule{
				ID: id, ModuleKey: target.ModuleKey, Title: option.Label, DisplayOrder: len(section.Modules),
				Questions: []delivery.DeliveredQuestion{{
					ExamQuestionID: id, QuestionID: id, QuestionType: "single_choice",
					Prompt: json.RawMessage(`{"version":1,"nodes":[{"type":"paragraph","id":"sample-prompt","text":"Which number equals 2 + 2?"}]}`),
					Answer: json.RawMessage(`{"kind":"single_choice","options":[{"id":"a","content":{"version":1,"nodes":[{"type":"paragraph","id":"sample-a","text":"4"}]}},{"id":"b","content":{"version":1,"nodes":[{"type":"paragraph","id":"sample-b","text":"5"}]}}]}`),
				}},
			})
			exam.Attempt.ModuleAttempts = append(exam.Attempt.ModuleAttempts, delivery.ModuleAttempt{ID: id, ModuleID: id, StartedAt: &now})
			if exam.AnswerKey != nil {
				exam.AnswerKey.Entries = append(exam.AnswerKey.Entries, delivery.AnsweredExamKeyEntry{
					ModuleID: id, ExamQuestionID: id, Result: "unanswered",
					CorrectAnswers: []satlearning.AnswerKeyAnswer{{Label: "A", Text: "4"}},
				})
			}
		}
	}
	view := json.RawMessage(`{"primaryLabel":"Sample score","primaryScore":{"kind":"raw","correct":1,"total":2},"subjects":[{"key":"math","label":"Sample result","score":{"kind":"raw","correct":1,"total":2},"rawCorrect":1,"rawTotal":2,"modules":[],"domains":[]}],"mode":"test"}`)
	return exam, view
}
