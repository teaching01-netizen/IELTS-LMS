package results

import (
	"errors"
	"math"
	"strconv"

	"github.com/xuri/excelize/v2"
)

// BuildSATRawdataXLSX serializes the section projections into a two-sheet
// workbook, plus the optional third "SAT Forms" sheet. StreamWriter keeps large
// exports from retaining a second full worksheet representation in memory.
func BuildSATRawdataXLSX(export *SATRawdataExport) ([]byte, error) {
	if export == nil {
		return nil, errors.New("sat rawdata export is required")
	}
	if len(export.Sheets) < 2 || export.Sheets[0].Name != "SAT Math" || export.Sheets[1].Name != "SAT Verbal" {
		return nil, errors.New("sat rawdata export requires SAT Math and SAT Verbal sheets")
	}
	if len(export.Sheets) > 3 {
		return nil, errors.New("sat rawdata export supports at most three sheets")
	}
	if len(export.Sheets) == 3 && export.Sheets[2].Name != SATFormsSheetName {
		return nil, errors.New("the third sat rawdata sheet must be SAT Forms")
	}

	book := excelize.NewFile()
	defer func() { _ = book.Close() }()

	for index, sheet := range export.Sheets {
		if index == 0 {
			if err := book.SetSheetName("Sheet1", sheet.Name); err != nil {
				return nil, err
			}
			continue
		}
		if _, err := book.NewSheet(sheet.Name); err != nil {
			return nil, err
		}
	}
	book.SetActiveSheet(0)

	for _, sheet := range export.Sheets {
		if err := validateSATSheet(sheet); err != nil {
			return nil, err
		}

		writer, err := book.NewStreamWriter(sheet.Name)
		if err != nil {
			return nil, err
		}
		if err := writer.SetPanes(&excelize.Panes{
			Freeze:      true,
			YSplit:      2,
			TopLeftCell: "A3",
			ActivePane:  "bottomLeft",
		}); err != nil {
			return nil, err
		}

		numeric := sheet.isNumericColumn
		rowNumber := 1
		for _, row := range sheet.HeaderRows {
			if err := writeSATRawdataWorkbookRow(writer, rowNumber, row, numeric); err != nil {
				return nil, err
			}
			rowNumber++
		}
		for _, row := range sheet.Rows {
			if err := writeSATRawdataWorkbookRow(writer, rowNumber, row, numeric); err != nil {
				return nil, err
			}
			rowNumber++
		}
		if err := writer.Flush(); err != nil {
			return nil, err
		}
	}

	buffer, err := book.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

// isNumericColumn reports whether the workbook should write a column as a
// number.
//
// A sheet that carries its own width also carries an explicit numeric-column
// list (SAT Forms: only "number" questions). Otherwise the frozen rawdata rule
// applies, so SAT Math / SAT Verbal keep their exact pre-forms formatting.
func (s SATRawdataSheet) isNumericColumn(column int) bool {
	if s.ColumnCount > 0 {
		for _, index := range s.NumericColumns {
			if index == column {
				return true
			}
		}
		return false
	}
	return isSATRawdataNumericColumn(column)
}

func writeSATRawdataWorkbookRow(writer *excelize.StreamWriter, rowNumber int, row []string, numeric func(int) bool) error {
	cell, err := excelize.CoordinatesToCellName(1, rowNumber)
	if err != nil {
		return err
	}
	values := make([]interface{}, len(row))
	for column, value := range row {
		if numeric(column) {
			if number, parseErr := strconv.Atoi(value); parseErr == nil {
				values[column] = number
				continue
			}
			if number, parseErr := strconv.ParseFloat(value, 64); parseErr == nil && !math.IsNaN(number) && !math.IsInf(number, 0) {
				values[column] = number
				continue
			}
		}
		// Strings are emitted as inline strings, including formula-looking
		// candidate names, so spreadsheet applications do not evaluate them.
		values[column] = value
	}
	return writer.SetRow(cell, values)
}

func isSATRawdataNumericColumn(column int) bool {
	return column == satRawdataColPointsReceived ||
		column == satRawdataColPointsAvailable ||
		(column >= satRawdataColFirstQuestion && column < satRawdataColFirstQuestion+SATRawdataReadingWritingQuestions)
}
