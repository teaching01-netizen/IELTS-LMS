package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/config"
)

// TestSATBreakEntryDatabaseTimeoutIsRetryableMySQL pins the break endpoints to
// the same 1.5 s entry budget as module entry. Before the fix they had no
// deadline: a saturated pool held the request open until the read timeout, so
// the browser's six-second offer lead expired and four misses locked the
// student out until a proctor re-armed the break.
//
// The pool is reduced to one connection after setup and that connection is
// held, so every authoritative read must fail inside the budget. The assertion
// is the endpoint contract, not a specific SQL error: retryable 503, a
// Retry-After of one second, and no request held past the budget.
func TestSATBreakEntryDatabaseTimeoutIsRetryableMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	scheduleID, attemptID, _, _, _ := seedStaleETagExam(t, db)
	bearer := boundaryBearer(t, db, scheduleID, attemptID)

	cfg := config.Load()
	cfg.AuthSecret = submitTestSecret
	cfg.RateLimitMode = config.RateLimitModeLocal
	app := BuildApp(cfg, db)
	router := BuildRouter(app)

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	conn, err := db.Conn(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	const breakID = "11111111-1111-4111-8111-111111111111"
	base := "/api/v1/assessment-delivery/schedules/" + scheduleID + "/breaks/"
	cases := []struct {
		name string
		path string
		body string
	}{
		{
			name: "start",
			path: base + breakID + "/start",
			body: `{}`,
		},
		{
			name: "enter",
			path: base + "enter",
			body: `{"breakId":"` + breakID + `","generation":1}`,
		},
		{
			name: "visible",
			path: base + "visible",
			body: `{"breakId":"` + breakID + `","generation":1}`,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(
				http.MethodPost,
				testCase.path,
				strings.NewReader(testCase.body),
			)
			request.Header.Set("Authorization", "Bearer "+bearer)
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()

			started := time.Now()
			router.ServeHTTP(recorder, request)
			elapsed := time.Since(started)

			if recorder.Code != http.StatusServiceUnavailable {
				t.Fatalf(
					"break %s timeout returned HTTP %d body=%s; want retryable 503",
					testCase.name,
					recorder.Code,
					recorder.Body.String(),
				)
			}
			if recorder.Header().Get("Retry-After") != "1" {
				t.Fatalf(
					"break %s timeout Retry-After=%q; want 1",
					testCase.name,
					recorder.Header().Get("Retry-After"),
				)
			}
			// The entry budget is 1.5 s; transport and recorder overhead stay
			// well inside the extra second. A failure here means the endpoint
			// escaped the deadline again.
			if elapsed > 2500*time.Millisecond {
				t.Fatalf(
					"break %s held the request for %s; want <= 2.5s",
					testCase.name,
					elapsed,
				)
			}
		})
	}
}
