package exams

// Publish-time IELTS objective key gate. The grader and this check share the
// key-source table, so an exam cannot be published with a key the server would
// read as missing.

import "example.com/ielts-proctoring/internal/grading"

func validateObjectiveKeysForPublish(provider, content string) error {
	if provider != ProviderIELTS {
		return nil
	}
	issues := grading.ValidateObjectiveContentJSON(content)
	if len(issues) == 0 {
		return nil
	}
	return validationError(issues[0].Message)
}
