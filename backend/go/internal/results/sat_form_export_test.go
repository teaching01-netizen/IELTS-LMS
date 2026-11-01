package results

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/assessmentforms"
	"example.com/ielts-proctoring/internal/assessmentforms/definition"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// Column fixtures for the four SAT Forms reads.
var (
	satFormPinColumns        = []string{"published_version_id", "version_number"}
	satFormAttemptColumns    = []string{"attempt_id", "candidate_id", "wcode", "candidate_name", "candidate_email", "version_id", "version_number", "status_registration", "status_verbal_entry", "status_math_entry", "status_eva_sim"}
	satFormDefinitionColumns = []string{"id", "version_number", "config_snapshot"}
	satFormResponseColumns   = []string{"attempt_id", "form_key", "answers"}
)

// Patterns identify each form read without pinning the interpolated status SQL
// (that expression is owned and tested by assessmentforms).
const (
	satFormPinQueryPattern        = `(?s)SELECT COALESCE\(s\.published_version_id, ''\), COALESCE\(v\.version_number, 0\).*FROM exam_schedules`
	satFormAttemptQueryPattern    = `(?s)SELECT a\.id, COALESCE\(a\.candidate_id, ''\), COALESCE\(a\.wcode, ''\).*FROM student_attempts a`
	satFormDefinitionQueryPattern = `(?s)SELECT id, version_number, CAST\(config_snapshot AS CHAR\) FROM exam_versions WHERE id IN`
	satFormResponseQueryPattern   = `(?s)SELECT r\.attempt_id, r\.form_key, CAST\(r\.answers AS CHAR\).*FROM assessment_form_responses`
)

func satRawdataArgs() []driver.Value {
	return []driver.Value{"exam-1", "schedule-1"}
}

// expectSATFormsExport registers the four form reads. A nil rowset means "no
// rows". Omitting the definitions rowset is the expected shape when no version
// is present: the exporter must not issue an empty IN () query.
func expectSATFormsExport(mock sqlmock.Sqlmock, args []driver.Value, pin []driver.Value, attempts, definitions, responses *sqlmock.Rows) {
	pinRows := sqlmock.NewRows(satFormPinColumns)
	if pin != nil {
		pinRows.AddRow(pin...)
	}
	mock.ExpectQuery(satFormPinQueryPattern).WithArgs(args...).WillReturnRows(pinRows)

	if attempts == nil {
		attempts = sqlmock.NewRows(satFormAttemptColumns)
	}
	mock.ExpectQuery(satFormAttemptQueryPattern).WithArgs(args...).WillReturnRows(attempts)

	if definitions != nil {
		mock.ExpectQuery(satFormDefinitionQueryPattern).WillReturnRows(definitions)
	}

	if responses == nil {
		responses = sqlmock.NewRows(satFormResponseColumns)
	}
	mock.ExpectQuery(satFormResponseQueryPattern).WithArgs(args...).WillReturnRows(responses)
}

// expectNoSATForms keeps an admin/observer/proctor export on its two section
// sheets: no version in the room configures a form field.
func expectNoSATForms(mock sqlmock.Sqlmock, args []driver.Value) {
	expectSATFormsExport(mock, args, nil, nil, nil, nil)
}

// satFormsSnapshot renders the config_snapshot JSON a version stores.
func satFormsSnapshot(t *testing.T, forms definition.Forms) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{definition.SnapshotKey: forms})
	if err != nil {
		t.Fatalf("marshal forms snapshot: %v", err)
	}
	return string(raw)
}

func textField(id, label string) definition.Field {
	return definition.Field{ID: id, Type: definition.TypeText, Label: label, MaxLength: 255}
}

func numberField(id, label string) definition.Field {
	return definition.Field{ID: id, Type: definition.TypeNumber, Label: label}
}

func choiceField(id, label string, options ...definition.Option) definition.Field {
	return definition.Field{ID: id, Type: definition.TypeSingleChoice, Label: label, Options: options}
}

// satFormTestForms is the two-version fixture used by the column tests: v2 is
// the pinned version and v3 was published mid-room.
func satFormTestForms() (map[string]*definition.Forms, []satFormVersion) {
	v2 := &definition.Forms{
		SchemaVersion: definition.SchemaVersionSections,
		Registration: definition.Registration{Fields: []definition.Field{
			textField("sat_seat_number", "Seat number"),
			choiceField("sat_expected_class", "Expected Class",
				definition.Option{ID: "rank_4", Label: "Rank 4"},
				definition.Option{ID: "rank_1", Label: "Rank 1"}),
		}},
		SectionEntry: map[string]definition.SectionEntry{
			definition.SectionReadingWriting: {Fields: []definition.Field{numberField("vwpm", "VWPM")}},
			definition.SectionMath:           {Fields: []definition.Field{}},
		},
		EvaSim: definition.EvaSim{Mode: definition.ModeNative},
	}
	v3 := &definition.Forms{
		SchemaVersion: definition.SchemaVersionSections,
		Registration: definition.Registration{Fields: []definition.Field{
			// Same ID as v2 with a different label: the pinned label must win.
			textField("sat_seat_number", "Seat (v3 wording)"),
			numberField("sat_admission_year", "Admission year"),
		}},
		SectionEntry: map[string]definition.SectionEntry{
			definition.SectionReadingWriting: {Fields: []definition.Field{numberField("vwpm", "VWPM")}},
			definition.SectionMath:           {Fields: []definition.Field{}},
		},
		EvaSim: definition.EvaSim{Mode: definition.ModeNative, Fields: []definition.Field{
			numberField("eva_rating", "Eva rating"),
		}},
	}
	return map[string]*definition.Forms{"version-2": v2, "version-3": v3},
		[]satFormVersion{{ID: "version-2", Number: 2}, {ID: "version-3", Number: 3}}
}

func TestSATFormColumnsPinnedVersionFirstThenExtras(t *testing.T) {
	defs, versions := satFormTestForms()
	columns := satFormColumns(versions, defs)

	want := []string{
		"reg.sat_seat_number",
		"reg.sat_expected_class",
		"reg.sat_admission_year",
		"verbal.vwpm",
		"eva.eva_rating",
	}
	if len(columns) != len(want) {
		t.Fatalf("columns = %v, want %v", columnIDs(columns), want)
	}
	for i := range want {
		if columns[i].HeaderID != want[i] {
			t.Fatalf("column %d = %q, want %q (all: %v)", i, columns[i].HeaderID, want[i], columnIDs(columns))
		}
	}

	// The pinned version wins the label and options for a shared field ID.
	if columns[0].Header != "Registration · Seat number" {
		t.Fatalf("duplicate field ID must keep the pinned label, got %q", columns[0].Header)
	}
	if !columns[2].Numeric || columns[0].Numeric {
		t.Fatalf("numeric flags are wrong: seat=%v admissionYear=%v", columns[0].Numeric, columns[2].Numeric)
	}
	if columns[3].Header != "Verbal entry · VWPM" {
		t.Fatalf("section label = %q", columns[3].Header)
	}
}

func columnIDs(columns []satFormFieldColumn) []string {
	out := make([]string, len(columns))
	for i, column := range columns {
		out[i] = column.HeaderID
	}
	return out
}

func TestSATFormColumnsSkipSectionFormsBeforeSchemaV2(t *testing.T) {
	legal := &definition.Forms{
		SchemaVersion: definition.SchemaVersion,
		Registration:  definition.Registration{Fields: []definition.Field{textField("sat_seat_number", "Seat number")}},
		EvaSim:        definition.EvaSim{Mode: definition.ModeNative},
	}
	columns := satFormColumns(
		[]satFormVersion{{ID: "version-1", Number: 1}},
		map[string]*definition.Forms{"version-1": legal},
	)
	if len(columns) != 1 || columns[0].HeaderID != "reg.sat_seat_number" {
		t.Fatalf("legacy schema must contribute registration only, got %v", columnIDs(columns))
	}
}

func TestSATFormColumnsEvaEmbedAddsNoColumns(t *testing.T) {
	forms := &definition.Forms{
		SchemaVersion: definition.SchemaVersionSections,
		Registration:  definition.Registration{Fields: []definition.Field{textField("sat_seat_number", "Seat number")}},
		SectionEntry: map[string]definition.SectionEntry{
			definition.SectionReadingWriting: {Fields: []definition.Field{}},
			definition.SectionMath:           {Fields: []definition.Field{}},
		},
		EvaSim: definition.EvaSim{Mode: definition.ModeEmbed, Enabled: true, URL: "https://example.invalid/eva"},
	}
	columns := satFormColumns([]satFormVersion{{ID: "version-1", Number: 1}}, map[string]*definition.Forms{"version-1": forms})
	for _, column := range columns {
		if column.FormKey == definition.FormEvaSim {
			t.Fatalf("embedded Eva must not export a field column: %v", column.HeaderID)
		}
	}
}

func TestSATFormValueRendersLabelsNumbersAndRawFallback(t *testing.T) {
	seat := textField("sat_seat_number", "Seat number")
	year := numberField("sat_admission_year", "Admission year")
	class := choiceField("sat_expected_class", "Expected Class",
		definition.Option{ID: "rank_4", Label: "Rank 4"},
		definition.Option{ID: "rank_1", Label: "Rank 1"})

	cases := []struct {
		name    string
		field   definition.Field
		answers definition.Answers
		want    string
	}{
		{"text", seat, definition.Answers{"sat_seat_number": "A-007"}, "A-007"},
		{"integer number", year, definition.Answers{"sat_admission_year": float64(2027)}, "2027"},
		{"fractional number", year, definition.Answers{"sat_admission_year": 2027.5}, "2027.5"},
		{"option label", class, definition.Answers{"sat_expected_class": "rank_1"}, "Rank 1"},
		{"unknown option keeps the stored id", class, definition.Answers{"sat_expected_class": "rank_9"}, "rank_9"},
		{"unanswered", seat, definition.Answers{}, ""},
		{"no response object", seat, nil, ""},
		{"wrong stored type", year, definition.Answers{"sat_admission_year": "2027"}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := satFormValue(c.field, c.answers); got != c.want {
				t.Fatalf("satFormValue = %q, want %q", got, c.want)
			}
		})
	}
}

// FR-5: a single_choice answer renders the option label pinned by the
// attempt's version. The column header still follows the room's pinned version
// (FR-3), so a later version's option must not fall back to its raw ID just
// because the pinned version does not know it.
func TestAssembleSATFormsRendersChoiceLabelFromAttemptVersion(t *testing.T) {
	pinned := &definition.Forms{
		SchemaVersion: definition.SchemaVersionSections,
		Registration: definition.Registration{Fields: []definition.Field{
			choiceField("sat_expected_class", "Expected Class",
				definition.Option{ID: "rank_4", Label: "Rank 4"},
				definition.Option{ID: "rank_1", Label: "Rank 1"}),
		}},
		SectionEntry: map[string]definition.SectionEntry{
			definition.SectionReadingWriting: {Fields: []definition.Field{}},
			definition.SectionMath:           {Fields: []definition.Field{}},
		},
		EvaSim: definition.EvaSim{Mode: definition.ModeNative},
	}
	later := &definition.Forms{
		SchemaVersion: definition.SchemaVersionSections,
		Registration: definition.Registration{Fields: []definition.Field{
			choiceField("sat_expected_class", "Expected class (later)",
				definition.Option{ID: "rank_3", Label: "Rank 3"}),
		}},
		SectionEntry: map[string]definition.SectionEntry{
			definition.SectionReadingWriting: {Fields: []definition.Field{}},
			definition.SectionMath:           {Fields: []definition.Field{}},
		},
		EvaSim: definition.EvaSim{Mode: definition.ModeNative},
	}
	defs := map[string]*definition.Forms{"version-2": pinned, "version-3": later}
	versions := []satFormVersion{{ID: "version-2", Number: 2}, {ID: "version-3", Number: 3}}
	attempts := []satFormAttempt{
		{AttemptID: "attempt-2", VersionID: "version-2", VersionNumber: 2, Status: map[string]string{}},
		{AttemptID: "attempt-3", VersionID: "version-3", VersionNumber: 3, Status: map[string]string{}},
	}
	responses := map[string]map[string]definition.Answers{
		"attempt-2": {definition.FormRegistration: {"sat_expected_class": "rank_1"}},
		"attempt-3": {definition.FormRegistration: {"sat_expected_class": "rank_3"}},
	}

	sheet, ok := assembleSATForms(attempts, versions, defs, responses)
	if !ok {
		t.Fatal("forms sheet must be produced")
	}
	if got := sheet.HeaderRows[1][5]; got != "Registration · Expected Class" {
		t.Fatalf("header must keep the pinned wording, got %q", got)
	}
	if got := sheet.Rows[0][5]; got != "Rank 1" {
		t.Fatalf("v2 answer = %q, want the v2 label", got)
	}
	if got := sheet.Rows[1][5]; got != "Rank 3" {
		t.Fatalf("v3 answer = %q, want the v3 label, not the raw option ID", got)
	}
}

func TestAssembleSATFormsOmitsSheetWithoutForms(t *testing.T) {
	attempts := []satFormAttempt{{AttemptID: "attempt-1", CandidateID: "000123", VersionID: "version-1", VersionNumber: 1}}
	sheet, ok := assembleSATForms(attempts, []satFormVersion{{ID: "version-1", Number: 1}}, map[string]*definition.Forms{"version-1": nil}, nil)
	if ok {
		t.Fatalf("a legacy version without forms must not produce a sheet: %#v", sheet)
	}
}

func TestAssembleSATFormsRowPerAttemptNotPerModule(t *testing.T) {
	defs, versions := satFormTestForms()
	attempts := []satFormAttempt{
		{AttemptID: "attempt-1", CandidateID: "000123", Wcode: "W123456", CandidateName: "Ada", Email: "ada@example.com", VersionID: "version-2", VersionNumber: 2,
			Status: map[string]string{
				definition.FormRegistration: assessmentStatusSubmitted,
				definition.FormVerbalEntry:  assessmentStatusNotApplicable,
				definition.FormMathEntry:    assessmentStatusNotApplicable,
				definition.FormEvaSim:       assessmentStatusNotApplicable,
			}},
		{AttemptID: "attempt-2", CandidateID: "000124", CandidateName: "Bob", Email: "bob@example.com", VersionID: "version-3", VersionNumber: 3,
			Status: map[string]string{
				definition.FormRegistration: assessmentStatusNotSubmitted,
				definition.FormVerbalEntry:  assessmentStatusPendingSection,
				definition.FormMathEntry:    assessmentStatusNotApplicable,
				definition.FormEvaSim:       assessmentStatusNotTracked,
			}},
	}
	responses := map[string]map[string]definition.Answers{
		"attempt-1": {
			definition.FormRegistration: {"sat_seat_number": "A-007", "sat_expected_class": "rank_1"},
		},
	}

	sheet, ok := assembleSATForms(attempts, versions, defs, responses)
	if ok != true {
		t.Fatal("forms sheet must be produced when fields exist")
	}
	if len(sheet.Rows) != len(attempts) {
		t.Fatalf("one row per attempt, got %d rows for %d attempts", len(sheet.Rows), len(attempts))
	}
	if len(sheet.HeaderRows) != 2 {
		t.Fatalf("expected two header rows, got %d", len(sheet.HeaderRows))
	}
	if sheet.ColumnCount != len(sheet.HeaderRows[0]) || len(sheet.HeaderRows[1]) != sheet.ColumnCount {
		t.Fatalf("header width drifted: %d/%d/%d", sheet.ColumnCount, len(sheet.HeaderRows[0]), len(sheet.HeaderRows[1]))
	}
	for i, row := range sheet.Rows {
		if len(row) != sheet.ColumnCount {
			t.Fatalf("row %d has %d columns, want %d", i, len(row), sheet.ColumnCount)
		}
	}
	first := sheet.Rows[0]
	if first[0] != "000123" || first[1] != "W123456" || first[2] != "Ada" || first[3] != "ada@example.com" || first[4] != "2" {
		t.Fatalf("identity block drifted: %#v", first[:5])
	}
	if got := first[len(first)-1]; got != "attempt-1" {
		t.Fatalf("attempt_id must close the row, got %q", got)
	}
	if got := first[sheet.ColumnCount-5]; got != assessmentStatusSubmitted {
		t.Fatalf("registration status = %q", got)
	}
	// Field columns start after the five identity columns.
	if first[5] != "A-007" || first[6] != "Rank 1" {
		t.Fatalf("field values = %#v", first[5:7])
	}
	if first[7] != "" {
		t.Fatalf("v3-only admission year must stay blank for a v2 attempt, got %q", first[7])
	}
	if sheet.Rows[1][len(sheet.Rows[1])-1] != "attempt-2" {
		t.Fatal("second attempt row missing")
	}
	if len(sheet.NumericColumns) == 0 {
		t.Fatal("number fields must be listed as numeric columns")
	}
}

// Status vocabulary mirror: the export must reuse assessmentforms values
// verbatim. TestSATFormStatusVocabularyMatchesAssessmentForms asserts the
// mirror stays true.
const (
	assessmentStatusSubmitted         = "submitted"
	assessmentStatusNotSubmitted      = "not_submitted"
	assessmentStatusPendingCompletion = "pending_completion"
	assessmentStatusPendingSection    = "pending_section"
	assessmentStatusNotApplicable     = "not_applicable"
	assessmentStatusNotTracked        = "not_tracked"
)

func TestSATFormStatusVocabularyMatchesAssessmentForms(t *testing.T) {
	pairs := []struct{ summary, source string }{
		{assessmentStatusSubmitted, assessmentforms.StatusSubmitted},
		{assessmentStatusNotSubmitted, assessmentforms.StatusNotSubmitted},
		{assessmentStatusPendingCompletion, assessmentforms.StatusPendingCompletion},
		{assessmentStatusPendingSection, assessmentforms.StatusPendingSection},
		{assessmentStatusNotApplicable, assessmentforms.StatusNotApplicable},
		{assessmentStatusNotTracked, assessmentforms.StatusNotTracked},
	}
	for _, pair := range pairs {
		if pair.summary != pair.source {
			t.Fatalf("status vocabulary drifted: export expects %q, assessmentforms declares %q", pair.summary, pair.source)
		}
	}
}

func TestExportSATRawdataAppendsFormsSheetForAdmin(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	base := time.Date(2026, 11, 1, 8, 0, 0, 0, time.UTC)

	forms := definition.Forms{
		SchemaVersion: definition.SchemaVersionSections,
		Registration: definition.Registration{Fields: []definition.Field{
			textField("sat_seat_number", "Seat number"),
			choiceField("sat_expected_class", "Expected Class", definition.Option{ID: "rank_1", Label: "Rank 1"}),
		}},
		SectionEntry: map[string]definition.SectionEntry{
			definition.SectionReadingWriting: {Fields: []definition.Field{numberField("vwpm", "VWPM")}},
			definition.SectionMath:           {Fields: []definition.Field{}},
		},
		EvaSim: definition.EvaSim{Mode: definition.ModeEmbed, Enabled: true, URL: "https://example.invalid/eva"},
	}

	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataAttemptQueryPattern).WithArgs(satRawdataArgs()...).
		WillReturnRows(sqlmock.NewRows(satRawdataAttemptColumns).
			AddRow(satRawdataAttemptRow("attempt-1", "000123", "ada@example.com", base)...))
	mock.ExpectQuery(satRawdataModuleQueryPattern).WithArgs(satRawdataArgs()...).
		WillReturnRows(sqlmock.NewRows(satRawdataModuleColumns).
			AddRow("attempt-1", "mod-rw", "reading-writing", "rw-1", "base", "submitted", satRawdataTestVersion, 1, 1))
	mock.ExpectQuery(satRawdataCellQueryPattern).WithArgs(satRawdataArgs()...).
		WillReturnRows(sqlmock.NewRows(satRawdataCellColumns))

	attempts := sqlmock.NewRows(satFormAttemptColumns).AddRow(
		"attempt-1", "000123", "W123456", "Ada Lovelace", "ada@example.com",
		satRawdataTestVersion, 1,
		"submitted", "submitted", "not_applicable", "not_tracked",
	)
	definitions := sqlmock.NewRows(satFormDefinitionColumns).
		AddRow(satRawdataTestVersion, 1, satFormsSnapshot(t, forms))
	responses := sqlmock.NewRows(satFormResponseColumns).
		AddRow("attempt-1", definition.FormRegistration, `{"sat_seat_number":"A-007","sat_expected_class":"rank_1"}`).
		AddRow("attempt-1", definition.FormVerbalEntry, `{"vwpm":42}`)
	expectSATFormsExport(mock, satRawdataArgs(), []driver.Value{satRawdataTestVersion, 1}, attempts, definitions, responses)
	mock.ExpectCommit()

	out, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Sheets) != 3 || out.Sheets[2].Name != SATFormsSheetName {
		t.Fatalf("admin export must append the forms sheet: %#v", out.Sheets)
	}
	// The frozen top-level projection is untouched.
	if out.ColumnCount != SATRawdataColumns || out.RowCount != 1 || len(out.Rows[0]) != SATRawdataColumns {
		t.Fatalf("rawdata projection drifted: %#v", out)
	}

	sheet := out.Sheets[2]
	wantID := []string{
		"cm_user_id", "wcode", "candidate_name", "email", "version",
		"reg.sat_seat_number", "reg.sat_expected_class", "verbal.vwpm",
		"status.registration", "status.verbal_entry", "status.math_entry", "status.eva_sim",
		"attempt_id",
	}
	if len(sheet.HeaderRows[0]) != len(wantID) {
		t.Fatalf("forms header = %v, want %v", sheet.HeaderRows[0], wantID)
	}
	for i := range wantID {
		if sheet.HeaderRows[0][i] != wantID[i] {
			t.Fatalf("forms header %d = %q, want %q", i, sheet.HeaderRows[0][i], wantID[i])
		}
	}
	if sheet.HeaderRows[1][5] != "Registration · Seat number" || sheet.HeaderRows[1][9] != "Verbal entry status" {
		t.Fatalf("human header drifted: %v", sheet.HeaderRows[1])
	}
	if len(sheet.Rows) != 1 {
		t.Fatalf("expected one attempt row, got %d", len(sheet.Rows))
	}
	row := sheet.Rows[0]
	want := []string{
		"000123", "W123456", "Ada Lovelace", "ada@example.com", "1",
		"A-007", "Rank 1", "42",
		"submitted", "submitted", "not_applicable", "not_tracked",
		"attempt-1",
	}
	for i := range want {
		if row[i] != want[i] {
			t.Fatalf("forms row %d = %q, want %q (row %v)", i, row[i], want[i], row)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestExportSATRawdataOmitsFormsSheetForGrader(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataAttemptQueryPattern).WithArgs(satRawdataArgs()...).
		WillReturnRows(sqlmock.NewRows(satRawdataAttemptColumns))
	mock.ExpectQuery(satRawdataModuleQueryPattern).WithArgs(satRawdataArgs()...).
		WillReturnRows(sqlmock.NewRows(satRawdataModuleColumns))
	mock.ExpectQuery(satRawdataCellQueryPattern).WithArgs(satRawdataArgs()...).
		WillReturnRows(sqlmock.NewRows(satRawdataCellColumns))
	mock.ExpectCommit()

	out, err := NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("grader-1", auth.RoleGrader), "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Sheets) != 2 {
		t.Fatalf("grader export must stay at two sheets, got %d", len(out.Sheets))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestExportSATRawdataRejectsMalformedFormDefinitions(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataAttemptQueryPattern).WithArgs(satRawdataArgs()...).
		WillReturnRows(sqlmock.NewRows(satRawdataAttemptColumns))
	mock.ExpectQuery(satRawdataModuleQueryPattern).WithArgs(satRawdataArgs()...).
		WillReturnRows(sqlmock.NewRows(satRawdataModuleColumns))
	mock.ExpectQuery(satRawdataCellQueryPattern).WithArgs(satRawdataArgs()...).
		WillReturnRows(sqlmock.NewRows(satRawdataCellColumns))

	attempts := sqlmock.NewRows(satFormAttemptColumns).AddRow(
		"attempt-1", "000123", "", "Ada", "ada@example.com", satRawdataTestVersion, 2,
		"submitted", "not_applicable", "not_applicable", "not_applicable",
	)
	definitions := sqlmock.NewRows(satFormDefinitionColumns).
		AddRow(satRawdataTestVersion, 2, `{"forms":{"schemaVersion":99}}`)
	expectSATFormsExport(mock, satRawdataArgs(), []driver.Value{satRawdataTestVersion, 2}, attempts, definitions, nil)

	_, err = NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1")
	if err == nil {
		t.Fatal("a malformed stored form definition must fail the export")
	}
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeInvalidAssessment {
		t.Fatalf("expected INVALID_ASSESSMENT, got %v", err)
	}
}

func TestExportSATRawdataRejectsMalformedFormAnswers(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	seat := textField("sat_seat_number", "Seat number")
	// Schema 1 keeps per-question scope; schema 2 fields inherit the form's
	// timing and must leave Scope empty.
	seat.Scope = definition.ScopeAll
	forms := definition.Forms{
		SchemaVersion: definition.SchemaVersion,
		Registration:  definition.Registration{Fields: []definition.Field{seat}},
		EvaSim:        definition.EvaSim{Mode: definition.ModeNative},
	}

	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataAttemptQueryPattern).WithArgs(satRawdataArgs()...).
		WillReturnRows(sqlmock.NewRows(satRawdataAttemptColumns))
	mock.ExpectQuery(satRawdataModuleQueryPattern).WithArgs(satRawdataArgs()...).
		WillReturnRows(sqlmock.NewRows(satRawdataModuleColumns))
	mock.ExpectQuery(satRawdataCellQueryPattern).WithArgs(satRawdataArgs()...).
		WillReturnRows(sqlmock.NewRows(satRawdataCellColumns))

	attempts := sqlmock.NewRows(satFormAttemptColumns).AddRow(
		"attempt-1", "000123", "", "Ada", "ada@example.com", satRawdataTestVersion, 1,
		"submitted", "not_applicable", "not_applicable", "not_applicable",
	)
	definitions := sqlmock.NewRows(satFormDefinitionColumns).
		AddRow(satRawdataTestVersion, 1, satFormsSnapshot(t, forms))
	responses := sqlmock.NewRows(satFormResponseColumns).
		AddRow("attempt-1", definition.FormRegistration, `not-json`)
	expectSATFormsExport(mock, satRawdataArgs(), []driver.Value{satRawdataTestVersion, 1}, attempts, definitions, responses)

	_, err = NewService(db).ExportSATRawdata(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "exam-1", "schedule-1")
	if err == nil {
		t.Fatal("undecodable stored answers must fail the export")
	}
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeInternal {
		t.Fatalf("expected INTERNAL, got %v", err)
	}
}

func TestExportSATRawdataFormsQueriesCarryTenantScope(t *testing.T) {
	orgID := "org-1"
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	scopeFragment := `(?s).*s\.organization_id = \? AND EXISTS \(SELECT 1 FROM schedule_staff_assignments`
	rawdataScope := `(?s).*sch\.organization_id = \? AND EXISTS \(SELECT 1 FROM schedule_staff_assignments`
	args := []driver.Value{"exam-1", "schedule-1", orgID, "proctor-1", auth.RoleProctor}

	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataAttemptQueryPattern + rawdataScope).WithArgs(args...).
		WillReturnRows(sqlmock.NewRows(satRawdataAttemptColumns))
	mock.ExpectQuery(satRawdataModuleQueryPattern + rawdataScope).WithArgs(args...).
		WillReturnRows(sqlmock.NewRows(satRawdataModuleColumns))
	mock.ExpectQuery(satRawdataCellQueryPattern + rawdataScope).WithArgs(args...).
		WillReturnRows(sqlmock.NewRows(satRawdataCellColumns))
	mock.ExpectQuery(satFormPinQueryPattern + scopeFragment).WithArgs(args...).
		WillReturnRows(sqlmock.NewRows(satFormPinColumns))
	mock.ExpectQuery(satFormAttemptQueryPattern + scopeFragment).WithArgs(args...).
		WillReturnRows(sqlmock.NewRows(satFormAttemptColumns))
	mock.ExpectQuery(satFormResponseQueryPattern + scopeFragment).WithArgs(args...).
		WillReturnRows(sqlmock.NewRows(satFormResponseColumns))
	mock.ExpectCommit()

	actor := auth.ActorContext{UserID: "proctor-1", Role: auth.RoleProctor, OrgID: &orgID}
	out, err := NewService(db).ExportSATRawdata(context.Background(), actor, "exam-1", "schedule-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Sheets) != 2 {
		t.Fatalf("a room without forms keeps two sheets, got %d", len(out.Sheets))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
