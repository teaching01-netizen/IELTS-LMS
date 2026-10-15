package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"example.com/ielts-proctoring/internal/authoring"
)

func TestSATWorkbookGuidanceUsesLiteralTextCells(t *testing.T) {
	data, err := buildSATWorkbookTemplate()
	if err != nil {
		t.Fatal(err)
	}
	book, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = book.Close() }()

	for _, sheet := range []string{"Guide", "AI Instructions"} {
		rows, err := book.GetRows(sheet)
		if err != nil {
			t.Fatalf("read %s: %v", sheet, err)
		}
		for rowIndex, row := range rows {
			for columnIndex := range row {
				cell := fmt.Sprintf("%s%d", satWorkbookColumnName(columnIndex+1), rowIndex+1)
				cellType, err := book.GetCellType(sheet, cell)
				if err != nil {
					t.Fatalf("read %s!%s type: %v", sheet, cell, err)
				}
				if cellType != excelize.CellTypeInlineString {
					t.Errorf("%s!%s type = %v, want inline text", sheet, cell, cellType)
				}
				formula, err := book.GetCellFormula(sheet, cell)
				if err != nil {
					t.Fatalf("read %s!%s formula: %v", sheet, cell, err)
				}
				if formula != "" {
					t.Errorf("%s!%s unexpectedly contains formula %q", sheet, cell, formula)
				}
			}
		}
	}
}

func TestSATWorkbookTextXMLRoundTrip(t *testing.T) {
	want := "A&B <tag> \"quoted\" 'apostrophe' Ω \\ path\nnext line"
	data, err := buildSATWorkbookTemplate()
	if err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}

	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	for _, file := range archive.File {
		contents, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		fileBytes, readErr := io.ReadAll(contents)
		closeErr := contents.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		if closeErr != nil {
			t.Fatal(closeErr)
		}
		if file.Name == "xl/worksheets/sheet2.xml" {
			fileBytes = []byte(satWorkbookSimpleSheet([][]string{{"Round trip", want}}))
		}
		entry, err := writer.Create(file.Name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(fileBytes); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	book, err := excelize.OpenReader(bytes.NewReader(output.Bytes()))
	if err != nil {
		t.Fatalf("Excelize could not reopen generated XML text: %v", err)
	}
	defer func() { _ = book.Close() }()
	got, err := book.GetCellValue("Guide", "B1")
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("round-tripped text = %q, want %q", got, want)
	}
	if formula, err := book.GetCellFormula("Guide", "B1"); err != nil || formula != "" {
		t.Fatalf("round-tripped text formula = %q, error = %v; want plain text", formula, err)
	}
}

func TestSATWorkbookParserRejectsHostileCompletedFixtures(t *testing.T) {
	completed := completedGeneratedWorkbookBytes(t)

	cases := []struct {
		name         string
		cell         string
		value        string
		formula      bool
		pictureSheet string
		picture      bool
	}{
		{name: "missing prompt", cell: "C2", value: ""},
		{name: "duplicate order", cell: "B3", value: "1"},
		{name: "section-invalid domain", cell: "L2", value: "Algebra"},
		{name: "student response in reading writing", cell: "E2", value: "Student Response"},
		{name: "formula in Questions", cell: "C2", value: "=1+1", formula: true},
		{name: "picture on Guide", pictureSheet: "Guide", cell: "A1", picture: true},
		{name: "picture outside Assets image column", pictureSheet: "Assets", cell: "C2", picture: true},
	}
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/q5sAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mutated, err := excelize.OpenReader(bytes.NewReader(completed))
			if err != nil {
				t.Fatal(err)
			}
			if tc.picture {
				err = mutated.AddPictureFromBytes(tc.pictureSheet, tc.cell, &excelize.Picture{Extension: ".png", File: png})
			} else if tc.formula {
				err = mutated.SetCellFormula("Questions", tc.cell, tc.value)
			} else {
				err = mutated.SetCellValue("Questions", tc.cell, tc.value)
			}
			if err != nil {
				t.Fatal(err)
			}
			var workbookBytes bytes.Buffer
			if err := mutated.Write(&workbookBytes); err != nil {
				t.Fatal(err)
			}
			if err := mutated.Close(); err != nil {
				t.Fatal(err)
			}

			preview, err := authoring.ParseSATWorkbook(workbookBytes.Bytes())
			if err != nil {
				t.Fatalf("ParseSATWorkbook() error = %v", err)
			}
			if preview.Valid {
				t.Fatalf("hostile workbook was valid: %+v", preview)
			}
		})
	}
}

func TestSATWorkbookParserAcceptsPictureInAssetsImageColumn(t *testing.T) {
	completed := completedGeneratedWorkbookBytes(t)
	book, err := excelize.OpenReader(bytes.NewReader(completed))
	if err != nil {
		t.Fatal(err)
	}
	if err := book.SetCellValue("Assets", "A2", "graph"); err != nil {
		t.Fatal(err)
	}
	if err := book.SetCellValue("Assets", "B2", "A one pixel diagram"); err != nil {
		t.Fatal(err)
	}
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/q5sAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	if err := book.AddPictureFromBytes("Assets", "D2", &excelize.Picture{Extension: ".png", File: png}); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := book.Write(&output); err != nil {
		t.Fatal(err)
	}
	if err := book.Close(); err != nil {
		t.Fatal(err)
	}
	preview, err := authoring.ParseSATWorkbook(output.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Valid || len(preview.Assets) != 1 {
		t.Fatalf("Assets column-D picture preview valid=%v assets=%d issues=%+v", preview.Valid, len(preview.Assets), preview.Issues)
	}
}

func completedGeneratedWorkbookBytes(t *testing.T) []byte {
	t.Helper()
	template, err := buildSATWorkbookTemplate()
	if err != nil {
		t.Fatal(err)
	}
	book, err := excelize.OpenReader(bytes.NewReader(template))
	if err != nil {
		t.Fatal(err)
	}
	completed := completeGeneratedSATWorkbook(t, book)
	if err := book.Close(); err != nil {
		t.Fatal(err)
	}
	return completed
}

func TestSATWorkbookGuideExplainsStudentPlacementAndWorkedExamples(t *testing.T) {
	data, err := buildSATWorkbookTemplate()
	if err != nil {
		t.Fatal(err)
	}
	book, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = book.Close() }()
	rows, err := book.GetRows("Guide")
	if err != nil {
		t.Fatal(err)
	}
	guide := flattenSATWorkbookRows(rows)
	for _, text := range []string{
		"Question text", "Passage or image", "above the answers", "separate pane", "stacked",
		"genuinely empty", "None", "N/A", "grading only", "Explanation", "staff metadata",
		"EXAMPLE · TEXT ONLY", "EXAMPLE · PASSAGE", "EXAMPLE · TABLE", "EXAMPLE · GRAPH", "EXAMPLE · NUMERIC",
		"| Area (square feet) | Water (gallons) |", "![bike_value]", "crop", "OCR", "source page",
		"Filled modules only", "untouched template defaults",
	} {
		if !strings.Contains(guide, text) {
			t.Errorf("Guide missing %q", text)
		}
	}
	for _, outdated := range []string{"replaces all six modules", "All six module labels and counts", "Medium and No", "both require authored questions"} {
		if strings.Contains(guide, outdated) {
			t.Errorf("Guide retains outdated requirement %q", outdated)
		}
	}
	examples := make(map[string]map[string]string)
	for _, row := range rows {
		if len(row) < 3 || !strings.HasPrefix(row[0], "EXAMPLE ·") {
			continue
		}
		if examples[row[0]] == nil {
			examples[row[0]] = make(map[string]string)
		}
		examples[row[0]][row[1]] = row[2]
	}
	for _, example := range []string{"TEXT ONLY", "PASSAGE", "TABLE", "GRAPH", "NUMERIC"} {
		fields := examples["EXAMPLE ·"+" "+example]
		if fields["Prompt"] == "" || fields["Response Type"] == "" {
			t.Errorf("%s example lacks Prompt or Response Type", example)
		}
	}
	if got := examples["EXAMPLE · TABLE"]["Stimulus"]; !strings.Contains(got, "|---") || !strings.Contains(got, "3,780") {
		t.Errorf("table example is not a Markdown table: %q", got)
	}
	if got := examples["EXAMPLE · GRAPH"]["Stimulus"]; got != "![bike_value]" {
		t.Errorf("graph Stimulus = %q", got)
	}
	if got := examples["EXAMPLE · NUMERIC"]["Accepted Responses"]; got != "4" {
		t.Errorf("numeric accepted response = %q", got)
	}
	prompt, err := book.GetCellValue("AI Instructions", "B4")
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"Question text", "Passage or image", "genuinely empty", "None", "N/A", "grading only", "source page", "graphs", "Markdown tables", "untouched template defaults"} {
		if !strings.Contains(prompt, text) {
			t.Errorf("AI prompt missing %q", text)
		}
	}
	if strings.Contains(prompt, "both modules still require") {
		t.Error("AI prompt requires both adaptive branches")
	}
}

func TestSATWorkbookReferenceSheetsAreReadable(t *testing.T) {
	data, err := buildSATWorkbookTemplate()
	if err != nil {
		t.Fatal(err)
	}
	book, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = book.Close() }()
	for _, sheet := range []string{"Guide", "AI Instructions"} {
		width, err := book.GetColWidth(sheet, "C")
		if err != nil || width < 50 {
			t.Errorf("%s column C width = %v, error %v; want >=50", sheet, width, err)
		}
		for _, cell := range []string{"A1", "B2", "C2"} {
			id, err := book.GetCellStyle(sheet, cell)
			if err != nil {
				t.Fatal(err)
			}
			style, err := book.GetStyle(id)
			if err != nil {
				t.Fatal(err)
			}
			if style.Alignment == nil || !style.Alignment.WrapText || style.Alignment.Vertical != "top" {
				t.Errorf("%s!%s needs wrapped, top-aligned text", sheet, cell)
			}
			if cell == "A1" && (style.Font == nil || !style.Font.Bold) {
				t.Errorf("%s needs a bold heading", sheet)
			}
		}
	}
}
