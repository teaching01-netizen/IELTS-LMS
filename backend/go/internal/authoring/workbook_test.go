package authoring

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestParseSATWorkbookCompleteContract(t *testing.T) {
	bytes := completeSATWorkbookBytes(t, "Question with math:\n\\[x^2=4\\]\n\n| x | y |\n| --- | --- |\n| 1 | 2 |\n\n```python\nprint(1)\n```")
	preview, err := ParseSATWorkbook(bytes)
	if err != nil {
		t.Fatalf("ParseSATWorkbook() error = %v", err)
	}
	if !preview.Valid {
		t.Fatalf("complete workbook was invalid: %+v", preview.Issues)
	}
	if preview.QuestionCount != 147 || len(preview.Modules) != 6 {
		t.Fatalf("unexpected workbook shape: questions=%d modules=%d", preview.QuestionCount, len(preview.Modules))
	}

	var prompt map[string]any
	if err := json.Unmarshal(preview.Modules[0].Questions[0].Prompt, &prompt); err != nil {
		t.Fatalf("prompt is not JSON: %v", err)
	}
	document, ok := prompt["document"].(map[string]any)
	if !ok {
		t.Fatalf("prompt document missing: %#v", prompt)
	}
	content, ok := document["content"].([]any)
	if !ok {
		t.Fatalf("prompt content missing: %#v", document)
	}
	types := make([]string, 0, len(content))
	for _, node := range content {
		object, _ := node.(map[string]any)
		types = append(types, stringField(object, "type"))
	}
	want := []string{"paragraph", "blockMath", "table", "codeBlock"}
	if fmt.Sprint(types) != fmt.Sprint(want) {
		t.Fatalf("rich content types = %v, want %v", types, want)
	}
}

func TestParseSATWorkbookRejectsFormulas(t *testing.T) {
	book := newWorkbook(t)
	setSATHeaders(t, book)
	book.SetCellValue("Questions", "A2", satWorkbookModules[0].label)
	book.SetCellValue("Questions", "B2", 1)
	book.SetCellFormula("Questions", "C2", "=1+1")
	book.SetCellValue("Questions", "D2", "x")
	book.SetCellValue("Questions", "E2", "Multiple Choice")
	book.SetCellValue("Questions", "F2", "A")
	book.SetCellValue("Questions", "G2", "B")
	book.SetCellValue("Questions", "H2", "C")
	book.SetCellValue("Questions", "I2", "D")
	book.SetCellValue("Questions", "J2", "A")
	book.SetCellValue("Questions", "L2", "Information and Ideas")
	book.SetCellValue("Questions", "M2", "Central Ideas and Details")
	book.SetCellValue("Questions", "N2", "Medium")
	book.SetCellValue("Questions", "O2", "Yes")
	book.SetCellValue("Questions", "P2", "rationale")
	book.SetCellValue("Questions", "Q2", "tag")
	data := workbookBytes(t, book)
	preview, err := ParseSATWorkbook(data)
	if err != nil {
		t.Fatalf("ParseSATWorkbook() error = %v", err)
	}
	if preview.Valid {
		t.Fatal("workbook with formula and oversized cell was valid")
	}
	if !hasWorkbookIssue(preview.Issues, "Formulas are not allowed") {
		t.Fatalf("formula issue missing: %+v", preview.Issues)
	}
}

func TestParseSATWorkbookRejectsInvalidContainer(t *testing.T) {
	_, err := ParseSATWorkbook([]byte("not an xlsx"))
	if err == nil {
		t.Fatal("invalid container was accepted")
	}
	workbookErr, ok := err.(*WorkbookError)
	if !ok || workbookErr.Message == "" {
		t.Fatalf("unexpected invalid-container error: %#v", err)
	}
}

func completeSATWorkbookBytes(t *testing.T, firstPrompt string) []byte {
	t.Helper()
	book := newWorkbook(t)
	setSATHeaders(t, book)
	row := 2
	for _, module := range satWorkbookModules {
		for order := 1; order <= module.count; order++ {
			prompt := "Which answer is correct?"
			if row == 2 {
				prompt = firstPrompt
			}
			values := []any{
				module.label, order, prompt, "", "Multiple Choice",
				"Choice A", "Choice B", "Choice C", "Choice D", "A", "",
				map[bool]string{true: "Algebra", false: "Information and Ideas"}[module.sectionKey == SectionMath],
				map[bool]string{true: "Linear Equations in One Variable", false: "Central Ideas and Details"}[module.sectionKey == SectionMath],
				"Medium", map[bool]string{true: "Yes", false: "No"}[order <= 2], "Rationale", "workbook-test",
			}
			for column, value := range values {
				book.SetCellValue("Questions", fmt.Sprintf("%s%d", workbookColumnName(column+1), row), value)
			}
			row++
		}
	}
	return workbookBytes(t, book)
}

func newWorkbook(t *testing.T) *excelize.File {
	t.Helper()
	book := excelize.NewFile()
	if err := book.SetSheetName("Sheet1", "Questions"); err != nil {
		t.Fatal(err)
	}
	if _, err := book.NewSheet("Assets"); err != nil {
		t.Fatal(err)
	}
	book.SetCellValue("Assets", "A1", "Asset Key")
	book.SetCellValue("Assets", "B1", "Alt Text")
	book.SetCellValue("Assets", "C1", "Caption")
	book.SetCellValue("Assets", "D1", "Image")
	return book
}

func setSATHeaders(t *testing.T, book *excelize.File) {
	t.Helper()
	for column, header := range []string{
		"Module", "Order", "Prompt", "Stimulus", "Response Type", "A", "B", "C", "D", "Correct",
		"Accepted Responses", "Domain", "Skill", "Difficulty", "Pretest", "Rationale", "Tags",
	} {
		book.SetCellValue("Questions", fmt.Sprintf("%s1", workbookColumnName(column+1)), header)
	}
}

func workbookBytes(t *testing.T, book *excelize.File) []byte {
	t.Helper()
	defer func() { _ = book.Close() }()
	var out bytes.Buffer
	if err := book.Write(&out); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func hasWorkbookIssue(issues []SatWorkbookIssue, fragment string) bool {
	for _, issue := range issues {
		if strings.Contains(issue.Message, fragment) {
			return true
		}
	}
	return false
}

func workbookInlineMarksByText(t *testing.T, raw json.RawMessage) map[string][]string {
	t.Helper()
	var compiled map[string]any
	if err := json.Unmarshal(raw, &compiled); err != nil {
		t.Fatalf("content is not JSON: %v", err)
	}
	document, _ := compiled["document"].(map[string]any)
	blocks, _ := document["content"].([]any)
	marksByText := map[string][]string{}
	var visit func(node any)
	visit = func(node any) {
		object, ok := node.(map[string]any)
		if !ok {
			return
		}
		if stringField(object, "type") == "text" {
			text := stringField(object, "text")
			var marks []string
			if list, ok := object["marks"].([]any); ok {
				for _, mark := range list {
					markObject, _ := mark.(map[string]any)
					marks = append(marks, stringField(markObject, "type"))
				}
			}
			marksByText[text] = marks
		}
		if children, ok := object["content"].([]any); ok {
			for _, child := range children {
				visit(child)
			}
		}
	}
	for _, block := range blocks {
		visit(block)
	}
	return marksByText
}

func workbookAllText(t *testing.T, raw json.RawMessage) string {
	t.Helper()
	var compiled map[string]any
	if err := json.Unmarshal(raw, &compiled); err != nil {
		t.Fatalf("content is not JSON: %v", err)
	}
	var parts []string
	var visit func(node any)
	visit = func(node any) {
		object, ok := node.(map[string]any)
		if !ok {
			return
		}
		if stringField(object, "type") == "text" {
			parts = append(parts, stringField(object, "text"))
		}
		if latex, ok := object["attrs"].(map[string]any); ok && (stringField(object, "type") == "inlineMath" || stringField(object, "type") == "blockMath") {
			parts = append(parts, stringField(latex, "latex"))
		}
		if children, ok := object["content"].([]any); ok {
			for _, child := range children {
				visit(child)
			}
		}
	}
	document, _ := compiled["document"].(map[string]any)
	blocks, _ := document["content"].([]any)
	for _, block := range blocks {
		visit(block)
	}
	return strings.Join(parts, "")
}

func TestCompileWorkbookContentInlineMarks(t *testing.T) {
	raw := `**bold** and *italic* and ++underlined text++ and ` + "`code`" + ` and \(x^2+3x\)`
	marks := workbookInlineMarksByText(t, compileWorkbookContent(raw, map[string]string{}, map[string]string{}))
	for text, want := range map[string]string{
		"bold": "bold", "italic": "italic", "underlined text": "underline", "code": "code",
	} {
		got, ok := marks[text]
		if !ok {
			t.Fatalf("missing inline node %q: %+v", text, marks)
		}
		if len(got) != 1 || got[0] != want {
			t.Fatalf("marks for %q = %v, want [%s]", text, got, want)
		}
	}
	combined := workbookAllText(t, compileWorkbookContent(raw, map[string]string{}, map[string]string{}))
	if strings.Contains(combined, "++") || strings.Contains(combined, "**") {
		t.Fatalf("valid markers leaked as literal text: %q", combined)
	}
}

func TestCompileWorkbookContentUnderlineEdgeCases(t *testing.T) {
	for _, raw := range []string{"a ++unclosed", "++++", "++ ++", "trace ++"} {
		combined := workbookAllText(t, compileWorkbookContent(raw, map[string]string{}, map[string]string{}))
		if !strings.Contains(combined, "++") {
			t.Fatalf("expected literal ++ in %q, got %q", raw, combined)
		}
		marks := workbookInlineMarksByText(t, compileWorkbookContent(raw, map[string]string{}, map[string]string{}))
		for text, list := range marks {
			for _, mark := range list {
				if mark == "underline" {
					t.Fatalf("unexpected underline mark for %q (text %q)", raw, text)
				}
			}
		}
	}
}

func TestParseSATWorkbookPreservesUnderlineInPromptAndChoices(t *testing.T) {
	book := newWorkbook(t)
	setSATHeaders(t, book)
	row := 2
	for _, module := range satWorkbookModules {
		for order := 1; order <= module.count; order++ {
			prompt := "Which answer is correct?"
			choiceA := "Choice A"
			if row == 2 {
				prompt = "Define the ++key term++ with **bold**, *italic*, `code`, and \\(x^2\\)."
				choiceA = "The ++underlined choice++"
			}
			values := []any{
				module.label, order, prompt, "", "Multiple Choice",
				choiceA, "Choice B", "Choice C", "Choice D", "A", "",
				map[bool]string{true: "Algebra", false: "Information and Ideas"}[module.sectionKey == SectionMath],
				map[bool]string{true: "Linear Equations in One Variable", false: "Central Ideas and Details"}[module.sectionKey == SectionMath],
				"Medium", map[bool]string{true: "Yes", false: "No"}[order <= 2], "Rationale with ++note++", "workbook-test",
			}
			for column, value := range values {
				book.SetCellValue("Questions", fmt.Sprintf("%s%d", workbookColumnName(column+1), row), value)
			}
			row++
		}
	}
	preview, err := ParseSATWorkbook(workbookBytes(t, book))
	if err != nil {
		t.Fatalf("ParseSATWorkbook() error = %v", err)
	}
	if !preview.Valid {
		t.Fatalf("underline workbook was invalid: %+v", preview.Issues)
	}
	first := preview.Modules[0].Questions[0]
	promptMarks := workbookInlineMarksByText(t, first.Prompt)
	if got := promptMarks["key term"]; len(got) != 1 || got[0] != "underline" {
		t.Fatalf("prompt underline marks = %+v, want underline on %q", promptMarks, "key term")
	}
	for _, want := range []string{"bold", "italic", "code"} {
		found := false
		for _, marks := range promptMarks {
			for _, mark := range marks {
				if mark == want {
					found = true
				}
			}
		}
		if !found {
			t.Fatalf("prompt missing %s mark: %+v", want, promptMarks)
		}
	}
	if combined := workbookAllText(t, first.Prompt); strings.Contains(combined, "++") {
		t.Fatalf("prompt markers leaked as literal text: %q", combined)
	}
	var answer map[string]any
	if err := json.Unmarshal(first.Answer, &answer); err != nil {
		t.Fatalf("answer is not JSON: %v", err)
	}
	options, _ := answer["options"].([]any)
	if len(options) == 0 {
		t.Fatal("answer has no options")
	}
	option, _ := options[0].(map[string]any)
	contentBytes, _ := json.Marshal(option["content"])
	choiceMarks := workbookInlineMarksByText(t, contentBytes)
	if got := choiceMarks["underlined choice"]; len(got) != 1 || got[0] != "underline" {
		t.Fatalf("choice underline marks = %+v", choiceMarks)
	}
	if combined := workbookAllText(t, contentBytes); strings.Contains(combined, "++") {
		t.Fatalf("choice markers leaked as literal text: %q", combined)
	}
	rationaleMarks := workbookInlineMarksByText(t, first.Rationale)
	if got := rationaleMarks["note"]; len(got) != 1 || got[0] != "underline" {
		t.Fatalf("rationale underline marks = %+v", rationaleMarks)
	}
}
