// Command worker runs the shared background runner in continuous mode.
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"example.com/ielts-proctoring/internal/app"
	"example.com/ielts-proctoring/internal/background"
	"example.com/ielts-proctoring/internal/outbox"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/db"
	"example.com/ielts-proctoring/internal/platform/shutdown"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func main() {
	if id := requeueDeadLetterID(os.Args[1:]); id != "" {
		if err := runRequeueDeadLetter(id); err != nil {
			log.Fatalf("worker: requeue-dead-letter: %v", err)
		}
		return
	}
	cfg := config.Load()
	if err := cfg.ValidateForRuntime(); err != nil {
		log.Fatalf("worker: invalid config: %v", err)
	}
	pool, err := db.OpenRole(cfg, db.RoleWorker)
	if err != nil {
		log.Fatalf("worker: open db: %v", err)
	}
	defer pool.Close()
	defer tx.SetRetryHook(func(err error) {
		kind := "conntransient"
		lower := strings.ToLower(err.Error())
		if strings.Contains(lower, "deadlock") {
			kind = "deadlock"
		} else if strings.Contains(lower, "lock wait timeout") || strings.Contains(lower, "try restarting transaction") {
			kind = "lockwait"
		}
		telemetry.IncCounter(telemetry.MDeadlocks, "kind", kind)
	})()
	if err := db.VerifyRuntimeSchema(context.Background(), pool); err != nil {
		log.Fatalf("worker: runtime schema guard: %v", err)
	}
	log.Printf("worker: starting job set=%v fallback_interval=%ds maintenance_interval=%ds", background.Jobs, cfg.WorkerFallbackIntervalSecs, cfg.WorkerMaintenanceIntervalSecs)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { shutdown.Wait(ctx); cancel() }()
	background.New(cfg, pool, app.Deps{}).Run(ctx, satTimeoutsOnlyRequested(os.Args[1:]))
}

func satTimeoutsOnlyRequested(args []string) bool {
	for _, arg := range args {
		if arg == "--sat-timeouts-only" {
			return true
		}
	}
	return false
}

// requeueDeadLetterID parses the WS-09 operator requeue flags from raw
// args (flag-style, matching the repo's FlagSet CLI posture):
// requeue-dead-letter --id <dlq-id> (alias: --requeue <id>).
// Returns "" when no requeue command is present.
func requeueDeadLetterID(args []string) string {
	for i, a := range args {
		if a != "requeue-dead-letter" && a != "requeue" {
			continue
		}
		for _, rest := range args[i+1:] {
			if rest == "--id" || rest == "--requeue" {
				continue
			}
			if v, ok := strings.CutPrefix(rest, "--id="); ok && strings.TrimSpace(v) != "" {
				return strings.TrimSpace(v)
			}
			if v, ok := strings.CutPrefix(rest, "--requeue="); ok && strings.TrimSpace(v) != "" {
				return strings.TrimSpace(v)
			}
			if !strings.HasPrefix(rest, "-") && strings.TrimSpace(rest) != "" {
				return strings.TrimSpace(rest)
			}
		}
		return ""
	}
	return ""
}

// runRequeueDeadLetter loads config, opens the worker pool, requeues one
// dead letter, and prints the new event id (operator evidence).
func runRequeueDeadLetter(dlqID string) error {
	cfg := config.Load()
	if err := cfg.ValidateForRuntime(); err != nil {
		return fmt.Errorf("invalid config: %w", err)
	}
	pool, err := db.OpenRole(cfg, db.RoleWorker)
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}
	defer func() { _ = pool.Close() }()
	repo := outbox.NewRepository(pool)
	newID, err := repo.RequeueDeadLetter(context.Background(), dlqID)
	if err != nil {
		return err
	}
	fmt.Printf("requeued dead letter %s as event %s\n", dlqID, newID)
	return nil
}
