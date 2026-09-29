package results

import "testing"

func TestSATRawdataHeaderRowsMatchTemplateWidthAndPositions(t *testing.T) {
	headers := SATRawdataHeaderRows()
	if len(headers) != 2 {
		t.Fatalf("expected 2 header rows, got %d", len(headers))
	}
	for i, row := range headers {
		if len(row) != SATRawdataColumns {
			t.Fatalf("header row %d has %d columns, want %d", i+1, len(row), SATRawdataColumns)
		}
	}

	row1 := headers[0]
	if row1[0] != "A" || row1[25] != "Z" || row1[26] != "AA" || row1[48] != "AW" || row1[49] != "" {
		t.Fatalf("unexpected column-letter row: %#v", row1)
	}

	row2 := headers[1]
	want := map[int]string{
		0:  "First name",
		2:  "email",
		3:  "Percentage",
		4:  "Points received",
		5:  "Points available",
		14: "IP Address",
		20: "",
		21: "Q1",
		30: "Q10",
		47: "Q27",
		48: "เติมชุดข้อสอบ",
		49: "RECHECK",
	}
	for index, value := range want {
		if row2[index] != value {
			t.Errorf("header row 2 column %d = %q, want %q", index, row2[index], value)
		}
	}
}

func TestSATRawdataHeaderRowsReturnFreshCopy(t *testing.T) {
	first := SATRawdataHeaderRows()
	first[1][48] = "mutated"
	if SATRawdataHeaderRows()[1][48] != "เติมชุดข้อสอบ" {
		t.Fatal("header rows must be returned as a copy, not the package template")
	}
}

func TestSATRawdataColumnLetter(t *testing.T) {
	cases := map[int]string{1: "A", 26: "Z", 27: "AA", 49: "AW", 52: "AZ", 53: "BA", 0: ""}
	for index, want := range cases {
		if got := satRawdataColumnLetter(index); got != want {
			t.Errorf("satRawdataColumnLetter(%d) = %q, want %q", index, got, want)
		}
	}
}

func TestSATRawdataQuestionCountPerSection(t *testing.T) {
	if got := satRawdataQuestionCount(SATRawdataSectionReadingWriting); got != 27 {
		t.Fatalf("reading-writing question count = %d, want 27", got)
	}
	if got := satRawdataQuestionCount(SATRawdataSectionMath); got != 22 {
		t.Fatalf("math question count = %d, want 22", got)
	}
	if got := satRawdataQuestionCount("science"); got != 0 {
		t.Fatalf("unknown section question count = %d, want 0", got)
	}
}

func TestSATRawdataModuleCodeMapping(t *testing.T) {
	cases := map[string]string{"base": "A", "lower_branch": "B", "higher_branch": "C", "none": "", "": ""}
	for role, want := range cases {
		if got := satRawdataModuleCode(role); got != want {
			t.Errorf("satRawdataModuleCode(%q) = %q, want %q", role, got, want)
		}
	}
}

func TestSATRawdataPercentageMatchesTemplateFormat(t *testing.T) {
	// Expected values are transcribed from the external RAWDATA Verbal template:
	// 18/27 -> 66.70%, 22/27 -> 81.50%, 23/27 -> 85.20%, 25/27 -> 92.60%,
	// 12/27 -> 44.40%, 27/27 -> 100.00% (1-decimal value, two decimals shown).
	cases := []struct {
		received, available int
		want                string
	}{
		{1, 27, "3.70%"},
		{2, 22, "9.10%"},
		{12, 27, "44.40%"},
		{18, 27, "66.70%"},
		{22, 27, "81.50%"},
		{23, 27, "85.20%"},
		{25, 27, "92.60%"},
		{27, 27, "100.00%"},
		{0, 27, "0.00%"},
		{5, 0, ""},
	}
	for _, c := range cases {
		if got := satRawdataPercentage(c.received, c.available); got != c.want {
			t.Errorf("satRawdataPercentage(%d, %d) = %q, want %q", c.received, c.available, got, c.want)
		}
	}
}

func TestSATRawdataHeaderRowIdentifiersAreExported(t *testing.T) {
	if len(SATRawdataHeaderRow1) != SATRawdataColumns || len(SATRawdataHeaderRow2) != SATRawdataColumns {
		t.Fatalf("exported header rows must be %d wide: %d/%d", SATRawdataColumns, len(SATRawdataHeaderRow1), len(SATRawdataHeaderRow2))
	}
	rows := SATRawdataHeaderRows()
	if rows[0][0] != SATRawdataHeaderRow1[0] || rows[1][48] != SATRawdataHeaderRow2[48] {
		t.Fatal("SATRawdataHeaderRows must mirror the exported row identifiers")
	}
}

func TestSATRawdataRowValidation(t *testing.T) {
	if err := validateSATRawdataRow(make([]string, SATRawdataColumns)); err != nil {
		t.Fatalf("50-column row must validate: %v", err)
	}
	if err := validateSATRawdataRow(make([]string, SATRawdataColumns-1)); err == nil {
		t.Fatal("short row must fail validation")
	}
	if err := validateSATRawdataHeaders([][]string{{"a"}}); err == nil {
		t.Fatal("single header row must fail validation")
	}
}
