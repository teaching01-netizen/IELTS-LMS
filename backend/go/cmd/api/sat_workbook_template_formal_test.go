package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
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
		{name: "wrong pretest count", cell: "O2", value: "No"},
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
