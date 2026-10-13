package authoring

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"testing"

	"github.com/xuri/excelize/v2"
)

func singleSATWorkbookBytes(t *testing.T, target string, scaffolds bool) []byte {
	t.Helper()
	book, err := excelize.OpenReader(bytes.NewReader(completeSATWorkbookBytes(t, "Question")))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	row := 2
	for _, spec := range satWorkbookModules {
		for order := 1; order <= spec.count; order++ {
			if spec.key == target {
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

func TestParseSATWorkbookSingleModuleUnknownPretests(t *testing.T) {
	for _, spec := range satWorkbookModules {
		for _, scaffolds := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/scaffolds=%v", spec.key, scaffolds), func(t *testing.T) {
				preview, err := ParseSATWorkbook(singleSATWorkbookBytes(t, spec.key, scaffolds), SatWorkbookImportOptions{Mode: "single_module", TargetModuleKey: spec.key})
				if err != nil {
					t.Fatal(err)
				}
				if !preview.Valid || len(preview.Modules) != 1 || preview.QuestionCount != spec.count || preview.RowCount != spec.count {
					t.Fatalf("single module not content-valid: %+v", preview)
				}
				raw, _ := json.Marshal(preview)
				var wire struct {
					Modules []struct {
						Questions []map[string]any `json:"questions"`
					} `json:"modules"`
				}
				if err := json.Unmarshal(raw, &wire); err != nil {
					t.Fatal(err)
				}
				for _, question := range wire.Modules[0].Questions {
					pretest, present := question["isPretest"]
					if !present || pretest != nil {
						t.Fatalf("Unknown was converted to a Boolean: %s", raw)
					}
				}
			})
		}
	}
}

func TestParseSATWorkbookSingleModuleBlocksModifiedScaffolds(t *testing.T) {
	for _, column := range []string{"C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R"} {
		t.Run(column, func(t *testing.T) {
			book, err := excelize.OpenReader(bytes.NewReader(singleSATWorkbookBytes(t, "rw-m1", true)))
			if err != nil {
				t.Fatal(err)
			}
			defer book.Close()
			book.SetCellValue("Questions", column+"29", "Authored or modified content")
			preview, err := ParseSATWorkbook(workbookBytes(t, book), SatWorkbookImportOptions{Mode: "single_module", TargetModuleKey: "rw-m1"})
			if err != nil {
				t.Fatal(err)
			}
			if preview.Valid {
				t.Fatal("non-target content silently discarded")
			}
			found := false
			for _, issue := range preview.Issues {
				if issue.Row == 29 && issue.Blocking {
					found = true
				}
			}
			if !found {
				t.Fatalf("missing non-target row diagnostic: %+v", preview.Issues)
			}
		})
	}
}

func TestParseSATWorkbookSingleModuleStillChecksIgnoredRowFormulas(t *testing.T) {
	book, err := excelize.OpenReader(bytes.NewReader(singleSATWorkbookBytes(t, "rw-m1", true)))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	book.SetCellFormula("Questions", "C29", "=1+1")
	preview, err := ParseSATWorkbook(workbookBytes(t, book), SatWorkbookImportOptions{Mode: "single_module", TargetModuleKey: "rw-m1"})
	if err != nil {
		t.Fatal(err)
	}
	if preview.Valid || !hasWorkbookIssue(preview.Issues, "Formulas are not allowed") {
		t.Fatalf("formula hidden by scaffold handling: %+v", preview)
	}
}

func TestParseSATWorkbookSingleModuleRejectsInvalidScope(t *testing.T) {
	for _, options := range []SatWorkbookImportOptions{{Mode: "anything"}, {Mode: "single_module"}, {Mode: "single_module", TargetModuleKey: "unknown"}, {Mode: "full", TargetModuleKey: "rw-m1"}} {
		if _, err := ParseSATWorkbook(singleSATWorkbookBytes(t, "rw-m1", false), options); err == nil {
			t.Fatalf("invalid scope accepted: %+v", options)
		}
	}
}
