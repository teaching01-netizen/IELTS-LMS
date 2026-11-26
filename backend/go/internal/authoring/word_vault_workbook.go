package authoring

import (
	"archive/zip"
	"bytes"
	"fmt"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"example.com/ielts-proctoring/internal/satwordvault"
	"github.com/xuri/excelize/v2"
)

const (
	MaxWordVaultBytes   = 2 << 20
	wordVaultUnzipLimit = 16 << 20
	wordVaultSheet      = "Vocabulary"
	wordVaultMaxEntries = 200
)

var wordVaultHeaders = []string{"Module", "Question number", "Vocabulary word", "Thai meaning", "English definition", "Example sentence"}

type WordVaultIssue struct {
	Row     int    `json:"row"`
	Column  string `json:"column"`
	Message string `json:"message"`
}

type wordVaultRow struct {
	number   int
	question int
	entry    satwordvault.Entry
}

func WordVaultTemplate() ([]byte, error) {
	book := excelize.NewFile()
	defer book.Close()
	if err := book.SetSheetName("Sheet1", wordVaultSheet); err != nil {
		return nil, err
	}
	if _, err := book.NewSheet("Guide"); err != nil {
		return nil, err
	}
	headers := make([]any, len(wordVaultHeaders))
	for i, header := range wordVaultHeaders {
		headers[i] = header
	}
	if err := book.SetSheetRow(wordVaultSheet, "A1", &headers); err != nil {
		return nil, err
	}
	guide := [][]any{
		{"The Word Vault", "Fill in Vocabulary. A confirmed upload replaces the entire draft Word Vault."},
		{"Module", "Use the matching Reading & Writing module. Use the question number shown in that module."},
		{"Example (reference only)", "Reading & Writing · Module 1", 1, "adapt", "ปรับตัว", "To adjust to a new situation.", "The team adapted to the new schedule."},
	}
	for _, spec := range satWorkbookModules {
		if spec.sectionKey == SectionReadingWriting {
			guide = append(guide, []any{"Module label", spec.label})
		}
	}
	for i, row := range guide {
		if err := book.SetSheetRow("Guide", "A"+strconv.Itoa(i+1), &row); err != nil {
			return nil, err
		}
	}
	headerStyle, err := book.NewStyle(&excelize.Style{
		Font: &excelize.Font{Bold: true, Color: "#14375C"},
		Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"#E6F1FC"}},
	})
	if err != nil {
		return nil, err
	}
	if err := book.SetCellStyle(wordVaultSheet, "A1", "F1", headerStyle); err != nil {
		return nil, err
	}
	if err := book.SetPanes(wordVaultSheet, &excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"}); err != nil {
		return nil, err
	}
	for i, width := range []float64{38, 18, 26, 28, 50, 50} {
		column, _ := excelize.ColumnNumberToName(i + 1)
		if err := book.SetColWidth(wordVaultSheet, column, column, width); err != nil {
			return nil, err
		}
	}
	if err := book.SetColWidth("Guide", "A", "G", 32); err != nil {
		return nil, err
	}
	out, err := book.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func parseWordVault(data []byte) ([]wordVaultRow, []WordVaultIssue, error) {
	if len(data) > MaxWordVaultBytes {
		return nil, nil, &WorkbookError{TooLarge: true, Message: "Vocabulary workbooks must be 2 MB or smaller."}
	}
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil || len(archive.File) > maxSATWorkbookZipEntries {
		return nil, nil, &WorkbookError{Message: "Choose a readable vocabulary .xlsx workbook."}
	}
	var size uint64
	for _, file := range archive.File {
		name := strings.ToLower(file.Name)
		if file.Flags&1 != 0 || strings.HasPrefix(name, "xl/embeddings/") || strings.HasPrefix(name, "xl/media/") ||
			strings.HasPrefix(name, "xl/externallinks/") || strings.Contains(name, "vbaproject") {
			return nil, nil, &WorkbookError{Message: "Use a plain workbook without encryption, attachments, external links, or macros."}
		}
		if file.UncompressedSize64 > wordVaultUnzipLimit-size {
			return nil, nil, &WorkbookError{TooLarge: true, Message: "The vocabulary workbook expands beyond 16 MB."}
		}
		size += file.UncompressedSize64
	}
	book, err := excelize.OpenReader(bytes.NewReader(data), excelize.Options{UnzipSizeLimit: wordVaultUnzipLimit, UnzipXMLSizeLimit: wordVaultUnzipLimit, RawCellValue: true})
	if err != nil {
		return nil, nil, &WorkbookError{Message: "Choose a readable vocabulary .xlsx workbook."}
	}
	defer book.Close()
	rows, err := book.Rows(wordVaultSheet)
	if err != nil {
		return nil, nil, &WorkbookError{Message: "The Vocabulary worksheet is missing. Start with the vocabulary template."}
	}
	defer rows.Close()

	issues := make([]WordVaultIssue, 0)
	var parsed []wordVaultRow
	seen := make(map[wordVaultRow]bool)
	nonempty := 0
	line := 0
	for rows.Next() {
		line++
		if line > 1000 {
			return nil, nil, &WorkbookError{Message: "Keep the Vocabulary worksheet within the first 1,000 rows."}
		}
		cells, err := rows.Columns()
		if err != nil {
			return nil, nil, &WorkbookError{Message: "A row in the Vocabulary worksheet could not be read."}
		}
		for i := range cells {
			cells[i] = strings.TrimSpace(cells[i])
		}
		for len(cells) < len(wordVaultHeaders) {
			cells = append(cells, "")
		}
		report := func(column int, message string) {
			letter, _ := excelize.ColumnNumberToName(column + 1)
			issues = append(issues, WordVaultIssue{line, letter, message})
		}
		start := len(issues)
		for i := range cells {
			if i >= len(wordVaultHeaders) {
				if cells[i] != "" {
					report(i, "Use the six columns in the vocabulary template.")
					break
				}
				continue
			}
			cell, _ := excelize.CoordinatesToCellName(i+1, line)
			formula, err := book.GetCellFormula(wordVaultSheet, cell)
			if err != nil {
				return nil, nil, &WorkbookError{Message: "A cell in the Vocabulary worksheet could not be read."}
			}
			if formula != "" {
				report(i, "Paste values here instead of formulas.")
			}
		}
		if line == 1 {
			for i, header := range wordVaultHeaders {
				if !strings.EqualFold(cells[i], header) {
					report(i, fmt.Sprintf("The header must be %q.", header))
				}
			}
			if len(issues) > 0 {
				return nil, issues, nil
			}
			continue
		}
		if strings.Join(cells, "") == "" && len(issues) == start {
			continue
		}
		nonempty++
		if nonempty > wordVaultMaxEntries {
			report(0, "Include at most 200 vocabulary entries.")
			break
		}
		spec, ok := workbookModuleByLabel[normalizeWorkbookValue(cells[0])]
		if !ok || spec.sectionKey != SectionReadingWriting {
			report(0, "Choose a Reading & Writing module listed in the Guide.")
		}
		number, err := strconv.Atoi(cells[1])
		if err != nil || number < 1 {
			report(1, "Enter a positive whole question number.")
		}
		for index, max := range []int{80, 160, 320, 320} {
			value := cells[index+2]
			if value == "" || utf8.RuneCountInString(value) > max || strings.ContainsFunc(value, unicode.IsControl) {
				report(index+2, fmt.Sprintf("Enter plain text between 1 and %d characters on one line.", max))
			}
		}
		if len(issues) != start {
			continue
		}
		row := wordVaultRow{question: number, entry: satwordvault.Entry{
			ModuleKey: spec.key, Word: cells[2], Thai: cells[3], Definition: cells[4], Example: cells[5],
		}}
		if seen[row] {
			report(2, "This vocabulary entry is duplicated.")
			continue
		}
		seen[row] = true
		row.number = line
		parsed = append(parsed, row)
	}
	if err := rows.Error(); err != nil {
		return nil, nil, &WorkbookError{Message: "A row in the Vocabulary worksheet could not be read."}
	}
	if line == 0 {
		return nil, []WordVaultIssue{{1, "A", "Start with the vocabulary template and keep its headers."}}, nil
	}
	return parsed, issues, nil
}
