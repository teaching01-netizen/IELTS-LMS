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
	for _, module := range preview.Modules {
		pretests := 0
		for _, question := range module.Questions {
			if question.IsPretest {
				pretests++
			}
		}
		if pretests != 2 {
			t.Errorf("module %s has %d pretests", module.ModuleKey, pretests)
		}
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
