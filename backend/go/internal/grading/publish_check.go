package grading

// Publish-time key validation. It reuses collectProjectionSection so the
// publish gate and the grader can never disagree about whether a key is
// readable. The exams package calls ValidateObjectiveContentJSON before it
// flips an IELTS draft to published.

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// ObjectiveKeyIssue is one objective question whose key the server cannot read.
type ObjectiveKeyIssue struct {
	Section        string
	QuestionNumber int
	QuestionID     string
	Message        string
}

// ValidateObjectiveContentJSON validates the objective sections of a raw
// content snapshot.
func ValidateObjectiveContentJSON(raw string) []ObjectiveKeyIssue {
	var content map[string]any
	if err := json.Unmarshal([]byte(raw), &content); err != nil {
		return []ObjectiveKeyIssue{{Message: "Draft content is not valid JSON."}}
	}
	return ValidateObjectiveContent(content)
}

// ValidateObjectiveContent returns one issue per objective question that has no
// server-readable key, including choose-N blocks with zero correct options.
func ValidateObjectiveContent(content map[string]any) []ObjectiveKeyIssue {
	issues := make([]ObjectiveKeyIssue, 0)
	for _, section := range []string{"listening", "reading"} {
		model := collectProjectionSection(content, section)
		ordinals := objectiveQuestionOrdinals(content, section)
		for _, spec := range model.Specs {
			number := ordinals[spec.ID]
			switch {
			case spec.Rule == "duplicate_question_id":
				issues = append(issues, ObjectiveKeyIssue{
					Section: section, QuestionNumber: number, QuestionID: spec.ID,
					Message: fmt.Sprintf("%s question %d (%s): the question id appears more than once.", sectionTitle(section), number, spec.ID),
				})
			case spec.Multi && len(spec.Accepted) == 0:
				issues = append(issues, ObjectiveKeyIssue{
					Section: section, QuestionNumber: number, QuestionID: spec.ID,
					Message: fmt.Sprintf("%s question %d (%s): choose-N block has no options marked correct.", sectionTitle(section), number, spec.ID),
				})
			case len(spec.Accepted) == 0:
				issues = append(issues, ObjectiveKeyIssue{
					Section: section, QuestionNumber: number, QuestionID: spec.ID,
					Message: fmt.Sprintf("%s question %d (%s): no answer key the server can read.", sectionTitle(section), number, spec.ID),
				})
			}
		}
	}
	sort.SliceStable(issues, func(left, right int) bool {
		if issues[left].Section != issues[right].Section {
			return issues[left].Section < issues[right].Section
		}
		return issues[left].QuestionNumber < issues[right].QuestionNumber
	})
	return issues
}

func sectionTitle(section string) string {
	if section == "" {
		return "Objective"
	}
	return strings.ToUpper(section[:1]) + section[1:]
}

// objectiveQuestionOrdinals maps a graded question id to the number the
// builder shows, following the same slot/group numbering rules as the student
// descriptor list (a choose-N block consumes N numbers; a scoring group
// consumes one).
func objectiveQuestionOrdinals(content map[string]any, section string) map[string]int {
	out := map[string]int{}
	root, _ := content[section].(map[string]any)
	var groups []any
	if section == "reading" {
		groups, _ = root["passages"].([]any)
	} else {
		groups, _ = root["parts"].([]any)
	}
	next := 1
	for _, group := range groups {
		groupMap, _ := group.(map[string]any)
		blocks, _ := groupMap["blocks"].([]any)
		for _, item := range blocks {
			block, ok := item.(map[string]any)
			if !ok {
				continue
			}
			next = assignBlockOrdinals(out, block, next)
		}
	}
	return out
}

func assignBlockOrdinals(out map[string]int, block map[string]any, next int) int {
	blockID := stringOrEmpty(block["id"])
	if enabled, _ := block["subAnswerModeEnabled"].(bool); enabled && blockID != "" {
		if roots, ok := block["answerTree"].([]any); ok && len(roots) > 0 {
			for _, rawRoot := range roots {
				root, _ := rawRoot.(map[string]any)
				rootID := stringOrEmpty(root["id"])
				rootNumber := next
				next++
				var walk func(map[string]any)
				walk = func(node map[string]any) {
					children, _ := node["children"].([]any)
					if len(children) == 0 {
						if nodeID := stringOrEmpty(node["id"]); nodeID != "" {
							out[blockID+"::tree::"+rootID+"::"+nodeID] = rootNumber
						}
						return
					}
					for _, rawChild := range children {
						if child, ok := rawChild.(map[string]any); ok {
							walk(child)
						}
					}
				}
				walk(root)
			}
			return next
		}
	}

	blockType := strings.ToUpper(stringOrEmpty(block["type"]))
	questions, _ := block["questions"].([]any)
	switch blockType {
	case "SENTENCE_COMPLETION", "NOTE_COMPLETION":
		for _, rawQuestion := range questions {
			question, _ := rawQuestion.(map[string]any)
			questionID := stringOrEmpty(question["id"])
			blanks, _ := question["blanks"].([]any)
			if len(blanks) == 0 {
				if questionID != "" {
					out[questionID] = next
				}
				next++
				continue
			}
			assigned := map[string]int{}
			for _, rawBlank := range blanks {
				blank, _ := rawBlank.(map[string]any)
				blankID := stringOrEmpty(blank["id"])
				groupID := stringOrEmpty(blank["scoreGroupId"])
				number := next
				if groupID != "" {
					if existing, ok := assigned[groupID]; ok {
						number = existing
					} else {
						assigned[groupID] = next
						next++
					}
				} else {
					next++
				}
				if questionID != "" && blankID != "" {
					out[questionID+":"+blankID] = number
				}
			}
		}
	case "TABLE_COMPLETION":
		cells, _ := block["cells"].([]any)
		assigned := map[string]int{}
		for _, rawCell := range cells {
			cell, _ := rawCell.(map[string]any)
			cellID := stringOrEmpty(cell["id"])
			groupID := stringOrEmpty(cell["scoreGroupId"])
			number := next
			if groupID != "" {
				if existing, ok := assigned[groupID]; ok {
					number = existing
				} else {
					assigned[groupID] = next
					next++
				}
			} else {
				next++
			}
			if blockID != "" && cellID != "" {
				out[blockID+":"+cellID] = number
			}
		}
	case "DIAGRAM_LABELING":
		next = assignSlotOrdinals(out, blockID, block["labels"], next)
	case "FLOW_CHART":
		next = assignSlotOrdinals(out, blockID, block["steps"], next)
	case "CLASSIFICATION":
		next = assignSlotOrdinals(out, blockID, block["items"], next)
	case "MATCHING_FEATURES":
		next = assignSlotOrdinals(out, blockID, block["features"], next)
	case "MULTI_MCQ":
		if blockID != "" {
			out[blockID] = next
		}
		correct := 0
		options, _ := block["options"].([]any)
		for _, rawOption := range options {
			option, _ := rawOption.(map[string]any)
			if isCorrect, _ := option["isCorrect"].(bool); isCorrect {
				correct++
			}
		}
		if correct < 1 {
			correct = 1
		}
		next += correct
	case "SINGLE_MCQ":
		if len(questions) > 0 {
			for _, rawQuestion := range questions {
				question, _ := rawQuestion.(map[string]any)
				if id := stringOrEmpty(question["id"]); id != "" {
					out[id] = next
				}
				next++
			}
		} else if blockID != "" {
			out[blockID] = next
			next++
		}
	default:
		if len(questions) > 0 {
			for _, rawQuestion := range questions {
				question, _ := rawQuestion.(map[string]any)
				if id := stringOrEmpty(question["id"]); id != "" {
					out[id] = next
				}
				next++
			}
		} else if blockID != "" {
			out[blockID] = next
			next++
		}
	}
	return next
}

func assignSlotOrdinals(out map[string]int, blockID string, raw any, next int) int {
	items, _ := raw.([]any)
	for _, rawItem := range items {
		item, _ := rawItem.(map[string]any)
		if blockID != "" {
			if id := stringOrEmpty(item["id"]); id != "" {
				out[blockID+":"+id] = next
			}
		}
		next++
	}
	return next
}
