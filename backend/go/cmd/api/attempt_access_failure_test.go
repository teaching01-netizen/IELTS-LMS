package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"github.com/DATA-DOG/go-sqlmock"
)

func TestAttemptAccessOutageIsRetryableNotAuthenticationFailure(t *testing.T) {
	for _, endpoint := range []string{"/access:resume", "/submission-receipt?submissionId=submission"} {
		t.Run(endpoint, func(t *testing.T) {
			db, _, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			cfg := persistentRouterCfg()
			cfg.AuthSecret = "access-outage-test-secret-with-32-characters"
			cfg.BackgroundMode = config.BackgroundActivityDriven
			app := BuildApp(cfg, db)
			db.Close()
			lease := uint64(1)
			token, err := crypto.SignAttemptToken([]byte(cfg.AuthSecret), crypto.AttemptClaims{TokenID: "token", UserID: "user", ScheduleID: "schedule", AttemptID: "attempt", ClientSessionID: "writer", LeaseEpoch: &lease, Exp: time.Now().Add(time.Hour).Unix()})
			if err != nil {
				t.Fatal(err)
			}
			method := http.MethodGet
			if endpoint == "/access:resume" {
				method = http.MethodPost
			}
			req := httptest.NewRequest(method, "/api/v2/student/attempts/attempt"+endpoint, nil)
			req.Header.Set("Authorization", "Bearer "+token)
			rec := httptest.NewRecorder()
			BuildRouter(app).ServeHTTP(rec, req)
			if rec.Code != 503 || decodeCode(t, rec) != "SERVICE_UNAVAILABLE" {
				t.Fatalf("outage misclassified: %d %s", rec.Code, rec.Body.String())
			}
		})
	}
}
