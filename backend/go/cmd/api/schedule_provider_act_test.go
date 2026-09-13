package main

import (
	"context"
	"database/sql"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/attempts"
)

// Phase 02 (blocker 4): the V2 submit preamble must route legacy ACT rows
// (provider_key='ielts', exam_type='ACT') to the ACT direct-seal path, never
// the IELTS path. scheduleProvider resolves via the central
// effective-provider rule; the local mirror is pinned here.
func TestScheduleProviderHealsLegacyACT(t *testing.T) {
	cases := []struct {
		name     string
		provider string
		examType string
		want     string
	}{
		{"canonical act stays act", "act", "ACT", string(attempts.ProviderACT)},
		{"legacy ACT+ielts heals to act", "ielts", "ACT", string(attempts.ProviderACT)},
		{"legacy ACT blank provider heals to act", "", "ACT", string(attempts.ProviderACT)},
		{"genuine IELTS stays ielts", "ielts", "Academic", string(attempts.ProviderIELTS)},
		{"sat stays sat", "sat", "Academic", string(attempts.ProviderSAT)},
		{"unknown provider passes through", "toefl", "Academic", "toefl"},
	}
	for _, tc := range cases {
		if got := effectiveProviderForSubmit(tc.provider, tc.examType); got != tc.want {
			t.Fatalf("%s: effectiveProviderForSubmit(%q, %q) = %q, want %q", tc.name, tc.provider, tc.examType, got, tc.want)
		}
	}
}

// scheduleProvider issues the joined entity read and heals the legacy row
// end to end (sqlmock): provider_key='ielts' + exam_type='ACT' -> act.
func TestScheduleProviderQueryHealsLegacyACT(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	app := &App{DB: db}
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts a JOIN exam_entities e")).
		WithArgs("att-legacy").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key", "exam_type"}).AddRow("ielts", "ACT"))
	if got := scheduleProvider(context.Background(), app, "att-legacy"); got != string(attempts.ProviderACT) {
		t.Fatalf("legacy ACT row must route to act, got %q", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Unreadable provider rows fail closed to the pre-existing IELTS default so
// the preamble never misroutes on DB uncertainty.
func TestScheduleProviderUnknownFailsClosedIELTS(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	app := &App{DB: db}
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts a JOIN exam_entities e")).
		WithArgs("att-missing").
		WillReturnError(sql.ErrNoRows)
	if got := scheduleProvider(context.Background(), app, "att-missing"); got != string(attempts.ProviderIELTS) {
		t.Fatalf("unknown row must fail closed to ielts, got %q", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
