package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"example.com/ielts-proctoring/internal/authoring"
)

func TestSATWorkbookTemplateRoundTripsThroughImporter(t *testing.T) {
	data, err := buildSATWorkbookTemplate()
	if err != nil {
		t.Fatalf("buildSATWorkbookTemplate() error = %v", err)
	}
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("generated workbook is not a readable ZIP archive: %v", err)
	}
	for _, file := range archive.File {
		if strings.HasPrefix(file.Name, "xl/media/") {
			t.Fatalf("generated template unexpectedly contains embedded media %q", file.Name)
		}
	}
	book, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("generated workbook is not readable: %v", err)
	}
	defer func() { _ = book.Close() }()

	wantSheets := []string{"Questions", "Guide", "Assets", "AI Instructions", "_SAT"}
	if got := book.GetSheetList(); fmt.Sprint(got) != fmt.Sprint(wantSheets) {
		t.Fatalf("sheet order = %v, want %v", got, wantSheets)
	}
	if active := book.GetActiveSheetIndex(); active != 3 {
		t.Fatalf("active sheet index = %d, want 3 (AI Instructions)", active)
	}
	if activeName := book.GetSheetName(book.GetActiveSheetIndex()); activeName != "AI Instructions" {
		t.Fatalf("active sheet = %q, want AI Instructions", activeName)
	}
	if visible, err := book.GetSheetVisible("_SAT"); err != nil || visible {
		t.Fatalf("_SAT visible = %v, error = %v; want hidden", visible, err)
	}

	questionRows, err := book.GetRows("Questions")
	if err != nil {
		t.Fatalf("read Questions sheet: %v", err)
	}
	if len(questionRows) != 148 {
		t.Fatalf("Questions rows = %d, want header plus 147 slots", len(questionRows))
	}
	for index, header := range satWorkbookHeaders {
		if got := questionRows[0][index]; got != header {
			t.Errorf("Questions header %d = %q, want %q", index+1, got, header)
		}
	}
	if cellType, err := book.GetCellType("Questions", "B2"); err != nil || cellType != excelize.CellTypeNumber {
		t.Fatalf("Questions!B2 type = %v, error = %v; want numeric order", cellType, err)
	}
	row := 2
	for _, module := range satWorkbookModules {
		for order := 1; order <= module.count; order++ {
			if got, _ := book.GetCellValue("Questions", fmt.Sprintf("A%d", row)); got != module.label {
				t.Errorf("Questions!A%d = %q, want %q", row, got, module.label)
			}
			if got, _ := book.GetCellValue("Questions", fmt.Sprintf("B%d", row)); got != fmt.Sprint(order) {
				t.Errorf("Questions!B%d = %q, want %d", row, got, order)
			}
			for cell, want := range map[string]string{"E": "Multiple Choice", "N": "Medium", "O": "No"} {
				if got, _ := book.GetCellValue("Questions", fmt.Sprintf("%s%d", cell, row)); got != want {
					t.Errorf("Questions!%s%d = %q, want %q", cell, row, got, want)
				}
			}
			row++
		}
	}

	manifestRow := 1
	for _, group := range satWorkbookTaxonomy {
		for _, skill := range group.skills {
			cell := fmt.Sprintf("D%d", manifestRow)
			if got, _ := book.GetCellValue("_SAT", cell); got != skill {
				t.Errorf("_SAT!%s = %q, want %q", cell, got, skill)
			}
			manifestRow++
		}
	}
	if manifestRow != 32 || satWorkbookSkillCount() != 31 {
		t.Fatalf("taxonomy has %d skills, want 31", manifestRow-1)
	}
	if got, _ := book.GetCellValue("_SAT", "D32"); got != "" {
		t.Fatalf("_SAT!D32 = %q, want empty", got)
	}
	validations, err := book.GetDataValidations("Questions")
	if err != nil {
		t.Fatalf("read Questions validations: %v", err)
	}
	if len(validations) != 7 {
		t.Fatalf("Questions validation count = %d, want 7", len(validations))
	}
	validationByRange := make(map[string]string, len(validations))
	for _, validation := range validations {
		validationByRange[validation.Sqref] = validation.Formula1
	}
	for _, ref := range []string{"A2:A148", "E2:E148", "J2:J148", "L2:L148", "M2:M148", "N2:N148", "O2:O148"} {
		if _, ok := validationByRange[ref]; !ok {
			t.Errorf("Questions data validation missing range %s", ref)
		}
	}
	if got := validationByRange["M2:M148"]; got != "_SAT!$D$1:$D$31" {
		t.Errorf("Skill validation formula = %q, want _SAT!$D$1:$D$31", got)
	}
	if got := validationByRange["A2:A148"]; !strings.Contains(got, "Reading & Writing · Module 1") {
		t.Errorf("Module validation formula lost SAT labels: %q", got)
	}

	guideRows, err := book.GetRows("Guide")
	if err != nil {
		t.Fatalf("read Guide sheet: %v", err)
	}
	guideText := flattenSATWorkbookRows(guideRows)
	guideFields := make(map[string]bool, len(satWorkbookGuideFields))
	guideModules := make(map[string]string, len(satWorkbookModules))
	guideTaxonomy := make(map[string]bool, satWorkbookSkillCount())
	for _, guideRow := range guideRows {
		if len(guideRow) < 2 {
			continue
		}
		switch guideRow[0] {
		case "FIELD":
			guideFields[guideRow[1]] = true
		case "MODULE MAP":
			if len(guideRow) > 2 {
				guideModules[guideRow[1]] = guideRow[2]
			}
		case "TAXONOMY":
			if len(guideRow) > 3 {
				guideTaxonomy[guideRow[1]+"|"+guideRow[2]+"|"+guideRow[3]] = true
			}
		}
	}
	for _, field := range satWorkbookGuideFields {
		if !guideFields[field[0]] {
			t.Errorf("Guide is missing field definition for %q", field[0])
		}
	}
	for _, module := range satWorkbookModules {
		mapping, ok := guideModules[module.label]
		if !ok || !strings.Contains(mapping, fmt.Sprintf("%s / %s / %d questions", module.key, module.section, module.count)) {
			t.Errorf("Guide module mapping for %q = %q", module.label, mapping)
		}
	}
	for _, group := range satWorkbookTaxonomy {
		for _, skill := range group.skills {
			if !guideTaxonomy[group.section+"|"+group.domain+"|"+skill] {
				t.Errorf("Guide taxonomy is missing %s / %s / %s", group.section, group.domain, skill)
			}
		}
	}
	for _, expected := range []string{
		"COLUMN / FIELD", "Accepted Responses", "Module 2 — Higher", "Central Ideas and Details",
		"Student Response", "Pretest is optional and not checked at import", "NOT IMPORT READY", "50,000 Unicode characters",
		"![asset_key]", "Inline math:", "Display math:", "level-2 and level-3 headings",
		"token-to-key matches",
	} {
		if !strings.Contains(guideText, expected) {
			t.Errorf("Guide is missing %q", expected)
		}
	}
	prompt, err := book.GetCellValue("AI Instructions", "B4")
	if err != nil {
		t.Fatalf("read copyable AI prompt: %v", err)
	}
	if len([]rune(prompt)) == 0 || len([]rune(prompt)) > 32767 {
		t.Fatalf("AI prompt length = %d runes, want 1..32767", len([]rune(prompt)))
	}
	for _, expected := range []string{
		"Never invent missing questions", "source-to-module/order traceability map",
		"publishing requires exactly two pretests per module", "NOT IMPORT READY", "personal or student information",
		"human must review the workbook against the supplied sources",
	} {
		if !strings.Contains(prompt, expected) {
			t.Errorf("copyable prompt is missing %q", expected)
		}
	}
	if formula, err := book.GetCellFormula("AI Instructions", "B4"); err != nil || formula != "" {
		t.Fatalf("AI prompt formula = %q, error = %v; want plain text", formula, err)
	}
	preview, err := authoring.ParseSATWorkbook(data)
	if err != nil {
		t.Fatalf("generated workbook could not be parsed: %v", err)
	}
	if preview.RowCount != 0 || len(preview.Detected) != 0 || preview.TemplateVersion != "2" {
		t.Fatalf("blank template preview = rows %d, detected %d, version %q; want 0 rows, no modules, version 2", preview.RowCount, len(preview.Detected), preview.TemplateVersion)
	}
	if preview.Valid {
		t.Fatal("blank template must not be importable")
	}
	if hasIssueFragment(preview.Issues, "Formulas are not allowed") {
		t.Fatalf("generated blank template unexpectedly contains a Questions formula: %+v", preview.Issues)
	}

	completed := completeGeneratedSATWorkbook(t, book)
	completePreview, err := authoring.ParseSATWorkbook(completed)
	if err != nil {
		t.Fatalf("completed generated workbook could not be parsed: %v", err)
	}
	if !completePreview.Valid {
		t.Fatalf("completed generated workbook is invalid: %+v", completePreview.Issues)
	}
	if completePreview.RowCount != 147 || completePreview.QuestionCount != 147 || len(completePreview.Modules) != 6 {
		t.Fatalf("completed preview = rows %d, questions %d, modules %d; want 147, 147, 6", completePreview.RowCount, completePreview.QuestionCount, len(completePreview.Modules))
	}
	for index, module := range completePreview.Modules {
		if want := satWorkbookModules[index].count; len(module.Questions) != want {
			t.Errorf("completed module %q has %d questions, want %d", module.ModuleKey, len(module.Questions), want)
		}
	}
}

func completeGeneratedSATWorkbook(t *testing.T, book *excelize.File) []byte {
	t.Helper()
	type classification struct{ domain, skill string }
	taxonomyBySection := make(map[string][]classification)
	for _, group := range satWorkbookTaxonomy {
		for _, skill := range group.skills {
			taxonomyBySection[group.section] = append(taxonomyBySection[group.section], classification{domain: group.domain, skill: skill})
		}
	}
	sectionQuestionCounts := make(map[string]int, len(taxonomyBySection))
	row := 2
	for _, module := range satWorkbookModules {
		for order := 1; order <= module.count; order++ {
			classifications := taxonomyBySection[module.section]
			if len(classifications) == 0 {
				t.Fatalf("missing taxonomy for section %q", module.section)
			}
			selectedTaxonomy := classifications[sectionQuestionCounts[module.section]%len(classifications)]
			sectionQuestionCounts[module.section]++
			values := map[string]any{
				"A": module.label, "B": order, "C": "Which answer is correct?", "D": "",
				"E": "Multiple Choice", "F": "Choice A", "G": "Choice B", "H": "Choice C", "I": "Choice D",
				"J": "A", "K": "", "L": selectedTaxonomy.domain, "M": selectedTaxonomy.skill,
				"N": "Medium", "O": map[bool]string{true: "Yes", false: "No"}[order <= 2], "P": "Rationale", "Q": "source workbook test",
			}
			if module.section == "Math" {
				if order == 1 {
					values["E"] = "Student Response"
					values["F"], values["G"], values["H"], values["I"], values["J"] = "", "", "", "", ""
					values["K"] = "1; 1.0"
				}
			}
			for column, value := range values {
				if err := book.SetCellValue("Questions", fmt.Sprintf("%s%d", column, row), value); err != nil {
					t.Fatalf("set Questions!%s%d: %v", column, row, err)
				}
			}
			row++
		}
	}
	var output bytes.Buffer
	if err := book.Write(&output); err != nil {
		t.Fatalf("write completed workbook: %v", err)
	}
	return output.Bytes()
}

func flattenSATWorkbookRows(rows [][]string) string {
	var cells []string
	for _, row := range rows {
		cells = append(cells, row...)
	}
	return strings.Join(cells, "\n")
}

func hasIssueFragment(issues []authoring.SatWorkbookIssue, fragment string) bool {
	for _, issue := range issues {
		if strings.Contains(issue.Message, fragment) {
			return true
		}
	}
	return false
}
