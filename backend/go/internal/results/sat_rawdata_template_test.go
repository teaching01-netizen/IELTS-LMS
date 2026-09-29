package results

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// satRawdataHeaderFixture is the committed, header-only copy of the external
// RAWDATA template ("26C2 SAT Simulation Test (May - Aug 2026) - Score
// Converter - RAWDATA Verbal.csv", rows 1-2). It is checked in so the
// byte-for-byte header pin actually runs in CI: the full template is a
// 566-row export sample that is NOT part of the repository, so a pin that
// only reads it can never fail there.
const satRawdataHeaderFixture = "testdata/sat_rawdata_template_headers.csv"

// satRawdataTemplatePaths are the places the full external template lives in a
// developer checkout. The first readable one wins so the test also works from a
// nested module root.
var satRawdataTemplatePaths = []string{
	filepath.Join("..", "..", "..", "..", "26C2 SAT Simulation Test (May - Aug 2026) - Score Converter - RAWDATA Verbal.csv"),
	filepath.Join("..", "..", "..", "..", "..", "26C2 SAT Simulation Test (May - Aug 2026) - Score Converter - RAWDATA Verbal.csv"),
}

// TestSATRawdataHeadersMatchTemplateFixture is the byte-for-byte header pin: the
// two exported header rows must equal the template exactly. Plan §4 treats the
// template as an external API contract, so a typo in the schema constants must
// fail here rather than ship.
//
// The fixture is mandatory — a missing or unreadable file fails the test instead
// of skipping it, so the contract can never pass vacuously.
func TestSATRawdataHeadersMatchTemplateFixture(t *testing.T) {
	rows := readSATRawdataTemplateRows(t, satRawdataHeaderFixture)
	headers := SATRawdataHeaderRows()
	if len(headers) != len(rows) {
		t.Fatalf("fixture carries %d header rows, schema exports %d", len(rows), len(headers))
	}
	assertRowEqual(t, "column-letter row", headers[0], rows[0])
	assertRowEqual(t, "named header row", headers[1], rows[1])
}

// TestSATRawdataTemplateFixtureMatchesExternalTemplate keeps the committed
// fixture honest: whenever the full external template is present in the
// checkout, the fixture's header rows must still equal it byte for byte, so the
// checked-in copy cannot silently drift from the real template.
//
// Skipping is honest here — a missing developer-local sample says nothing about
// the contract, which TestSATRawdataHeadersMatchTemplateFixture pins
// unconditionally.
func TestSATRawdataTemplateFixtureMatchesExternalTemplate(t *testing.T) {
	var (
		raw  []byte
		path string
	)
	for _, candidate := range satRawdataTemplatePaths {
		data, err := os.ReadFile(candidate)
		if err == nil {
			raw, path = data, candidate
			break
		}
	}
	if raw == nil {
		t.Skip("external RAWDATA template not present in this checkout")
	}

	rows := readSATRawdataTemplateRows(t, satRawdataHeaderFixture)
	external := strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n")
	if len(external) < len(rows) {
		t.Fatalf("%s carries %d lines, expected at least %d header rows", path, len(external), len(rows))
	}
	for i, row := range rows {
		assertRowEqual(t, path+" header row", row, strings.Split(external[i], ","))
	}
}

// readSATRawdataTemplateRows reads a template file's two header rows. An
// unreadable file is a failure, never a skip, and both rows must be exactly
// SATRawdataColumns wide.
func readSATRawdataTemplateRows(t *testing.T, path string) [][]string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read SAT RAWDATA template headers %s: %v", path, err)
	}
	lines := strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n")
	// A trailing record separator leaves one empty final element.
	if n := len(lines); n > 0 && strings.TrimSpace(lines[n-1]) == "" {
		lines = lines[:n-1]
	}
	if len(lines) != 2 {
		t.Fatalf("%s must contain exactly two header rows, got %d", path, len(lines))
	}
	rows := make([][]string, 0, len(lines))
	for i, line := range lines {
		fields := strings.Split(line, ",")
		if len(fields) != SATRawdataColumns {
			t.Fatalf("%s header row %d is %d wide, want %d", path, i+1, len(fields), SATRawdataColumns)
		}
		rows = append(rows, fields)
	}
	return rows
}

func assertRowEqual(t *testing.T, label string, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s length mismatch: got %d want %d", label, len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("%s differs at column %d: got %q want %q", label, i, got[i], want[i])
		}
	}
}

// TestSATRawdataTemplatePositionsMatchSchema pins the two contract anchors the
// plan calls out: เติมชุดข้อสอบ and RECHECK keep their positions.
func TestSATRawdataTemplatePositionsMatchSchema(t *testing.T) {
	headers := SATRawdataHeaderRows()
	if headers[1][satRawdataColModuleCode] != "เติมชุดข้อสอบ" {
		t.Fatalf("เติมชุดข้อสอบ must sit at column %d, got %q", satRawdataColModuleCode, headers[1][satRawdataColModuleCode])
	}
	if headers[1][satRawdataColRecheck] != "RECHECK" {
		t.Fatalf("RECHECK must sit at column %d, got %q", satRawdataColRecheck, headers[1][satRawdataColRecheck])
	}
	if headers[1][satRawdataColFirstQuestion] != "Q1" {
		t.Fatalf("Q1 must sit at column %d, got %q", satRawdataColFirstQuestion, headers[1][satRawdataColFirstQuestion])
	}
}
