package results

import (
	"context"
	"database/sql"
	"strconv"
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestSATRawdataVerbalHeaderContract(t *testing.T) {
	rows := satRawdataVerbalHeaderRows()
	if len(rows) != 2 {
		t.Fatalf("expected two header rows, got %d", len(rows))
	}
	for _, row := range rows {
		if len(row) != SATRawdataVerbalColumnCount {
			t.Fatalf("header has %d columns, expected %d", len(row), SATRawdataVerbalColumnCount)
		}
	}
	wantQ1 := 21
	wantQ27 := 47
	if rows[1][wantQ1] != "Q1" || rows[1][wantQ27] != "Q27" || rows[1][48] != "เติมชุดข้อสอบ" || rows[1][49] != "RECHECK" {
		t.Fatalf("converter-sensitive positions changed: %#v", rows[1])
	}
	if rows[0][0] != "A" || rows[0][48] != "AW" || rows[0][49] != "" {
		t.Fatalf("first header row changed: %#v", rows[0])
	}
	wantHeader1 := "A|B|C|D|E|F|G|H|I|J|K|L|M|N|O|P|Q|R|S|T|U|V|W|X|Y|Z|AA|AB|AC|AD|AE|AF|AG|AH|AI|AJ|AK|AL|AM|AN|AO|AP|AQ|AR|AS|AT|AU|AV|AW|"
	if got := strings.Join(satRawdataVerbalHeaderRow1[:], "|"); got != wantHeader1 {
		t.Fatalf("first header row changed:\n got %s\nwant %s", got, wantHeader1)
	}
}

func TestRawdataModuleCode(t *testing.T) {
	for _, tc := range []struct{ role, want string }{
		{"base", "A"},
		{"lower_branch", "B"},
		{"higher_branch", "C"},
		{"none", ""},
		{"unknown", ""},
	} {
		if got := rawdataModuleCode(tc.role); got != tc.want {
			t.Errorf("rawdataModuleCode(%q) = %q, want %q", tc.role, got, tc.want)
		}
	}
}

func TestBuildSATRawdataVerbalRowsProjectsCompatibilityMatrix(t *testing.T) {
	started := sql.NullTime{Time: time.Date(2026, 9, 1, 9, 0, 0, 0, time.UTC), Valid: true}
	questions := rawdataTestQuestions()
	questions[0].LegacyResponse = sql.NullString{String: `"A"`, Valid: true}
	questions[1].LegacyResponse = sql.NullString{String: `"B"`, Valid: true}
	questions[3].AnswerDefinition = sql.NullString{String: `{"kind":"single_choice"}`, Valid: true}
	questions[3].LegacyResponse = sql.NullString{String: `"A"`, Valid: true}
	questions[4].LegacyResponse = sql.NullString{String: `true`, Valid: true}
	questions[5].LegacyResponse = sql.NullString{String: `"A"`, Valid: true}
	questions[5].V2Present = true
	questions[5].V2Canonical = sql.NullString{String: `{"answer":"B","markedForReview":false}`, Valid: true}
	rows, err := buildSATRawdataVerbalRows(
		[]satRawdataAttempt{{ID: "attempt-1", Email: "student@example.com"}},
		[]satRawdataModule{{AttemptID: "attempt-1", ModuleID: "module-a", AdaptiveRole: "base", DisplayOrder: 1, State: "active", StartedAt: started}},
		questions,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || len(rows[0]) != SATRawdataVerbalColumnCount {
		t.Fatalf("unexpected row shape: %#v", rows)
	}
	row := rows[0]
	for index, want := range map[int]string{
		2: "student@example.com", 3: "3.70%", 4: "1", 5: "27",
		21: "1", 22: "0", 23: "No answer", 24: "", 25: "", 26: "0",
		48: "A", 49: "",
	} {
		if row[index] != want {
			t.Errorf("row[%d] = %q, want %q", index, row[index], want)
		}
	}
}

func TestBuildSATRawdataVerbalRowsKeepsPlaceholdersAndNotStartedModules(t *testing.T) {
	attempts := []satRawdataAttempt{{ID: "attempt-no-modules", Email: "one@example.com"}, {ID: "attempt-not-started", Email: "two@example.com"}}
	modules := []satRawdataModule{{AttemptID: "attempt-not-started", ModuleID: "module-a", AdaptiveRole: "base", DisplayOrder: 1, State: "not_started"}}
	questions := rawdataTestQuestions()
	questions[0].LegacyResponse = sql.NullString{String: `"A"`, Valid: true}
	questions[0].AttemptID = "attempt-not-started"
	questions[1].AttemptID = "attempt-not-started"
	for i := range questions[2:] {
		questions[i+2].AttemptID = "attempt-not-started"
	}
	rows, err := buildSATRawdataVerbalRows(attempts, modules, questions)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected a row for both attempts, got %d", len(rows))
	}
	if rows[0][2] != "one@example.com" || rows[0][48] != "" {
		t.Fatalf("module-less placeholder was not retained: %#v", rows[0])
	}
	if rows[1][2] != "two@example.com" || rows[1][48] != "A" || rows[1][21] != "" || rows[1][3] != "" || rows[1][4] != "" || rows[1][5] != "" {
		t.Fatalf("not-started module was scored or misplaced: %#v", rows[1])
	}
}

func TestBuildSATRawdataVerbalRowsSortsModulesAndBlanksInvalidStructureTotals(t *testing.T) {
	modules := []satRawdataModule{
		{AttemptID: "attempt-1", ModuleID: "higher", AdaptiveRole: "higher_branch", DisplayOrder: 2, State: "not_started"},
		{AttemptID: "attempt-1", ModuleID: "lower", AdaptiveRole: "lower_branch", DisplayOrder: 1, State: "not_started"},
	}
	rows, err := buildSATRawdataVerbalRows([]satRawdataAttempt{{ID: "attempt-1"}}, modules, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0][48] != "B" || rows[1][48] != "C" {
		t.Fatalf("module output order/code incorrect: %#v", rows)
	}

	questions := rawdataTestQuestions()
	questions[0].DisplayOrder = 2
	started := sql.NullTime{Time: time.Now(), Valid: true}
	invalid, err := buildSATRawdataVerbalRows([]satRawdataAttempt{{ID: "attempt-1"}}, []satRawdataModule{{AttemptID: "attempt-1", ModuleID: "base", AdaptiveRole: "base", State: "active", StartedAt: started}}, questions)
	if err != nil {
		t.Fatal(err)
	}
	if invalid[0][3] != "" || invalid[0][4] != "" || invalid[0][5] != "" || invalid[0][21] != "" {
		t.Fatalf("invalid question structure fabricated a Q1 or totals: %#v", invalid[0])
	}
}

func TestSATRawdataQuestionCellUsesV2AndDegradesMalformedData(t *testing.T) {
	question := satRawdataQuestion{
		AnswerDefinition: sql.NullString{String: `{"kind":"single_choice","correctOptionId":"B"}`, Valid: true},
		LegacyResponse:   sql.NullString{String: `"B"`, Valid: true},
		V2Present:        true,
		V2Canonical:      sql.NullString{String: `{"answer":"A"}`, Valid: true},
	}
	if got := satRawdataQuestionCell(question); got != "0" {
		t.Fatalf("V2 response did not beat conflicting legacy value: %q", got)
	}
	question.V2Canonical = sql.NullString{String: `{"answer":`, Valid: true}
	if got := satRawdataQuestionCell(question); got != "" {
		t.Fatalf("malformed V2 response resurrected legacy data: %q", got)
	}
}

func TestExportSATRawdataVerbalUsesThreeBulkReadsForAllAttempts(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	attemptRows := sqlmock.NewRows([]string{"id", "candidate_email"})
	for i := 0; i < 101; i++ {
		attemptRows.AddRow("attempt-"+strconv.Itoa(i), "student@example.com")
	}
	mock.ExpectQuery("(?s)FROM student_attempts a.*ORDER BY a.created_at ASC, a.id ASC").
		WithArgs("exam-1", "schedule-1").WillReturnRows(attemptRows)
	mock.ExpectQuery("(?s)FROM student_attempts a.*assessment_module_attempts ma.*section_key = 'reading-writing'").
		WithArgs("exam-1", "schedule-1").WillReturnRows(sqlmock.NewRows([]string{"attempt_id", "module_id", "adaptive_role", "display_order", "state", "started_at"}))
	mock.ExpectQuery("(?s)FROM student_attempts a.*assessment_exam_questions eq.*attempt_responses_v2 v").
		WithArgs("exam-1", "schedule-1").WillReturnRows(sqlmock.NewRows([]string{"attempt_id", "module_id", "exam_question_id", "display_order", "answer_definition", "legacy_response", "marked_for_review", "legacy_updated_at", "v2_response", "v2_present", "v2_updated_at"}))
	mock.ExpectCommit()

	out, err := NewService(db).ExportSATRawdataVerbal(context.Background(), auth.NewActorContext("admin", auth.RoleAdmin), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Rows) != 101 {
		t.Fatalf("expected all 101 attempts, got %d", len(out.Rows))
	}
	for i, row := range out.Rows {
		if len(row) != SATRawdataVerbalColumnCount || row[2] != "student@example.com" {
			t.Fatalf("placeholder row %d has wrong shape/content: %#v", i, row)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestExportSATRawdataVerbalAppliesScheduleResultScope(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery("(?s)FROM student_attempts a.*schedule_staff_assignments").
		WithArgs("exam-1", "schedule-1", "org-1", "grader-1", auth.RoleGrader).
		WillReturnRows(sqlmock.NewRows([]string{"id", "candidate_email"}))
	mock.ExpectCommit()
	actor := auth.NewActorContext("grader-1", auth.RoleGrader).WithOrgID("org-1")
	out, err := NewService(db).ExportSATRawdataVerbal(context.Background(), actor, "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Rows) != 0 || len(out.HeaderRows) != 2 {
		t.Fatalf("unexpected scoped export: %#v", out)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func rawdataTestQuestions() []satRawdataQuestion {
	questions := make([]satRawdataQuestion, 27)
	for i := range questions {
		questions[i] = satRawdataQuestion{
			AttemptID:        "attempt-1",
			ModuleID:         "module-a",
			ExamQuestionID:   "eq-" + strconv.Itoa(i+1),
			DisplayOrder:     i + 1,
			AnswerDefinition: sql.NullString{String: `{"kind":"single_choice","correctOptionId":"A"}`, Valid: true},
		}
	}
	return questions
}

func TestRawdataHeaderLabelsAreVerbatim(t *testing.T) {
	want := "First name|Last name|email|Percentage|Points received|Points available|Minutes|Seconds|Date started|Date finished|Requires grading|Certificate Serial|cm_user_id|Access code|IP Address|Extra information 1|Extra information 2|Extra information 3|Extra information 4|Extra information 5||Q1|Q2|Q3|Q4|Q5|Q6|Q7|Q8|Q9|Q10|Q11|Q12|Q13|Q14|Q15|Q16|Q17|Q18|Q19|Q20|Q21|Q22|Q23|Q24|Q25|Q26|Q27|เติมชุดข้อสอบ|RECHECK"
	got := strings.Join(satRawdataVerbalHeaderRow2[:], "|")
	if got != want {
		t.Fatalf("second header row changed:\n got %s\nwant %s", got, want)
	}
}
