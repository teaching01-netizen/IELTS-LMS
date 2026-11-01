package main

// End-to-end proof for the SAT RAWDATA "SAT Forms" worksheet
// (docs/plans/2026-11-01-sat-forms-xlsx-export-low-level.md).
//
// This is deliberately not a service-level test. It drives the production
// router over HTTP with real cookie sessions and the real role/authorization
// middleware, reads a real migrated MySQL schema, executes the real export
// transaction, and opens the downloaded workbook bytes. It covers:
//
//   - FR-1 shell count per role: admin/proctor 3 sheets, grader 2.
//   - FR-2 one row per attempt (two stored forms, one row).
//   - FR-3/FR-4 two header rows, pinned field order, labels.
//   - FR-5 value rendering: text verbatim (leading zeroes preserved),
//     single_choice by pinned label, number as a numeric cell.
//   - FR-6 the four status columns derived by the shared expression.
//   - FR-7 schemaVersion 3 while the top-level projection stays 50 columns.
//   - ERR-1/ERR-2 fail loudly through the HTTP envelope (422 / 500).
//   - Scope: an unassigned proctor sees nothing, and a builder is refused.
//
// Gated on TEST_MYSQL_DSN (isolated, fully migrated), like the rest of the
// real-database cmd/api suites.

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/xuri/excelize/v2"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
	resultsdomain "example.com/ielts-proctoring/internal/results"
	"example.com/ielts-proctoring/internal/schedules"
)

// satFormsE2ESnapshot is a schema-2 forms configuration: two registration
// questions (one single_choice), one verbal-entry number, no math-entry
// question (so a verbal sitting reports not_applicable), Eva disabled.
const satFormsE2ESnapshot = `{"providerKey":"sat","forms":{` +
	`"schemaVersion":2,` +
	`"registration":{"fields":[` +
	`{"id":"sat_seat_number","type":"text","label":"Seat number","maxLength":255},` +
	`{"id":"sat_expected_class","type":"single_choice","label":"Expected Class","options":[` +
	`{"id":"rank_4","label":"Rank 4"},{"id":"rank_1","label":"Rank 1"}]}]},` +
	`"sectionEntry":{` +
	`"reading-writing":{"fields":[{"id":"vwpm","type":"number","label":"VWPM"}]},` +
	`"math":{"fields":[]}},` +
	`"evaSim":{"enabled":false,"mode":"native"}}}`

type satFormsE2EFixture struct {
	db       *sql.DB
	cfg      config.Config
	router   http.Handler
	examID   string
	version  string
	schedule string
	org      string
	module   string

	admin, grader, proctor, foreignProctor, builder []*http.Cookie
}

func newSATFormsE2EFixture(t *testing.T) *satFormsE2EFixture {
	t.Helper()
	db := staleETagTestDB(t)
	ctx := context.Background()

	cfg := config.Load()
	cfg.AuthSecret = "sat-forms-e2e-secret-at-least-32-characters"
	cfg.Environment = "test"
	cfg.CookieSecure = false
	cfg.SessionCacheEnabled = false
	cfg.RateLimitMode = config.RateLimitModeLocal
	cfg.RateLimitExportPerUser = 50
	cfg.OutboxExecOnly = true
	app := BuildApp(cfg, db)

	f := &satFormsE2EFixture{
		db:       db,
		cfg:      cfg,
		router:   BuildRouter(app),
		examID:   uuid.NewString(),
		version:  uuid.NewString(),
		org:      "sat-forms-e2e-org-" + uuid.NewString()[:8],
		schedule: "",
	}
	sectionID := uuid.NewString()
	f.module = uuid.NewString()
	owner := "sat-forms-e2e-" + uuid.NewString()[:8]

	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("seed: %.80s: %v", query, err)
		}
	}
	exec(`INSERT INTO exam_entities (id, slug, title, provider_key, provider_exam_type, exam_type,
		status, visibility, organization_id, owner_id, schema_version, revision)
		VALUES (?, ?, 'SAT forms E2E', 'sat', 'SAT', 'Academic', 'published', 'organization', ?, ?, 1, 0)`,
		f.examID, f.examID, f.org, owner)
	exec(`INSERT INTO exam_versions (id, exam_id, version_number, content_snapshot, config_snapshot,
		created_by, is_published, revision)
		VALUES (?, ?, 1, '{"providerKey":"sat","title":"SAT forms E2E","sections":[{"secret":"question body"}]}', ?, ?, TRUE, 1)`,
		f.version, f.examID, satFormsE2ESnapshot, owner)
	exec(`UPDATE exam_entities SET current_published_version_id = ? WHERE id = ?`, f.version, f.examID)
	exec(`INSERT INTO assessment_sections (id, exam_version_id, section_key, title, display_order,
		duration_seconds, break_after_seconds, instructions, tool_policy)
		VALUES (?, ?, 'reading-writing', 'Reading and Writing', 0, 3600, 0, '{"version":1,"nodes":[]}', '[]')`,
		sectionID, f.version)
	exec(`INSERT INTO assessment_modules (id, section_id, module_key, title, display_order,
		duration_seconds, target_question_count, adaptive_role, instructions, tool_policy)
		VALUES (?, ?, 'rw-m1', 'Reading and Writing Module 1', 0, 1920, 1, 'base', '{"version":1,"nodes":[]}', '[]')`,
		f.module, sectionID)

	now := time.Now().UTC()
	sch, err := app.Schedules.Create(ctx, schedules.CreateRequest{
		ExamID: f.examID, PublishedVersionID: f.version, CohortName: "forms e2e cohort",
		StartTime: now.Add(-time.Minute), EndTime: now.Add(3 * time.Hour), CreatedBy: owner,
	})
	if err != nil {
		t.Fatalf("create schedule: %v", err)
	}
	f.schedule = sch.ID

	seedUser := func(role string, org *string) string {
		t.Helper()
		id := uuid.NewString()
		exec(`INSERT INTO users (id, email, display_name, role, state, organization_id)
			VALUES (?, ?, ?, ?, 'active', ?)`, id, id+"@example.test", "E2E "+role, role, org)
		return id
	}
	session := func(userID, role string) []*http.Cookie {
		t.Helper()
		_, token, _, err := auth.CreateSession(ctx, db, cfg, userID, role,
			auth.SessionProof{Source: auth.SessionSourceAccount}, nil, nil, time.Now().UTC())
		if err != nil {
			t.Fatalf("create %s session: %v", role, err)
		}
		return []*http.Cookie{{Name: cfg.EffectiveSessionCookieName(), Value: token}}
	}
	assign := func(userID, role string) {
		t.Helper()
		exec(`INSERT INTO schedule_staff_assignments (id, schedule_id, actor_id, user_id, role, granted_by)
			VALUES (?, ?, ?, ?, ?, ?)`, uuid.NewString(), f.schedule, userID, userID, role, userID)
	}

	admin := seedUser(auth.RoleAdmin, nil) // platform read: no tenant scope
	grader := seedUser(auth.RoleGrader, &f.org)
	proctor := seedUser(auth.RoleProctor, &f.org)
	foreign := seedUser(auth.RoleProctor, &f.org)
	builder := seedUser(auth.RoleBuilder, &f.org)
	assign(grader, auth.RoleGrader)
	assign(proctor, auth.RoleProctor)

	f.admin = session(admin, auth.RoleAdmin)
	f.grader = session(grader, auth.RoleGrader)
	f.proctor = session(proctor, auth.RoleProctor)
	f.foreignProctor = session(foreign, auth.RoleProctor)
	f.builder = session(builder, auth.RoleBuilder)

	t.Cleanup(func() {
		quiet := func(query string, args ...any) {
			if _, err := db.ExecContext(ctx, query, args...); err != nil {
				t.Logf("cleanup sat forms e2e (%.60q): %v", query, err)
			}
		}
		quiet(`DELETE FROM assessment_form_responses WHERE attempt_id IN (SELECT id FROM student_attempts WHERE schedule_id = ?)`, f.schedule)
		quiet(`DELETE FROM assessment_module_attempts WHERE attempt_id IN (SELECT id FROM student_attempts WHERE schedule_id = ?)`, f.schedule)
		quiet(`DELETE FROM student_attempts WHERE schedule_id = ?`, f.schedule)
		quiet(`DELETE FROM schedule_staff_assignments WHERE schedule_id = ?`, f.schedule)
		quiet(`DELETE FROM exam_schedules WHERE id = ?`, f.schedule)
		quiet(`DELETE FROM assessment_modules WHERE section_id IN (SELECT id FROM assessment_sections WHERE exam_version_id = ?)`, f.version)
		quiet(`DELETE FROM assessment_sections WHERE exam_version_id = ?`, f.version)
		quiet(`DELETE FROM exam_versions WHERE id = ?`, f.version)
		quiet(`DELETE FROM exam_entities WHERE id = ?`, f.examID)
		quiet(`DELETE FROM user_sessions WHERE user_id IN (?, ?, ?, ?, ?)`, admin, grader, proctor, foreign, builder)
		quiet(`DELETE FROM users WHERE id IN (?, ?, ?, ?, ?)`, admin, grader, proctor, foreign, builder)
	})
	return f
}

// exportPath builds the exact production URL the staff results page calls.
func (f *satFormsE2EFixture) exportPath(format string) string {
	path := "/api/v1/results/sat/export/rawdata?examId=" + f.examID + "&scheduleId=" + f.schedule
	if format != "" {
		path += "&format=" + format
	}
	return path
}

func (f *satFormsE2EFixture) call(t *testing.T, method, path string, cookies []*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	f.router.ServeHTTP(rec, req)
	return rec
}

func (f *satFormsE2EFixture) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := f.db.ExecContext(context.Background(), query, args...); err != nil {
		t.Fatalf("exec: %.80s: %v", query, err)
	}
}

func (f *satFormsE2EFixture) seedAttempt(t *testing.T, candidateID, name, wcode string, createdAt time.Time) string {
	t.Helper()
	attemptID := uuid.NewString()
	f.exec(t, `INSERT INTO student_attempts (
		id, schedule_id, student_key, organization_id, exam_id,
		published_version_id, exam_title, candidate_id, candidate_name,
		candidate_email, phase, current_module, answers, writing_answers,
		flags, violations_snapshot, integrity, recovery, revision,
		protocol_version, delivery_status, lease_epoch, control_epoch, response_revision,
		wcode, created_at
	) VALUES (?, ?, ?, ?, ?, ?, 'SAT forms E2E', ?, ?, ?, 'pre-check', 'reading', '{}', '{}', '{}', '[]', '{}', '{}', 0,
		2, 'running', 1, 1, 0, ?, ?)`,
		attemptID, f.schedule, attemptID, f.org, f.examID, f.version,
		candidateID, name, candidateID+"@example.test", wcode, createdAt)
	return attemptID
}

func (f *satFormsE2EFixture) seedAttemptModule(t *testing.T, attemptID string) {
	t.Helper()
	f.exec(t, `INSERT INTO assessment_module_attempts (
		id, attempt_id, module_id, state, allocated_seconds, started_at, tool_state, revision
	) VALUES (?, ?, ?, 'submitted', 3600, UTC_TIMESTAMP(6), '{}', 1)`, uuid.NewString(), attemptID, f.module)
}

func (f *satFormsE2EFixture) seedResponse(t *testing.T, attemptID, formKey, answers string) {
	t.Helper()
	now := time.Now().UTC()
	f.exec(t, `INSERT INTO assessment_form_responses (
		attempt_id, form_key, answers, revision, first_submitted_at, updated_at
	) VALUES (?, ?, ?, 1, ?, ?)`, attemptID, formKey, answers, now, now)
}

func openSATFormsE2EWorkbook(t *testing.T, rec *httptest.ResponseRecorder) *excelize.File {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("workbook response: status=%d body=%s", rec.Code, rec.Body.String())
	}
	book, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatalf("open workbook: %v", err)
	}
	t.Cleanup(func() { _ = book.Close() })
	return book
}

func assertSATFormsE2ECell(t *testing.T, book *excelize.File, sheet, cell, want string) {
	t.Helper()
	got, err := book.GetCellValue(sheet, cell)
	if err != nil || got != want {
		t.Fatalf("%s!%s = %q, %v; want %q", sheet, cell, got, err, want)
	}
}

// TestSATFormsExportE2EAdminWorkbookMySQL proves the whole admin path: HTTP,
// cookie session, role gate, export transaction, JSON contract, workbook bytes.
func TestSATFormsExportE2EAdminWorkbookMySQL(t *testing.T) {
	f := newSATFormsE2EFixture(t)
	now := time.Now().UTC()
	a1 := f.seedAttempt(t, "000123", "Ada Lovelace", "W123456", now.Add(-3*time.Minute))
	a2 := f.seedAttempt(t, "000124", "Bob", "W654321", now.Add(-2*time.Minute))
	a3 := f.seedAttempt(t, "000125", "Cy", "W111111", now.Add(-time.Minute))
	// A1 and A3 entered the verbal module; A2 never did. Only A1 answered.
	f.seedAttemptModule(t, a1)
	f.seedAttemptModule(t, a3)
	f.seedResponse(t, a1, "registration", `{"sat_seat_number":"A-007","sat_expected_class":"rank_1"}`)
	f.seedResponse(t, a1, "verbal_entry", `{"vwpm":510}`)

	// --- JSON contract: schemaVersion 3, forms only in sheets[]. ---
	rec := f.call(t, http.MethodGet, f.exportPath(""), f.admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("JSON export: status=%d body=%s", rec.Code, rec.Body.String())
	}
	var payload resultsdomain.SATRawdataExport
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode JSON export: %v", err)
	}
	if payload.SchemaVersion != 3 {
		t.Fatalf("schemaVersion = %d, want 3", payload.SchemaVersion)
	}
	if payload.ColumnCount != resultsdomain.SATRawdataColumns || len(payload.HeaderRows) != 2 {
		t.Fatalf("top-level rawdata projection drifted: columns=%d headers=%d", payload.ColumnCount, len(payload.HeaderRows))
	}
	if payload.RowCount == 0 || len(payload.Rows) != payload.RowCount {
		t.Fatalf("rawdata body is empty: rowCount=%d rows=%d", payload.RowCount, len(payload.Rows))
	}
	if len(payload.Sheets) != 3 || payload.Sheets[2].Name != resultsdomain.SATFormsSheetName {
		t.Fatalf("admin sheets = %v, want SAT Math/SAT Verbal/SAT Forms", sheetNames(payload.Sheets))
	}
	forms := payload.Sheets[2]
	wantHeaderID := []string{
		"cm_user_id", "wcode", "candidate_name", "email", "version",
		"reg.sat_seat_number", "reg.sat_expected_class", "verbal.vwpm",
		"status.registration", "status.verbal_entry", "status.math_entry", "status.eva_sim",
		"attempt_id",
	}
	wantHeaderLabel := []string{
		"cm_user_id", "wcode", "Candidate name", "email", "Version",
		"Registration · Seat number", "Registration · Expected Class", "Verbal entry · VWPM",
		"Registration status", "Verbal entry status", "Math entry status", "Eva SIM status",
		"attempt_id",
	}
	if !reflect.DeepEqual(forms.HeaderRows[0], wantHeaderID) {
		t.Fatalf("forms header row 1 = %v", forms.HeaderRows[0])
	}
	if !reflect.DeepEqual(forms.HeaderRows[1], wantHeaderLabel) {
		t.Fatalf("forms header row 2 = %v", forms.HeaderRows[1])
	}
	if forms.ColumnCount != len(wantHeaderID) || len(forms.NumericColumns) != 1 || forms.NumericColumns[0] != 7 {
		t.Fatalf("forms column metadata = columns:%d numeric:%v", forms.ColumnCount, forms.NumericColumns)
	}
	if len(forms.Rows) != 3 {
		t.Fatalf("forms rows = %d, want one row per attempt", len(forms.Rows))
	}
	wantRows := [][]string{
		{"000123", "W123456", "Ada Lovelace", "000123@example.test", "1", "A-007", "Rank 1", "510",
			"submitted", "submitted", "not_applicable", "not_applicable", a1},
		{"000124", "W654321", "Bob", "000124@example.test", "1", "", "", "",
			"not_submitted", "pending_section", "not_applicable", "not_applicable", a2},
		{"000125", "W111111", "Cy", "000125@example.test", "1", "", "", "",
			"not_submitted", "not_submitted", "not_applicable", "not_applicable", a3},
	}
	for rowIndex := range wantRows {
		if !reflect.DeepEqual(forms.Rows[rowIndex], wantRows[rowIndex]) {
			t.Fatalf("forms row %d = %v\nwant %v", rowIndex, forms.Rows[rowIndex], wantRows[rowIndex])
		}
	}

	// --- The same export as an xlsx download. ---
	rec = f.call(t, http.MethodGet, f.exportPath("xlsx"), f.admin)
	if got := rec.Header().Get("Content-Type"); got != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" {
		t.Fatalf("Content-Type = %q", got)
	}
	if got := rec.Header().Get("Content-Disposition"); !strings.Contains(got, `filename="sat-rawdata.xlsx"`) {
		t.Fatalf("Content-Disposition = %q", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q", got)
	}
	book := openSATFormsE2EWorkbook(t, rec)
	if got := book.GetSheetList(); !reflect.DeepEqual(got, []string{"SAT Math", "SAT Verbal", resultsdomain.SATFormsSheetName}) {
		t.Fatalf("sheet list = %v", got)
	}
	for column, want := range wantHeaderID {
		cell, _ := excelize.CoordinatesToCellName(column+1, 1)
		assertSATFormsE2ECell(t, book, resultsdomain.SATFormsSheetName, cell, want)
	}
	for column, want := range wantHeaderLabel {
		cell, _ := excelize.CoordinatesToCellName(column+1, 2)
		assertSATFormsE2ECell(t, book, resultsdomain.SATFormsSheetName, cell, want)
	}
	for rowIndex, want := range wantRows {
		for column, value := range want {
			cell, _ := excelize.CoordinatesToCellName(column+1, rowIndex+3)
			assertSATFormsE2ECell(t, book, resultsdomain.SATFormsSheetName, cell, value)
		}
	}
	// Leading-zero candidate IDs and text answers must stay inline strings...
	if kind, err := book.GetCellType(resultsdomain.SATFormsSheetName, "A3"); err != nil || kind != excelize.CellTypeInlineString {
		t.Fatalf("cm_user_id cell type = %v, %v; want inline string", kind, err)
	}
	// ...while a number answer is a real numeric cell.
	if kind, err := book.GetCellType(resultsdomain.SATFormsSheetName, "H3"); err != nil || kind != excelize.CellTypeUnset {
		t.Fatalf("vwpm cell type = %v, %v; want numeric", kind, err)
	}
	panes, err := book.GetPanes(resultsdomain.SATFormsSheetName)
	if err != nil || !panes.Freeze || panes.YSplit != 2 {
		t.Fatalf("forms frozen panes = %#v, %v; want two frozen header rows", panes, err)
	}
}

// TestSATFormsExportE2ERoleScopingMySQL proves the sheet follows the backend
// role, not the URL: grader 2 sheets (scores only), assigned proctor 3, an
// unassigned proctor no rows, a builder refused, and anonymous 401.
func TestSATFormsExportE2ERoleScopingMySQL(t *testing.T) {
	f := newSATFormsE2EFixture(t)
	now := time.Now().UTC()
	attemptID := f.seedAttempt(t, "000123", "Ada Lovelace", "W123456", now)
	f.seedAttemptModule(t, attemptID)
	f.seedResponse(t, attemptID, "registration", `{"sat_seat_number":"A-007","sat_expected_class":"rank_1"}`)

	// Grader: permitted, sees rawdata rows, never the forms sheet.
	rec := f.call(t, http.MethodGet, f.exportPath(""), f.grader)
	if rec.Code != http.StatusOK {
		t.Fatalf("grader JSON: status=%d body=%s", rec.Code, rec.Body.String())
	}
	var grader resultsdomain.SATRawdataExport
	if err := json.Unmarshal(rec.Body.Bytes(), &grader); err != nil {
		t.Fatal(err)
	}
	if len(grader.Sheets) != 2 || grader.Sheets[0].Name != "SAT Math" || grader.Sheets[1].Name != "SAT Verbal" {
		t.Fatalf("grader sheets = %v, want the two section sheets", sheetNames(grader.Sheets))
	}
	if len(grader.Sheets[0].Rows)+len(grader.Sheets[1].Rows) == 0 {
		t.Fatal("grader must still receive the section rows")
	}
	book := openSATFormsE2EWorkbook(t, f.call(t, http.MethodGet, f.exportPath("xlsx"), f.grader))
	if got := book.GetSheetList(); !reflect.DeepEqual(got, []string{"SAT Math", "SAT Verbal"}) {
		t.Fatalf("grader workbook sheets = %v", got)
	}

	// Assigned proctor: permitted and gets the forms sheet.
	book = openSATFormsE2EWorkbook(t, f.call(t, http.MethodGet, f.exportPath("xlsx"), f.proctor))
	if got := book.GetSheetList(); len(got) != 3 || got[2] != resultsdomain.SATFormsSheetName {
		t.Fatalf("assigned proctor sheets = %v, want a third SAT Forms sheet", got)
	}
	assertSATFormsE2ECell(t, book, resultsdomain.SATFormsSheetName, "B3", "W123456")

	// Unassigned proctor: same role, no room assignment -> no rows at all,
	// which also proves the new form queries carry the same result scope.
	rec = f.call(t, http.MethodGet, f.exportPath(""), f.foreignProctor)
	if rec.Code != http.StatusOK {
		t.Fatalf("unassigned proctor: status=%d body=%s", rec.Code, rec.Body.String())
	}
	var foreign resultsdomain.SATRawdataExport
	if err := json.Unmarshal(rec.Body.Bytes(), &foreign); err != nil {
		t.Fatal(err)
	}
	if foreign.RowCount != 0 || len(foreign.Rows) != 0 || len(foreign.Sheets) != 2 {
		t.Fatalf("unassigned proctor leaked data: rows=%d sheets=%v", foreign.RowCount, sheetNames(foreign.Sheets))
	}
	book = openSATFormsE2EWorkbook(t, f.call(t, http.MethodGet, f.exportPath("xlsx"), f.foreignProctor))
	if got := book.GetSheetList(); !reflect.DeepEqual(got, []string{"SAT Math", "SAT Verbal"}) {
		t.Fatalf("unassigned proctor workbook sheets = %v", got)
	}

	// Role boundaries at the HTTP edge.
	if rec := f.call(t, http.MethodGet, f.exportPath(""), f.builder); rec.Code != http.StatusForbidden {
		t.Fatalf("builder status = %d, want 403 (body %s)", rec.Code, rec.Body.String())
	}
	if rec := f.call(t, http.MethodGet, f.exportPath(""), nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous status = %d, want 401 (body %s)", rec.Code, rec.Body.String())
	}
}

// TestSATFormsExportE2EStorageFailuresMySQL proves malformed stored data fails
// the request loudly (not with blank columns) and that a legacy version with
// no forms keeps the two-sheet workbook.
func TestSATFormsExportE2EStorageFailuresMySQL(t *testing.T) {
	f := newSATFormsE2EFixture(t)
	attemptID := f.seedAttempt(t, "000123", "Ada Lovelace", "W123456", time.Now().UTC())

	// ERR-1: present-but-invalid forms -> 422 naming the version.
	f.exec(t, `UPDATE exam_versions SET config_snapshot = '{"providerKey":"sat","forms":{"schemaVersion":99}}' WHERE id = ?`, f.version)
	rec := f.call(t, http.MethodGet, f.exportPath("xlsx"), f.admin)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("malformed forms status = %d, want 422 (body %s)", rec.Code, rec.Body.String())
	}
	if code := responseCode(t, rec); code != "INVALID_ASSESSMENT" {
		t.Fatalf("malformed forms code = %q, want INVALID_ASSESSMENT", code)
	}
	if !strings.Contains(rec.Body.String(), f.version) {
		t.Fatalf("error must name the offending version: %s", rec.Body.String())
	}

	// A legacy snapshot without forms is not an error: two sheets.
	f.exec(t, `UPDATE exam_versions SET config_snapshot = '{}' WHERE id = ?`, f.version)
	book := openSATFormsE2EWorkbook(t, f.call(t, http.MethodGet, f.exportPath("xlsx"), f.admin))
	if got := book.GetSheetList(); !reflect.DeepEqual(got, []string{"SAT Math", "SAT Verbal"}) {
		t.Fatalf("legacy version sheets = %v, want two section sheets", got)
	}

	// ERR-2: undecodable stored answers -> 500 INTERNAL, never a blank cell.
	f.exec(t, `UPDATE exam_versions SET config_snapshot = ? WHERE id = ?`, satFormsE2ESnapshot, f.version)
	f.exec(t, `INSERT INTO assessment_form_responses (attempt_id, form_key, answers, revision, first_submitted_at, updated_at)
		VALUES (?, 'registration', CAST('"not-an-object"' AS JSON), 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`, attemptID)
	rec = f.call(t, http.MethodGet, f.exportPath("xlsx"), f.admin)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("malformed answers status = %d, want 500 (body %s)", rec.Code, rec.Body.String())
	}
	if code := responseCode(t, rec); code != "INTERNAL" {
		t.Fatalf("malformed answers code = %q, want INTERNAL", code)
	}
	if strings.Contains(rec.Body.String(), "assessment_form_responses") {
		t.Fatalf("error body leaked storage detail: %s", rec.Body.String())
	}
}

func sheetNames(sheets []resultsdomain.SATRawdataSheet) []string {
	out := make([]string, len(sheets))
	for i, sheet := range sheets {
		out[i] = sheet.Name
	}
	return out
}
