package delivery

import (
	"database/sql"
	"encoding/json"
	"example.com/ielts-proctoring/internal/assessscore"
	"example.com/ielts-proctoring/internal/satlearning"
	"strings"
)

type answerKeyDefinition struct {
	Kind             string   `json:"kind"`
	CorrectOptionID  string   `json:"correctOptionId"`
	CorrectOptionAlt string   `json:"correct_option_id"`
	Accepted         []string `json:"acceptedResponses"`
	AcceptedAlt      []string `json:"accepted_responses"`
	Options          []struct {
		ID      string          `json:"id"`
		Content json.RawMessage `json:"content"`
	} `json:"options"`
}

func correctAnswers(definition answerKeyDefinition) ([]satlearning.AnswerKeyAnswer, bool) {
	switch definition.Kind {
	case "single_choice":
		correctID := definition.CorrectOptionID
		if correctID == "" {
			correctID = definition.CorrectOptionAlt
		}
		if correctID == "" {
			return nil, false
		}
		labels := assessscore.SATChoiceLabelsFromDefinition(definition.Kind, choiceOptions(definition.Options))
		label := labels[correctID]
		if label == "" {
			return nil, false
		}
		text := ""
		for _, option := range definition.Options {
			if option.ID == correctID {
				text = optionText(option.Content)
				break
			}
		}
		return []satlearning.AnswerKeyAnswer{{Label: label, Text: text}}, true
	case "student_produced_response":
		accepted := definition.Accepted
		if len(accepted) == 0 {
			accepted = definition.AcceptedAlt
		}
		if len(accepted) == 0 {
			return nil, false
		}
		out := make([]satlearning.AnswerKeyAnswer, 0, len(accepted))
		for _, value := range accepted {
			out = append(out, satlearning.AnswerKeyAnswer{Label: "", Text: value})
		}
		return out, true
	default:
		return nil, false
	}
}

func scoredResponse(v2, legacy sql.NullString) (string, bool) {
	if v2.Valid && v2.String != "" {
		input, answered := assessscore.V2ResponseToScorerInput(v2.String)
		if answered {
			return input, true
		}
	}
	if legacy.Valid {
		return legacy.String, assessscore.SATResponsePresent(legacy.String)
	}
	return "", false
}

func choiceOptions(options []struct {
	ID      string          `json:"id"`
	Content json.RawMessage `json:"content"`
}) []assessscore.SATChoiceOption {
	out := make([]assessscore.SATChoiceOption, 0, len(options))
	for _, option := range options {
		out = append(out, assessscore.SATChoiceOption{ID: option.ID})
	}
	return out
}

// optionText extracts display text from the delivery content contract without
// exposing the raw node tree. Unknown shapes return "" and the client falls
// back to the choice letter.
func optionText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var direct struct {
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &direct) == nil && direct.Text != "" {
		return direct.Text
	}
	var walk func(any) string
	walk = func(value any) string {
		switch node := value.(type) {
		case map[string]any:
			if text, ok := node["text"].(string); ok && text != "" {
				return text
			}
			for _, key := range []string{"nodes", "content"} {
				if text := walk(node[key]); text != "" {
					return text
				}
			}
		case []any:
			var parts []string
			for _, item := range node {
				if text := walk(item); text != "" {
					parts = append(parts, text)
				}
			}
			return strings.Join(parts, " ")
		}
		return ""
	}
	var decoded any
	if json.Unmarshal(raw, &decoded) != nil {
		return ""
	}
	return walk(decoded)
}
