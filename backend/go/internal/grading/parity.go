package grading

// This file exposes the objective grading projection as a pure function so the
// parity harness (cmd/grading-parity-grade and backend/scripts/grading-parity.ts)
// can grade exam content + answers without a database. The harness is read-only:
// it never calls a write path in this package.

// ParityOverride is the JSON shape of one schedule-scoped answer-key override
// as the parity harness supplies it.
type ParityOverride struct {
	CorrectAnswer    *string  `json:"correctAnswer"`
	AcceptedAnswers  []string `json:"acceptedAnswers"`
	ExcludedAnswers  []string `json:"excludedAnswers"`
	CorrectOptionIDs []string `json:"correctOptionIds"`
	ScoringRule      string   `json:"scoringRule"`
	MaxScore         int64    `json:"maxScore"`
	Points           *float64 `json:"points"`
	MaxPoints        *float64 `json:"maxPoints"`
	Correct          *bool    `json:"correct"`
}

// ParityInput is one section worth of exam content and a student's answers.
type ParityInput struct {
	Section   string                    `json:"section"`
	Content   map[string]any            `json:"content"`
	Answers   map[string]any            `json:"answers"`
	Keys      map[string]string         `json:"keys"`
	Overrides map[string]ParityOverride `json:"overrides"`
	VersionID string                    `json:"versionId"`
}

// ParityQuestionResult is the comparable per-question shape shared with the
// website's parity grader.
type ParityQuestionResult struct {
	QuestionID      string   `json:"questionId"`
	Correctness     *bool    `json:"correctness"`
	Status          string   `json:"status"`
	AwardedScore    *float64 `json:"awardedScore"`
	MaxScore        *float64 `json:"maxScore"`
	StudentAnswer   string   `json:"studentAnswer"`
	CorrectAnswer   any      `json:"correctAnswer"`
	AcceptedAnswers []string `json:"acceptedAnswers"`
	ScoringRule     string   `json:"scoringRule"`
}

// ParitySectionResult is one section's graded output.
type ParitySectionResult struct {
	Section    string                 `json:"section"`
	TotalScore float64                `json:"totalScore"`
	MaxScore   float64                `json:"maxScore"`
	Percentage float64                `json:"percentage"`
	Questions  []ParityQuestionResult `json:"questions"`
}

// GradeContentForParity grades one section using the same projection function
// as the worker and the staff regrade.
func GradeContentForParity(in ParityInput) ParitySectionResult {
	overrides := make(map[string]objectiveOverridePayload, len(in.Overrides))
	for questionID, override := range in.Overrides {
		overrides[questionID] = objectiveOverridePayload{
			CorrectAnswer:    override.CorrectAnswer,
			AcceptedAnswers:  override.AcceptedAnswers,
			ExcludedAnswers:  override.ExcludedAnswers,
			CorrectOptionIDs: override.CorrectOptionIDs,
			ScoringRule:      override.ScoringRule,
			MaxScore:         override.MaxScore,
		}
	}
	keys := in.Keys
	if keys == nil {
		keys = map[string]string{}
	}
	answers := in.Answers
	if answers == nil {
		answers = map[string]any{}
	}
	_, raw := gradeProjectionObjectiveSection(in.Section, answers, in.Content, keys, overrides, in.VersionID)
	return paritySectionResult(in.Section, raw)
}

func paritySectionResult(section string, raw map[string]any) ParitySectionResult {
	out := ParitySectionResult{
		Section:    section,
		TotalScore: numberOrZero(raw["totalScore"]),
		MaxScore:   numberOrZero(raw["maxScore"]),
		Percentage: numberOrZero(raw["percentage"]),
		Questions:  []ParityQuestionResult{},
	}
	results, _ := raw["questionResults"].([]any)
	for _, item := range results {
		question, _ := item.(map[string]any)
		if question == nil {
			continue
		}
		result := ParityQuestionResult{
			QuestionID:    stringOrEmpty(question["questionId"]),
			Status:        stringOrEmpty(question["verificationStatus"]),
			StudentAnswer: stringOrEmpty(question["studentAnswer"]),
			CorrectAnswer: question["correctAnswer"],
			ScoringRule:   stringOrEmpty(question["scoringRule"]),
		}
		if accepted, ok := question["acceptedAnswers"].([]string); ok {
			result.AcceptedAnswers = accepted
		} else if accepted, ok := question["acceptedAnswers"].([]any); ok {
			for _, value := range accepted {
				if text, ok := value.(string); ok {
					result.AcceptedAnswers = append(result.AcceptedAnswers, text)
				}
			}
		}
		if correct, ok := question["isCorrect"].(bool); ok {
			result.Correctness = &correct
		}
		result.AwardedScore = numberPtr(question["awardedScore"])
		result.MaxScore = numberPtr(question["maxScore"])
		out.Questions = append(out.Questions, result)
	}
	return out
}

func numberOrZero(value any) float64 {
	if number, ok := value.(float64); ok {
		return number
	}
	if number, ok := value.(int); ok {
		return float64(number)
	}
	return 0
}

func numberPtr(value any) *float64 {
	if number, ok := value.(float64); ok {
		return &number
	}
	if number, ok := value.(int); ok {
		converted := float64(number)
		return &converted
	}
	return nil
}
