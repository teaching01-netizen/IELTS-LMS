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
			question, correct := sampleQuestion(id, target.SectionKey)
			section.Modules = append(section.Modules, delivery.DeliveryModule{
				ID: id, ModuleKey: target.ModuleKey, Title: option.Label, DisplayOrder: len(section.Modules),
				Questions: []delivery.DeliveredQuestion{question},
			})
			exam.Attempt.ModuleAttempts = append(exam.Attempt.ModuleAttempts, delivery.ModuleAttempt{ID: id, ModuleID: id, StartedAt: &now})
			exam.Attempt.Responses = append(exam.Attempt.Responses, delivery.ResponseSnapshot{
				ModuleAttemptID: id, ExamQuestionID: id, Response: json.RawMessage(`"a"`),
			})
			if exam.AnswerKey != nil {
				exam.AnswerKey.Entries = append(exam.AnswerKey.Entries, delivery.AnsweredExamKeyEntry{
					ModuleID: id, ExamQuestionID: id, Result: "correct",
					CorrectAnswers: []satlearning.AnswerKeyAnswer{{Label: "A", Text: correct}},
				})
			}
		}
	}
	view := sampleView(exam)
	return exam, view
}

// sampleView makes the example internally consistent: every sample question is
// answered correctly, so the summary, the subject rows and the answer key all
// report the same perfect raw result instead of a hardcoded fraction.
func sampleView(exam *delivery.AnsweredExam) json.RawMessage {
	subjects := []map[string]any{}
	correctTotal, questionTotal := 0, 0
	for _, section := range exam.Sections {
		modules := []map[string]any{}
		correct, total := 0, 0
		for _, module := range section.Modules {
			count := len(module.Questions)
			if count == 0 {
				continue
			}
			correct += count
			total += count
			modules = append(modules, map[string]any{
				"key": module.ModuleKey, "label": module.Title,
				"rawCorrect": count, "rawTotal": count,
			})
		}
		if total == 0 {
			continue
		}
		correctTotal += correct
		questionTotal += total
		subjects = append(subjects, map[string]any{
			"key": section.SectionKey, "label": section.Title,
			"score":      map[string]any{"kind": "raw", "correct": correct, "total": total},
			"rawCorrect": correct, "rawTotal": total,
			"modules": modules, "domains": []any{},
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
		"notice":            "Sample report: every question is answered correctly.",
		"methodology":       map[string]any{"isEstimated": false, "converterVersion": nil},
		"mode":              "test",
		"assistance":        map[string]any{"revealAnswers": false, "untimed": false},
		"issues":            []any{},
	}
	out, _ := json.Marshal(view)
	return out
}

func sampleQuestion(id, subject string) (delivery.DeliveredQuestion, string) {
	prompt := "If 3x + 5 = 20, what is the value of x?"
	choices := []string{"5", "7", "15", "25"}
	stimulus := ""
	if subject == "reading-writing" {
		stimulus = "The museum extended its hours during the summer. This gave visitors more time to explore the exhibits."
		prompt = "Which choice best describes the relationship between the two sentences?"
		choices = []string{"The second sentence explains an effect of the first.", "The second sentence introduces a contrasting idea.", "The second sentence restates the same information.", "The second sentence questions the first."}
	}
	type paragraph struct {
		Type string `json:"type"`
		ID   string `json:"id"`
		Text string `json:"text"`
	}
	content := func(id, text string) map[string]any {
		return map[string]any{"version": 1, "nodes": []paragraph{{Type: "paragraph", ID: id, Text: text}}}
	}
	options := make([]map[string]any, len(choices))
	for i, choice := range choices {
		key := string(rune('a' + i))
		options[i] = map[string]any{"id": key, "content": content(key, choice)}
	}
	// These payloads contain only strings, slices and maps of JSON values.
	answer, _ := json.Marshal(map[string]any{"kind": "single_choice", "options": options})
	promptJSON, _ := json.Marshal(content("prompt", prompt))
	question := delivery.DeliveredQuestion{
		ExamQuestionID: id, QuestionID: id, QuestionType: "single_choice", Prompt: promptJSON, Answer: answer,
	}
	if stimulus != "" {
		question.Stimulus, _ = json.Marshal(content("stimulus", stimulus))
	}
	return question, choices[0]
}
