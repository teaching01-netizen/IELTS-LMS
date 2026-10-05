package main

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/schedules"
)

func TestStudentEntryScheduleHealsLegacyACTProvider(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(`FROM exam_schedules WHERE id = \?`).
		WithArgs("schedule-act-legacy").
		WillReturnRows(legacyScheduleRow("ielts"))
	mock.ExpectQuery(`SELECT exam_type FROM exam_entities WHERE id = \?`).
		WithArgs("exam-act").
		WillReturnRows(sqlmock.NewRows([]string{"exam_type"}).AddRow("ACT"))

	routeContext := chi.NewRouteContext()
	routeContext.URLParams.Add("id", "schedule-act-legacy")
	request := httptest.NewRequest("GET", "/api/v1/auth/student/schedules/schedule-act-legacy", nil)
	request = request.WithContext(context.WithValue(request.Context(), chi.RouteCtxKey, routeContext))
	response := httptest.NewRecorder()
	studentEntryScheduleHandler(&App{
		DB:        db,
		Schedules: schedules.NewService(db, nil),
	}).ServeHTTP(response, request)

	if response.Code != 200 {
		t.Fatalf("student entry schedule status = %d, body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		ProviderKey string `json:"providerKey"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.ProviderKey != "act" {
		t.Fatalf("legacy ACT check-in providerKey = %q, want act", payload.ProviderKey)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func legacyScheduleRow(providerKey string) *sqlmock.Rows {
	start := time.Date(2026, 10, 5, 10, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	return sqlmock.NewRows([]string{
		"id", "exam_id", "provider_key", "organization_id", "exam_title",
		"proctor_display_name", "grading_display_name", "published_version_id",
		"cohort_name", "institution", "start_time", "end_time",
		"planned_duration_minutes", "delivery_mode", "status", "revision",
		"recurrence_type", "recurrence_interval", "recurrence_end_date",
		"buffer_before_minutes", "buffer_after_minutes", "auto_start", "auto_stop",
		"created_at", "created_by", "updated_at", "sat_timing_model",
	}).AddRow(
		"schedule-act-legacy", "exam-act", providerKey, nil, "ACT Science",
		"ACT Science", "ACT Science", "version-act-1", "cohort", nil,
		start, end, 60, "proctor_start", "scheduled", 0,
		"none", 1, nil, nil, nil, false, false, start, "admin", start, nil,
	)
}
