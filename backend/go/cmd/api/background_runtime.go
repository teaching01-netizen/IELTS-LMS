package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	shared "example.com/ielts-proctoring/internal/app"
	"example.com/ielts-proctoring/internal/background"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/db"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

func startActivityRuntime(app *App, workerPool *sql.DB) *background.Lifecycle {
	runner := background.New(app.Config, workerPool, shared.Deps{
		LiveHub: app.LiveHub, Versions: app.Versions, RuntimeSnapshots: app.RuntimeSnapshots,
		Admission: app.Admission,
	}).WithPresence(app.Student.PresenceMap())
	var stopWorker, stopRecovery context.CancelFunc
	var workerDone chan struct{}
	stop := func() {
		if stopWorker != nil {
			stopWorker()
		}
		app.stopLiveForwarder()
		if stopRecovery != nil {
			stopRecovery()
			stopRecovery = nil
		}
		if workerDone != nil {
			<-workerDone
			workerDone = nil
			stopWorker = nil
		}
	}
	return background.NewLifecycle(context.Background(), time.Duration(app.Config.IdleGraceSecs)*time.Second, background.LifecycleHooks{
		Resume: func(ctx context.Context) error {
			app.DB.SetMaxIdleConns(app.Config.DBPoolMaxIdle)
			workerPool.SetMaxIdleConns(app.Config.DBPoolMaxIdle)
			if app.CoeditCapability() {
				recoveryCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
				if err := recoverExpiredCoeditFreezes(recoveryCtx, app); err != nil {
					log.Printf("api: activation freeze recovery failed: %v", err)
				}
				cancel()
			}
			loopCtx, cancel := context.WithCancel(ctx)
			stopWorker, workerDone = cancel, make(chan struct{})
			done := workerDone
			go func() { defer close(done); runner.RunUntil(loopCtx, ctx) }()
			startLiveBusForwarder(app)
			stopRecovery = startCoeditRecoveryLoop(ctx, app)
			return nil
		},
		Drain: func(ctx context.Context) error {
			stop()
			if err := runner.Drain(ctx); err != nil {
				return err
			}
			if app.CoeditCapability() {
				if err := recoverExpiredCoeditFreezes(ctx, app); err != nil {
					return err
				}
				if err := app.CoeditControl.Park(ctx); err != nil {
					return fmt.Errorf("co-edit park: %w", err)
				}
			}
			// Parking may include private persistence calls. Recheck durable work
			// after it completes; Lifecycle checks the activity generation last.
			reason, err := runner.PendingReason(ctx)
			if err != nil {
				return err
			}
			if reason != "" {
				return fmt.Errorf("pending work: %s", reason)
			}
			return nil
		},
		Park: func() error {
			if app.DB.Stats().InUse != 0 || workerPool.Stats().InUse != 0 {
				return fmt.Errorf("database work still in flight")
			}
			app.DB.SetMaxIdleConns(0)
			workerPool.SetMaxIdleConns(0)
			if app.CoeditControl != nil {
				app.CoeditControl.CloseIdleConnections()
			}
			db.ReportPoolStats(db.RoleAPI, app.DB.Stats())
			db.ReportPoolStats(db.RoleWorker, workerPool.Stats())
			return nil
		},
		Stop: func() {
			stop()
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if err := runner.FlushPresence(ctx); err != nil {
				log.Printf("api: shutdown presence flush failed: %v", err)
			}
		},
	})
}

func applicationPath(path string) bool {
	return path == coeditPublicProxyPath || strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/v2/")
}

func activityMiddleware(app *App) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if app.Background == nil {
				next.ServeHTTP(w, r)
				return
			}
			if applicationPath(r.URL.Path) {
				release, err := app.Background.Reserve(r.Context())
				if err != nil {
					httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Service is starting. Please retry."))
					return
				}
				defer release()
			} else if r.URL.Path == "/readyz" || strings.HasPrefix(r.URL.Path, "/internal/") {
				release := app.Background.Track()
				defer release()
			}
			// ServeHTTP includes the lifetime of upgraded connections for both
			// websocket handlers and ReverseProxy, preserving their interfaces.
			next.ServeHTTP(w, r)
		})
	}
}

func activateCoedit(ctx context.Context, app *App) error {
	if app.Config.BackgroundMode != config.BackgroundActivityDriven {
		return nil
	}
	if app.CoeditControl == nil {
		return apperrors.New(apperrors.CodeServiceUnavailable, "Co-editing service is unavailable.")
	}
	return app.CoeditControl.Activate(ctx)
}
