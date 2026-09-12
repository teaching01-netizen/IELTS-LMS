package main

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/crypto"
)

func testCtxWithChi(ctx context.Context, rctx *chi.Context) context.Context {
	return context.WithValue(ctx, chi.RouteCtxKey, rctx)
}

// WS-02a: terminated-bearer replay on the snapshot read fails closed (401)
// in BOTH verify modes. The session row is revoked/rotated, so the
// revoked_at IS NULL predicate filters it (sql.ErrNoRows) and the handler
// renders 401 with zero further reads (strict sqlmock proves it).
func TestSnapshotTerminatedBearerReplay401BothModes(t *testing.T) {
	for _, mode := range []config.AttemptVerifyMode{config.AttemptVerifyStrict, config.AttemptVerifyStateless} {
		t.Run(string(mode), func(t *testing.T) {
			secret := "test-secret-with-at-least-32-characters!!"
			now := time.Now().UTC()
			lease := uint64(3)
			tok, err := crypto.SignAttemptToken([]byte(secret), crypto.AttemptClaims{
				TokenID: "tok-old", UserID: "u-1", ScheduleID: "sched-1",
				AttemptID: "att-1", ClientSessionID: "sess-old",
				LeaseEpoch: &lease, Exp: now.Add(15 * time.Minute).Unix(),
			})
			if err != nil {
				t.Fatal(err)
			}
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			cfg := config.Load()
			cfg.AuthSecret = secret
			cfg.AttemptVerify = mode
			app := BuildApp(cfg, db)
			// Post-takeover replay: the old token_id row no longer
			// satisfies revoked_at IS NULL -> unknown session.
			mock.ExpectQuery("FROM attempt_sessions WHERE token_id").
				WithArgs("tok-old").
				WillReturnError(sql.ErrNoRows)
			req := httptest.NewRequest(http.MethodGet, "/api/v2/student/attempts/att-1/responses", nil)
			req.Header.Set("Authorization", "Bearer "+tok)
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("attemptID", "att-1")
			req = req.WithContext(testCtxWithChi(req.Context(), rctx))
			rec := httptest.NewRecorder()
			v2SnapshotHandler(app)(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("terminated bearer replay must be 401, got %d (%s)", rec.Code, rec.Body.String())
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// WS-02a: live session row still reads 200 in both modes (no regression).
func TestSnapshotLiveBearerReadsBothModes(t *testing.T) {
	for _, mode := range []config.AttemptVerifyMode{config.AttemptVerifyStrict, config.AttemptVerifyStateless} {
		t.Run(string(mode), func(t *testing.T) {
			secret := "test-secret-with-at-least-32-characters!!"
			now := time.Now().UTC()
			lease := uint64(3)
			tok, err := crypto.SignAttemptToken([]byte(secret), crypto.AttemptClaims{
				TokenID: "tok-live", UserID: "u-1", ScheduleID: "sched-1",
				AttemptID: "att-1", ClientSessionID: "sess-1",
				LeaseEpoch: &lease, Exp: now.Add(15 * time.Minute).Unix(),
			})
			if err != nil {
				t.Fatal(err)
			}
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			cfg := config.Load()
			cfg.AuthSecret = secret
			cfg.AttemptVerify = mode
			app := BuildApp(cfg, db)
			mock.ExpectQuery("FROM attempt_sessions WHERE token_id").
				WithArgs("tok-live").
				WillReturnRows(sqlmock.NewRows([]string{"token_id", "revoked_at", "expires_at", "lease_epoch"}).
					AddRow("tok-live", nil, now.Add(time.Hour), 3))
			mock.ExpectQuery("FROM student_attempts WHERE id").
				WillReturnRows(sqlmock.NewRows([]string{
					"protocol_version", "delivery_status", "lease_epoch", "control_epoch",
					"response_revision", "deadline_at", "closing_grace_until", "schedule_id", "user_id",
				}).AddRow(2, "running", 3, 7, 0, nil, nil, "sched-1", "u-1"))
			mock.ExpectQuery("FROM attempt_responses_v2 WHERE attempt_id").
				WillReturnRows(sqlmock.NewRows([]string{
					"question_id", "client_write_id", "client_version", "server_revision", "response_hash", "response",
				}))
			req := httptest.NewRequest(http.MethodGet, "/api/v2/student/attempts/att-1/responses", nil)
			req.Header.Set("Authorization", "Bearer "+tok)
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("attemptID", "att-1")
			req = req.WithContext(testCtxWithChi(req.Context(), rctx))
			rec := httptest.NewRecorder()
			v2SnapshotHandler(app)(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("live bearer must read 200, got %d (%s)", rec.Code, rec.Body.String())
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// WS-02a: post-takeover old token_id replays on the runtime poll bearer
// path render 401 in both modes.
func TestPollTakeoverRotatedBearer401BothModes(t *testing.T) {
	for _, mode := range []config.AttemptVerifyMode{config.AttemptVerifyStrict, config.AttemptVerifyStateless} {
		t.Run(string(mode), func(t *testing.T) {
			secret := "test-secret-with-at-least-32-characters!!"
			now := time.Now().UTC()
			lease := uint64(3)
			tok, err := crypto.SignAttemptToken([]byte(secret), crypto.AttemptClaims{
				TokenID: "tok-old", UserID: "u-1", ScheduleID: "sched-1",
				AttemptID: "att-1", ClientSessionID: "sess-old",
				LeaseEpoch: &lease, Exp: now.Add(15 * time.Minute).Unix(),
			})
			if err != nil {
				t.Fatal(err)
			}
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			cfg := config.Load()
			cfg.AuthSecret = secret
			cfg.AttemptVerify = mode
			app := BuildApp(cfg, db)
			mock.ExpectQuery("FROM attempt_sessions WHERE token_id").
				WithArgs("tok-old").
				WillReturnError(sql.ErrNoRows)
			req := httptest.NewRequest(http.MethodGet, "/api/v1/student/sessions/sched-1/runtime", nil)
			req.Header.Set("Authorization", "Bearer "+tok)
			rec := httptest.NewRecorder()
			if _, ok := authorizeRuntimePollBearer(rec, req, app, "sched-1"); ok {
				t.Fatal("rotated bearer must not authorize the poll")
			}
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("rotated bearer poll replay must be 401, got %d (%s)", rec.Code, rec.Body.String())
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
