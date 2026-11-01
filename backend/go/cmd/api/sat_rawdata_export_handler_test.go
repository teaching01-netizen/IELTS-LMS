package main

import (
	"bytes"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/httpx"
	resultsdomain "example.com/ielts-proctoring/internal/results"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/xuri/excelize/v2"
)

const (
	satRawdataHandlerAttemptQuery = `(?s)SELECT a\.id, a\.candidate_id, COALESCE\(a\.candidate_name, ''\), a\.candidate_email.*FROM student_attempts`
	satRawdataHandlerModuleQuery  = `(?s)SELECT ma\.attempt_id, m\.id, s\.section_key.*FROM assessment_module_attempts`
	satRawdataHandlerCellQuery    = `(?s)SELECT ma\.attempt_id, m\.id AS module_id, eq\.id AS exam_question_id.*FROM assessment_module_attempts`
	satFormHandlerPinQuery        = `(?s)SELECT COALESCE\(s\.published_version_id, ''\), COALESCE\(v\.version_number, 0\).*FROM exam_schedules`
	satFormHandlerAttemptQuery    = `(?s)SELECT a\.id, COALESCE\(a\.candidate_id, ''\), COALESCE\(a\.wcode, ''\).*FROM student_attempts a`
	satFormHandlerResponseQuery   = `(?s)SELECT r\.attempt_id, r\.form_key, CAST\(r\.answers AS CHAR\).*FROM assessment_form_responses`
)

// satFormsVisibleToRole mirrors results.satFormsVisibleTo for handler fixtures.
func satFormsVisibleToRole(role string) bool {
	switch role {
	case auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleProctor:
		return true
	}
	return false
}

func expectEmptySATRawdataQueries(mock sqlmock.Sqlmock, session *auth.Session) {
	args := []driver.Value{"exam-1", "schedule-1"}
	if session != nil {
		actor := auth.NewActorContext(session.UserID, session.Role)
		if !actor.IsPlatformRead() && session.OrganizationID != nil && *session.OrganizationID != "" {
			args = append(args, *session.OrganizationID, session.UserID, session.Role)
		}
	}
	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataHandlerAttemptQuery).WithArgs(args...).WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(satRawdataHandlerModuleQuery).WithArgs(args...).WillReturnRows(sqlmock.NewRows([]string{"attempt_id"}))
	mock.ExpectQuery(satRawdataHandlerCellQuery).WithArgs(args...).WillReturnRows(sqlmock.NewRows([]string{"attempt_id"}))
	if session != nil && satFormsVisibleToRole(session.Role) {
		// No attempt in the fixture carries a version, so the definitions read
		// is skipped and the export stays at two sheets.
		mock.ExpectQuery(satFormHandlerPinQuery).WithArgs(args...).
			WillReturnRows(sqlmock.NewRows([]string{"published_version_id", "version_number"}))
		mock.ExpectQuery(satFormHandlerAttemptQuery).WithArgs(args...).
			WillReturnRows(sqlmock.NewRows([]string{"attempt_id"}))
		mock.ExpectQuery(satFormHandlerResponseQuery).WithArgs(args...).
			WillReturnRows(sqlmock.NewRows([]string{"attempt_id"}))
	}
	mock.ExpectCommit()
}

func callSATRawdataHandler(handler http.HandlerFunc, target string, session *auth.Session) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if session != nil {
		req = req.WithContext(sessionCtx(req.Context(), session))
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func newSATRawdataHandlerApp(db *sql.DB) *App {
	return &App{
		Config:  config.Config{RateLimitExportPerUser: 10, RateLimitExportPerUserWindowSecs: 60},
		Results: resultsdomain.NewService(db),
	}
}

func TestSATRawdataHandlerXLSXResponse(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	session := &auth.Session{UserID: "admin-1", Role: auth.RoleAdmin}
	expectEmptySATRawdataQueries(mock, session)

	app := newSATRawdataHandlerApp(db)
	rec := callSATRawdataHandler(resultsSATRawdataExportHandler(app), "/api/v1/results/sat/export/rawdata?examId=exam-1&scheduleId=schedule-1&format=xlsx", session)
	if rec.Code != http.StatusOK {
		t.Fatalf("XLSX export status = %d, body %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" {
		t.Fatalf("Content-Type = %q", got)
	}
	if got := rec.Header().Get("Content-Disposition"); !strings.Contains(got, "attachment") {
		t.Fatalf("Content-Disposition = %q, want attachment", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q", got)
	}
	book, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatalf("handler returned an unreadable workbook: %v", err)
	}
	defer func() { _ = book.Close() }()
	if got, want := book.GetSheetList(), []string{"SAT Math", "SAT Verbal"}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("sheet list = %v, want %v", got, want)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSATRawdataHandlerDefaultsToCompatibleJSON(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	session := &auth.Session{UserID: "admin-1", Role: auth.RoleAdmin}
	expectEmptySATRawdataQueries(mock, session)

	rec := callSATRawdataHandler(resultsSATRawdataExportHandler(newSATRawdataHandlerApp(db)), "/api/v1/results/sat/export/rawdata?examId=exam-1&scheduleId=schedule-1", session)
	if rec.Code != http.StatusOK {
		t.Fatalf("JSON export status = %d, body %s", rec.Code, rec.Body.String())
	}
	var payload resultsdomain.SATRawdataExport
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("default response must remain JSON: %v", err)
	}
	// FR-7: schemaVersion 3 signals the optional forms sheet, while the
	// top-level projection keeps describing the fixed 50-column rawdata view.
	if payload.SchemaVersion != 3 || payload.ColumnCount != 50 || len(payload.HeaderRows) != 2 || len(payload.Rows) != 0 {
		t.Fatalf("legacy JSON fields drifted: %#v", payload)
	}
	if len(payload.Sheets) != 2 || payload.Sheets[0].Name != "SAT Math" || payload.Sheets[1].Name != "SAT Verbal" {
		t.Fatalf("default JSON omitted the new sheets: %#v", payload.Sheets)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSATRawdataHandlerValidatesRequiredIds(t *testing.T) {
	app := newSATRawdataHandlerApp(nil)
	handler := resultsSATRawdataExportHandler(app)
	session := &auth.Session{UserID: "admin-1", Role: auth.RoleAdmin}
	for _, target := range []string{
		"/api/v1/results/sat/export/rawdata?scheduleId=schedule-1",
		"/api/v1/results/sat/export/rawdata?examId=exam-1",
	} {
		rec := callSATRawdataHandler(handler, target, session)
		if rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("request %q status = %d, want 422 (%s)", target, rec.Code, rec.Body.String())
		}
	}
}

func TestSATRawdataHandlerRoleMatrix(t *testing.T) {
	for _, role := range []string{auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleGrader, auth.RoleProctor} {
		t.Run("allows_"+role, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			session := &auth.Session{UserID: "staff-1", Role: role}
			expectEmptySATRawdataQueries(mock, session)
			rec := callSATRawdataHandler(resultsSATRawdataExportHandler(newSATRawdataHandlerApp(db)), "/api/v1/results/sat/export/rawdata?examId=exam-1&scheduleId=schedule-1", session)
			if rec.Code != http.StatusOK {
				t.Fatalf("role %q status = %d, body %s", role, rec.Code, rec.Body.String())
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
	for _, role := range []string{auth.RoleStudent, auth.RoleBuilder} {
		t.Run("denies_"+role, func(t *testing.T) {
			rec := callSATRawdataHandler(resultsSATRawdataExportHandler(&App{}), "/api/v1/results/sat/export/rawdata?examId=exam-1&scheduleId=schedule-1", &auth.Session{UserID: "user-1", Role: role})
			if rec.Code != http.StatusForbidden {
				t.Fatalf("role %q status = %d, body %s", role, rec.Code, rec.Body.String())
			}
		})
	}
	t.Run("requires_session", func(t *testing.T) {
		rec := callSATRawdataHandler(resultsSATRawdataExportHandler(&App{}), "/api/v1/results/sat/export/rawdata?examId=exam-1&scheduleId=schedule-1", nil)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("anonymous status = %d, body %s", rec.Code, rec.Body.String())
		}
	})
}

func TestSATRawdataHandlerRateLimitAppliesToXLSX(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	session := &auth.Session{UserID: "admin-1", Role: auth.RoleAdmin}
	expectEmptySATRawdataQueries(mock, session)
	app := newSATRawdataHandlerApp(db)
	app.Config.RateLimitExportPerUser = 1
	app.Limiter = httpx.NewBucketStore(10)
	handler := resultsSATRawdataExportHandler(app)
	target := "/api/v1/results/sat/export/rawdata?examId=exam-1&scheduleId=schedule-1&format=xlsx"

	first := callSATRawdataHandler(handler, target, session)
	if first.Code != http.StatusOK {
		t.Fatalf("first export status = %d, body %s", first.Code, first.Body.String())
	}
	second := callSATRawdataHandler(handler, target, session)
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second export status = %d, want 429 (%s)", second.Code, second.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSATRawdataHandlerKeepsOrganizationScope(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	orgID := "org-current"
	session := &auth.Session{UserID: "grader-1", Role: auth.RoleGrader, OrganizationID: &orgID}
	args := []driver.Value{"exam-1", "schedule-1", orgID, session.UserID, session.Role}
	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataHandlerAttemptQuery + `.*sch\.organization_id = \? AND EXISTS \(SELECT 1 FROM schedule_staff_assignments`).
		WithArgs(args...).WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(satRawdataHandlerModuleQuery + `.*sch\.organization_id = \? AND EXISTS \(SELECT 1 FROM schedule_staff_assignments`).
		WithArgs(args...).WillReturnRows(sqlmock.NewRows([]string{"attempt_id"}))
	mock.ExpectQuery(satRawdataHandlerCellQuery + `.*sch\.organization_id = \? AND EXISTS \(SELECT 1 FROM schedule_staff_assignments`).
		WithArgs(args...).WillReturnRows(sqlmock.NewRows([]string{"attempt_id"}))
	mock.ExpectCommit()

	rec := callSATRawdataHandler(resultsSATRawdataExportHandler(newSATRawdataHandlerApp(db)), "/api/v1/results/sat/export/rawdata?examId=exam-1&scheduleId=schedule-1&format=xlsx", session)
	if rec.Code != http.StatusOK {
		t.Fatalf("scoped export status = %d, body %s", rec.Code, rec.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The grader keeps the two section sheets: form answers are not part of that
// role's export, and the four form reads must not even be issued.
func TestSATRawdataHandlerGraderKeepsTwoSheets(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	session := &auth.Session{UserID: "grader-1", Role: auth.RoleGrader}
	expectEmptySATRawdataQueries(mock, session)

	rec := callSATRawdataHandler(resultsSATRawdataExportHandler(newSATRawdataHandlerApp(db)), "/api/v1/results/sat/export/rawdata?examId=exam-1&scheduleId=schedule-1&format=xlsx", session)
	if rec.Code != http.StatusOK {
		t.Fatalf("grader export status = %d, body %s", rec.Code, rec.Body.String())
	}
	book, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatalf("handler returned an unreadable workbook: %v", err)
	}
	defer func() { _ = book.Close() }()
	if got := book.GetSheetList(); len(got) != 2 || got[0] != "SAT Math" || got[1] != "SAT Verbal" {
		t.Fatalf("grader sheet list = %v, want the two section sheets", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

const satRawdataHandlerFormsSnapshot = `{"forms":{"schemaVersion":2,` +
	`"registration":{"fields":[{"id":"sat_seat_number","type":"text","label":"Seat number","maxLength":255}]},` +
	`"sectionEntry":{"reading-writing":{"fields":[]},"math":{"fields":[]}},` +
	`"evaSim":{"enabled":false,"mode":"native"}}}`

// An admin download carries the third sheet over HTTP, with the registration
// answer rendered by label and the derived status.
func TestSATRawdataHandlerAdminGetsFormsSheet(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	base := time.Date(2026, 11, 1, 8, 0, 0, 0, time.UTC)
	args := []driver.Value{"exam-1", "schedule-1"}

	mock.ExpectBegin()
	mock.ExpectQuery(satRawdataHandlerAttemptQuery).WithArgs(args...).
		WillReturnRows(sqlmock.NewRows([]string{"id", "candidate_id", "candidate_name", "candidate_email", "published_version_id", "order_key"}).
			AddRow("attempt-1", "000123", "Ada", "ada@example.com", "version-1", base))
	mock.ExpectQuery(satRawdataHandlerModuleQuery).WithArgs(args...).
		WillReturnRows(sqlmock.NewRows([]string{"attempt_id", "module_id", "section_key", "module_key", "adaptive_role", "state", "exam_version_id", "section_order", "module_order"}).
			AddRow("attempt-1", "mod-rw", "reading-writing", "rw-1", "base", "submitted", "version-1", 1, 1))
	mock.ExpectQuery(satRawdataHandlerCellQuery).WithArgs(args...).
		WillReturnRows(sqlmock.NewRows([]string{"attempt_id", "module_id", "exam_question_id", "display_order", "answer_definition", "v2_response", "legacy_response", "config_snapshot"}))
	mock.ExpectQuery(satFormHandlerPinQuery).WithArgs(args...).
		WillReturnRows(sqlmock.NewRows([]string{"published_version_id", "version_number"}).AddRow("version-1", 1))
	mock.ExpectQuery(satFormHandlerAttemptQuery).WithArgs(args...).
		WillReturnRows(sqlmock.NewRows([]string{"attempt_id", "candidate_id", "wcode", "candidate_name", "candidate_email", "version_id", "version_number", "status_registration", "status_verbal_entry", "status_math_entry", "status_eva_sim"}).
			AddRow("attempt-1", "000123", "W123456", "Ada", "ada@example.com", "version-1", 1, "submitted", "not_applicable", "not_applicable", "not_applicable"))
	mock.ExpectQuery(`(?s)SELECT id, version_number, CAST\(config_snapshot AS CHAR\) FROM exam_versions WHERE id IN`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "version_number", "config_snapshot"}).
			AddRow("version-1", 1, satRawdataHandlerFormsSnapshot))
	mock.ExpectQuery(satFormHandlerResponseQuery).WithArgs(args...).
		WillReturnRows(sqlmock.NewRows([]string{"attempt_id", "form_key", "answers"}).
			AddRow("attempt-1", "registration", `{"sat_seat_number":"A-007"}`))
	mock.ExpectCommit()

	session := &auth.Session{UserID: "admin-1", Role: auth.RoleAdmin}
	rec := callSATRawdataHandler(resultsSATRawdataExportHandler(newSATRawdataHandlerApp(db)), "/api/v1/results/sat/export/rawdata?examId=exam-1&scheduleId=schedule-1&format=xlsx", session)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin export status = %d, body %s", rec.Code, rec.Body.String())
	}
	book, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatalf("handler returned an unreadable workbook: %v", err)
	}
	defer func() { _ = book.Close() }()
	if got := book.GetSheetList(); len(got) != 3 || got[2] != "SAT Forms" {
		t.Fatalf("admin sheet list = %v, want a third SAT Forms sheet", got)
	}
	if got, err := book.GetCellValue("SAT Forms", "B3"); err != nil || got != "W123456" {
		t.Fatalf("wcode = %q, %v", got, err)
	}
	if got, err := book.GetCellValue("SAT Forms", "F3"); err != nil || got != "A-007" {
		t.Fatalf("registration answer = %q, %v", got, err)
	}
	if got, err := book.GetCellValue("SAT Forms", "G3"); err != nil || got != "submitted" {
		t.Fatalf("registration status = %q, %v", got, err)
	}
	if got, err := book.GetCellValue("SAT Forms", "H3"); err != nil || got != "not_applicable" {
		t.Fatalf("verbal entry status = %q, %v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
