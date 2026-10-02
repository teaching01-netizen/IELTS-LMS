package results

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

var (
	satRawdataAttemptColumns = []string{"id", "candidate_id", "candidate_name", "candidate_email", "published_version_id", "order_key"}
	satRawdataModuleColumns  = []string{"attempt_id", "module_id", "section_key", "module_key", "adaptive_role", "state", "exam_version_id", "section_order", "module_order"}
	satRawdataCellColumns    = []string{"attempt_id", "module_id", "exam_question_id", "display_order", "answer_definition", "v2_response", "legacy_response", "config_snapshot"}
)

const satRawdataTestVersion = "version-1"

// Patterns pin both which query is being matched and the version fence: every
// module/question read must be pinned to the attempt's published version.
const (
	satRawdataAttemptQueryPattern = `SELECT a\.id, a\.candidate_id, COALESCE\(a\.candidate_name, ''\), a\.candidate_email`
	satRawdataModuleQueryPattern  = `(?s)SELECT ma\.attempt_id, m\.id, s\.section_key, m\.module_key, m\.adaptive_role, ma\.state.*s\.exam_version_id = a\.published_version_id`
	satRawdataCellQueryPattern    = `(?s)SELECT ma\.attempt_id, m\.id AS module_id, eq\.id AS exam_question_id.*s\.exam_version_id = a\.published_version_id`
)

func singleChoice(option string) string {
	return `{"kind":"single_choice","correctOptionId":"` + option + `"}`
}

func satRawdataAttemptRow(id, candidate, email string, order time.Time) []driver.Value {
	return satRawdataAttemptRowWithName(id, candidate, "", email, order)
}

func satRawdataAttemptRowWithName(id, candidate, name, email string, order time.Time) []driver.Value {
	return []driver.Value{id, candidate, name, email, satRawdataTestVersion, order}
}

func TestExportSATRawdataMixedStatesQuestionRangesAndV2Priority(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	base := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)

	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataAttemptQueryPattern).
		WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataAttemptColumns).
			AddRow(satRawdataAttemptRow("attempt-blank", "C-BLANK", "blank@example.com", base)...).
			AddRow(satRawdataAttemptRow("attempt-rw", "C-RW", "rw@example.com", base.Add(time.Minute))...).
			AddRow(satRawdataAttemptRow("attempt-math", "C-MATH", "math@example.com", base.Add(2*time.Minute))...).
			AddRow(satRawdataAttemptRow("attempt-notstarted", "C-NS", "ns@example.com", base.Add(3*time.Minute))...))
	mock.ExpectQuery(satRawdataModuleQueryPattern).
		WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataModuleColumns).
			AddRow("attempt-rw", "mod-rw-1", "reading-writing", "rw-1", "base", "submitted", satRawdataTestVersion, 1, 1).
			AddRow("attempt-math", "mod-math-1", "math", "m-1", "base", "active", satRawdataTestVersion, 2, 1).
			AddRow("attempt-notstarted", "mod-rw-2", "reading-writing", "rw-2", "higher_branch", "not_started", satRawdataTestVersion, 1, 2))
	cells := sqlmock.NewRows(satRawdataCellColumns).
		AddRow("attempt-rw", "mod-rw-1", "eq-1", 0, singleChoice("B"), nil, `"B"`, nil).
		AddRow("attempt-rw", "mod-rw-1", "eq-2", 1, singleChoice("A"), nil, `"C"`, nil).
		AddRow("attempt-rw", "mod-rw-1", "eq-3", 2, singleChoice("D"), nil, nil, nil).
		AddRow("attempt-rw", "mod-rw-1", "eq-4", 3, `{"kind":"single_choice"}`, nil, `"A"`, nil).
		AddRow("attempt-math", "mod-math-1", "eq-5", 0, singleChoice("B"), `{"answer":"B"}`, nil, nil).
		AddRow("attempt-math", "mod-math-1", "eq-6", 1, singleChoice("B"), `{"answer":"B"}`, `"A"`, nil).
		AddRow("attempt-math", "mod-math-1", "eq-7", 22, singleChoice("B"), nil, `"B"`, nil).
		AddRow("attempt-notstarted", "mod-rw-2", "eq-8", 0, singleChoice("B"), nil, `"B"`, nil)
	// Keep all 22 Math placements present; the extra placement is Q23 and
	// cannot fit the section's fixed range, regardless of its answer.
	for q := 2; q < SATRawdataMathQuestions; q++ {
		cells.AddRow("attempt-math", "mod-math-1", "math-q"+itoa(q+1), q, nil, nil, nil, nil)
	}
	mock.ExpectQuery(satRawdataCellQueryPattern).
		WithArgs("exam-1", "schedule-1").WillReturnRows(cells)
	mock.ExpectCommit()

	out, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	if out.SchemaVersion != SATRawdataSchemaVersion || out.ColumnCount != SATRawdataColumns {
		t.Fatalf("unexpected schema metadata: %#v", out)
	}
	if len(out.HeaderRows) != 2 || len(out.HeaderRows[1]) != SATRawdataColumns {
		t.Fatalf("unexpected header rows: %#v", out.HeaderRows)
	}
	if out.RowCount != 4 || len(out.Rows) != 4 {
		t.Fatalf("expected 4 rows (blank + 3 modules), got %d", len(out.Rows))
	}
	for i, row := range out.Rows {
		if len(row) != SATRawdataColumns {
			t.Fatalf("row %d has %d columns, want %d", i, len(row), SATRawdataColumns)
		}
	}

	// Attempt with no module attempt still emits identity in its blank row.
	blank := out.Rows[0]
	if blank[satRawdataColFirstName] != "" || blank[satRawdataColEmail] != "blank@example.com" || blank[satRawdataColCandidateID] != "C-BLANK" {
		t.Fatalf("blank attempt row must keep identity: %#v", blank[:13])
	}
	for i, cell := range blank {
		if i == satRawdataColFirstName || i == satRawdataColEmail || i == satRawdataColCandidateID {
			continue
		}
		if cell != "" {
			t.Fatalf("blank attempt row has an unexpected value at column %d = %q", i, cell)
		}
	}

	rw := out.Rows[1]
	if rw[satRawdataColEmail] != "rw@example.com" || rw[satRawdataColCandidateID] != "C-RW" {
		t.Fatalf("unexpected rw metadata: %#v", rw[:13])
	}
	if rw[satRawdataColModuleCode] != "A" || rw[satRawdataColRecheck] != SATRawdataRecheck {
		t.Fatalf("unexpected rw module/recheck cells: %q %q", rw[satRawdataColModuleCode], rw[satRawdataColRecheck])
	}
	if rw[satRawdataColFirstQuestion] != "1" || rw[satRawdataColFirstQuestion+1] != "0" ||
		rw[satRawdataColFirstQuestion+2] != "No answer" || rw[satRawdataColFirstQuestion+3] != "" {
		t.Fatalf("unexpected rw question cells: %#v", rw[21:26])
	}
	// Verbal populates the full Q1-Q27 range; every slot must be a legal cell
	// value (a slot only stays blank when no question is administered there).
	for i := 0; i < SATRawdataReadingWritingQuestions; i++ {
		switch rw[satRawdataColFirstQuestion+i] {
		case "1", "0", "No answer", "":
		default:
			t.Fatalf("rw Q%d has an illegal cell %q", i+1, rw[satRawdataColFirstQuestion+i])
		}
	}
	if rw[satRawdataColPointsReceived] != "1" || rw[satRawdataColPointsAvailable] != "27" || rw[satRawdataColPercentage] != "3.70%" {
		t.Fatalf("unexpected rw points: %q %q %q", rw[4], rw[5], rw[3])
	}

	math := out.Rows[2]
	if math[satRawdataColPointsReceived] != "2" || math[satRawdataColPointsAvailable] != "22" || math[satRawdataColPercentage] != "9.10%" {
		t.Fatalf("unexpected math points: %q %q %q", math[4], math[5], math[3])
	}
	if math[satRawdataColFirstQuestion] != "1" || math[satRawdataColFirstQuestion+1] != "1" {
		t.Fatalf("expected V2 answers counted (Q1/Q2 both 1): %#v", math[21:24])
	}
	// Math populates Q1-Q22 only; Q23-Q27 stay empty.
	for i := 22; i < 27; i++ {
		if math[satRawdataColFirstQuestion+i] != "" {
			t.Fatalf("math Q%d must stay empty, got %q", i+1, math[satRawdataColFirstQuestion+i])
		}
	}

	ns := out.Rows[3]
	if ns[satRawdataColModuleCode] != "C" {
		t.Fatalf("not-started module must keep its code, got %q", ns[satRawdataColModuleCode])
	}
	for i := satRawdataColFirstQuestion; i < satRawdataColModuleCode; i++ {
		if ns[i] != "" {
			t.Fatalf("not-started module question column %d must be blank, got %q", i, ns[i])
		}
	}
	if ns[satRawdataColPointsReceived] != "" || ns[satRawdataColPointsAvailable] != "" || ns[satRawdataColPercentage] != "" {
		t.Fatalf("not-started module points must be blank: %q %q %q", ns[4], ns[5], ns[3])
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestExportSATRawdataFullMixedCohort mirrors plan §30's eight-student cohort:
// every delivery/result state is present in student_attempts and every one is
// exported, with module placement, adaptive code, and section question count
// derived from the administered data only.
func TestExportSATRawdataFullMixedCohort(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	base := time.Date(2026, 9, 2, 8, 0, 0, 0, time.UTC)

	at := func(index int) []driver.Value {
		return satRawdataAttemptRow("attempt-"+string(rune('A'+index)), "C-"+string(rune('A'+index)), string(rune('a'+index))+"@example.com", base.Add(time.Duration(index)*time.Minute))
	}

	mock.ExpectBegin()
	attempts := sqlmock.NewRows(satRawdataAttemptColumns)
	for i := 0; i < 8; i++ {
		attempts.AddRow(at(i)...)
	}
	mock.ExpectQuery(satRawdataAttemptQueryPattern).WithArgs("exam-1", "schedule-1").WillReturnRows(attempts)

	modules := sqlmock.NewRows(satRawdataModuleColumns).
		// B: Verbal Module 1 active.
		AddRow("attempt-B", "b-m1", "reading-writing", "rw-m1", "base", "active", satRawdataTestVersion, 1, 1).
		// C: Verbal Module 1 + Module 2 Higher.
		AddRow("attempt-C", "c-m1", "reading-writing", "rw-m1", "base", "submitted", satRawdataTestVersion, 1, 1).
		AddRow("attempt-C", "c-m2h", "reading-writing", "rw-m2-h", "higher_branch", "submitted", satRawdataTestVersion, 1, 2).
		// D: Verbal Module 1 + Module 2 Lower.
		AddRow("attempt-D", "d-m1", "reading-writing", "rw-m1", "base", "submitted", satRawdataTestVersion, 1, 1).
		AddRow("attempt-D", "d-m2l", "reading-writing", "rw-m2-l", "lower_branch", "submitted", satRawdataTestVersion, 1, 2).
		// E: Math Module 1 + Module 2 Lower.
		AddRow("attempt-E", "e-m1", "math", "m-m1", "base", "submitted", satRawdataTestVersion, 2, 1).
		AddRow("attempt-E", "e-m2l", "math", "m-m2-l", "lower_branch", "submitted", satRawdataTestVersion, 2, 2).
		// F/G: registered but module never entered.
		AddRow("attempt-F", "f-m1", "reading-writing", "rw-m1", "base", "not_started", satRawdataTestVersion, 1, 1).
		AddRow("attempt-G", "g-m2h", "math", "m-m2-h", "higher_branch", "not_started", satRawdataTestVersion, 2, 2).
		// H: scored Verbal Module 1 with mixed cell outcomes.
		AddRow("attempt-H", "h-m1", "reading-writing", "rw-m1", "base", "submitted", satRawdataTestVersion, 1, 1)
	mock.ExpectQuery(satRawdataModuleQueryPattern).WithArgs("exam-1", "schedule-1").WillReturnRows(modules)

	mock.ExpectQuery(satRawdataCellQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataCellColumns).
			AddRow("attempt-B", "b-m1", "q1", 0, singleChoice("B"), nil, `"B"`, nil).
			AddRow("attempt-C", "c-m1", "q1", 0, singleChoice("B"), nil, `"B"`, nil).
			AddRow("attempt-C", "c-m2h", "q1", 0, singleChoice("B"), nil, `"A"`, nil).
			AddRow("attempt-D", "d-m1", "q1", 0, singleChoice("B"), nil, `"B"`, nil).
			AddRow("attempt-D", "d-m2l", "q1", 0, singleChoice("B"), nil, nil, nil).
			AddRow("attempt-E", "e-m1", "q1", 0, singleChoice("B"), nil, `"B"`, nil).
			AddRow("attempt-E", "e-m2l", "q1", 0, singleChoice("B"), nil, `"A"`, nil).
			AddRow("attempt-F", "f-m1", "q1", 0, singleChoice("B"), nil, `"B"`, nil).
			AddRow("attempt-G", "g-m2h", "q1", 0, singleChoice("B"), nil, `"B"`, nil).
			AddRow("attempt-H", "h-m1", "q1", 0, singleChoice("B"), nil, `"B"`, nil).
			AddRow("attempt-H", "h-m1", "q2", 1, singleChoice("B"), nil, `"A"`, nil).
			AddRow("attempt-H", "h-m1", "q3", 2, singleChoice("B"), nil, nil, nil))
	mock.ExpectCommit()

	out, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	// A(blank) + B(1) + C(2) + D(2) + E(2) + F(1) + G(1) + H(1) = 11.
	if out.RowCount != 11 {
		t.Fatalf("expected all 11 cohort rows, got %d", out.RowCount)
	}
	for i, row := range out.Rows {
		if len(row) != SATRawdataColumns {
			t.Fatalf("row %d has %d columns", i, len(row))
		}
	}
	codes := make([]string, 0, len(out.Rows))
	for _, row := range out.Rows {
		codes = append(codes, row[satRawdataColModuleCode])
	}
	want := []string{"", "A", "A", "C", "A", "B", "A", "B", "A", "C", "A"}
	if strings.Join(codes, ",") != strings.Join(want, ",") {
		t.Fatalf("adaptive code mapping drifted:\n got %v\nwant %v", codes, want)
	}
	// Math rows advertise 22 points available (indices 6-7); Verbal rows 27 (e.g. index 2).
	if out.Rows[6][satRawdataColPointsAvailable] != "22" || out.Rows[7][satRawdataColPointsAvailable] != "22" || out.Rows[2][satRawdataColPointsAvailable] != "27" {
		t.Fatalf("section question counts drifted: math=%q/%q verbal=%q",
			out.Rows[6][satRawdataColPointsAvailable], out.Rows[7][satRawdataColPointsAvailable], out.Rows[2][satRawdataColPointsAvailable])
	}
	// Not-started modules keep their code but no points.
	for _, index := range []int{8, 9} {
		if out.Rows[index][satRawdataColPointsReceived] != "" || out.Rows[index][satRawdataColPercentage] != "" {
			t.Fatalf("not-started row %d must have blank points: %#v", index, out.Rows[index])
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestExportSATRawdataProjectionIsPaginationIndependent pins plan §3/§30: the
// export is bounded by (exam, schedule), never by the UI page size, so a 500
// student group yields 500 rows from one snapshot.
func TestExportSATRawdataProjectionIsPaginationIndependent(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	base := time.Date(2026, 9, 3, 8, 0, 0, 0, time.UTC)
	const students = 500

	attempts := sqlmock.NewRows(satRawdataAttemptColumns)
	modules := sqlmock.NewRows(satRawdataModuleColumns)
	cells := sqlmock.NewRows(satRawdataCellColumns)
	for i := 0; i < students; i++ {
		id := "attempt-" + itoa(i)
		attempts.AddRow(id, "C-"+itoa(i), "", itoa(i)+"@example.com", satRawdataTestVersion, base.Add(time.Duration(i)*time.Second))
		modules.AddRow(id, "mod-"+itoa(i), "reading-writing", "rw-m1", "base", "submitted", satRawdataTestVersion, 1, 1)
		cells.AddRow(id, "mod-"+itoa(i), "eq-"+itoa(i), 0, singleChoice("B"), nil, `"B"`, nil)
	}
	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataAttemptQueryPattern).WithArgs("exam-1", "schedule-1").WillReturnRows(attempts)
	mock.ExpectQuery(satRawdataModuleQueryPattern).WithArgs("exam-1", "schedule-1").WillReturnRows(modules)
	mock.ExpectQuery(satRawdataCellQueryPattern).WithArgs("exam-1", "schedule-1").WillReturnRows(cells)
	mock.ExpectCommit()

	out, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	if out.RowCount != students || len(out.Rows) != students {
		t.Fatalf("expected %d rows regardless of page size, got %d", students, out.RowCount)
	}
	if out.Rows[students-1][satRawdataColEmail] != itoa(students-1)+"@example.com" {
		t.Fatalf("last student missing from the export: %#v", out.Rows[students-1][:6])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestExportSATRawdataIgnoresModulesFromAnotherVersion pins plan §11 at the
// projection layer: an attempt keeps the questions of the version it actually
// received, so a module belonging to a different version is never projected
// even if the SQL fence were weakened.
func TestExportSATRawdataIgnoresModulesFromAnotherVersion(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	base := time.Date(2026, 9, 4, 8, 0, 0, 0, time.UTC)

	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataAttemptQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataAttemptColumns).
			AddRow("attempt-v12", "C-1", "", "v12@example.com", "version-12", base))
	mock.ExpectQuery(satRawdataModuleQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataModuleColumns).
			AddRow("attempt-v12", "mod-v12", "reading-writing", "rw-m1", "base", "submitted", "version-12", 1, 1).
			AddRow("attempt-v12", "mod-v20", "math", "m-m1", "higher_branch", "submitted", "version-20", 2, 1))
	mock.ExpectQuery(satRawdataCellQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataCellColumns).
			AddRow("attempt-v12", "mod-v12", "q-v12", 0, singleChoice("B"), nil, `"B"`, nil).
			AddRow("attempt-v12", "mod-v20", "q-v20", 0, singleChoice("B"), nil, `"B"`, nil))
	mock.ExpectCommit()

	out, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	if out.RowCount != 1 {
		t.Fatalf("expected only the attempt's published-version module, got %d rows", out.RowCount)
	}
	row := out.Rows[0]
	if row[satRawdataColModuleCode] != "A" || row[satRawdataColPointsAvailable] != "27" {
		t.Fatalf("expected the version-12 verbal module, got code=%q available=%q", row[satRawdataColModuleCode], row[satRawdataColPointsAvailable])
	}
	if row[satRawdataColFirstQuestion] != "1" {
		t.Fatalf("expected the version-12 answer, got %q", row[satRawdataColFirstQuestion])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestExportSATRawdataKeepsBlankRowForUnmappedSection pins the improved §18
// behavior: an attempt whose only placements cannot be section-mapped still
// produces one blank row instead of disappearing.
func TestExportSATRawdataKeepsBlankRowForUnmappedSection(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	base := time.Date(2026, 9, 5, 8, 0, 0, 0, time.UTC)
	const candidateName = "  Unmapped Student  "

	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataAttemptQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataAttemptColumns).
			AddRow(satRawdataAttemptRowWithName("attempt-science", "C-1", candidateName, "s@example.com", base)...))
	mock.ExpectQuery(satRawdataModuleQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataModuleColumns).
			AddRow("attempt-science", "mod-sci", "science", "sci-m1", "base", "submitted", satRawdataTestVersion, 1, 1))
	mock.ExpectQuery(satRawdataCellQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataCellColumns))
	mock.ExpectCommit()

	out, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	if out.RowCount != 1 {
		t.Fatalf("expected one retained row, got %d", out.RowCount)
	}
	row := out.Rows[0]
	if row[satRawdataColFirstName] != "Unmapped Student" || row[satRawdataColEmail] != "s@example.com" || row[satRawdataColCandidateID] != "C-1" {
		t.Fatalf("unmapped-section row must preserve attempt identity: %#v", row[:13])
	}
	for i, cell := range row {
		if i == satRawdataColFirstName || i == satRawdataColEmail || i == satRawdataColCandidateID {
			continue
		}
		if cell != "" {
			t.Fatalf("unmapped-section row has an unexpected value at column %d = %q", i, cell)
		}
	}
}

func TestExportSATRawdataCandidateNamesAndNoModuleIdentity(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	base := time.Date(2026, 9, 5, 9, 0, 0, 0, time.UTC)
	cases := []struct {
		id, candidateID, input, want, email string
	}{
		{"attempt-1", "S2", `Nguyễn Văn "Nam", Jr.`, `Nguyễn Văn "Nam", Jr.`, "s2@example.com"},
		{"attempt-2", "S3", "สมชาย ใจดี", "สมชาย ใจดี", "s3@example.com"},
		{"attempt-3", "S4", `=HYPERLINK("http://x","x")`, `=HYPERLINK("http://x","x")`, "s4@example.com"},
		{"attempt-4", "S5", "  Leading  and trailing  ", "Leading  and trailing", "s5@example.com"},
		{"attempt-5", "S6", strings.Repeat("N", 255), strings.Repeat("N", 255), "s6@example.com"},
	}
	attempts := sqlmock.NewRows(satRawdataAttemptColumns)
	for i, c := range cases {
		attempts.AddRow(satRawdataAttemptRowWithName(c.id, c.candidateID, c.input, c.email, base.Add(time.Duration(i)*time.Minute))...)
	}
	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataAttemptQueryPattern).WithArgs("exam-1", "schedule-1").WillReturnRows(attempts)
	mock.ExpectQuery(satRawdataModuleQueryPattern).WithArgs("exam-1", "schedule-1").WillReturnRows(sqlmock.NewRows(satRawdataModuleColumns))
	mock.ExpectQuery(satRawdataCellQueryPattern).WithArgs("exam-1", "schedule-1").WillReturnRows(sqlmock.NewRows(satRawdataCellColumns))
	mock.ExpectCommit()

	out, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	if out.RowCount != len(cases) || len(out.Rows) != len(cases) || len(out.Sheets) != 2 {
		t.Fatalf("unexpected no-module export dimensions: rows=%d flat=%d sheets=%d", out.RowCount, len(out.Rows), len(out.Sheets))
	}
	for i, c := range cases {
		row := out.Rows[i]
		if row[satRawdataColFirstName] != c.want || row[1] != "" || row[satRawdataColEmail] != c.email || row[satRawdataColCandidateID] != c.candidateID {
			t.Fatalf("attempt %s identity = %q / %q / %q / %q", c.id, row[0], row[1], row[2], row[12])
		}
		for column, cell := range row {
			if column == satRawdataColFirstName || column == satRawdataColEmail || column == satRawdataColCandidateID {
				continue
			}
			if cell != "" {
				t.Fatalf("attempt %s no-module column %d = %q, want blank", c.id, column, cell)
			}
		}
		for _, sheet := range out.Sheets {
			sheetRow := sheet.Rows[i]
			if sheetRow[satRawdataColFirstName] != c.want || sheetRow[satRawdataColEmail] != c.email || sheetRow[satRawdataColCandidateID] != c.candidateID {
				t.Fatalf("attempt %s missing from %q identity row", c.id, sheet.Name)
			}
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestExportSATRawdataDoesNotFilterPretestQuestions pins plan §15 at the SQL
// layer: the cells query must not add an is_pretest predicate, and must keep
// the published-version fence. A captured-query matcher proves both.
func TestExportSATRawdataDoesNotFilterPretestQuestions(t *testing.T) {
	var captured []string
	matcher := sqlmock.QueryMatcherFunc(func(_, actual string) error {
		captured = append(captured, actual)
		return nil
	})
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(matcher))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectQuery("attempts").WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataAttemptColumns))
	mock.ExpectQuery("modules").WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataModuleColumns))
	mock.ExpectQuery("cells").WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataCellColumns))
	mock.ExpectCommit()

	if _, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1"); err != nil {
		t.Fatal(err)
	}
	if len(captured) != 3 {
		t.Fatalf("expected three bulk queries, captured %d", len(captured))
	}
	for _, query := range captured {
		if strings.Contains(query, "is_pretest") {
			t.Fatalf("pretest questions must be evaluated, not filtered: %s", query)
		}
	}
	if !strings.Contains(captured[1], "s.exam_version_id = a.published_version_id") ||
		!strings.Contains(captured[2], "s.exam_version_id = a.published_version_id") {
		t.Fatal("module/question reads must stay pinned to the attempt's published version")
	}
	// The two reads must agree on the module identity the assembly joins on:
	// assessment_modules.id (`m.id`), never the module-attempt row id (ma.id).
	if !strings.Contains(captured[1], "SELECT ma.attempt_id, m.id") {
		t.Fatalf("module read must project m.id as the module identity: %s", captured[1])
	}
	if !strings.Contains(captured[2], "m.id AS module_id") {
		t.Fatalf("question read must project m.id as module_id: %s", captured[2])
	}
}

// TestExportSATRawdataTreatsLockedModuleAsAdministered pins the one non-obvious
// module state: the delivery layer writes state='locked' when a module ends by
// auto-submit/time-expiry, so a locked module must be evaluated, not blanked.
func TestExportSATRawdataTreatsLockedModuleAsAdministered(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	base := time.Date(2026, 9, 6, 8, 0, 0, 0, time.UTC)

	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataAttemptQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataAttemptColumns).
			AddRow("attempt-locked", "C-1", "", "locked@example.com", satRawdataTestVersion, base))
	mock.ExpectQuery(satRawdataModuleQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataModuleColumns).
			AddRow("attempt-locked", "mod-locked", "reading-writing", "rw-m1", "base", "locked", satRawdataTestVersion, 1, 1))
	mock.ExpectQuery(satRawdataCellQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataCellColumns).
			AddRow("attempt-locked", "mod-locked", "eq-1", 0, singleChoice("B"), nil, `"B"`, nil))
	mock.ExpectCommit()

	out, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	row := out.Rows[0]
	if row[satRawdataColFirstQuestion] != "1" || row[satRawdataColPointsReceived] != "1" || row[satRawdataColPointsAvailable] != "27" {
		t.Fatalf("a locked module must be evaluated like a submission: %#v", row[:6])
	}
}

func TestExportSATRawdataEmptyScheduleKeepsHeaders(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataAttemptQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataAttemptColumns))
	mock.ExpectQuery(satRawdataModuleQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataModuleColumns))
	mock.ExpectQuery(satRawdataCellQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataCellColumns))
	mock.ExpectCommit()

	out, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("observer-1", auth.RoleAdminObserver), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	if out.RowCount != 0 || len(out.Rows) != 0 {
		t.Fatalf("expected an empty body, got %#v", out.Rows)
	}
	if len(out.HeaderRows) != 2 {
		t.Fatalf("headers must survive an empty schedule: %#v", out.HeaderRows)
	}
	if len(out.Sheets) != 2 || out.Sheets[0].Name != "SAT Math" || out.Sheets[1].Name != "SAT Verbal" ||
		len(out.Sheets[0].HeaderRows) != 2 || len(out.Sheets[1].HeaderRows) != 2 {
		t.Fatalf("both section sheets and their headers must survive an empty schedule: %#v", out.Sheets)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestExportSATRawdataRejectsMissingScopeBeforeDatabaseAccess(t *testing.T) {
	svc := NewService(nil)
	ctx := context.Background()
	actor := auth.NewActorContext("admin-1", auth.RoleAdmin)
	for _, c := range []struct{ name, examID, scheduleID string }{
		{"blank scheduleId", "exam-1", " "},
		{"blank examId", " ", "schedule-1"},
		{"both blank", "", ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			if _, err := svc.ExportSATRawdata(ctx, actor, c.examID, c.scheduleID); err == nil {
				t.Fatal("expected validation error before any database access")
			} else if appErr, ok := apperrors.As(err); !ok || appErr.Code != apperrors.CodeValidation {
				t.Fatalf("expected VALIDATION_ERROR, got %v", err)
			}
		})
	}
}

func TestSATRawdataAnswerCellResolution(t *testing.T) {
	key := singleChoice("B")
	cases := []struct {
		name     string
		answer   string
		v2       any
		legacy   any
		expected string
	}{
		{"correct legacy", key, nil, `"B"`, "1"},
		{"incorrect legacy", key, nil, `"A"`, "0"},
		{"no answer", key, nil, nil, "No answer"},
		{"missing key stays blank", `{"kind":"single_choice"}`, nil, `"B"`, ""},
		{"v2 wins over legacy", key, `{"answer":"B"}`, `"A"`, "1"},
		// §14: a V2 row whose answer is null is the candidate answering
		// nothing — "No answer", and never backfilled from the legacy row.
		{"v2 null answer is No answer, never backfilled", key, `{"answer":null}`, `"B"`, "No answer"},
		// §14: a payload that cannot be decoded at all is indeterminate, so
		// the cell stays blank instead of asserting "No answer" or "0".
		{"v2 payload that cannot be decoded stays blank", key, `{"answer":`, `"B"`, ""},
		{"v2 non-JSON payload stays blank", key, `not-json`, `"B"`, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := satRawdataAnswerCell(c.answer, nullable(c.v2), nullable(c.legacy)); got != c.expected {
				t.Fatalf("got %q, want %q", got, c.expected)
			}
		})
	}
}

// nullable mirrors a scanned sql.NullString: nil is absent, a string is present.
func nullable(value any) sql.NullString {
	if value == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: value.(string), Valid: true}
}

// itoa is a tiny local helper so the 500-row fixture stays readable.
func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	digits := []byte{}
	for value > 0 {
		digits = append([]byte{byte('0' + value%10)}, digits...)
		value /= 10
	}
	return string(digits)
}

// TestExportSATRawdataQuestionlessModulePoints pins the documented §16/§17
// asymmetry: an *entered* module with no administered questions is a score of
// zero over the section's fixed count (0 / 27 / "0.00%"), while a module the
// candidate never entered keeps points and percentage blank. Only "never
// entered" means "no score exists".
//
// The same rows also pin §22/§23: an administered row carries email, Candidate
// ID, the placement code and RECHECK, and every other template column — the
// ambiguous date/time and extra-information cells — stays blank rather than
// being guessed.
func TestExportSATRawdataQuestionlessModulePoints(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	base := time.Date(2026, 9, 8, 8, 0, 0, 0, time.UTC)

	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataAttemptQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataAttemptColumns).
			AddRow(satRawdataAttemptRow("attempt-entered", "C-ENTERED", "entered@example.com", base)...).
			AddRow(satRawdataAttemptRow("attempt-unentered", "C-NEVER", "never@example.com", base.Add(time.Minute))...))
	mock.ExpectQuery(satRawdataModuleQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataModuleColumns).
			AddRow("attempt-entered", "mod-entered", "reading-writing", "rw-m1", "base", "submitted", satRawdataTestVersion, 1, 1).
			AddRow("attempt-unentered", "mod-unentered", "reading-writing", "rw-m2", "higher_branch", "not_started", satRawdataTestVersion, 1, 2))
	// The entered module has no administered questions at all.
	mock.ExpectQuery(satRawdataCellQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataCellColumns))
	mock.ExpectCommit()

	out, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	if out.RowCount != 2 {
		t.Fatalf("expected one row per placement, got %d", out.RowCount)
	}

	entered := out.Rows[0]
	if entered[satRawdataColEmail] != "entered@example.com" || entered[satRawdataColCandidateID] != "C-ENTERED" {
		t.Fatalf("entered row lost its metadata: %#v", entered[:13])
	}
	if entered[satRawdataColPointsReceived] != "0" || entered[satRawdataColPointsAvailable] != "27" ||
		entered[satRawdataColPercentage] != "0.00%" {
		t.Fatalf("an entered questionless module is a zero score: %q %q %q",
			entered[satRawdataColPointsReceived], entered[satRawdataColPointsAvailable], entered[satRawdataColPercentage])
	}
	if entered[satRawdataColModuleCode] != "A" || entered[satRawdataColRecheck] != SATRawdataRecheck {
		t.Fatalf("entered row lost its anchors: %q %q", entered[satRawdataColModuleCode], entered[satRawdataColRecheck])
	}
	for i := 0; i < satRawdataColFirstQuestion; i++ {
		switch i {
		case satRawdataColEmail, satRawdataColPercentage, satRawdataColPointsReceived, satRawdataColPointsAvailable, satRawdataColCandidateID:
			continue
		}
		if entered[i] != "" {
			t.Fatalf("column %d must stay blank (no confirmed business meaning): %q", i, entered[i])
		}
	}

	unentered := out.Rows[1]
	if unentered[satRawdataColModuleCode] != "C" {
		t.Fatalf("a never-entered module still exports its placement code, got %q", unentered[satRawdataColModuleCode])
	}
	if unentered[satRawdataColPointsReceived] != "" || unentered[satRawdataColPointsAvailable] != "" ||
		unentered[satRawdataColPercentage] != "" {
		t.Fatalf("a never-entered module must not claim a score: %q %q %q",
			unentered[satRawdataColPointsReceived], unentered[satRawdataColPointsAvailable], unentered[satRawdataColPercentage])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestExportSATRawdataDeduplicatesV2AliasMatches pins the per-placement dedupe:
// attempt_responses_v2 is joined on `question_id IN (eq.id, eq.question_id)`,
// so one administered question can match twice. The query orders the eq.id
// match first and the export must fold the alias row away rather than emit the
// question twice (or let the stale alias answer win).
//
// sqlmock replays rows in the order they are declared, which is exactly the
// ORDER BY contract the production query relies on.
func TestExportSATRawdataDeduplicatesV2AliasMatches(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	base := time.Date(2026, 9, 7, 8, 0, 0, 0, time.UTC)

	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataAttemptQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataAttemptColumns).
			AddRow(satRawdataAttemptRow("attempt-1", "C-1", "dedupe@example.com", base)...))
	mock.ExpectQuery(satRawdataModuleQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataModuleColumns).
			AddRow("attempt-1", "mod-rw", "reading-writing", "rw-m1", "base", "submitted", satRawdataTestVersion, 1, 1))
	mock.ExpectQuery(satRawdataCellQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataCellColumns).
			// Q1: the canonical eq.id match first (correct), then the alias
			// match carrying a stale, different answer.
			AddRow("attempt-1", "mod-rw", "eq-1", 0, singleChoice("B"), `{"answer":"B"}`, nil, nil).
			AddRow("attempt-1", "mod-rw", "eq-1", 0, singleChoice("B"), `{"answer":"A"}`, nil, nil).
			// Q2: an unrelated question must be unaffected by the fold.
			AddRow("attempt-1", "mod-rw", "eq-2", 1, singleChoice("B"), nil, `"B"`, nil))
	mock.ExpectCommit()

	out, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	if out.RowCount != 1 {
		t.Fatalf("expected one row, got %d", out.RowCount)
	}
	row := out.Rows[0]
	if row[satRawdataColFirstQuestion] != "1" {
		t.Fatalf("the eq.id match must win the fold, got Q1=%q", row[satRawdataColFirstQuestion])
	}
	if row[satRawdataColFirstQuestion+1] != "1" {
		t.Fatalf("Q2 must be unaffected by the fold, got %q", row[satRawdataColFirstQuestion+1])
	}
	if row[satRawdataColPointsReceived] != "2" {
		t.Fatalf("the folded question must be scored once, got points=%q", row[satRawdataColPointsReceived])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// satRawdataTxRecordingDriver is a minimal database/sql driver that records the
// transaction options the export requests.
//
// sqlmock cannot serve this pin: its driver implements driver.ConnBeginTx but
// drops the options on the floor, so a regression to BeginTx(ctx, nil) would
// leave every sqlmock assertion green while the repeatable-read snapshot (and
// the read-only guarantee) silently disappeared.
type satRawdataTxRecordingDriver struct {
	mu        sync.Mutex
	beginOpts []driver.TxOptions
	queries   int
}

func (d *satRawdataTxRecordingDriver) Open(string) (driver.Conn, error) {
	return &satRawdataTxRecordingConn{driver: d}, nil
}

func (d *satRawdataTxRecordingDriver) record(opts driver.TxOptions) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.beginOpts = append(d.beginOpts, opts)
}

func (d *satRawdataTxRecordingDriver) counts() (int, int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.beginOpts), d.queries
}

type satRawdataTxRecordingConn struct{ driver *satRawdataTxRecordingDriver }

func (c *satRawdataTxRecordingConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (c *satRawdataTxRecordingConn) Close() error                        { return nil }
func (c *satRawdataTxRecordingConn) Begin() (driver.Tx, error)           { return satRawdataTxRecordingTx{}, nil }

func (c *satRawdataTxRecordingConn) BeginTx(_ context.Context, opts driver.TxOptions) (driver.Tx, error) {
	c.driver.record(opts)
	return satRawdataTxRecordingTx{}, nil
}

func (c *satRawdataTxRecordingConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	c.driver.mu.Lock()
	c.driver.queries++
	c.driver.mu.Unlock()
	return &satRawdataEmptyRows{}, nil
}

type satRawdataTxRecordingTx struct{}

func (satRawdataTxRecordingTx) Commit() error   { return nil }
func (satRawdataTxRecordingTx) Rollback() error { return nil }

// satRawdataEmptyRows is an empty result set: the export reads three of them and
// projects an empty body, which is all this pin needs.
type satRawdataEmptyRows struct{}

func (*satRawdataEmptyRows) Columns() []string         { return []string{"id"} }
func (*satRawdataEmptyRows) Close() error              { return nil }
func (*satRawdataEmptyRows) Next([]driver.Value) error { return io.EOF }

var (
	satRawdataTxDriverOnce sync.Once
	satRawdataTxDriverName = "sat_rawdata_tx_recorder"
)

// TestExportSATRawdataPinsReadOnlyRepeatableReadSnapshot pins plan §20: the
// export must read one committed snapshot in a transaction that cannot write.
func TestExportSATRawdataPinsReadOnlyRepeatableReadSnapshot(t *testing.T) {
	recorder := &satRawdataTxRecordingDriver{}
	satRawdataTxDriverOnce.Do(func() { sql.Register(satRawdataTxDriverName, recorder) })
	db, err := sql.Open(satRawdataTxDriverName, "record")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	out, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	begins, queries := recorder.counts()
	if begins != 1 {
		t.Fatalf("expected exactly one transaction, got %d", begins)
	}
	opts := recorder.beginOpts[0]
	if opts.Isolation != driver.IsolationLevel(sql.LevelRepeatableRead) {
		t.Fatalf("export isolation = %v, want REPEATABLE READ", opts.Isolation)
	}
	if !opts.ReadOnly {
		t.Fatal("export transaction must be read-only")
	}
	if queries != 3 {
		t.Fatalf("expected the 3 bulk reads inside the snapshot, got %d", queries)
	}
	if out.RowCount != 0 || len(out.Rows) != 0 {
		t.Fatalf("expected an empty body, got %#v", out.Rows)
	}
	if len(out.HeaderRows) != 2 {
		t.Fatalf("headers must survive an empty schedule: %#v", out.HeaderRows)
	}
}

// satRawdataQueryLog records every statement the export issues, so a test can
// assert on the SQL itself (not just on the rows a mock chose to return).
type satRawdataQueryLog struct{ queries []string }

// matcher returns the sqlmock matcher that records statements; wrap it with
// sqlmock.QueryMatcherOption at the call site.
func (l *satRawdataQueryLog) matcher() sqlmock.QueryMatcher {
	return sqlmock.QueryMatcherFunc(func(_, actual string) error {
		l.queries = append(l.queries, actual)
		return nil
	})
}

// TestExportSATRawdataDoesNotFilterAttemptState covers TC-ATTEMPT-001..004 and
// the state half of TC-SCALE-001: a pending attempt, an unscored attempt, an
// attempt still being taken and a terminated attempt are all exported, and no
// statement the export issues filters on delivery/proctor/phase state, on
// assessment_results (or any result table), or paginates with LIMIT/OFFSET.
//
// The fixture deliberately supplies no result rows at all: the projection's
// source is student_attempts, and the export of an in-progress attempt shows
// both halves of the question contract — answered questions scored, the rest
// administered-but-unanswered ("No answer").
func TestExportSATRawdataDoesNotFilterAttemptState(t *testing.T) {
	log := &satRawdataQueryLog{}
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(log.matcher()))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	base := time.Date(2026, 9, 9, 8, 0, 0, 0, time.UTC)

	states := []struct{ name, moduleState string }{
		{"pending", "not_started"}, // registered, module never entered
		{"unscored", "submitted"},  // handed in, no assessment_results row
		{"active", "active"},       // mid-module, partial answers
		{"terminated", "locked"},   // proctor/timeout lock after termination
	}
	mock.ExpectBegin()
	attempts := sqlmock.NewRows(satRawdataAttemptColumns)
	modules := sqlmock.NewRows(satRawdataModuleColumns)
	cells := sqlmock.NewRows(satRawdataCellColumns)
	for i, state := range states {
		attemptID := "attempt-" + state.name
		attempts.AddRow(satRawdataAttemptRow(attemptID, "C-"+strings.ToUpper(state.name), state.name+"@example.com", base.Add(time.Duration(i)*time.Minute))...)
		modules.AddRow(attemptID, "mod-"+state.name, "reading-writing", "rw-m1", "base", state.moduleState, satRawdataTestVersion, 1, 1)
	}
	// The active attempt answered Q1-Q3; the rest of its module was administered
	// with no response.
	for q := 0; q < SATRawdataReadingWritingQuestions; q++ {
		if q < 3 {
			cells.AddRow("attempt-active", "mod-active", "q"+itoa(q+1), q, singleChoice("B"), nil, `"B"`, nil)
			continue
		}
		cells.AddRow("attempt-active", "mod-active", "q"+itoa(q+1), q, singleChoice("B"), nil, nil, nil)
	}
	for _, state := range states {
		if state.name == "active" || state.moduleState == "not_started" {
			continue
		}
		cells.AddRow("attempt-"+state.name, "mod-"+state.name, "q1", 0, singleChoice("B"), nil, `"B"`, nil)
	}
	mock.ExpectQuery("").WillReturnRows(attempts)
	mock.ExpectQuery("").WillReturnRows(modules)
	mock.ExpectQuery("").WillReturnRows(cells)
	mock.ExpectCommit()

	out, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	if out.RowCount != len(states) {
		t.Fatalf("every delivery state must be exported, got %d rows want %d", out.RowCount, len(states))
	}
	seen := map[string]bool{}
	for i, row := range out.Rows {
		if len(row) != SATRawdataColumns {
			t.Fatalf("row %d has %d columns", i, len(row))
		}
		seen[row[satRawdataColEmail]] = true
	}
	for _, state := range states {
		if !seen[state.name+"@example.com"] {
			t.Fatalf("%s attempt missing from the export", state.name)
		}
	}

	active := out.Rows[2]
	for q := 0; q < 3; q++ {
		if active[satRawdataColFirstQuestion+q] != SATRawdataAnswerCorrect {
			t.Fatalf("active attempt Q%d must keep its saved answer, got %q", q+1, active[satRawdataColFirstQuestion+q])
		}
	}
	if active[satRawdataColFirstQuestion+3] != SATRawdataAnswerNoAnswer ||
		active[satRawdataColFirstQuestion+SATRawdataReadingWritingQuestions-1] != SATRawdataAnswerNoAnswer {
		t.Fatalf("administered-but-unanswered questions must read %q: %#v",
			SATRawdataAnswerNoAnswer, active[satRawdataColFirstQuestion+3])
	}
	if active[satRawdataColPointsReceived] != "3" || active[satRawdataColPointsAvailable] != "27" {
		t.Fatalf("active attempt points drifted: %q/%q", active[satRawdataColPointsReceived], active[satRawdataColPointsAvailable])
	}

	if len(log.queries) != 3 {
		t.Fatalf("expected the 3 bulk reads, got %d", len(log.queries))
	}
	banned := []string{
		"delivery_status", "proctor_status", "assessment_results", "student_results",
		"outcome_status", "release_status", "grading_status", "submission_id",
		"LIMIT", "OFFSET",
	}
	for i, query := range log.queries {
		upper := strings.ToUpper(query)
		for _, fragment := range banned {
			if strings.Contains(upper, strings.ToUpper(fragment)) {
				t.Fatalf("query %d must not use %q (it would drop attempts by state/result or paginate):\n%s", i, fragment, query)
			}
		}
		if !strings.Contains(upper, "ORDER BY") {
			t.Fatalf("query %d must pin a stable order for a reproducible file:\n%s", i, query)
		}
		if !strings.Contains(upper, "EXAM.PROVIDER_KEY = 'SAT'") {
			t.Fatalf("query %d must stay scoped to SAT exams:\n%s", i, query)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestExportSATRawdataMapsCellsByDisplayOrderNotRowOrder covers TC-QUESTION-001
// and TC-QUESTION-002: the question a cell lands in is decided by sorting
// assessment_exam_questions.display_order, never by arrival order
// (or question UUID).
func TestExportSATRawdataMapsCellsByDisplayOrderNotRowOrder(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	base := time.Date(2026, 9, 10, 8, 0, 0, 0, time.UTC)

	key := singleChoice("B")
	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataAttemptQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataAttemptColumns).
			AddRow(satRawdataAttemptRow("attempt-1", "C-1", "order@example.com", base)...))
	mock.ExpectQuery(satRawdataModuleQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataModuleColumns).
			AddRow("attempt-1", "mod-rw", "reading-writing", "rw-m1", "base", "submitted", satRawdataTestVersion, 1, 1))
	cells := sqlmock.NewRows(satRawdataCellColumns).
		// Delivered out of order: Q3 and Q27 arrive before Q1 and Q2.
		AddRow("attempt-1", "mod-rw", "uuid-z", 2, key, nil, `"B"`, nil).
		AddRow("attempt-1", "mod-rw", "uuid-q27", 26, key, nil, `"B"`, nil).
		AddRow("attempt-1", "mod-rw", "uuid-a", 0, key, nil, nil, nil).
		AddRow("attempt-1", "mod-rw", "uuid-b", 1, key, nil, `"A"`, nil)
	for q := 3; q < SATRawdataReadingWritingQuestions-1; q++ {
		// Unknown keys reserve their delivered positions with blank cells.
		cells.AddRow("attempt-1", "mod-rw", "uuid-q"+itoa(q+1), q, nil, nil, nil, nil)
	}
	mock.ExpectQuery(satRawdataCellQueryPattern).WithArgs("exam-1", "schedule-1").WillReturnRows(cells)
	mock.ExpectCommit()

	out, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	row := out.Rows[0]
	if row[satRawdataColFirstQuestion] != SATRawdataAnswerNoAnswer {
		t.Fatalf("display_order 0 (uuid-a) must land in Q1, got %q", row[satRawdataColFirstQuestion])
	}
	if row[satRawdataColFirstQuestion+1] != SATRawdataAnswerIncorrect {
		t.Fatalf("display_order 1 (uuid-b) must land in Q2, got %q", row[satRawdataColFirstQuestion+1])
	}
	if row[satRawdataColFirstQuestion+2] != SATRawdataAnswerCorrect {
		t.Fatalf("display_order 2 (uuid-z) must land in Q3, got %q", row[satRawdataColFirstQuestion+2])
	}
	if row[satRawdataColFirstQuestion+SATRawdataReadingWritingQuestions-1] != SATRawdataAnswerCorrect {
		t.Fatalf("display_order 26 (uuid-q27) must land in Q27, got %q", row[satRawdataColFirstQuestion+SATRawdataReadingWritingQuestions-1])
	}
	if row[satRawdataColPointsReceived] != "2" {
		t.Fatalf("Q3 and Q27 should both count as correct, got %q points", row[satRawdataColPointsReceived])
	}
	for q := 3; q < SATRawdataReadingWritingQuestions-1; q++ {
		if row[satRawdataColFirstQuestion+q] != "" {
			t.Fatalf("Q%d has an unknown key and must stay blank, got %q", q+1, row[satRawdataColFirstQuestion+q])
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAssembleSATRawdataMatchesDeliveredQuestionPositionsWithGaps(t *testing.T) {
	for _, section := range []struct {
		key   string
		count int
	}{
		{SATRawdataSectionReadingWriting, 27},
		{SATRawdataSectionMath, 22},
	} {
		t.Run(section.key, func(t *testing.T) {
			attempt := satRawdataAttempt{ID: "attempt", PublishedVersionID: satRawdataTestVersion}
			module := satRawdataModule{
				AttemptID: attempt.ID, ModuleID: "module", SectionKey: section.key,
				State: "submitted", ExamVersionID: satRawdataTestVersion,
			}
			cells := make([]satRawdataCell, 0, section.count)
			want := make([]string, section.count)
			correct := 0
			for q := section.count - 1; q >= 0; q-- {
				order := q
				if q >= 2 {
					order++ // A replaced question leaves sort key 2 absent.
				}
				value := []string{"1", "0", "No answer", ""}[q%4]
				if q == section.count-1 {
					value = "1"
				}
				want[q] = value
				if value == "1" {
					correct++
				}
				cells = append(cells, satRawdataCell{DisplayOrder: order, Value: value})
			}
			out := assembleSATRawdata([]satRawdataAttempt{attempt},
				map[string][]satRawdataModule{attempt.ID: {module}},
				map[string][]satRawdataCell{satRawdataCellGroupKey(attempt.ID, module.ModuleID): cells}, "exam", "schedule")
			row := out.Rows[0]
			for q, value := range want {
				if got := row[satRawdataColFirstQuestion+q]; got != value {
					t.Fatalf("delivered Q%d = %q, want %q", q+1, got, value)
				}
			}
			if row[satRawdataColPointsReceived] != itoa(correct) || row[satRawdataColPointsAvailable] != itoa(section.count) {
				t.Fatalf("points = %q/%q, want %d/%d", row[satRawdataColPointsReceived], row[satRawdataColPointsAvailable], correct, section.count)
			}
			for q := section.count; q < 27; q++ {
				if row[satRawdataColFirstQuestion+q] != "" {
					t.Fatalf("Q%d outside section range must stay blank", q+1)
				}
			}
		})
	}
}

// TestExportSATRawdataLeavesMissingFinalQuestionBlank covers
// TC-QUESTION-003: a version whose module is missing Q27 exports Q27 blank and
// never slides Q26 (or any earlier question) up a slot. Points keep the
// section's fixed denominator, so "26 of 27" stays visible rather than looking
// like a complete paper.
func TestExportSATRawdataLeavesMissingFinalQuestionBlank(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	base := time.Date(2026, 9, 11, 8, 0, 0, 0, time.UTC)

	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataAttemptQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataAttemptColumns).
			AddRow(satRawdataAttemptRow("attempt-1", "C-1", "gap@example.com", base)...))
	mock.ExpectQuery(satRawdataModuleQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataModuleColumns).
			AddRow("attempt-1", "mod-rw", "reading-writing", "rw-m1", "base", "submitted", satRawdataTestVersion, 1, 1))
	cells := sqlmock.NewRows(satRawdataCellColumns)
	for q := 0; q < SATRawdataReadingWritingQuestions-1; q++ {
		cells.AddRow("attempt-1", "mod-rw", "q"+itoa(q+1), q, singleChoice("B"), nil, `"B"`, nil)
	}
	mock.ExpectQuery(satRawdataCellQueryPattern).WithArgs("exam-1", "schedule-1").WillReturnRows(cells)
	mock.ExpectCommit()

	out, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	row := out.Rows[0]
	if row[satRawdataColFirstQuestion+25] != SATRawdataAnswerCorrect {
		t.Fatalf("Q26 must keep its own answer, got %q", row[satRawdataColFirstQuestion+25])
	}
	if row[satRawdataColFirstQuestion+26] != "" {
		t.Fatalf("the missing Q27 must stay blank, got %q", row[satRawdataColFirstQuestion+26])
	}
	if row[satRawdataColPointsAvailable] != "27" {
		t.Fatalf("the denominator stays the section count, got %q", row[satRawdataColPointsAvailable])
	}
	if row[satRawdataColPointsReceived] != "26" {
		t.Fatalf("points count the exported cells (26), got %q", row[satRawdataColPointsReceived])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestExportSATRawdataModuleCodeIgnoresScore covers TC-MODULE-004: the
// เติมชุดข้อสอบ code comes from adaptive_role alone. A Higher branch that scored
// nothing is still C, and a Lower branch that scored everything is still B.
func TestExportSATRawdataModuleCodeIgnoresScore(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	base := time.Date(2026, 9, 12, 8, 0, 0, 0, time.UTC)

	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataAttemptQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataAttemptColumns).
			AddRow(satRawdataAttemptRow("attempt-1", "C-1", "code@example.com", base)...))
	mock.ExpectQuery(satRawdataModuleQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataModuleColumns).
			AddRow("attempt-1", "mod-h", "reading-writing", "rw-m2-h", "higher_branch", "submitted", satRawdataTestVersion, 1, 2).
			AddRow("attempt-1", "mod-l", "math", "m-m2-l", "lower_branch", "submitted", satRawdataTestVersion, 2, 2))
	mock.ExpectQuery(satRawdataCellQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataCellColumns).
			// The Higher branch got everything wrong...
			AddRow("attempt-1", "mod-h", "h1", 0, singleChoice("B"), nil, `"A"`, nil).
			// ...and the Lower branch got everything right.
			AddRow("attempt-1", "mod-l", "l1", 0, singleChoice("B"), nil, `"B"`, nil))
	mock.ExpectCommit()

	out, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	higher, lower := out.Rows[0], out.Rows[1]
	if higher[satRawdataColModuleCode] != "C" {
		t.Fatalf("a zero-scoring Higher branch is still C, got %q", higher[satRawdataColModuleCode])
	}
	if higher[satRawdataColPointsReceived] != "0" {
		t.Fatalf("fixture precondition: the Higher branch scored nothing, got %q", higher[satRawdataColPointsReceived])
	}
	if lower[satRawdataColModuleCode] != "B" {
		t.Fatalf("a perfect Lower branch is still B, got %q", lower[satRawdataColModuleCode])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestExportSATRawdataBindsTenantScopeToEveryQuery covers TC-SEC-001 and
// TC-SEC-003: an assigned staff actor (not a platform reader) has the org and
// assignment predicate bound into all three reads, with the org/user/role as
// real arguments, so another organization's or another schedule's students can
// never be projected. A platform reader issues the same reads unscoped.
func TestExportSATRawdataBindsTenantScopeToEveryQuery(t *testing.T) {
	orgID := "org-1"
	scoped := []string{
		`(?s)SELECT a\.id, a\.candidate_id.*sch\.organization_id = \? AND EXISTS \(SELECT 1 FROM schedule_staff_assignments`,
		`(?s)SELECT ma\.attempt_id, m\.id, s\.section_key.*sch\.organization_id = \? AND EXISTS \(SELECT 1 FROM schedule_staff_assignments`,
		`(?s)SELECT ma\.attempt_id, m\.id AS module_id, eq\.id AS exam_question_id.*sch\.organization_id = \? AND EXISTS \(SELECT 1 FROM schedule_staff_assignments`,
	}
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	for _, pattern := range scoped {
		mock.ExpectQuery(pattern).
			WithArgs("exam-1", "schedule-1", orgID, "grader-1", auth.RoleGrader).
			WillReturnRows(sqlmock.NewRows([]string{"id"}))
	}
	mock.ExpectCommit()

	actor := auth.ActorContext{UserID: "grader-1", Role: auth.RoleGrader, OrgID: &orgID}
	out, err := NewService(db).ExportSATRawdata(context.Background(), actor, "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	if out.RowCount != 0 {
		t.Fatalf("a scoped actor with no matching rows must get an empty body, got %d", out.RowCount)
	}
	if len(out.HeaderRows) != 2 {
		t.Fatalf("headers must survive an empty scope: %#v", out.HeaderRows)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}

	// Positive control: the same reads for a platform reader carry no tenant
	// predicate, so an admin is not silently narrowed to one organization.
	log := &satRawdataQueryLog{}
	db2, mock2, err := sqlmock.New(sqlmock.QueryMatcherOption(log.matcher()))
	if err != nil {
		t.Fatal(err)
	}
	defer db2.Close()
	mock2.ExpectBegin()
	mock2.ExpectQuery("").WillReturnRows(sqlmock.NewRows(satRawdataAttemptColumns))
	mock2.ExpectQuery("").WillReturnRows(sqlmock.NewRows(satRawdataModuleColumns))
	mock2.ExpectQuery("").WillReturnRows(sqlmock.NewRows(satRawdataCellColumns))
	mock2.ExpectCommit()
	if _, err := NewService(db2).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1"); err != nil {
		t.Fatal(err)
	}
	for i, query := range log.queries {
		if strings.Contains(query, "schedule_staff_assignments") {
			t.Fatalf("query %d narrowed a platform reader to one organization:\n%s", i, query)
		}
	}
	if err := mock2.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestExportSATRawdataTenThousandAttempts covers TC-SCALE-002 and
// TC-PERF-001: a 10,000-attempt Student Access group is projected from the same
// three bulk reads (never one query per student) and keeps the query's stable
// order, so the file is reproducible and the endpoint cannot degrade into N+1.
func TestExportSATRawdataTenThousandAttempts(t *testing.T) {
	log := &satRawdataQueryLog{}
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(log.matcher()))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	base := time.Date(2026, 9, 13, 8, 0, 0, 0, time.UTC)
	const students = 10000

	attempts := sqlmock.NewRows(satRawdataAttemptColumns)
	modules := sqlmock.NewRows(satRawdataModuleColumns)
	cells := sqlmock.NewRows(satRawdataCellColumns)
	for i := 0; i < students; i++ {
		id := "attempt-" + itoa(i)
		attempts.AddRow(satRawdataAttemptRow(id, "C-"+itoa(i), itoa(i)+"@example.com", base.Add(time.Duration(i)*time.Second))...)
		modules.AddRow(id, "mod-"+itoa(i), "reading-writing", "rw-m1", "base", "submitted", satRawdataTestVersion, 1, 1)
		cells.AddRow(id, "mod-"+itoa(i), "q"+itoa(i), 0, singleChoice("B"), nil, `"B"`, nil)
	}
	mock.ExpectBegin()
	mock.ExpectQuery("").WillReturnRows(attempts)
	mock.ExpectQuery("").WillReturnRows(modules)
	mock.ExpectQuery("").WillReturnRows(cells)
	mock.ExpectCommit()

	out, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	if out.RowCount != students || len(out.Rows) != students {
		t.Fatalf("expected %d rows regardless of page size, got %d", students, out.RowCount)
	}
	if len(log.queries) != 3 {
		t.Fatalf("expected exactly 3 bulk reads for %d attempts (no N+1), got %d", students, len(log.queries))
	}
	if out.Rows[0][satRawdataColEmail] != "0@example.com" ||
		out.Rows[students-1][satRawdataColEmail] != itoa(students-1)+"@example.com" {
		t.Fatalf("the projection must preserve the query order: first=%q last=%q",
			out.Rows[0][satRawdataColEmail], out.Rows[students-1][satRawdataColEmail])
	}
	for _, index := range []int{0, students / 2, students - 1} {
		if len(out.Rows[index]) != SATRawdataColumns {
			t.Fatalf("row %d has %d columns", index, len(out.Rows[index]))
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestExportSATRawdataTransportKeepsCellsVerbatim pins the backend projection:
// names and identifiers remain exact, and workbook serialization is responsible
// for writing formula-looking text as inline strings.
func TestExportSATRawdataTransportKeepsCellsVerbatim(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	base := time.Date(2026, 9, 14, 8, 0, 0, 0, time.UTC)
	const (
		email         = "=cmd(),\"two\"\nlines@example.com"
		candidateID   = "candidate,1"
		candidateName = `=HYPERLINK("https://example.invalid"), "Full Name"`
	)

	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataAttemptQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataAttemptColumns).
			AddRow(satRawdataAttemptRowWithName("attempt-1", candidateID, candidateName, email, base)...))
	mock.ExpectQuery(satRawdataModuleQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataModuleColumns).
			AddRow("attempt-1", "mod-rw", "reading-writing", "rw-m1", "base", "submitted", satRawdataTestVersion, 1, 1))
	mock.ExpectQuery(satRawdataCellQueryPattern).WithArgs("exam-1", "schedule-1").
		WillReturnRows(sqlmock.NewRows(satRawdataCellColumns))
	mock.ExpectCommit()

	out, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	row := out.Rows[0]
	if row[satRawdataColEmail] != email {
		t.Fatalf("the transport must not rewrite the email cell: got %q want %q", row[satRawdataColEmail], email)
	}
	if row[satRawdataColCandidateID] != candidateID {
		t.Fatalf("the transport must not rewrite the candidate cell: got %q want %q", row[satRawdataColCandidateID], candidateID)
	}
	if row[satRawdataColFirstName] != candidateName || row[1] != "" {
		t.Fatalf("the transport must keep the full name verbatim in First name: got %q / %q", row[0], row[1])
	}
	if len(row) != SATRawdataColumns {
		t.Fatalf("a hostile cell must not change the row width: got %d", len(row))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
