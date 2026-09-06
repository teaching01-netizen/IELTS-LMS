package main

import (
	"bytes"
	"testing"

	"github.com/xuri/excelize/v2"

	"example.com/ielts-proctoring/internal/authoring"
)

func TestSATWorkbookTemplateRoundTripsThroughImporter(t *testing.T) {
	data, err := buildSATWorkbookTemplate()
	if err != nil {
		t.Fatalf("buildSATWorkbookTemplate() error = %v", err)
	}
	book, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("generated workbook is not readable: %v", err)
	}
	defer func() { _ = book.Close() }()
	for _, expected := range []string{"Questions", "Guide", "Assets", "AI Instructions", "_SAT"} {
		found := false
		for _, sheet := range book.GetSheetList() {
			if sheet == expected {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("generated workbook is missing sheet %q", expected)
		}
	}
	preview, err := authoring.ParseSATWorkbook(data)
	if err != nil {
		t.Fatalf("generated workbook could not be parsed: %v", err)
	}
	if preview.RowCount != 147 || preview.TemplateVersion != "2" {
		t.Fatalf("template preview = rows %d, version %q; want 147, 2", preview.RowCount, preview.TemplateVersion)
	}
	if preview.Valid {
		t.Fatal("blank template must not be importable")
	}
}
