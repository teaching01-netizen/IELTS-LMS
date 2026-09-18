package main

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// Phase 02 (blocker 4): legacy ACT rows (provider_key='ielts', exam_type='ACT')
// route to the ACT direct-seal path, never the IELTS path.
//
// The provider decision belongs to the submit transaction (attempts.Submit
// takes a ProviderResolver, not a Provider), so these cases are exercised
// through v2ProviderResolver on a real *sql.Tx — the same call the attempts
// service makes after locking the attempt.
func TestEffectiveProviderForSubmit(t *testing.T) {
	cases := []struct {
		name     string
		provider any // nil = SQL NULL
		examType string
		want     attempts.Provider
		wantCode apperrors.Code
	}{
		{"canonical act stays act", "act", "ACT", attempts.ProviderACT, ""},
		{"legacy ACT+ielts heals to act", "ielts", "ACT", attempts.ProviderACT, ""},
		{"legacy ACT blank provider heals to act", "", "ACT", attempts.ProviderACT, ""},
		{"legacy ACT NULL provider heals to act", nil, "ACT", attempts.ProviderACT, ""},
		{"genuine IELTS stays ielts", "ielts", "Academic", attempts.ProviderIELTS, ""},
		{"sat stays sat", "sat", "Academic", attempts.ProviderSAT, ""},
		// Legacy IELTS rows predate the provider_key column: nullable in the old
		// schema (data check: the only blank rows in any local DB are NULL +
		// exam_type='Academic'). They submitted through the IELTS path before
		// and still must — blank is the legacy IELTS identity, not an error.
		{"NULL key legacy IELTS row stays ielts", nil, "Academic", attempts.ProviderIELTS, ""},
		{"empty key legacy IELTS row stays ielts", "", "Academic", attempts.ProviderIELTS, ""},
		{"NULL key with blank exam type stays ielts", nil, "", attempts.ProviderIELTS, ""},
		// Genuinely unresolvable: an unrecognised NON-blank key used to be
		// forwarded verbatim into the terminal write, sealing an unscored
		// attempt.
		{"unknown provider key is refused", "toefl", "Academic", "", apperrors.CodeUnsupportedProvider},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveProviderOnTx(t, tc.provider, tc.examType)
			if tc.wantCode != "" {
				appErr, ok := apperrors.As(err)
				if !ok || appErr.Code != tc.wantCode {
					t.Fatalf("want %s, got provider %q err %v", tc.wantCode, got, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("effectiveProviderForSubmit(%v, %q) returned %v", tc.provider, tc.examType, err)
			}
			if got != tc.want {
				t.Fatalf("effectiveProviderForSubmit(%v, %q) = %q, want %q", tc.provider, tc.examType, got, tc.want)
			}
		})
	}
}

// A missing attempt row is a 404; a read failure propagates. Neither may be
// translated into a provider.
func TestResolveProviderFailures(t *testing.T) {
	wantErr := errors.New("connection reset")
	cases := []struct {
		name     string
		qerr     error
		wantCode apperrors.Code
		wantErr  error
	}{
		{"missing attempt row", sql.ErrNoRows, apperrors.CodeNotFound, nil},
		{"read failure", wantErr, "", wantErr},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			sqlTx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			mock.ExpectQuery("FROM student_attempts a JOIN exam_entities e").WithArgs("att-1").WillReturnError(tc.qerr)
			mock.ExpectRollback()

			got, rerr := v2ProviderResolver{}.ResolveProvider(context.Background(), sqlTx, "att-1")
			if rerr == nil {
				t.Fatalf("provider %q must not be returned", got)
			}
			if tc.wantErr != nil {
				if !errors.Is(rerr, tc.wantErr) {
					t.Fatalf("read failure must propagate, got %v", rerr)
				}
			} else if appErr, ok := apperrors.As(rerr); !ok || appErr.Code != tc.wantCode {
				t.Fatalf("want %s, got %v", tc.wantCode, rerr)
			}
			if err := sqlTx.Rollback(); err != nil {
				t.Fatal(err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// resolveProviderOnTx runs the production resolver against one staged exam row
// on a real transaction, then rolls the transaction back.
func resolveProviderOnTx(t *testing.T, provider any, examType string) (attempts.Provider, error) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	sqlTx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery("FROM student_attempts a JOIN exam_entities e").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key", "exam_type"}).AddRow(provider, examType))
	mock.ExpectRollback()

	got, rerr := v2ProviderResolver{}.ResolveProvider(context.Background(), sqlTx, "att-1")
	if err := sqlTx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	return got, rerr
}

// v2ProviderResolver must satisfy the port the attempts service calls in-tx.
var _ attempts.ProviderResolver = v2ProviderResolver{}
