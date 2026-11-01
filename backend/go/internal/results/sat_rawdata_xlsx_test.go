package results

import (
	"bytes"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"
)

func sampleSATRawdataExport(candidateName string) *SATRawdataExport {
	attempt := satRawdataAttempt{
		ID:                 "attempt-1",
		CandidateID:        "000123",
		CandidateName:      candidateName,
		Email:              "candidate@example.com",
		PublishedVersionID: "version-1",
		OrderKey:           time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC),
	}
	modules := []satRawdataModule{
		{AttemptID: attempt.ID, ModuleID: "rw-1", SectionKey: SATRawdataSectionReadingWriting, AdaptiveRole: "base", State: "submitted", ExamVersionID: attempt.PublishedVersionID, SectionOrder: 1, ModuleOrder: 1},
		{AttemptID: attempt.ID, ModuleID: "rw-2", SectionKey: SATRawdataSectionReadingWriting, AdaptiveRole: "higher_branch", State: "submitted", ExamVersionID: attempt.PublishedVersionID, SectionOrder: 1, ModuleOrder: 2},
		{AttemptID: attempt.ID, ModuleID: "math-1", SectionKey: SATRawdataSectionMath, AdaptiveRole: "base", State: "submitted", ExamVersionID: attempt.PublishedVersionID, SectionOrder: 2, ModuleOrder: 1},
		{AttemptID: attempt.ID, ModuleID: "math-2", SectionKey: SATRawdataSectionMath, AdaptiveRole: "lower_branch", State: "submitted", ExamVersionID: attempt.PublishedVersionID, SectionOrder: 2, ModuleOrder: 2},
	}
	readingWritingCells := make([]satRawdataCell, 0, SATRawdataReadingWritingQuestions)
	for order := 0; order < SATRawdataReadingWritingQuestions; order++ {
		value := SATRawdataAnswerNoAnswer
		if order < 18 {
			value = SATRawdataAnswerCorrect
		}
		readingWritingCells = append(readingWritingCells, satRawdataCell{DisplayOrder: order, Value: value})
	}
	mathCells := make([]satRawdataCell, 0, 13)
	for order := 0; order < 12; order++ {
		mathCells = append(mathCells, satRawdataCell{DisplayOrder: order, Value: SATRawdataAnswerCorrect})
	}
	mathCells = append(mathCells, satRawdataCell{DisplayOrder: 12, Value: SATRawdataAnswerIncorrect})
	cells := map[string][]satRawdataCell{
		satRawdataCellGroupKey(attempt.ID, "rw-1"):   readingWritingCells,
		satRawdataCellGroupKey(attempt.ID, "math-1"): mathCells,
	}
	return assembleSATRawdata([]satRawdataAttempt{attempt}, map[string][]satRawdataModule{attempt.ID: modules}, cells, "exam-1", "schedule-1")
}

func TestAssembleSATRawdataSplitsSectionsAndKeepsBothHeaders(t *testing.T) {
	export := sampleSATRawdataExport(" Candidate Name ")
	if export.RowCount != 4 || len(export.Rows) != 4 {
		t.Fatalf("legacy flat projection has %d rows, want 4", export.RowCount)
	}
	if len(export.Sheets) != 2 {
		t.Fatalf("got %d sheets, want 2", len(export.Sheets))
	}
	for i, expected := range []struct {
		name, section string
		rows          int
	}{
		{"SAT Math", SATRawdataSectionMath, 2},
		{"SAT Verbal", SATRawdataSectionReadingWriting, 2},
	} {
		sheet := export.Sheets[i]
		if sheet.Name != expected.name || sheet.SectionKey != expected.section || len(sheet.Rows) != expected.rows {
			t.Fatalf("sheet %d = %#v, want %q / %q with %d rows", i, sheet, expected.name, expected.section, expected.rows)
		}
		if len(sheet.HeaderRows) != 2 || len(sheet.HeaderRows[0]) != SATRawdataColumns || len(sheet.HeaderRows[1]) != SATRawdataColumns {
			t.Fatalf("sheet %q has invalid template headers", sheet.Name)
		}
		for _, row := range sheet.Rows {
			if row[satRawdataColFirstName] != "Candidate Name" || row[1] != "" {
				t.Fatalf("sheet %q did not keep the full name in First name only: %q / %q", sheet.Name, row[0], row[1])
			}
		}
	}
	if got := []string{
		export.Sheets[0].Rows[0][satRawdataColModuleCode],
		export.Sheets[0].Rows[1][satRawdataColModuleCode],
	}; got[0] != "A" || got[1] != "B" {
		t.Fatalf("Math module order/codes = %v, want [A B]", got)
	}
	if got := []string{
		export.Sheets[1].Rows[0][satRawdataColModuleCode],
		export.Sheets[1].Rows[1][satRawdataColModuleCode],
	}; got[0] != "A" || got[1] != "C" {
		t.Fatalf("Verbal module order/codes = %v, want [A C]", got)
	}
	for _, row := range export.Sheets[0].Rows {
		for i := 22; i < 27; i++ {
			if row[satRawdataColFirstQuestion+i] != "" {
				t.Fatalf("Math Q%d must stay blank, got %q", i+1, row[satRawdataColFirstQuestion+i])
			}
		}
	}
	for i := 0; i < SATRawdataReadingWritingQuestions; i++ {
		if export.Sheets[1].Rows[0][satRawdataColFirstQuestion+i] == "" {
			t.Fatalf("Verbal Q%d should be populated in the fixture", i+1)
		}
	}
	if export.Sheets[0].Rows[0][satRawdataColPointsReceived] != "12" || export.Sheets[0].Rows[0][satRawdataColPercentage] != "54.50%" {
		t.Fatalf("Math 12/22 score drifted: %#v", export.Sheets[0].Rows[0][3:6])
	}
	if export.Sheets[1].Rows[0][satRawdataColPointsReceived] != "18" || export.Sheets[1].Rows[0][satRawdataColPercentage] != "66.70%" {
		t.Fatalf("Verbal 18/27 score drifted: %#v", export.Sheets[1].Rows[0][3:6])
	}
}

func TestAssembleSATRawdataMathOnlyStillIncludesVerbalHeaderSheet(t *testing.T) {
	attempt := satRawdataAttempt{ID: "attempt-1", CandidateID: "S1", PublishedVersionID: "version-1"}
	module := satRawdataModule{
		AttemptID: attempt.ID, ModuleID: "math-1", SectionKey: SATRawdataSectionMath,
		AdaptiveRole: "base", State: "submitted", ExamVersionID: attempt.PublishedVersionID,
		SectionOrder: 1, ModuleOrder: 1,
	}
	export := assembleSATRawdata(
		[]satRawdataAttempt{attempt},
		map[string][]satRawdataModule{attempt.ID: {module}},
		map[string][]satRawdataCell{}, "exam-1", "math-only-schedule",
	)
	if len(export.Sheets) != 2 || len(export.Sheets[0].Rows) != 1 || len(export.Sheets[1].Rows) != 0 {
		t.Fatalf("Math-only projection sheets = %#v", export.Sheets)
	}
	for _, sheet := range export.Sheets {
		if len(sheet.HeaderRows) != 2 || len(sheet.HeaderRows[0]) != SATRawdataColumns || len(sheet.HeaderRows[1]) != SATRawdataColumns {
			t.Fatalf("sheet %q lost its template headers", sheet.Name)
		}
	}
}

func TestBuildSATRawdataXLSXUsesSafeTextAndNumericCells(t *testing.T) {
	name := `=HYPERLINK("https://example.invalid"), "Candidate"`
	export := sampleSATRawdataExport("  " + name + "  ")
	data, err := BuildSATRawdataXLSX(export)
	if err != nil {
		t.Fatal(err)
	}

	book, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("generated workbook is not readable: %v", err)
	}
	defer func() { _ = book.Close() }()
	if got, want := book.GetSheetList(), []string{"SAT Math", "SAT Verbal"}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("sheet names = %v, want %v", got, want)
	}
	for _, sheetName := range []string{"SAT Math", "SAT Verbal"} {
		for rowIndex, headerRow := range SATRawdataHeaderRows() {
			for column, expected := range headerRow {
				cell, err := excelize.CoordinatesToCellName(column+1, rowIndex+1)
				if err != nil {
					t.Fatal(err)
				}
				if got, err := book.GetCellValue(sheetName, cell); err != nil || got != expected {
					t.Fatalf("%s header %s = %q, %v; want %q", sheetName, cell, got, err, expected)
				}
			}
		}
	}
	if got, err := book.GetCellValue("SAT Math", "A3"); err != nil || got != name {
		t.Fatalf("candidate name = %q, %v", got, err)
	}
	if got, err := book.GetCellValue("SAT Verbal", "A3"); err != nil || got != name {
		t.Fatalf("Verbal candidate name = %q, %v", got, err)
	}
	if kind, err := book.GetCellType("SAT Math", "A3"); err != nil || kind != excelize.CellTypeInlineString {
		t.Fatalf("formula-looking name type = %v, %v; want inline string", kind, err)
	}
	if formula, err := book.GetCellFormula("SAT Math", "A3"); err != nil || formula != "" {
		t.Fatalf("candidate name formula = %q, %v; want no formula", formula, err)
	}
	if got, err := book.GetCellValue("SAT Math", "M3"); err != nil || got != "000123" {
		t.Fatalf("candidate ID lost its leading zeroes: %q, %v", got, err)
	}
	if kind, err := book.GetCellType("SAT Math", "M3"); err != nil || kind != excelize.CellTypeInlineString {
		t.Fatalf("candidate ID type = %v, %v; want inline string", kind, err)
	}
	for cell, want := range map[string]string{"E3": "12", "F3": "22", "V3": "1", "AH3": "0"} {
		if got, err := book.GetCellValue("SAT Math", cell); err != nil || got != want {
			t.Fatalf("numeric cell %s = %q, %v; want %q", cell, got, err, want)
		}
		if kind, err := book.GetCellType("SAT Math", cell); err != nil || kind != excelize.CellTypeUnset {
			t.Fatalf("numeric cell %s was serialized as text: %v, %v", cell, kind, err)
		}
	}
	for cell, want := range map[string]string{
		"C3":  "candidate@example.com",
		"D3":  "66.70%",
		"AN3": "No answer",
		"AV3": "No answer", // Q27 must survive the XLSX writer.
	} {
		if got, err := book.GetCellValue("SAT Verbal", cell); err != nil || got != want {
			t.Fatalf("text cell %s = %q, %v; want %q", cell, got, err, want)
		}
		if kind, err := book.GetCellType("SAT Verbal", cell); err != nil || kind != excelize.CellTypeInlineString {
			t.Fatalf("text cell %s type = %v, %v; want inline string", cell, kind, err)
		}
	}
	if got, err := book.GetCellValue("SAT Math", "D3"); err != nil || got != "54.50%" {
		t.Fatalf("Math percentage = %q, %v", got, err)
	}
	if kind, err := book.GetCellType("SAT Math", "D3"); err != nil || kind != excelize.CellTypeInlineString {
		t.Fatalf("Math percentage type = %v, %v; want inline string", kind, err)
	}
	panes, err := book.GetPanes("SAT Math")
	if err != nil || !panes.Freeze || panes.YSplit != 2 {
		t.Fatalf("Math frozen panes = %#v, %v; want two frozen header rows", panes, err)
	}
	panes, err = book.GetPanes("SAT Verbal")
	if err != nil || !panes.Freeze || panes.YSplit != 2 {
		t.Fatalf("Verbal frozen panes = %#v, %v; want two frozen header rows", panes, err)
	}
}

func TestBuildSATRawdataXLSXLargeExportOpens(t *testing.T) {
	const students = 10000
	base := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
	attempts := make([]satRawdataAttempt, 0, students)
	modulesByAttempt := make(map[string][]satRawdataModule, students)
	for i := 0; i < students; i++ {
		id := "attempt-" + itoa(i)
		attempt := satRawdataAttempt{
			ID:                 id,
			CandidateID:        "S-" + itoa(i),
			CandidateName:      "Candidate " + itoa(i),
			Email:              itoa(i) + "@example.com",
			PublishedVersionID: "version-1",
			OrderKey:           base.Add(time.Duration(i) * time.Second),
		}
		attempts = append(attempts, attempt)
		modulesByAttempt[id] = []satRawdataModule{{
			AttemptID: id, ModuleID: "module-" + itoa(i), SectionKey: SATRawdataSectionReadingWriting,
			AdaptiveRole: "base", State: "submitted", ExamVersionID: attempt.PublishedVersionID,
			SectionOrder: 1, ModuleOrder: 1,
		}}
	}
	export := assembleSATRawdata(attempts, modulesByAttempt, map[string][]satRawdataCell{}, "exam-1", "schedule-1")
	data, err := BuildSATRawdataXLSX(export)
	if err != nil {
		t.Fatalf("BuildSATRawdataXLSX() error = %v", err)
	}
	book, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("10k workbook is not readable: %v", err)
	}
	defer func() { _ = book.Close() }()
	if got, err := book.GetCellValue("SAT Verbal", "C10002"); err != nil || got != "9999@example.com" {
		t.Fatalf("last exported student = %q, %v", got, err)
	}
	if got, err := book.GetCellValue("SAT Verbal", "A10002"); err != nil || got != "Candidate 9999" {
		t.Fatalf("last exported name = %q, %v", got, err)
	}
	if got, err := book.GetCellValue("SAT Math", "A2"); err != nil || got != "First name" {
		t.Fatalf("empty Math tab lost its header: %q, %v", got, err)
	}
}

// sampleSATFormsExport appends a SAT Forms sheet to the two-sheet fixture. The
// column set mirrors what assembleSATForms produces: identity, one text field,
// one number field, four statuses, attempt_id.
func sampleSATFormsExport() *SATRawdataExport {
	export := sampleSATRawdataExport("Candidate Name")
	export.Sheets = append(export.Sheets, SATRawdataSheet{
		Name: SATFormsSheetName,
		HeaderRows: [][]string{
			{"cm_user_id", "wcode", "candidate_name", "email", "version", "reg.sat_seat_number", "reg.sat_admission_year", "status.registration", "status.verbal_entry", "status.math_entry", "status.eva_sim", "attempt_id"},
			{"cm_user_id", "wcode", "Candidate name", "email", "Version", "Registration · Seat number", "Registration · Admission year", "Registration status", "Verbal entry status", "Math entry status", "Eva SIM status", "attempt_id"},
		},
		Rows: [][]string{
			{"000123", "W123456", `=HYPERLINK("https://example.invalid"), "Ada"`, "candidate@example.com", "2", "A-007", "2027", "submitted", "not_submitted", "not_applicable", "not_tracked", "attempt-1"},
		},
		ColumnCount:    12,
		NumericColumns: []int{6},
	})
	return export
}

func TestBuildSATRawdataXLSXIncludesFormsSheet(t *testing.T) {
	export := sampleSATFormsExport()
	data, err := BuildSATRawdataXLSX(export)
	if err != nil {
		t.Fatal(err)
	}
	book, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("generated workbook is not readable: %v", err)
	}
	defer func() { _ = book.Close() }()

	if got, want := book.GetSheetList(), []string{"SAT Math", "SAT Verbal", SATFormsSheetName}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Fatalf("sheet names = %v, want %v", got, want)
	}
	formsSheet := export.Sheets[2]
	for rowIndex, headerRow := range formsSheet.HeaderRows {
		for column, expected := range headerRow {
			cell, err := excelize.CoordinatesToCellName(column+1, rowIndex+1)
			if err != nil {
				t.Fatal(err)
			}
			if got, err := book.GetCellValue(SATFormsSheetName, cell); err != nil || got != expected {
				t.Fatalf("forms header %s = %q, %v; want %q", cell, got, err, expected)
			}
		}
	}

	// Identity block: cm_user_id keeps its leading zeroes as text.
	if got, err := book.GetCellValue(SATFormsSheetName, "A3"); err != nil || got != "000123" {
		t.Fatalf("cm_user_id = %q, %v", got, err)
	}
	if kind, err := book.GetCellType(SATFormsSheetName, "A3"); err != nil || kind != excelize.CellTypeInlineString {
		t.Fatalf("cm_user_id type = %v, %v; want inline string", kind, err)
	}
	// A number field is a real numeric cell.
	if got, err := book.GetCellValue(SATFormsSheetName, "G3"); err != nil || got != "2027" {
		t.Fatalf("number field = %q, %v", got, err)
	}
	if kind, err := book.GetCellType(SATFormsSheetName, "G3"); err != nil || kind != excelize.CellTypeUnset {
		t.Fatalf("number field type = %v, %v; want numeric", kind, err)
	}
	// A text field stays an inline string, including a formula-looking value.
	if got, err := book.GetCellValue(SATFormsSheetName, "F3"); err != nil || got != "A-007" {
		t.Fatalf("text field = %q, %v", got, err)
	}
	if kind, err := book.GetCellType(SATFormsSheetName, "C3"); err != nil || kind != excelize.CellTypeInlineString {
		t.Fatalf("formula-looking name type = %v, %v; want inline string", kind, err)
	}
	if formula, err := book.GetCellFormula(SATFormsSheetName, "C3"); err != nil || formula != "" {
		t.Fatalf("formula-looking name formula = %q, %v; want none", formula, err)
	}
	// Statuses are exported verbatim.
	if got, err := book.GetCellValue(SATFormsSheetName, "H3"); err != nil || got != "submitted" {
		t.Fatalf("registration status = %q, %v", got, err)
	}
	if got, err := book.GetCellValue(SATFormsSheetName, "K3"); err != nil || got != "not_tracked" {
		t.Fatalf("eva status = %q, %v", got, err)
	}
	if got, err := book.GetCellValue(SATFormsSheetName, "L3"); err != nil || got != "attempt-1" {
		t.Fatalf("attempt_id = %q, %v", got, err)
	}

	panes, err := book.GetPanes(SATFormsSheetName)
	if err != nil || !panes.Freeze || panes.YSplit != 2 {
		t.Fatalf("forms frozen panes = %#v, %v; want two frozen header rows", panes, err)
	}
}

func TestBuildSATRawdataXLSXRejectsUnexpectedSheets(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*SATRawdataExport)
	}{
		{"missing verbal sheet", func(e *SATRawdataExport) { e.Sheets = e.Sheets[:1] }},
		{"unexpected third sheet", func(e *SATRawdataExport) {
			e.Sheets = append(e.Sheets, SATRawdataSheet{Name: "SAT Extra"})
		}},
		{"too many sheets", func(e *SATRawdataExport) {
			e.Sheets = append(e.Sheets, SATRawdataSheet{Name: SATFormsSheetName}, SATRawdataSheet{Name: SATFormsSheetName})
		}},
		{"short forms row", func(e *SATRawdataExport) {
			e.Sheets = append(e.Sheets, SATRawdataSheet{
				Name: SATFormsSheetName,
				HeaderRows: [][]string{
					{"a", "b"},
					{"a", "b"},
				},
				Rows:        [][]string{{"only-one"}},
				ColumnCount: 2,
			})
		}},
		{"numeric column outside the sheet", func(e *SATRawdataExport) {
			e.Sheets = append(e.Sheets, SATRawdataSheet{
				Name: SATFormsSheetName,
				HeaderRows: [][]string{
					{"a", "b"},
					{"a", "b"},
				},
				Rows:           [][]string{{"1", "2"}},
				ColumnCount:    2,
				NumericColumns: []int{2},
			})
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			export := sampleSATRawdataExport("Candidate")
			c.mutate(export)
			if _, err := BuildSATRawdataXLSX(export); err == nil {
				t.Fatal("expected BuildSATRawdataXLSX to reject the sheet layout")
			}
		})
	}
}

func TestBuildSATRawdataXLSXRawdataSheetsIgnoreFormsNumericList(t *testing.T) {
	// The rawdata sheets carry no ColumnCount, so the legacy numeric rule must
	// still apply even when a forms sheet exists with a different list.
	export := sampleSATFormsExport()
	data, err := BuildSATRawdataXLSX(export)
	if err != nil {
		t.Fatal(err)
	}
	book, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = book.Close() }()
	if kind, err := book.GetCellType("SAT Math", "E3"); err != nil || kind != excelize.CellTypeUnset {
		t.Fatalf("Math points cell type = %v, %v; want numeric", kind, err)
	}
}
