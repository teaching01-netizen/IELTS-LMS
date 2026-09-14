package act

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

// scienceSpec is the Go representation of the Rust objective answer spec.
// Keeping it private prevents callers from bypassing the sealed-result
// boundary while allowing the scorer and detail/export projections to share
// exactly one computation.
type scienceSpec struct {
	ID             string
	Correct        any
	Accepted       []string
	ExpectedSet    map[string]bool
	ExcludedSet    map[string]bool
	Rule           string
	MaxScore       int
	Multi          bool
	IntegrityIssue string
}

const (
	verificationCorrect    = "verified_correct"
	verificationIncorrect  = "verified_incorrect"
	verificationUnanswered = "verified_unanswered"
	verificationInvalid    = "invalid"
	verificationRecheck    = "needs_recheck"
)

func computeScienceAutoGradingResults(config, content map[string]any, answers []Answer, submittedAt time.Time, overrides map[string]map[string]any) (map[string]any, error) {
	specs := buildScienceSpecs(content, overrides)
	if len(specs) == 0 {
		return nil, fmt.Errorf("ACT science content carries no scorable questions")
	}
	if weights, ok := config["weights"].([]any); ok {
		for i := range specs {
			if i >= len(weights) {
				break
			}
			if weight, ok := numberAsInt(weights[i]); ok && weight >= 1 {
				specs[i].MaxScore = weight
			}
		}
	}
	answerMap := make(map[string]any, len(answers))
	for _, answer := range answers {
		if strings.TrimSpace(answer.QuestionID) != "" {
			answerMap[answer.QuestionID] = answer.Answer
		}
	}

	questionResults := make([]map[string]any, 0, len(specs))
	questionAudits := make([]map[string]any, 0, len(specs))
	var total, max, correct, incorrect, unanswered, invalid, unresolved int
	for _, spec := range specs {
		max += maxInt(spec.MaxScore, 0)
		given, present := answerMap[spec.ID]
		status := verificationIncorrect
		var isCorrect any
		var awarded any
		issueCode := spec.IntegrityIssue
		if issueCode == "" && present && scienceAnswerMalformed(given) {
			issueCode = "answer_payload_type_invalid"
		}
		if issueCode != "" {
			if scienceInvalidIssue(issueCode) {
				status = verificationInvalid
				invalid++
			} else {
				status = verificationRecheck
				unresolved++
			}
		} else if !present || scienceAnswerBlank(given) {
			status = verificationUnanswered
			isCorrect = false
			awarded = 0
			unanswered++
		} else {
			matched, points := scienceAnswerMatches(spec, given)
			isCorrect = matched
			awarded = points
			total += points
			if matched {
				status = verificationCorrect
				correct++
			} else {
				status = verificationIncorrect
				incorrect++
			}
		}
		if awarded != nil {
			if n, ok := awarded.(int); ok && n >= 0 {
				// total is already maintained above for answered rows; this branch
				// intentionally only keeps the JSON result shape explicit.
				_ = n
			}
		}
		studentAnswer := ""
		if present {
			studentAnswer = scienceDisplayValue(given)
		}
		questionResults = append(questionResults, map[string]any{
			"questionId":         spec.ID,
			"studentAnswer":      studentAnswer,
			"correctAnswer":      scienceCorrectAnswerValue(spec.Correct),
			"acceptedAnswers":    append([]string(nil), spec.Accepted...),
			"verificationStatus": status,
			"isCorrect":          isCorrect,
			"awardedScore":       awarded,
			"maxScore":           spec.MaxScore,
			"scoringRule":        spec.Rule,
			"hasOverride":        overrides != nil && overrides[spec.ID] != nil,
			"issueCode":          nullableStringValue(issueCode),
			"issueMessage":       scienceIssueMessage(issueCode),
		})
		audit := map[string]any{
			"questionId": spec.ID, "section": SectionScience, "status": status,
			"maxScore": spec.MaxScore, "awardedScore": awarded,
			"studentAnswer": func() any {
				if present {
					return given
				}
				return nil
			}(),
			"acceptedAnswers": append([]string(nil), spec.Accepted...),
		}
		if issueCode != "" {
			audit["issueCode"] = issueCode
			audit["issueMessage"] = scienceIssueMessage(issueCode)
		}
		questionAudits = append(questionAudits, audit)
	}

	unknown := make([]string, 0)
	known := make(map[string]bool, len(specs))
	for _, spec := range specs {
		known[spec.ID] = true
	}
	for id := range answerMap {
		if !known[id] {
			unknown = append(unknown, id)
		}
	}
	sort.Strings(unknown)
	issueCodes := make([]string, 0)
	for _, spec := range specs {
		if spec.IntegrityIssue != "" && !containsString(issueCodes, spec.IntegrityIssue) {
			issueCodes = append(issueCodes, spec.IntegrityIssue)
		}
	}
	// Rust derives unresolved from the expected question accounting. Unknown
	// answer IDs are a separate integrity dimension and do not consume a
	// question slot.
	unresolved = len(specs) - correct - incorrect - unanswered
	if unresolved < 0 {
		unresolved = 0
	}
	if len(unknown) > 0 {
		issueCodes = appendUnique(issueCodes, "unknown_student_answer_id")
	}
	integrityStatus := "verified"
	if invalid > 0 || containsAny(issueCodes, "invalid_answer_key", "answer_key_violates_scoring_rule", "duplicate_question_id") {
		integrityStatus = "invalid"
	} else if unresolved > 0 || len(issueCodes) > 0 {
		integrityStatus = "needs_recheck"
	}
	percentage := 0.0
	if max > 0 {
		percentage = math.Round((float64(total)/float64(max)*100)*100) / 100
	}
	return map[string]any{
		"generatedAt": submittedAt.UTC(), "totalScore": total, "maxScore": max,
		"percentage": percentage, "questionResults": questionResults,
		"integrity": map[string]any{
			"section": SectionScience, "expectedQuestionCount": len(specs),
			"verifiedCorrectCount": correct, "verifiedIncorrectCount": incorrect,
			"verifiedUnansweredCount": unanswered, "unresolvedCount": unresolved,
			"invalidCount": invalid, "unknownAnswerCount": len(unknown),
			"integrityStatus": integrityStatus, "gradingSourceVersionId": "unknown",
			"questions": questionAudits, "issueCodes": issueCodes,
			"unknownAnswerIds": unknown,
		},
		"unknownStudentAnswerIds": unknown,
	}, nil
}

func buildScienceSpecs(content map[string]any, overrides map[string]map[string]any) []scienceSpec {
	content = normalizeScienceContent(content)
	raw, _ := content["questions"].([]any)
	specs := make([]scienceSpec, 0, len(raw))
	seen := map[string]bool{}
	for _, item := range raw {
		question, _ := item.(map[string]any)
		if question == nil {
			continue
		}
		id, _ := firstString(question, "questionId", "question_id", "id")
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		spec := scienceSpec{ID: id, Rule: firstNonEmptyString(question, "scoringRule", "answerRule"), MaxScore: 1}
		if spec.Rule == "" {
			spec.Rule = "exact_match"
		}
		if max, ok := numberAsInt(question["maxScore"]); ok {
			spec.MaxScore = max
		}
		accepted, correct, multi := acceptedValues(question)
		spec.Accepted, spec.Correct, spec.Multi = accepted, correct, multi
		if multi && len(accepted) > 0 && question["maxScore"] == nil {
			spec.MaxScore = len(accepted)
		}
		if seen[id] {
			for index := range specs {
				if specs[index].ID == id {
					specs[index].IntegrityIssue = "duplicate_question_id"
				}
			}
			continue
		}
		seen[id] = true
		spec.IntegrityIssue = scienceAnswerKeyIssue(question, spec.Accepted, spec.Multi, spec.Rule)
		if override := overrides[id]; override != nil {
			applyScienceOverride(&spec, override)
			if issue := scienceOverrideIssue(override, spec); issue != "" {
				spec.IntegrityIssue = issue
			}
		}
		spec.ExpectedSet = make(map[string]bool, len(spec.Accepted))
		spec.ExcludedSet = make(map[string]bool)
		for _, value := range spec.Accepted {
			spec.ExpectedSet[normalizeScienceText(value)] = true
		}
		if override := overrides[id]; override != nil {
			if values, ok := stringArray(override["excludedAnswers"]); ok {
				for _, value := range values {
					spec.ExcludedSet[normalizeScienceText(value)] = true
				}
			}
		}
		specs = append(specs, spec)
	}
	return specs
}

func acceptedValues(question map[string]any) ([]string, any, bool) {
	if ids, ok := stringSlice(question["correctOptionIds"]); ok && len(ids) > 0 {
		return ids, ids, len(ids) > 1
	}
	if values, ok := stringSlice(question["acceptedAnswers"]); ok && len(values) > 0 {
		values = splitScienceVariants(values)
		if len(values) > 1 && question["correctAnswer"] == nil {
			return values, strings.Join(values, " | "), false
		}
		return values, strings.Join(values, " | "), false
	}
	if correct, ok := question["correctAnswer"]; ok {
		if values, ok := stringSlice(correct); ok {
			values = splitScienceVariants(values)
			if len(values) > 1 {
				switch correct.(type) {
				case []string, []any:
					return values, values, true
				}
			}
			return values, strings.Join(values, " | "), len(values) > 1
		}
		if value, ok := correct.(string); ok {
			values := splitScienceVariants([]string{value})
			return values, strings.Join(values, " | "), false
		}
		return []string{fmt.Sprint(correct)}, correct, false
	}
	if answer, ok := question["answer"]; ok {
		if value, ok := answer.(string); ok {
			values := splitScienceVariants([]string{value})
			return values, strings.Join(values, " | "), false
		}
		return []string{fmt.Sprint(answer)}, answer, false
	}
	if options, ok := question["options"].([]any); ok {
		values := make([]string, 0)
		for _, raw := range options {
			option, _ := raw.(map[string]any)
			correct, _ := option["isCorrect"].(bool)
			if !correct {
				continue
			}
			if id, ok := firstString(option, "id", "key", "value"); ok {
				values = append(values, id)
			}
		}
		if len(values) > 0 {
			if len(values) == 1 {
				return values, values[0], false
			}
			return values, values, true
		}
	}
	return nil, nil, false
}

func applyScienceOverride(spec *scienceSpec, override map[string]any) {
	if rule := firstNonEmptyString(override, "scoringRule", "answerRule"); rule != "" {
		spec.Rule = rule
	}
	if max, ok := numberAsInt(override["maxScore"]); ok {
		spec.MaxScore = max
	}
	if ids, exists := override["correctOptionIds"]; exists {
		if optionIDs, ok := stringArray(ids); ok {
			spec.Accepted, spec.Correct, spec.Multi = optionIDs, optionIDs, len(optionIDs) > 1
			if spec.Multi && override["maxScore"] == nil {
				spec.MaxScore = len(optionIDs)
			}
			if len(optionIDs) > 0 {
				spec.IntegrityIssue = ""
				return
			}
		}
	}
	if values, ok := stringArray(override["acceptedAnswers"]); ok && len(values) > 0 {
		spec.Accepted = splitScienceVariants(values)
	} else if correct, ok := override["correctAnswer"].(string); ok {
		spec.Accepted = splitScienceVariants([]string{correct})
	}
	if len(spec.Accepted) > 0 {
		spec.Correct = strings.Join(spec.Accepted, " | ")
		spec.IntegrityIssue = ""
	}
}

func scienceOverrideIssue(override map[string]any, spec scienceSpec) string {
	if raw, exists := override["excludedAnswers"]; exists && raw != nil {
		if _, ok := stringArray(raw); !ok {
			return "invalid_answer_key"
		}
	}
	if raw, exists := override["correctOptionIds"]; exists && raw != nil {
		if _, ok := stringArray(raw); !ok {
			return "invalid_answer_key"
		}
	}
	if raw, exists := override["acceptedAnswers"]; exists && raw != nil {
		if _, ok := stringArray(raw); !ok {
			return "invalid_answer_key"
		}
	}
	if raw, exists := override["correctAnswer"]; exists && raw != nil {
		if _, ok := raw.(string); !ok {
			return "invalid_answer_key"
		}
	}
	if len(spec.Accepted) == 0 {
		return "missing_answer_key"
	}
	for _, value := range spec.Accepted {
		if !scienceRuleAllows([]string{value}, spec.Rule) {
			return "answer_key_violates_scoring_rule"
		}
	}
	return ""
}

func scienceAnswerMatches(spec scienceSpec, given any) (bool, int) {
	if spec.Multi {
		values, ok := stringSlice(given)
		if !ok {
			return false, 0
		}
		seen := map[string]bool{}
		for _, value := range values {
			seen[normalizeScienceText(value)] = true
		}
		intersection := 0
		for value := range seen {
			if spec.ExpectedSet[value] {
				intersection++
			}
		}
		matched := len(seen) == len(spec.ExpectedSet) && intersection == len(spec.ExpectedSet)
		return matched, minInt(spec.MaxScore, intersection)
	}
	if _, textKey := spec.Correct.(string); !textKey {
		if answersEqual(given, spec.Correct) {
			return true, maxInt(spec.MaxScore, 0)
		}
		return false, 0
	}
	values, ok := stringSlice(given)
	if !ok || len(values) == 0 || !scienceRuleAllows(values, spec.Rule) {
		return false, 0
	}
	for _, value := range values {
		if spec.ExcludedSet[normalizeScienceText(value)] {
			return false, 0
		}
		if spec.ExpectedSet[normalizeScienceText(value)] {
			return true, maxInt(spec.MaxScore, 0)
		}
	}
	return false, 0
}

func scienceRuleAllows(values []string, rule string) bool {
	words := map[string]int{"ONE_WORD": 1, "TWO_WORDS": 2, "THREE_WORDS": 3}
	if max, ok := words[strings.ToUpper(strings.TrimSpace(rule))]; ok {
		return len(values) == 1 && len(strings.Fields(values[0])) <= max
	}
	return true
}

func scienceAnswerMalformed(value any) bool {
	switch value.(type) {
	case nil, string:
		return false
	case []any:
		for _, item := range value.([]any) {
			if scienceAnswerMalformed(item) {
				return true
			}
		}
		return false
	case []string:
		return false
	default:
		return true
	}
}

func scienceAnswerBlank(value any) bool {
	if value == nil {
		return true
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text) == ""
	}
	if values, ok := value.([]any); ok {
		return len(values) == 0 || allScienceBlank(values)
	}
	return false
}

func allScienceBlank(values []any) bool {
	for _, value := range values {
		if !scienceAnswerBlank(value) {
			return false
		}
	}
	return true
}

func scienceDisplayValue(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	if values, ok := stringSlice(value); ok {
		return strings.Join(values, ", ")
	}
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func scienceIssueMessage(code string) any {
	messages := map[string]string{
		"missing_answer_key":               "The published question has no usable answer key.",
		"invalid_answer_key":               "The answer key has an invalid shape.",
		"answer_key_violates_scoring_rule": "The configured answer key violates its scoring rule.",
		"duplicate_question_id":            "The published section contains a duplicate question ID.",
		"answer_payload_type_invalid":      "The submitted answer has an unsupported JSON shape.",
		"unknown_student_answer_id":        "The submission contains an answer ID absent from the published question map.",
	}
	if message, ok := messages[code]; ok {
		return message
	}
	return nil
}

func scienceInvalidIssue(code string) bool {
	return code == "missing_answer_key" || code == "invalid_answer_key" || code == "answer_key_violates_scoring_rule" || code == "duplicate_question_id"
}

func scienceCorrectAnswerValue(value any) any {
	if values, ok := value.([]string); ok {
		return append([]string(nil), values...)
	}
	return value
}

func scienceAnswerKeyIssue(question map[string]any, accepted []string, multi bool, rule string) string {
	if raw, exists := question["acceptedAnswers"]; exists && raw != nil {
		if _, ok := stringArray(raw); !ok {
			return "invalid_answer_key"
		}
	}
	if raw, exists := question["correctOptionIds"]; exists && raw != nil {
		if _, ok := stringArray(raw); !ok {
			return "invalid_answer_key"
		}
	}
	if raw, exists := question["correctAnswer"]; exists && raw != nil {
		switch raw.(type) {
		case string:
		case []string, []any:
			if !multi {
				return "invalid_answer_key"
			}
		default:
			return "invalid_answer_key"
		}
	}
	if raw, exists := question["answer"]; exists && raw != nil {
		if _, ok := raw.(string); !ok {
			return "invalid_answer_key"
		}
	}
	if len(accepted) == 0 {
		return "missing_answer_key"
	}
	for _, value := range accepted {
		if !scienceRuleAllows([]string{value}, rule) {
			return "answer_key_violates_scoring_rule"
		}
	}
	return ""
}

func stringArray(value any) ([]string, bool) {
	switch values := value.(type) {
	case []string:
		return append([]string(nil), values...), true
	case []any:
		out := make([]string, 0, len(values))
		for _, value := range values {
			text, ok := value.(string)
			if !ok {
				return nil, false
			}
			out = append(out, text)
		}
		return out, true
	default:
		return nil, false
	}
}

func normalizeScienceText(value string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(value)), " "))
}

func nullableStringValue(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func firstString(object map[string]any, keys ...string) (string, bool) {
	for _, key := range keys {
		if value, ok := object[key].(string); ok && strings.TrimSpace(value) != "" {
			return value, true
		}
	}
	return "", false
}

func firstNonEmptyString(object map[string]any, keys ...string) string {
	value, _ := firstString(object, keys...)
	return value
}

func stringSlice(value any) ([]string, bool) {
	switch values := value.(type) {
	case string:
		return []string{values}, true
	case []string:
		return append([]string(nil), values...), true
	case []any:
		out := make([]string, 0, len(values))
		for _, item := range values {
			text, ok := item.(string)
			if !ok {
				return nil, false
			}
			out = append(out, text)
		}
		return out, true
	default:
		return nil, false
	}
}

func splitScienceVariants(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		for _, part := range strings.Split(value, "|") {
			part = strings.TrimSpace(part)
			if part == "" || seen[normalizeScienceText(part)] {
				continue
			}
			seen[normalizeScienceText(part)] = true
			out = append(out, part)
		}
	}
	return out
}

func numberAsInt(value any) (int, bool) {
	if value == nil {
		return 0, false
	}
	if n, ok := numVal(value); ok {
		return int(n), true
	}
	return 0, false
}

func mustInt(value any) int {
	n, _ := numberAsInt(value)
	return n
}

func mustFloat(value any) float64 {
	n, _ := numVal(value)
	return n
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func appendUnique(values []string, value string) []string {
	if !containsString(values, value) {
		return append(values, value)
	}
	return values
}

func containsAny(values []string, targets ...string) bool {
	for _, target := range targets {
		if containsString(values, target) {
			return true
		}
	}
	return false
}
