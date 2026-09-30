package integration

// SAT RAWDATA export against real MySQL (skips without TEST_MYSQL_DSN like the
// rest of this package).
//
// The unit suite covers row assembly with sqlmock. This test proves the parts
// sqlmock cannot: the three bulk queries actually execute on MySQL/TiDB
// (CAST(... AS CHAR), the COLLATE in the V2 dedupe ORDER BY, and the
// correlated published_version_id fence), the read-only repeatable-read
// transaction commits, and the projection stays a fixed 50 columns for a
// Student Access group that mixes sections and an attempt with no modules.
import (
	"bytes"
	"context"
	"fmt"
	"reflect"
	"strconv"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/xuri/excelize/v2"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/results"
)

func TestSATRawdataExportAgainstMySQL(t *testing.T) {
	f := newAdaptiveExam(t)
	ctx := context.Background()

	// Two Verbal students (Module 1, active) with different V2 scores, one Math
	// student, and one registered-but-never-entered attempt.
	f.seedStudent(f.rw, 2, false)
	f.seedStudent(f.rw, 0, false)
	f.seedStudent(f.math, 1, false)
	bareAttemptID := seedBareAttempt(t, f)

	out, err := results.NewService(f.db).ExportSATRawdata(ctx,
		auth.NewActorContext("integration-admin", auth.RoleAdmin), f.examID, f.scheduleID)
	if err != nil {
		t.Fatalf("ExportSATRawdata: %v", err)
	}

	if out.SchemaVersion != results.SATRawdataSchemaVersion || out.ColumnCount != results.SATRawdataColumns {
		t.Fatalf("unexpected schema metadata: %+v", out)
	}
	if len(out.HeaderRows) != 2 {
		t.Fatalf("expected 2 header rows, got %d", len(out.HeaderRows))
	}
	for i, header := range out.HeaderRows {
		if len(header) != results.SATRawdataColumns {
			t.Fatalf("header row %d is %d wide, want %d", i+1, len(header), results.SATRawdataColumns)
		}
	}
	// Three module rows plus one identity row for the attempt that never entered.
	if out.RowCount != 4 || len(out.Rows) != 4 {
		t.Fatalf("expected 4 rows, got %d", out.RowCount)
	}

	var (
		verbal, math, blank int
		sawCorrectAnswer    bool
	)
	for i, row := range out.Rows {
		if len(row) != results.SATRawdataColumns {
			t.Fatalf("row %d is %d wide, want %d", i, len(row), results.SATRawdataColumns)
		}
		if row[12] == "bare-"+bareAttemptID[:8] {
			if row[0] != "Bare Candidate" || row[2] != "bare@example.test" {
				t.Fatalf("never-entered attempt lost its identity: %#v", row[:13])
			}
			for column, cell := range row {
				if column != 0 && column != 2 && column != 12 && cell != "" {
					t.Fatalf("never-entered attempt has unexpected column %d = %q", column, cell)
				}
			}
			blank++
			continue
		}
		// Every administered row carries the module code and RECHECK anchor.
		if row[48] != "A" || row[49] != "TRUE" {
			t.Fatalf("row %d lost its placement anchors: code=%q recheck=%q", i, row[48], row[49])
		}
		switch row[5] {
		case "27":
			verbal++
		case "22":
			math++
		default:
			t.Fatalf("row %d has an unexpected points-available value %q", i, row[5])
		}
		for q := 0; q < 27; q++ {
			if row[21+q] == "1" {
				sawCorrectAnswer = true
			}
		}
	}
	if verbal != 2 || math != 1 || blank != 1 {
		t.Fatalf("expected 2 verbal + 1 math + 1 blank row, got %d/%d/%d", verbal, math, blank)
	}
	if !sawCorrectAnswer {
		t.Fatal("V2 answers were not projected into any question cell")
	}
}

// Verify the complete database -> answer resolution -> workbook path against
// full-length modules. Literal spreadsheet addresses keep the expected column
// placement independent of the exporter's index constants.
func TestSATRawdataExportFullLengthWorkbookAgainstMySQL(t *testing.T) {
	t.Run("contiguous source order", func(t *testing.T) { assertSATRawdataFullLengthWorkbook(t, false) })
	t.Run("gaps after question replacement", func(t *testing.T) { assertSATRawdataFullLengthWorkbook(t, true) })
}

func assertSATRawdataFullLengthWorkbook(t *testing.T, gapped bool) {
	t.Helper()
	f := newAdaptiveExam(t)
	ctx := context.Background()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := f.db.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("seed full-length export: %v", err)
		}
	}
	for _, module := range []struct {
		id    string
		count int
	}{{f.rw.baseID, 27}, {f.math.baseID, 22}} {
		exec("UPDATE assessment_modules SET target_question_count = ? WHERE id = ?", module.count, module.id)
		// newAdaptiveExam already supplies orders 0, 1 and 2.
		for order := 3; order < module.count; order++ {
			questionID, revisionID := uuid.NewString(), uuid.NewString()
			exec("INSERT INTO assessment_questions (id, provider_key, created_by) VALUES (?, 'sat', ?)", questionID, f.owner)
			exec(`INSERT INTO assessment_question_revisions (
				id, question_id, semantic_revision, state, question_type, stimulus,
				prompt, answer_definition, rationale, metadata, accessibility, created_by
			) VALUES (?, ?, 1, 'sealed', 'single_choice', '{"version":1,"nodes":[]}',
				'{"version":1,"nodes":[]}', '{"kind":"single_choice","correctOptionId":"B"}',
				'{}', '{}', '{}', ?)`, revisionID, questionID, f.owner)
			exec(`INSERT INTO assessment_exam_questions
				(id, module_id, question_id, question_revision_id, display_order, is_pretest)
				VALUES (?, ?, ?, ?, ?, FALSE)`, uuid.NewString(), module.id, questionID, revisionID, order)
		}
		lastOrder := module.count - 1
		if gapped {
			// Deleting the third placement and appending a replacement leaves
			// orders 0, 1, 3, ..., count. Delivery still shows Q1..Q<count>.
			exec("UPDATE assessment_exam_questions SET display_order = ? WHERE module_id = ? AND display_order = 2", module.count, module.id)
			lastOrder = module.count
		}
		// The RAWDATA template includes pretest questions too, including the
		// final question in each section.
		exec("UPDATE assessment_exam_questions SET is_pretest = TRUE WHERE module_id = ? AND display_order = ?", module.id, lastOrder)
	}
	// Confirm the actual ordered question array delivered to students before
	// comparing its sequential question numbers with the exported workbook.
	sections, err := delivery.NewService(f.db, tx.NewRunner(f.db)).LoadSections(ctx, f.versionID)
	if err != nil {
		t.Fatal(err)
	}
	checkedModules := 0
	for _, section := range sections {
		for _, module := range section.Modules {
			count := 0
			switch module.ID {
			case f.rw.baseID:
				count = 27
			case f.math.baseID:
				count = 22
			default:
				continue
			}
			if len(module.Questions) != count {
				t.Fatalf("delivered module %s has %d questions, want %d", module.ID, len(module.Questions), count)
			}
			for index, question := range module.Questions {
				wantOrder := index
				if gapped && index >= 2 {
					wantOrder++
				}
				if question.DisplayOrder != wantOrder {
					t.Fatalf("delivered question %d has display_order %d, want %d", index+1, question.DisplayOrder, wantOrder)
				}
			}
			checkedModules++
		}
	}
	if checkedModules != 2 {
		t.Fatalf("checked %d full-length delivered modules, want 2", checkedModules)
	}

	cases := []struct {
		candidateID string
		branch      adaptiveBranch
		count       int
		correct     int
		lastEmpty   bool
		state       string
		percentage  string
	}{
		{"000123", f.rw, 27, 27, false, "submitted", "100.00%"},
		{"rw-incorrect", f.rw, 27, 0, false, "submitted", "0.00%"},
		{"rw-unanswered", f.rw, 27, 18, true, "active", "66.70%"},
		{"rw-not-started", f.rw, 27, 27, false, "not_started", ""},
		{"math-locked", f.math, 22, 22, false, "locked", "100.00%"},
		{"math-incorrect", f.math, 22, 0, false, "submitted", "0.00%"},
		{"math-unanswered", f.math, 22, 12, true, "active", "54.50%"},
	}
	for _, c := range cases {
		attemptID := f.seedStudent(c.branch, c.correct, false)
		lastOrder := c.count - 1
		if gapped {
			lastOrder++
		}
		exec("UPDATE student_attempts SET candidate_id = ?, candidate_name = ?, candidate_email = ? WHERE id = ?",
			c.candidateID, "  Full length "+c.candidateID+"  ", c.candidateID+"@example.test", attemptID)
		exec("UPDATE assessment_module_attempts SET state = ?, revision = revision + 1 WHERE attempt_id = ? AND module_id = ?",
			c.state, attemptID, c.branch.baseID)
		if c.lastEmpty {
			exec(`DELETE v FROM attempt_responses_v2 v
				JOIN assessment_exam_questions eq ON eq.id = v.question_id AND eq.module_id = v.module_id
				WHERE v.attempt_id = ? AND eq.display_order = ?`, attemptID, lastOrder)
		}
		if c.candidateID == "rw-incorrect" {
			// The final question has a wrong canonical answer and stale correct
			// answers under both its bank alias and the legacy response table.
			// The canonical placement answer must still win at Q27.
			exec(`INSERT INTO attempt_responses_v2 (
				attempt_id, question_id, module_id, lease_epoch, control_epoch,
				client_version, client_write_id, request_hash, response, response_hash, server_revision
			) SELECT ?, eq.question_id, eq.module_id, 1, 1, 1, ?, ?,
				'{"answer":"B"}', ?, 7 FROM assessment_exam_questions eq
				WHERE eq.module_id = ? AND eq.display_order = ?`, attemptID,
				"write-"+uuid.NewString(), "req-"+uuid.NewString(), "hash-"+uuid.NewString(), c.branch.baseID, lastOrder)
			exec(`INSERT INTO assessment_question_responses (
				id, module_attempt_id, exam_question_id, response, marked_for_review, eliminated_options, annotations, revision
			) SELECT ?, ma.id, eq.id, '"B"', FALSE, '[]', '{}', 1
				FROM assessment_module_attempts ma
				JOIN assessment_exam_questions eq ON eq.module_id = ma.module_id
				WHERE ma.attempt_id = ? AND eq.display_order = ?`, uuid.NewString(), attemptID, lastOrder)
		}
	}
	bareID := seedBareAttempt(t, f)
	out, err := results.NewService(f.db).ExportSATRawdata(ctx,
		auth.NewActorContext("integration-admin", auth.RoleAdmin), f.examID, f.scheduleID)
	if err != nil {
		t.Fatal(err)
	}
	if out.RowCount != 8 {
		t.Fatalf("export contains %d flat rows, want 8", out.RowCount)
	}
	data, err := results.BuildSATRawdataXLSX(out)
	if err != nil {
		t.Fatal(err)
	}
	book, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = book.Close() })
	if !reflect.DeepEqual(book.GetSheetList(), []string{"SAT Math", "SAT Verbal"}) {
		t.Fatalf("unexpected workbook sheets: %v", book.GetSheetList())
	}
	questionColumns := []string{"V", "W", "X", "Y", "Z", "AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AI", "AJ", "AK", "AL", "AM", "AN", "AO", "AP", "AQ", "AR", "AS", "AT", "AU", "AV"}
	assertCell := func(sheet, address, want string) {
		t.Helper()
		got, err := book.GetCellValue(sheet, address)
		if err != nil || got != want {
			t.Fatalf("%s!%s = %q (%v), want %q", sheet, address, got, err, want)
		}
	}
	for _, sheet := range []struct {
		name string
		rows int
	}{{"SAT Math", 6}, {"SAT Verbal", 7}} {
		rows, err := book.GetRows(sheet.name)
		if err != nil || len(rows) != sheet.rows {
			t.Fatalf("%s contains %d rows (%v), want %d including headers", sheet.name, len(rows), err, sheet.rows)
		}
		for q, column := range questionColumns {
			assertCell(sheet.name, column+"2", fmt.Sprintf("Q%d", q+1))
		}
		seen := map[string]bool{}
		for row := 3; row <= sheet.rows; row++ {
			r := strconv.Itoa(row)
			id, err := book.GetCellValue(sheet.name, "M"+r)
			if err != nil || seen[id] {
				t.Fatalf("%s row %d has duplicate/unreadable identity %q (%v)", sheet.name, row, id, err)
			}
			seen[id] = true
			if id == "bare-"+bareID[:8] {
				assertCell(sheet.name, "A"+r, "Bare Candidate")
				assertCell(sheet.name, "C"+r, "bare@example.test")
				for _, column := range append([]string{"B", "D", "E", "F", "AW", "AX"}, questionColumns...) {
					assertCell(sheet.name, column+r, "")
				}
				continue
			}
			matched := false
			for _, c := range cases {
				if c.candidateID != id {
					continue
				}
				matched = true
				if (c.count == 27) != (sheet.name == "SAT Verbal") {
					t.Fatalf("candidate %s appeared in the wrong section sheet %s", id, sheet.name)
				}
				assertCell(sheet.name, "A"+r, "Full length "+id)
				assertCell(sheet.name, "B"+r, "")
				assertCell(sheet.name, "C"+r, id+"@example.test")
				assertCell(sheet.name, "D"+r, c.percentage)
				assertCell(sheet.name, "AW"+r, "A")
				assertCell(sheet.name, "AX"+r, "TRUE")
				points, available := strconv.Itoa(c.correct), strconv.Itoa(c.count)
				if c.state == "not_started" {
					points, available = "", ""
				}
				assertCell(sheet.name, "E"+r, points)
				assertCell(sheet.name, "F"+r, available)
				sum := 0
				for q, column := range questionColumns {
					want := ""
					if q < c.count && c.state != "not_started" {
						want = "0"
						if q < c.correct {
							want = "1"
						}
						if c.lastEmpty && q == c.count-1 {
							want = "No answer"
						}
					}
					assertCell(sheet.name, column+r, want)
					if want == "0" || want == "1" {
						kind, err := book.GetCellType(sheet.name, column+r)
						if err != nil || (kind != excelize.CellTypeUnset && kind != excelize.CellTypeNumber) {
							t.Fatalf("%s!%s%s must be numeric, got type %v (%v)", sheet.name, column, r, kind, err)
						}
					}
					if want == "1" {
						sum++
					}
				}
				if c.state != "not_started" && sum != c.correct {
					t.Fatalf("candidate %s question sum %d differs from points %d", id, sum, c.correct)
				}
				if id == "000123" {
					kind, err := book.GetCellType(sheet.name, "M"+r)
					if err != nil || kind != excelize.CellTypeInlineString {
						t.Fatalf("leading-zero candidate ID must be text, got %v (%v)", kind, err)
					}
				}
			}
			if !matched {
				t.Fatalf("unexpected candidate %q in %s", id, sheet.name)
			}
		}
		if !seen["bare-"+bareID[:8]] {
			t.Fatalf("never-entered attempt missing from %s", sheet.name)
		}
	}
}

// TestSATRawdataExportConcurrentReadersAgree covers TC-CONCURRENT-001: two
// admins exporting the same Student Access group at the same moment must both
// succeed — the read-only repeatable-read snapshot takes no lock that would
// serialize or deadlock them — and must see an identical projection.
func TestSATRawdataExportConcurrentReadersAgree(t *testing.T) {
	f := newAdaptiveExam(t)
	f.seedStudent(f.rw, 2, false)
	f.seedStudent(f.math, 1, false)
	seedBareAttempt(t, f)

	svc := results.NewService(f.db)
	actor := auth.NewActorContext("integration-admin", auth.RoleAdmin)

	const readers = 2
	outs := make([]*results.SATRawdataExport, readers)
	errs := make([]error, readers)
	var wg sync.WaitGroup
	for i := 0; i < readers; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			outs[index], errs[index] = svc.ExportSATRawdata(context.Background(), actor, f.examID, f.scheduleID)
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("concurrent export %d failed: %v", i, err)
		}
	}
	if outs[0].RowCount == 0 {
		t.Fatal("fixture precondition: the export must project rows")
	}
	if outs[0].RowCount != outs[1].RowCount {
		t.Fatalf("concurrent exports disagree on row count: %d vs %d", outs[0].RowCount, outs[1].RowCount)
	}
	if !reflect.DeepEqual(outs[0].Rows, outs[1].Rows) {
		t.Fatal("concurrent exports produced different rows for the same snapshot")
	}
}

// seedBareAttempt inserts one student_attempts row with no module attempt,
// proving the export boundary is attempt existence, not administered modules.
func seedBareAttempt(t *testing.T, f *adaptiveExam) string {
	t.Helper()
	attemptID := uuid.NewString()
	if _, err := f.db.ExecContext(context.Background(), `INSERT INTO student_attempts (
		id, schedule_id, student_key, organization_id, exam_id,
		published_version_id, exam_title, candidate_id, candidate_name,
		candidate_email, phase, current_module, answers, writing_answers,
		flags, violations_snapshot, integrity, recovery, revision,
		protocol_version, delivery_status, lease_epoch, control_epoch, response_revision,
		wcode
	) VALUES (?, ?, ?, ?, ?, ?, 'SAT adaptive integration', ?, 'Bare Candidate',
		'bare@example.test', 'pre-check', 'reading', '{}', '{}', '{}', '[]', '{}', '{}', 0,
		2, 'running', 1, 1, 0, ?)`,
		attemptID, f.scheduleID, attemptID, "adaptive-org", f.examID, f.versionID,
		"bare-"+attemptID[:8], "W-"+attemptID); err != nil {
		t.Fatalf("seed bare attempt: %v", err)
	}
	return attemptID
}
