package results

import (
	"errors"
	"strconv"

	"github.com/xuri/excelize/v2"
)

// BuildSATRawdataXLSX serializes the section projections into a two-sheet
// workbook. StreamWriter keeps large exports from retaining a second full
// worksheet representation in memory.
func BuildSATRawdataXLSX(export *SATRawdataExport) ([]byte, error) {
	if export == nil {
		return nil, errors.New("sat rawdata export is required")
	}
	if len(export.Sheets) != 2 || export.Sheets[0].Name != "SAT Math" || export.Sheets[1].Name != "SAT Verbal" {
		return nil, errors.New("sat rawdata export requires SAT Math and SAT Verbal sheets")
	}

	book := excelize.NewFile()
	defer func() { _ = book.Close() }()

	if err := book.SetSheetName("Sheet1", export.Sheets[0].Name); err != nil {
		return nil, err
	}
	if _, err := book.NewSheet(export.Sheets[1].Name); err != nil {
		return nil, err
	}
	book.SetActiveSheet(0)

	for _, sheet := range export.Sheets {
		if err := validateSATRawdataHeaders(sheet.HeaderRows); err != nil {
			return nil, err
		}
		if err := validateSATRawdataRows(sheet.Rows); err != nil {
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

		rowNumber := 1
		for _, row := range sheet.HeaderRows {
			if err := writeSATRawdataWorkbookRow(writer, rowNumber, row); err != nil {
				return nil, err
			}
			rowNumber++
		}
		for _, row := range sheet.Rows {
			if err := writeSATRawdataWorkbookRow(writer, rowNumber, row); err != nil {
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

func writeSATRawdataWorkbookRow(writer *excelize.StreamWriter, rowNumber int, row []string) error {
	cell, err := excelize.CoordinatesToCellName(1, rowNumber)
	if err != nil {
		return err
	}
	values := make([]interface{}, len(row))
	for column, value := range row {
		if isSATRawdataNumericColumn(column) {
			if number, parseErr := strconv.Atoi(value); parseErr == nil {
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
