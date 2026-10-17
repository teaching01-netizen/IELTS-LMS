package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"example.com/ielts-proctoring/internal/answeredpdf"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/objectstore"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/results"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-chi/chi/v5"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNativePDFDownloadHeadersRangeAndHead(t *testing.T) {
	for _, tc := range []struct {
		method, rangeValue string
		status             int
		body               string
	}{
		{"GET", "", 200, "0123456789"}, {"GET", "bytes=4-", 206, "456789"}, {"HEAD", "", 200, ""}, {"GET", "bytes=100-", 416, "invalid range: failed to overlap\n"},
	} {
		req := httptest.NewRequest(tc.method, "/api/v1/sat-answered-pdf/downloads/test", nil)
		req.Header.Set("Range", tc.rangeValue)
		rec := httptest.NewRecorder()
		body := &closeTracker{Reader: bytes.NewReader([]byte("0123456789"))}
		servePreparedPDF(rec, req, &answeredpdf.Export{Filename: "มินา - Answered exam.pdf", ObjectKey: "answered-pdf/test.pdf", ExpiresAt: time.Now().Add(time.Minute)}, body)
		if rec.Code != tc.status || rec.Body.String() != tc.body {
			t.Fatalf("%s %s: %d %q", tc.method, tc.rangeValue, rec.Code, rec.Body.String())
		}
		if !body.closed || rec.Header().Get("Cache-Control") != "private, no-store" || rec.Header().Get("Content-Disposition") == "" {
			t.Fatalf("unsafe headers: %v", rec.Header())
		}
		if tc.status == http.StatusOK && rec.Header().Get("Content-Length") != "10" {
			t.Fatal(rec.Header())
		}
	}
}

func TestPDFDownloadAccessAndFreshEntitlement(t *testing.T) {
	for _, scenario := range []string{"no-cookie", "wrong-browser", "expired", "preparing", "wrong-session", "no-session", "changed-staff-access", "missing-file", "staff-get", "staff-head", "staff-range", "student-revoked", "student-report-disabled", "student-expired", "student-lease-changed"} {
		t.Run(scenario, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			store := objectstore.NewLocalStore(t.TempDir())
			app := &App{DB: db, PDFExports: answeredpdf.NewExports(db, store), Results: results.NewService(db), Delivery: delivery.NewService(db, tx.NewRunner(db))}
			binding := answeredpdf.Binding{Kind: "staff", OwnerID: "user", AttemptID: "attempt", SessionID: "session"}
			if strings.HasPrefix(scenario, "student-") {
				binding.Kind = "student"
				binding.Claims = &crypto.AttemptClaims{TokenID: "token", UserID: "user", AttemptID: "attempt", ScheduleID: "schedule", ClientSessionID: "session", Exp: time.Now().Add(time.Hour).Unix()}
			}
			if scenario == "student-expired" {
				binding.Claims.Exp = time.Now().Add(-time.Second).Unix()
			}
			raw, _ := json.Marshal(binding)
			expiry := time.Now().Add(time.Minute)
			state := "ready"
			if scenario == "expired" {
				expiry = time.Now().Add(-time.Second)
			}
			if scenario == "preparing" {
				state = "preparing"
			}
			if scenario != "no-cookie" {
				lookup := mock.ExpectQuery("SELECT owner_kind").WithArgs("export", answeredpdf.BrowserHash(strings.Repeat("c", 64)))
				if scenario == "wrong-browser" {
					lookup.WillReturnError(sql.ErrNoRows)
				} else {
					lookup.WillReturnRows(sqlmock.NewRows([]string{"owner_kind", "owner_id", "attempt_id", "binding", "state", "object_key", "filename", "size_bytes", "expires_at"}).AddRow(binding.Kind, "user", "attempt", raw, state, "answered-pdf/export.pdf", "exam.pdf", 10, expiry))
				}
			}
			switch scenario {
			case "student-revoked":
				mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WithArgs("token").WillReturnError(sql.ErrNoRows)
			case "student-report-disabled", "student-lease-changed":
				var lease any
				if scenario == "student-lease-changed" {
					lease = 8
				}
				mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WithArgs("token").WillReturnRows(sqlmock.NewRows([]string{"token_id", "revoked_at", "expires_at", "lease_epoch"}).AddRow("token", nil, time.Now().Add(time.Hour), lease))
				if scenario == "student-report-disabled" {
					mock.ExpectQuery("SELECT COALESCE.*sat_score_report_enabled").WithArgs("attempt", "schedule").WillReturnRows(sqlmock.NewRows([]string{"open"}).AddRow(false))
				}
			case "changed-staff-access":
				mock.ExpectQuery("SELECT 1 FROM student_attempts").WithArgs("attempt").WillReturnError(sql.ErrNoRows)
			case "missing-file", "staff-get", "staff-head", "staff-range":
				mock.ExpectQuery("SELECT 1 FROM student_attempts").WithArgs("attempt").WillReturnRows(sqlmock.NewRows([]string{"allowed"}).AddRow(1))
			}
			if scenario != "missing-file" {
				if err := store.Put(t.Context(), "answered-pdf/export.pdf", []byte("0123456789"), "application/pdf"); err != nil {
					t.Fatal(err)
				}
			}
			method := http.MethodGet
			if scenario == "staff-head" {
				method = http.MethodHead
			}
			request := httptest.NewRequest(method, "/downloads/export", nil)
			if scenario != "no-cookie" {
				request.AddCookie(&http.Cookie{Name: pdfDownloadCookie, Value: strings.Repeat("c", 64)})
			}
			if scenario == "staff-range" {
				request.Header.Set("Range", "bytes=4-")
			}
			if scenario != "no-session" {
				sessionID := "session"
				if scenario == "wrong-session" {
					sessionID = "other-session"
				}
				request = request.WithContext(context.WithValue(request.Context(), sessionCtxKey, &auth.Session{ID: sessionID, UserID: "user", Role: auth.RoleAdmin}))
			}
			router := chi.NewRouter()
			router.Get("/downloads/{exportID}", downloadAnsweredPDFHandler(app))
			router.Head("/downloads/{exportID}", downloadAnsweredPDFHandler(app))
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, request)
			expected := 404
			switch scenario {
			case "staff-get", "staff-head":
				expected = 200
			case "staff-range":
				expected = 206
			case "no-session":
				expected = 401
			case "student-report-disabled":
				expected = 403
			}
			if rec.Code != expected {
				t.Fatalf("got %d want %d: %s", rec.Code, expected, rec.Body.String())
			}
			if rec.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatal("missing privacy headers")
			}
			if scenario == "staff-get" && rec.Body.String() != "0123456789" {
				t.Fatal("wrong bytes")
			}
			if scenario == "staff-head" && rec.Body.Len() != 0 {
				t.Fatal("HEAD included bytes")
			}
			if scenario == "staff-range" && rec.Body.String() != "456789" {
				t.Fatal("wrong resumed bytes")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// An interrupted connection does not revoke the grant or alter stored bytes.
func TestNativePDFInterruptedTransferCanResume(t *testing.T) {
	content := bytes.Repeat([]byte("complete PDF bytes "), 1<<16)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		servePreparedPDF(w, r, &answeredpdf.Export{Filename: "exam.pdf", ObjectKey: "answered-pdf/id.pdf"}, &closeTracker{Reader: bytes.NewReader(content)})
	}))
	defer server.Close()
	response, err := http.Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	prefix := make([]byte, 4096)
	if _, err := io.ReadFull(response.Body, prefix); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	request, _ := http.NewRequest(http.MethodGet, server.URL, nil)
	request.Header.Set("Range", "bytes=4096-")
	request.Header.Set("If-Range", response.Header.Get("ETag"))
	resumed, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer resumed.Body.Close()
	tail, err := io.ReadAll(resumed.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resumed.StatusCode != 206 || !bytes.Equal(append(prefix, tail...), content) {
		t.Fatal("resumed file changed")
	}
}
