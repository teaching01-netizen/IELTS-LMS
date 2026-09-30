package results

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// SAT RAWDATA export schema.
//
// This file owns the *external compatibility contract* for the SAT Student
// Access "Export RAWDATA XLSX" surface: the two header rows, the fixed
// 50-column width, the per-section question counts, and the
// assessment_modules.adaptive_role -> เติมชุดข้อสอบ code mapping. The exporter
// (and its tests) read the same constants so the workbook cannot drift per caller.
//
// The template is shared by Reading & Writing (Verbal) and Math; only the
// populated Q-column range differs. Columns are never added or removed — a
// value the exporter cannot source with confidence stays the empty string.

const (
	// SATRawdataSchemaVersion is bumped whenever the column contract changes.
	SATRawdataSchemaVersion = 2
	// SATRawdataColumns is the exact width of every exported row. The
	// template is a fixed-width contract; missing values are "".
	SATRawdataColumns = 50
)

// Section keys read from assessment_sections.section_key. The export never
// infers the section from a module name.
const (
	SATRawdataSectionReadingWriting = "reading-writing"
	SATRawdataSectionMath           = "math"
)

// Question counts per section. The populated Q-range is Q1..Q<count>; the
// remaining question columns stay empty.
const (
	SATRawdataReadingWritingQuestions = 27
	SATRawdataMathQuestions           = 22
)

// Answer cell values. "0" means *incorrect*, so a question whose correctness
// cannot be determined safely is always the empty string, never "0".
const (
	SATRawdataAnswerCorrect   = "1"
	SATRawdataAnswerIncorrect = "0"
	SATRawdataAnswerNoAnswer  = "No answer"
	// SATRawdataRecheck is the fixed RECHECK cell for an administered row.
	SATRawdataRecheck = "TRUE"
)

// 0-based indices of the summary/metadata cells the exporter owns. Everything
// else is left blank: the template's date/time and extra-information columns
// have no confirmed business meaning, so guessing is forbidden.
//
// Percentage / Points received / Points available are always written together
// as the arithmetic of the exported Q cells over the section's fixed question
// count (27 verbal, 22 math). They are blank only for a module that was never
// entered: an entered module with no administered questions is a score of zero,
// not a missing score.
const (
	satRawdataColFirstName       = 0  // full candidate name (kept unsplit)
	satRawdataColEmail           = 2  // email
	satRawdataColPercentage      = 3  // Percentage
	satRawdataColPointsReceived  = 4  // Points received
	satRawdataColPointsAvailable = 5  // Points available
	satRawdataColCandidateID     = 12 // cm_user_id
	satRawdataColFirstQuestion   = 21 // Q1
	satRawdataColModuleCode      = 48 // เติมชุดข้อสอบ
	satRawdataColRecheck         = 49 // RECHECK
)

// SATRawdataHeaderRow2 is the second template header row, verbatim. Column 20
// (0-based) is intentionally blank in the template; Q1 starts at column 21.
var SATRawdataHeaderRow2 = []string{
	"First name",          // 0
	"Last name",           // 1
	"email",               // 2
	"Percentage",          // 3
	"Points received",     // 4
	"Points available",    // 5
	"Minutes",             // 6
	"Seconds",             // 7
	"Date started",        // 8
	"Date finished",       // 9
	"Requires grading",    // 10
	"Certificate Serial",  // 11
	"cm_user_id",          // 12
	"Access code",         // 13
	"IP Address",          // 14
	"Extra information 1", // 15
	"Extra information 2", // 16
	"Extra information 3", // 17
	"Extra information 4", // 18
	"Extra information 5", // 19
	"",                    // 20
	"Q1",                  // 21
	"Q2",                  // 22
	"Q3",                  // 23
	"Q4",                  // 24
	"Q5",                  // 25
	"Q6",                  // 26
	"Q7",                  // 27
	"Q8",                  // 28
	"Q9",                  // 29
	"Q10",                 // 30
	"Q11",                 // 31
	"Q12",                 // 32
	"Q13",                 // 33
	"Q14",                 // 34
	"Q15",                 // 35
	"Q16",                 // 36
	"Q17",                 // 37
	"Q18",                 // 38
	"Q19",                 // 39
	"Q20",                 // 40
	"Q21",                 // 41
	"Q22",                 // 42
	"Q23",                 // 43
	"Q24",                 // 44
	"Q25",                 // 45
	"Q26",                 // 46
	"Q27",                 // 47
	"เติมชุดข้อสอบ", // 48
	"RECHECK", // 49
}

// SATRawdataHeaderRow1 is the template's leading column-letter row: A..AW for
// the first 49 columns and a blank final cell (the template's RECHECK column
// carries no letter).
var SATRawdataHeaderRow1 = func() []string {
	out := make([]string, SATRawdataColumns)
	for i := 0; i < SATRawdataColumns-1; i++ {
		out[i] = satRawdataColumnLetter(i + 1)
	}
	return out
}()

// SATRawdataHeaderRows returns a copy of both template header rows. A fresh
// copy keeps callers from mutating the package-level template.
func SATRawdataHeaderRows() [][]string {
	return [][]string{
		append([]string(nil), SATRawdataHeaderRow1...),
		append([]string(nil), SATRawdataHeaderRow2...),
	}
}

// satRawdataColumnLetter converts a 1-based column number to its spreadsheet
// letter (1 -> A, 27 -> AA).
func satRawdataColumnLetter(index int) string {
	if index < 1 {
		return ""
	}
	name := ""
	for index > 0 {
		index--
		name = string(rune('A'+index%26)) + name
		index /= 26
	}
	return name
}

// satRawdataQuestionCount maps a section_key to its exported question count.
// Unknown sections return 0 so the caller skips them instead of inventing a
// range.
func satRawdataQuestionCount(sectionKey string) int {
	switch strings.TrimSpace(sectionKey) {
	case SATRawdataSectionReadingWriting:
		return SATRawdataReadingWritingQuestions
	case SATRawdataSectionMath:
		return SATRawdataMathQuestions
	default:
		return 0
	}
}

// satRawdataModuleCode maps assessment_modules.adaptive_role to the
// เติมชุดข้อสอบ code. This is read from the administered module, never
// calculated from a score.
func satRawdataModuleCode(adaptiveRole string) string {
	switch strings.TrimSpace(adaptiveRole) {
	case "base":
		return "A"
	case "lower_branch":
		return "B"
	case "higher_branch":
		return "C"
	default:
		return ""
	}
}

// satRawdataPercentage renders points received over points available the way
// the external template does.
//
// The template's observed rule is a 1-decimal percentage padded to exactly two
// decimals and suffixed with '%' — 18/27 -> "66.70%", 12/27 -> "44.40%",
// 23/27 -> "85.20%", 27/27 -> "100.00%". A few sample rows show the 1-decimal
// form trimmed ("44%", "96%"); that is a source-tool artifact of the original
// exporter, not a second formatting rule, so the padded form is used for every
// row. Math uses the same rule with denominator 22.
func satRawdataPercentage(received, available int) string {
	if available <= 0 {
		return ""
	}
	percent := float64(received) / float64(available) * 100
	rounded := math.Round(percent*10) / 10
	return strconv.FormatFloat(rounded, 'f', 2, 64) + "%"
}

// validateSATRawdataRow enforces the fixed-width contract for one row.
func validateSATRawdataRow(row []string) error {
	if len(row) != SATRawdataColumns {
		return fmt.Errorf("sat rawdata row has %d columns, want %d", len(row), SATRawdataColumns)
	}
	return nil
}

// validateSATRawdataRows fails the whole export rather than emitting a CSV
// with a short or over-long row.
func validateSATRawdataRows(rows [][]string) error {
	for i, row := range rows {
		if err := validateSATRawdataRow(row); err != nil {
			return fmt.Errorf("row %d: %w", i, err)
		}
	}
	return nil
}

// validateSATRawdataHeaders pins both header rows to the template width.
func validateSATRawdataHeaders(headerRows [][]string) error {
	if len(headerRows) != 2 {
		return errors.New("sat rawdata export requires exactly two header rows")
	}
	for i, row := range headerRows {
		if err := validateSATRawdataRow(row); err != nil {
			return fmt.Errorf("header row %d: %w", i+1, err)
		}
	}
	return nil
}
