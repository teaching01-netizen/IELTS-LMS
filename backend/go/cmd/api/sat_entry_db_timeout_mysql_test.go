package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
)

func TestSATModuleEntryDatabaseTimeoutIsRetryableMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	scheduleID, attemptID, _, _, nextModuleID := seedStaleETagExam(t, db)
	bearer := boundaryBearer(t, db, scheduleID, attemptID)

	cfg := config.Load()
	cfg.AuthSecret = submitTestSecret
	cfg.RateLimitMode = config.RateLimitModeLocal
	app := BuildApp(cfg, db)
	router := BuildRouter(app)

	// Hold the pool's only connection after setup. Signature verification is
	// local; the first authoritative schedule/attempt read must still fail
	// within the entry budget as a retryable response.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	conn, err := db.Conn(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	body := `{"moduleId":"` + nextModuleID + `","controlEpoch":1,"needContent":false}`
	request := httptest.NewRequest(http.MethodPost,
		"/api/v1/assessment-delivery/schedules/"+scheduleID+"/modules/start",
		strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+bearer)
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("entry auth lookup timeout returned HTTP %d body=%s; want retryable 503", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("Retry-After") != "1" {
		t.Fatalf("entry auth lookup timeout Retry-After=%q; want 1", recorder.Header().Get("Retry-After"))
	}
}
