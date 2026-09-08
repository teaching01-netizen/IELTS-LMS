// Command preprovision mints attempts for rostered (schedule, registration)
// pairs ahead of exam day (plan D3 item 3). Exam-day entry then degrades to
// token+session issuance: the D3 fast path (LookupAttemptByRegistration)
// resolves the pre-minted attempt in 1 SELECT instead of the full mint tx.
//
// Usage: preprovision -schedule <scheduleID> -registrations <regID,regID...>
// The process exits non-zero with a per-registration report on stderr when
// any mint fails; already-provisioned pairs are skipped (idempotent).
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/config"
	platformdb "example.com/ielts-proctoring/internal/platform/db"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/schedules"
)

func main() {
	scheduleID := flag.String("schedule", "", "exam schedule id")
	regs := flag.String("registrations", "", "comma-separated registration ids")
	flag.Parse()
	if strings.TrimSpace(*scheduleID) == "" || strings.TrimSpace(*regs) == "" {
		fmt.Fprintln(os.Stderr, "usage: preprovision -schedule <id> -registrations <regID,regID...>")
		os.Exit(2)
	}
	cfg := config.Load()
	pool, err := platformdb.OpenRole(cfg, platformdb.RoleWorker)
	if err != nil {
		fmt.Fprintln(os.Stderr, "open db:", err)
		os.Exit(1)
	}
	defer pool.Close()
	svc := schedules.NewService(pool, tx.NewRunner(pool))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	ids := strings.Split(*regs, ",")
	var minted, skipped, failed int
	for _, raw := range ids {
		regID := strings.TrimSpace(raw)
		if regID == "" {
			continue
		}
		if _, found, err := svc.LookupAttemptByRegistration(ctx, *scheduleID, regID); err == nil && found {
			skipped++
			continue
		}
		// Registration-scoped mint needs the registration's student key +
		// candidate fields; resolve the row first (1 indexed point get).
		var studentKey, candidateID, candidateName, candidateEmail string
		if err := pool.QueryRowContext(ctx,
			`SELECT student_key, COALESCE(candidate_id,''), COALESCE(candidate_name,''), COALESCE(candidate_email,'') FROM schedule_registrations WHERE id = ? AND schedule_id = ?`,
			regID, *scheduleID).Scan(&studentKey, &candidateID, &candidateName, &candidateEmail); err != nil {
			fmt.Fprintf(os.Stderr, "registration %s: %v\n", regID, err)
			failed++
			continue
		}
		if _, err := svc.CreateScheduleAttempt(ctx, *scheduleID, regID, studentKey, candidateID, candidateName, candidateEmail, "preprovision"); err != nil {
			fmt.Fprintf(os.Stderr, "registration %s: %v\n", regID, err)
			failed++
			continue
		}
		minted++
	}
	fmt.Fprintf(os.Stderr, "preprovision schedule=%s minted=%d skipped=%d failed=%d\n", *scheduleID, minted, skipped, failed)
	if failed > 0 {
		os.Exit(1)
	}
}
