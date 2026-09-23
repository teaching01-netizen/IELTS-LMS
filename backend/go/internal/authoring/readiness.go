package authoring

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"example.com/ielts-proctoring/internal/satpublish"
)

// The Rust authoring provider validates questions at the provider boundary,
// not in the browser. Keep the Go implementation on the same boundary so a
// stale or hand-written client cannot make an incomplete question appear
// publishable.

type questionValidationRow struct {
	examQuestionID, questionID, revisionID, sectionKey, questionType string
	displayOrder, semanticRevision, revision                         int
	isPretest                                                        bool
	stimulus, prompt, answer, rationale, metadata                    string
}

type satBlueprintModuleSpec struct {
	durationSeconds, questionCount, pretestCount int
	tools                                        []string
}

func satBlueprintModule(sectionKey, moduleKey string) (satBlueprintModuleSpec, bool) {
	spec := satBlueprintModuleSpec{}
	switch sectionKey {
	case SectionReadingWriting:
		spec = satBlueprintModuleSpec{durationSeconds: 32 * 60, questionCount: 27, pretestCount: 2}
		switch moduleKey {
		case "rw-m1", "rw-m2-lower", "rw-m2-higher":
			return spec, true
		default:
			return satBlueprintModuleSpec{}, false
		}
	case SectionMath:
		spec = satBlueprintModuleSpec{durationSeconds: 35 * 60, questionCount: 22, pretestCount: 2, tools: []string{"calculator", "reference_sheet"}}
		switch moduleKey {
		case "math-m1", "math-m2-lower", "math-m2-higher":
			return spec, true
		default:
			return satBlueprintModuleSpec{}, false
		}
	default:
		return satBlueprintModuleSpec{}, false
	}
}

// loadQuestionValidationRows returns the raw revision payload needed for
// question-list readiness and editor projections. SAT publish validation reads
// the same normalized tables through satpublish.ValidateDraft.
func loadQuestionValidationRows(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, moduleID string) ([]questionValidationRow, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT eq.id, eq.question_id, eq.question_revision_id, s.section_key,
		       eq.display_order, eq.is_pretest, r.question_type,
		       r.semantic_revision, r.revision,
		       CAST(r.stimulus AS CHAR), CAST(r.prompt AS CHAR),
		       CAST(r.answer_definition AS CHAR), CAST(r.rationale AS CHAR),
		       CAST(r.metadata AS CHAR)
		FROM assessment_exam_questions eq
		JOIN assessment_modules m ON m.id = eq.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		JOIN assessment_question_revisions r ON r.id = eq.question_revision_id
		WHERE eq.module_id = ?
		ORDER BY eq.display_order ASC`, moduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]questionValidationRow, 0)
	for rows.Next() {
		var row questionValidationRow
		if err := rows.Scan(
			&row.examQuestionID, &row.questionID, &row.revisionID, &row.sectionKey,
			&row.displayOrder, &row.isPretest, &row.questionType,
			&row.semanticRevision, &row.revision,
			&row.stimulus, &row.prompt, &row.answer, &row.rationale, &row.metadata,
		); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (row questionValidationRow) summary() QuestionSummary {
	issues := validateSATQuestion(row.sectionKey, row.questionType, row.stimulus, row.prompt, row.answer, row.rationale, row.metadata)
	blocking := 0
	invalid := false
	for _, issue := range issues {
		if !issue.Blocking {
			continue
		}
		blocking++
		if !strings.HasSuffix(issue.Code, ".required") && issue.Code != "sat.choice.count" {
			invalid = true
		}
	}
	metadata := parseQuestionMetadata(row.metadata)
	answerPreview := answerKeyPreview(row.answer)
	choicePlain := true
	answerObject := jsonObject(row.answer)
	if strings.EqualFold(stringField(answerObject, "kind"), "single_choice") {
		choicePlain = true
		if options, ok := answerObject["options"].([]any); ok {
			for _, option := range options {
				optionObject, ok := option.(map[string]any)
				if !ok {
					choicePlain = false
					continue
				}
				content, _ := json.Marshal(optionObject["content"])
				if !supportsFastPlainEditing(string(content)) {
					choicePlain = false
				}
			}
		}
	}
	readiness := "ready"
	if blocking > 0 {
		readiness = "incomplete"
		if invalid {
			readiness = "error"
		}
	}
	return QuestionSummary{
		ExamQuestionID:    row.examQuestionID,
		QuestionID:        row.questionID,
		QuestionRevision:  row.revisionID,
		DisplayOrder:      row.displayOrder,
		IsPretest:         row.isPretest,
		QuestionType:      row.questionType,
		SemanticRevision:  row.semanticRevision,
		Revision:          row.revision,
		PromptPreview:     truncatePreview(plainTextFromContent(row.prompt), 180),
		AnswerKeyPreview:  answerPreview,
		Domain:            metadata.domain,
		Skill:             metadata.skill,
		Difficulty:        metadata.difficulty,
		Tags:              metadata.tags,
		HasStimulus:       hasContent(row.stimulus),
		ContentComplexity: contentComplexity(row.stimulus, row.prompt, row.rationale, choicePlain),
		Readiness: QuestionReadinessSummary{
			Status:             readiness,
			BlockingIssueCount: blocking,
			WarningCount:       len(issues) - blocking,
		},
	}
}

type questionMetadata struct {
	sectionKey, difficulty string
	domain, skill          *string
	tags                   []string
}

func parseQuestionMetadata(raw string) questionMetadata {
	object := jsonObject(raw)
	metadata := questionMetadata{
		sectionKey: stringField(object, "sectionKey", "section_key"),
		difficulty: stringField(object, "difficulty"),
		tags:       []string{},
	}
	if metadata.difficulty == "" {
		metadata.difficulty = "medium"
	}
	if value := stringField(object, "domain"); strings.TrimSpace(value) != "" {
		metadata.domain = &value
	}
	if value := stringField(object, "skill"); strings.TrimSpace(value) != "" {
		metadata.skill = &value
	}
	if values, ok := object["tags"].([]any); ok {
		for _, value := range values {
			if tag, ok := value.(string); ok {
				metadata.tags = append(metadata.tags, tag)
			}
		}
	}
	return metadata
}

func jsonObject(raw string) map[string]any {
	var object map[string]any
	if json.Unmarshal([]byte(raw), &object) != nil || object == nil {
		return map[string]any{}
	}
	return object
}

func stringField(object map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := object[key].(string); ok {
			return value
		}
	}
	return ""
}

func truncatePreview(value string, limit int) string {
	normalized := strings.Join(strings.Fields(value), " ")
	if len(normalized) <= limit {
		return normalized
	}
	if limit <= 1 {
		return normalized[:limit]
	}
	return normalized[:limit-1] + "…"
}

func contentComplexity(stimulus, prompt, rationale string, choicesPlain bool) string {
	if supportsFastPlainEditing(stimulus) && supportsFastPlainEditing(prompt) && supportsFastPlainEditing(rationale) && choicesPlain {
		return "plain"
	}
	return "rich"
}

func answerKeyPreview(raw string) *string {
	answer := jsonObject(raw)
	switch stringField(answer, "kind") {
	case "single_choice":
		if value, ok := answer["correctOptionId"].(string); ok && strings.TrimSpace(value) != "" {
			return &value
		}
		if value, ok := answer["correct_option_id"].(string); ok && strings.TrimSpace(value) != "" {
			return &value
		}
	case "student_produced_response":
		if values, ok := answer["acceptedResponses"].([]any); ok {
			for _, value := range values {
				if response, ok := value.(string); ok && strings.TrimSpace(response) != "" {
					return &response
				}
			}
		}
		if values, ok := answer["accepted_responses"].([]any); ok {
			for _, value := range values {
				if response, ok := value.(string); ok && strings.TrimSpace(response) != "" {
					return &response
				}
			}
		}
	}
	return nil
}

func structuredContent(raw string) (map[string]any, bool) {
	var object map[string]any
	if err := json.Unmarshal([]byte(raw), &object); err != nil || object == nil {
		return nil, false
	}
	return object, true
}

func hasContent(raw string) bool {
	object, ok := structuredContent(raw)
	if !ok {
		return false
	}
	if document, ok := object["document"].(map[string]any); ok && stringField(document, "type") == "doc" {
		if nodes, ok := document["content"].([]any); ok {
			for _, node := range nodes {
				if richNodeHasContent(node) {
					return true
				}
			}
		}
	}
	if nodes, ok := object["nodes"].([]any); ok {
		for _, node := range nodes {
			if legacyNodeHasContent(node) {
				return true
			}
		}
	}
	return false
}

func legacyNodeHasContent(value any) bool {
	object, ok := value.(map[string]any)
	if !ok {
		return false
	}
	switch stringField(object, "type") {
	case "image":
		return true
	case "table":
		rows, _ := object["rows"].([]any)
		for _, row := range rows {
			cells, _ := row.([]any)
			for _, cell := range cells {
				if text, ok := cell.(string); ok && strings.TrimSpace(text) != "" {
					return true
				}
			}
		}
		return false
	case "equation":
		return strings.TrimSpace(stringField(object, "latex")) != ""
	default:
		return strings.TrimSpace(stringField(object, "text")) != ""
	}
}

func richNodeHasContent(value any) bool {
	object, ok := value.(map[string]any)
	if !ok {
		return false
	}
	switch stringField(object, "type") {
	case "image":
		return true
	case "inlineMath", "blockMath":
		attrs, _ := object["attrs"].(map[string]any)
		return strings.TrimSpace(stringField(attrs, "latex")) != ""
	case "text":
		return strings.TrimSpace(stringField(object, "text")) != ""
	}
	children, _ := object["content"].([]any)
	for _, child := range children {
		if richNodeHasContent(child) {
			return true
		}
	}
	return false
}

func richNodeText(value any) string {
	object, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	switch stringField(object, "type") {
	case "text":
		return stringField(object, "text")
	case "inlineMath", "blockMath":
		attrs, _ := object["attrs"].(map[string]any)
		return stringField(attrs, "latex")
	case "image":
		attrs, _ := object["attrs"].(map[string]any)
		return stringField(attrs, "alt")
	}
	children, _ := object["content"].([]any)
	parts := make([]string, 0, len(children))
	for _, child := range children {
		parts = append(parts, richNodeText(child))
	}
	separator := ""
	if stringField(object, "type") != "paragraph" {
		separator = "\n"
	}
	return strings.Join(parts, separator)
}

func plainTextFromContent(raw string) string {
	object, ok := structuredContent(raw)
	if !ok {
		return ""
	}
	if document, ok := object["document"].(map[string]any); ok && stringField(document, "type") == "doc" {
		children, _ := document["content"].([]any)
		parts := make([]string, 0, len(children))
		for _, child := range children {
			parts = append(parts, richNodeText(child))
		}
		return strings.TrimSpace(strings.Join(parts, "\n"))
	}
	nodes, _ := object["nodes"].([]any)
	parts := make([]string, 0, len(nodes))
	for _, node := range nodes {
		value, ok := node.(map[string]any)
		if !ok {
			continue
		}
		switch stringField(value, "type") {
		case "paragraph", "heading":
			parts = append(parts, stringField(value, "text"))
		case "equation":
			parts = append(parts, stringField(value, "latex"))
		case "image":
			parts = append(parts, stringField(value, "alt"))
		case "table":
			rows, _ := value["rows"].([]any)
			for _, row := range rows {
				cells, _ := row.([]any)
				texts := make([]string, 0, len(cells))
				for _, cell := range cells {
					if text, ok := cell.(string); ok {
						texts = append(texts, text)
					}
				}
				parts = append(parts, strings.Join(texts, " | "))
			}
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n"))
}

func supportsFastPlainEditing(raw string) bool {
	object, ok := structuredContent(raw)
	if !ok {
		return false
	}
	version, _ := object["version"].(float64)
	if version == 1 {
		nodes, _ := object["nodes"].([]any)
		if len(nodes) > 1 {
			return false
		}
		for _, node := range nodes {
			value, ok := node.(map[string]any)
			if !ok || stringField(value, "type") != "paragraph" {
				return false
			}
		}
		return true
	}
	document, ok := object["document"].(map[string]any)
	if !ok || stringField(document, "type") != "doc" {
		return false
	}
	blocks, _ := document["content"].([]any)
	if len(blocks) > 1 {
		return false
	}
	if len(blocks) == 0 {
		return true
	}
	paragraph, ok := blocks[0].(map[string]any)
	if !ok || stringField(paragraph, "type") != "paragraph" {
		return false
	}
	children, _ := paragraph["content"].([]any)
	for _, child := range children {
		value, ok := child.(map[string]any)
		if !ok || stringField(value, "type") != "text" {
			return false
		}
		marks, exists := value["marks"]
		if exists {
			markList, ok := marks.([]any)
			if !ok || len(markList) != 0 {
				return false
			}
		}
	}
	return true
}

var satAllowedNodes = map[string]bool{
	"doc": true, "paragraph": true, "heading": true, "text": true,
	"hardBreak": true, "bulletList": true, "orderedList": true,
	"listItem": true, "inlineMath": true, "blockMath": true,
	"image": true, "table": true, "tableRow": true, "tableHeader": true,
	"tableCell": true, "codeBlock": true,
}

var satAllowedMarks = map[string]bool{
	"bold": true, "italic": true, "underline": true,
	"superscript": true, "subscript": true, "code": true,
}

func appendIssue(issues *[]ValidationIssue, code, path, message string) {
	*issues = append(*issues, ValidationIssue{Code: code, Path: path, Message: message, Blocking: true})
}

func validateRichNode(value any, path string, issues *[]ValidationIssue) {
	object, ok := value.(map[string]any)
	if !ok {
		return
	}
	if nodeType := stringField(object, "type"); nodeType != "" {
		if !satAllowedNodes[nodeType] {
			appendIssue(issues, "sat.content.node.unsupported", path+".type", "This rich-content element is not supported in SAT delivery.")
		}
		if nodeType == "inlineMath" || nodeType == "blockMath" {
			attrs, _ := object["attrs"].(map[string]any)
			if strings.TrimSpace(stringField(attrs, "latex")) == "" {
				appendIssue(issues, "sat.math.latex.required", path+".attrs.latex", "Math content requires a LaTeX expression.")
			}
		}
	}
	if marks, ok := object["marks"].([]any); ok {
		for index, mark := range marks {
			markObject, _ := mark.(map[string]any)
			markType := stringField(markObject, "type")
			if !satAllowedMarks[markType] {
				appendIssue(issues, "sat.content.mark.unsupported", fmt.Sprintf("%s.marks[%d].type", path, index), "This text formatting is not supported in SAT delivery.")
			}
		}
	}
	if stringField(object, "type") == "image" {
		attrs, _ := object["attrs"].(map[string]any)
		if strings.TrimSpace(stringField(attrs, "assetId")) == "" && strings.TrimSpace(stringField(attrs, "src")) == "" {
			appendIssue(issues, "sat.media.source.required", path+".attrs.assetId", "Images require an uploaded asset or source URL.")
		}
		if strings.TrimSpace(stringField(attrs, "alt")) == "" {
			appendIssue(issues, "sat.accessibility.alt.required", path+".attrs.alt", "Images require alternative text.")
		}
	}
	if children, ok := object["content"].([]any); ok {
		for index, child := range children {
			validateRichNode(child, fmt.Sprintf("%s.content[%d]", path, index), issues)
		}
	}
}

func validateContent(raw, path string, issues *[]ValidationIssue) {
	object, ok := structuredContent(raw)
	if !ok {
		if strings.TrimSpace(raw) != "" {
			appendIssue(issues, "sat.content.invalid", path, "Content must be a valid structured-content object.")
		}
		return
	}
	if nodes, ok := object["nodes"].([]any); ok {
		for index, node := range nodes {
			value, _ := node.(map[string]any)
			if stringField(value, "type") != "image" {
				continue
			}
			if strings.TrimSpace(stringField(value, "assetId", "asset_id")) == "" {
				appendIssue(issues, "sat.media.source.required", fmt.Sprintf("%s.nodes[%d].assetId", path, index), "Images require an uploaded asset or source URL.")
			}
			if strings.TrimSpace(stringField(value, "alt")) == "" {
				appendIssue(issues, "sat.accessibility.alt.required", fmt.Sprintf("%s.nodes[%d].alt", path, index), "Images require alternative text.")
			}
		}
	}
	if document, ok := object["document"].(map[string]any); ok {
		if children, ok := document["content"].([]any); ok {
			for index, child := range children {
				validateRichNode(child, fmt.Sprintf("%s.document.content[%d]", path, index), issues)
			}
		}
	}
}

func satDomainValid(section, domain string) bool {
	values := map[string]map[string]bool{
		SectionReadingWriting: {
			"information-and-ideas": true, "craft-and-structure": true,
			"expression-of-ideas": true, "standard-english-conventions": true,
		},
		SectionMath: {
			"algebra": true, "advanced-math": true,
			"problem-solving-and-data-analysis": true, "geometry-and-trigonometry": true,
		},
	}
	return values[section][domain]
}

func satSkillValid(domain, skill string) bool {
	values := map[string]map[string]bool{
		"information-and-ideas": {
			"Central Ideas and Details": true, "Command of Evidence — Textual": true,
			"Command of Evidence — Quantitative": true, "Inferences": true,
		},
		"craft-and-structure":               {"Words in Context": true, "Text Structure and Purpose": true, "Cross-Text Connections": true},
		"expression-of-ideas":               {"Rhetorical Synthesis": true, "Transitions": true},
		"standard-english-conventions":      {"Boundaries": true, "Form, Structure, and Sense": true},
		"algebra":                           {"Linear Equations in One Variable": true, "Linear Functions": true, "Linear Equations in Two Variables": true, "Systems of Two Linear Equations": true, "Linear Inequalities": true},
		"advanced-math":                     {"Equivalent Expressions": true, "Nonlinear Equations in One Variable": true, "Systems of Equations in Two Variables": true, "Nonlinear Functions": true},
		"problem-solving-and-data-analysis": {"Ratios, Rates, Proportional Relationships, and Units": true, "Percentages": true, "One-Variable Data": true, "Two-Variable Data": true, "Probability and Conditional Probability": true, "Inference from Sample Statistics and Margin of Error": true, "Evaluating Statistical Claims": true},
		"geometry-and-trigonometry":         {"Area and Volume": true, "Lines, Angles, and Triangles": true, "Right Triangles and Trigonometry": true, "Circles": true},
	}
	return values[domain][skill]
}

func validateSATQuestion(section, questionType, stimulus, prompt, answer, rationale, metadata string) []ValidationIssue {
	issues := make([]ValidationIssue, 0)
	if !hasContent(prompt) {
		appendIssue(&issues, "question.prompt.required", "prompt", "Question text is required.")
	}
	validateContent(stimulus, "stimulus", &issues)
	validateContent(prompt, "prompt", &issues)
	validateContent(rationale, "rationale", &issues)

	metadataObject := jsonObject(metadata)
	metadataSection := stringField(metadataObject, "sectionKey", "section_key")
	if metadataSection != section {
		appendIssue(&issues, "sat.metadata.section.required", "metadata.sectionKey", "Question metadata must match its assessment section.")
	}
	domain := stringField(metadataObject, "domain")
	if strings.TrimSpace(domain) == "" {
		appendIssue(&issues, "sat.metadata.domain.required", "metadata.domain", "Choose the SAT domain for this question.")
	} else if !satDomainValid(section, domain) {
		appendIssue(&issues, "sat.metadata.domain.invalid", "metadata.domain", "Choose a valid SAT domain for this section.")
	}
	skill := stringField(metadataObject, "skill")
	if strings.TrimSpace(skill) == "" {
		appendIssue(&issues, "sat.metadata.skill.required", "metadata.skill", "Choose the SAT skill for this question.")
	} else if !satSkillValid(domain, skill) {
		appendIssue(&issues, "sat.metadata.skill.invalid", "metadata.skill", "Choose a skill that belongs to the selected SAT domain.")
	}
	difficulty := strings.ToLower(strings.TrimSpace(stringField(metadataObject, "difficulty")))
	if difficulty != "easy" && difficulty != "medium" && difficulty != "hard" {
		appendIssue(&issues, "sat.metadata.difficulty.invalid", "metadata.difficulty", "Difficulty must be easy, medium, or hard.")
	}

	answerObject, answerOK := structuredContent(answer)
	answerKind := stringField(answerObject, "kind")
	if questionType != "single_choice" && questionType != "student_produced_response" {
		appendIssue(&issues, "sat.question_type.invalid", "questionType", "Choose a supported SAT question type.")
	} else if !answerOK {
		appendIssue(&issues, "sat.answer.invalid", "answer.kind", "Answer definition must be valid JSON.")
	} else if answerKind != questionType {
		appendIssue(&issues, "sat.answer.kind_mismatch", "answer.kind", "The answer definition must match the question type.")
	} else if questionType == "single_choice" {
		validateChoiceAnswer(answerObject, &issues)
	} else {
		if section != SectionMath {
			appendIssue(&issues, "sat.spr.math_only", "questionType", "Student-produced response is only supported in Math.")
		}
		validateSPRAnswer(answerObject, &issues)
	}
	if section == SectionReadingWriting && questionType != "single_choice" {
		appendIssue(&issues, "sat.rw.question_type", "questionType", "Reading & Writing questions must be multiple choice.")
	}
	return issues
}

// validateSATPublishQuestion is deliberately narrower than validateSATQuestion.
// Editor diagnostics can require metadata, rich-content shape, accessibility,
// and provider-specific formatting; the publish contract only owns the four
// content families represented by satpublish.ValidateQuestion.
func validateSATPublishQuestion(row questionValidationRow) []ValidationIssue {
	issues := satpublish.ValidateQuestion(satpublish.Question{
		ExamQuestionID: row.examQuestionID,
		QuestionType:   row.questionType,
		Prompt:         row.prompt,
		Answer:         row.answer,
	})
	out := make([]ValidationIssue, 0, len(issues))
	for _, issue := range issues {
		out = append(out, ValidationIssue{
			Code:     issue.Code,
			Path:     issue.Path,
			Message:  issue.Message,
			Blocking: issue.Blocking,
		})
	}
	return out
}

func (s *Service) validateSATExam(ctx context.Context, shell Shell, rep ValidationReport, scope satpublish.Scope) (ValidationReport, error) {
	issues, err := satpublish.ValidateDraftForScope(ctx, s.db, shell.VersionID, scope)
	if err != nil {
		return ValidationReport{}, err
	}
	for _, issue := range issues {
		rep.Errors = append(rep.Errors, ValidationIssue{
			Code:     issue.Code,
			Path:     issue.Path,
			Message:  issue.Message,
			Blocking: issue.Blocking,
		})
	}

	var endingRevision int
	if err := s.db.QueryRowContext(ctx, "SELECT revision FROM exam_versions WHERE id = ? AND exam_id = ? AND is_draft = TRUE", shell.VersionID, shell.ExamID).Scan(&endingRevision); err == nil && endingRevision != shell.VersionRevision {
		return ValidationReport{}, conflictError("The SAT draft changed while publish checks were running. Run the checks again.")
	}
	rep.Valid = len(rep.Errors) == 0
	return rep, nil
}

func validateChoiceAnswer(answer map[string]any, issues *[]ValidationIssue) {
	options, _ := answer["options"].([]any)
	if len(options) != 4 {
		appendIssue(issues, "sat.choice.count", "answer.options", "SAT multiple-choice questions require four answer choices.")
	}
	correct := stringField(answer, "correctOptionId", "correct_option_id")
	if strings.TrimSpace(correct) == "" {
		appendIssue(issues, "sat.correct_answer.required", "answer.correctOptionId", "Select the correct answer.")
	} else {
		found := false
		for _, option := range options {
			if object, ok := option.(map[string]any); ok && stringField(object, "id") == correct {
				found = true
				break
			}
		}
		if !found {
			appendIssue(issues, "sat.correct_answer.invalid", "answer.correctOptionId", "The correct answer must reference one of the answer choices.")
		}
	}
	for index, option := range options {
		object, _ := option.(map[string]any)
		content, exists := object["content"]
		if !exists {
			content = map[string]any{}
		}
		raw, _ := json.Marshal(content)
		path := fmt.Sprintf("answer.options[%d].content", index)
		validateContent(string(raw), path, issues)
		if !hasContent(string(raw)) {
			appendIssue(issues, "sat.choice.content.required", path, "Answer choice content is required.")
		}
	}
}

type sprResponseError struct{ code, message string }

func validateSPRResponse(response string) *sprResponseError {
	value := strings.TrimSpace(response)
	negative := strings.HasPrefix(value, "-")
	maxLength := 5
	if negative {
		maxLength = 6
	}
	if len(value) > maxLength {
		return &sprResponseError{"length", fmt.Sprintf("SAT responses allow at most %d characters%s.", maxLength, map[bool]string{true: " including the minus sign", false: ""}[negative])}
	}
	for _, character := range value {
		if (character < '0' || character > '9') && character != '-' && character != '.' && character != '/' {
			return &sprResponseError{"characters", "Use only digits, a decimal point, a fraction bar, or a leading minus sign."}
		}
	}
	if strings.Count(value, "-") > 1 || (strings.Contains(value, "-") && !negative) {
		return &sprResponseError{"format", "A minus sign can appear only once, at the beginning."}
	}
	unsigned := strings.TrimPrefix(value, "-")
	if unsigned == "" || (strings.Contains(unsigned, "/") && strings.Contains(unsigned, ".")) {
		return &sprResponseError{"format", "Enter an integer, decimal, or fraction such as 12, .5, or 3/4."}
	}
	if strings.Contains(unsigned, "/") {
		parts := strings.Split(unsigned, "/")
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" || !allDigits(parts[0]) || !allDigits(parts[1]) {
			return &sprResponseError{"format", "Enter an integer, decimal, or fraction such as 12, .5, or 3/4."}
		}
		if strings.Trim(parts[1], "0") == "" {
			return &sprResponseError{"denominator_zero", "A fraction denominator cannot be zero."}
		}
		return nil
	}
	if allDigits(unsigned) {
		return nil
	}
	if strings.Count(unsigned, ".") == 1 {
		parts := strings.SplitN(unsigned, ".", 2)
		if parts[1] != "" && (parts[0] == "" || allDigits(parts[0])) && allDigits(parts[1]) {
			return nil
		}
	}
	return &sprResponseError{"format", "Enter an integer, decimal, or fraction such as 12, .5, or 3/4."}
}

func allDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func validateSPRAnswer(answer map[string]any, issues *[]ValidationIssue) {
	values, _ := answer["acceptedResponses"].([]any)
	if values == nil {
		values, _ = answer["accepted_responses"].([]any)
	}
	responses := make([]string, 0, len(values))
	for _, value := range values {
		if response, ok := value.(string); ok {
			responses = append(responses, response)
		}
	}
	nonEmpty := 0
	for _, response := range responses {
		if strings.TrimSpace(response) != "" {
			nonEmpty++
		}
	}
	if nonEmpty == 0 {
		appendIssue(issues, "sat.spr.answer.required", "answer.acceptedResponses", "At least one accepted response is required.")
	} else if len(responses) == 0 || strings.TrimSpace(responses[0]) == "" {
		appendIssue(issues, "sat.spr.primary.required", "answer.acceptedResponses[0]", "Enter a primary SAT response before adding equivalents.")
	}
	for index, response := range responses {
		if strings.TrimSpace(response) == "" {
			continue
		}
		if validation := validateSPRResponse(response); validation != nil {
			appendIssue(issues, "sat.spr."+validation.code, fmt.Sprintf("answer.acceptedResponses[%d]", index), validation.message)
		}
	}
}
