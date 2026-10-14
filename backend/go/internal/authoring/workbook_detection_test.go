package authoring

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

// moduleSheetBytes returns a workbook where only the listed modules hold real
// content (pretest left blank). Every other module keeps either untouched
// template defaults (scaffolds) or empty rows, as a user's sheet would.
func moduleSheetBytes(t *testing.T, filled []string, scaffolds bool) []byte {
	t.Helper()
	book, err := excelize.OpenReader(bytes.NewReader(completeSATWorkbookBytes(t, "Question")))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	isFilled := map[string]bool{}
	for _, key := range filled {
		isFilled[key] = true
	}
	row := 2
	for _, spec := range satWorkbookModules {
		for order := 1; order <= spec.count; order++ {
			if isFilled[spec.key] {
				book.SetCellValue("Questions", "O"+strconv.Itoa(row), "")
			} else {
				for col := 1; col <= 17; col++ {
					book.SetCellValue("Questions", workbookColumnName(col)+strconv.Itoa(row), "")
				}
				if scaffolds {
					for col, value := range map[string]any{"A": spec.label, "B": order, "E": "Multiple Choice", "N": "Medium", "O": "No"} {
						book.SetCellValue("Questions", col+strconv.Itoa(row), value)
					}
				}
			}
			row++
		}
	}
	return workbookBytes(t, book)
}

func detectedKeys(preview SatWorkbookPreview) []string {
	keys := make([]string, 0, len(preview.Detected))
	for _, module := range preview.Detected {
		keys = append(keys, module.ModuleKey)
	}
	return keys
}

func TestParseSATWorkbookDetectsEachModuleFromTheSheet(t *testing.T) {
	for _, spec := range satWorkbookModules {
		for _, scaffolds := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/scaffolds=%v", spec.key, scaffolds), func(t *testing.T) {
				preview, err := ParseSATWorkbook(moduleSheetBytes(t, []string{spec.key}, scaffolds))
				if err != nil {
					t.Fatal(err)
				}
				if !preview.Valid || !preview.CommitReady || preview.QuestionCount != spec.count || preview.RowCount != spec.count {
					t.Fatalf("module not importable: %+v", preview.Issues)
				}
				if !reflect.DeepEqual(preview.TargetModuleKeys, []string{spec.key}) || !reflect.DeepEqual(detectedKeys(preview), []string{spec.key}) {
					t.Fatalf("wrong modules detected: %v", preview.TargetModuleKeys)
				}
				got := preview.Detected[0]
				if !got.Ready || got.QuestionCount != spec.count || got.ExpectedCount != spec.count || got.Label != spec.label {
					t.Fatalf("detected module report wrong: %+v", got)
				}
				if scaffolds && preview.IgnoredScaffoldRows != 147-spec.count {
					t.Fatalf("ignored %d untouched rows, want %d", preview.IgnoredScaffoldRows, 147-spec.count)
				}
			})
		}
	}
}

func TestParseSATWorkbookDetectsSeveralModulesInTemplateOrder(t *testing.T) {
	preview, err := ParseSATWorkbook(moduleSheetBytes(t, []string{"math-m1", "rw-m1"}, true))
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Valid || preview.QuestionCount != 27+22 || len(preview.Modules) != 2 {
		t.Fatalf("multi-module sheet not importable: %+v", preview.Issues)
	}
	if !reflect.DeepEqual(preview.TargetModuleKeys, []string{"rw-m1", "math-m1"}) || preview.Modules[0].ModuleKey != "rw-m1" || preview.Modules[1].ModuleKey != "math-m1" {
		t.Fatalf("modules not in template order: %v", preview.TargetModuleKeys)
	}
}

func TestParseSATWorkbookCompleteSheetDetectsAllSixModules(t *testing.T) {
	preview, err := ParseSATWorkbook(completeSATWorkbookBytes(t, "Question"))
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Valid || len(preview.Detected) != len(satWorkbookModules) || preview.QuestionCount != 147 {
		t.Fatalf("complete sheet: %+v", preview.Issues)
	}
}

func TestParseSATWorkbookReportsAnIncompleteDetectedModule(t *testing.T) {
	book, err := excelize.OpenReader(bytes.NewReader(moduleSheetBytes(t, []string{"rw-m1", "math-m1"}, true)))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	// Math module 1 starts at row 2+27*3; clear its last two rows.
	first := 2 + 27*3
	for _, row := range []int{first + 20, first + 21} {
		for col := 1; col <= 17; col++ {
			book.SetCellValue("Questions", workbookColumnName(col)+strconv.Itoa(row), "")
		}
	}
	preview, err := ParseSATWorkbook(workbookBytes(t, book))
	if err != nil {
		t.Fatal(err)
	}
	if preview.Valid || preview.CommitReady {
		t.Fatal("an incomplete detected module must block the import")
	}
	var rw, math SatWorkbookDetectedModule
	for _, module := range preview.Detected {
		if module.ModuleKey == "rw-m1" {
			rw = module
		} else {
			math = module
		}
	}
	if !rw.Ready || math.Ready || math.QuestionCount != 20 || math.ExpectedCount != 22 {
		t.Fatalf("per-module status wrong: rw=%+v math=%+v", rw, math)
	}
	if !hasWorkbookIssue(preview.Issues, "requires exactly 22 questions; found 20") {
		t.Fatalf("missing count diagnostic: %+v", preview.Issues)
	}
}

func TestParseSATWorkbookNeverDiscardsAuthoredContentInAnotherModule(t *testing.T) {
	// Touching one cell of an otherwise-untouched module makes it part of the
	// import, where it must be complete; it is never silently dropped.
	for _, column := range []string{"C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R"} {
		t.Run(column, func(t *testing.T) {
			book, err := excelize.OpenReader(bytes.NewReader(moduleSheetBytes(t, []string{"rw-m1"}, true)))
			if err != nil {
				t.Fatal(err)
			}
			defer book.Close()
			book.SetCellValue("Questions", column+"29", "Authored or modified content")
			preview, err := ParseSATWorkbook(workbookBytes(t, book))
			if err != nil {
				t.Fatal(err)
			}
			if preview.Valid {
				t.Fatal("authored content outside the first module was silently discarded")
			}
			if !reflect.DeepEqual(detectedKeys(preview), []string{"rw-m1", "rw-m2-lower"}) || preview.Detected[1].Ready {
				t.Fatalf("touched module not detected as incomplete: %+v", preview.Detected)
			}
		})
	}
}

func TestParseSATWorkbookStillChecksFormulasInIgnoredRows(t *testing.T) {
	book, err := excelize.OpenReader(bytes.NewReader(moduleSheetBytes(t, []string{"rw-m1"}, true)))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	book.SetCellFormula("Questions", "Z29", "=1+1")
	preview, err := ParseSATWorkbook(workbookBytes(t, book))
	if err != nil {
		t.Fatal(err)
	}
	if preview.Valid || !hasWorkbookIssue(preview.Issues, "Formulas are not allowed") {
		t.Fatalf("formula hidden by scaffold handling: %+v", preview)
	}
}

func TestParseSATWorkbookWithNoModuleContentIsNotImportable(t *testing.T) {
	preview, err := ParseSATWorkbook(moduleSheetBytes(t, nil, true))
	if err != nil {
		t.Fatal(err)
	}
	if preview.Valid || len(preview.Detected) != 0 || len(preview.Modules) != 0 || !hasWorkbookIssue(preview.Issues, "No SAT questions were found") {
		t.Fatalf("an empty template must not be importable: %+v", preview)
	}
}

func TestParseSATWorkbookIgnoresPretestColumn(t *testing.T) {
	book, err := excelize.OpenReader(bytes.NewReader(moduleSheetBytes(t, []string{"rw-m1"}, true)))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	book.SetCellValue("Questions", "O2", "Maybe")
	book.SetCellValue("Questions", "O3", "Yes")
	preview, err := ParseSATWorkbook(workbookBytes(t, book))
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Valid || hasWorkbookIssue(preview.Issues, "Pretest") {
		t.Fatalf("pretest column was validated: %+v", preview.Issues)
	}
	first, second, third := preview.Modules[0].Questions[0], preview.Modules[0].Questions[1], preview.Modules[0].Questions[2]
	if first.IsPretest != nil || first.QuestionDraft.IsPretest || third.IsPretest != nil {
		t.Fatal("an unrecognised or blank pretest must be Unknown and import as not-pretest")
	}
	if second.IsPretest == nil || !*second.IsPretest || !second.QuestionDraft.IsPretest {
		t.Fatal("a Yes pretest must carry through")
	}
}

func TestParseSATWorkbookDoesNotRequireAPretestColumn(t *testing.T) {
	book, err := excelize.OpenReader(bytes.NewReader(moduleSheetBytes(t, []string{"rw-m1"}, false)))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	if err := book.RemoveCol("Questions", "O"); err != nil {
		t.Fatal(err)
	}
	preview, err := ParseSATWorkbook(workbookBytes(t, book))
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Valid {
		t.Fatalf("a workbook without a Pretest column must import: %+v", preview.Issues)
	}
}

func TestPretestCellIsInformationalOnTheWire(t *testing.T) {
	preview, err := ParseSATWorkbook(moduleSheetBytes(t, []string{"rw-m1"}, false))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(preview)
	if !strings.Contains(string(raw), `"isPretest":null`) {
		t.Fatalf("Unknown pretest must serialise as null: %s", raw)
	}
}

func TestCanonicalWorkbookTargetsRejectsUnknownOrEmpty(t *testing.T) {
	for _, keys := range [][]string{nil, {}, {"unknown"}, {"rw-m1", "unknown"}} {
		if _, err := canonicalWorkbookTargets(keys); err == nil {
			t.Fatalf("invalid targets accepted: %v", keys)
		}
	}
	got, err := canonicalWorkbookTargets([]string{"math-m1", "rw-m1", "math-m1"})
	if err != nil || !reflect.DeepEqual(got, []string{"rw-m1", "math-m1"}) {
		t.Fatalf("targets not distinct and ordered: %v %v", got, err)
	}
}

func TestIssuesFromOtherSheetsAreNeverAttributedToAModule(t *testing.T) {
	// A picture anchored on row 5 of a sheet other than Assets produces an issue numbered 5.
	// Row 5 of Questions belongs to Reading & Writing · Module 1, but the issue
	// is workbook-wide and must not mark that module as needing attention.
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/q5sAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	book, err := excelize.OpenReader(bytes.NewReader(moduleSheetBytes(t, []string{"rw-m1"}, true)))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	if err := book.AddPictureFromBytes("Questions", "Z5", &excelize.Picture{Extension: ".png", File: png}); err != nil {
		t.Fatal(err)
	}
	preview, err := ParseSATWorkbook(workbookBytes(t, book))
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, issue := range preview.Issues {
		if issue.Field == "Assets" {
			found = true
			if issue.ModuleKey != "" {
				t.Fatalf("an Assets-sheet issue was attributed to %q", issue.ModuleKey)
			}
		}
	}
	if !found || preview.Valid {
		t.Fatalf("the misplaced picture must block the import: %+v", preview.Issues)
	}
	if len(preview.Detected) != 1 || !preview.Detected[0].Ready {
		t.Fatalf("module readiness must not absorb workbook-wide issues: %+v", preview.Detected)
	}
}
