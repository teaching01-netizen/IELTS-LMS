package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/config"
	platformdb "example.com/ielts-proctoring/internal/platform/db"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// statementCounts is what one service call sent through the production
// measured driver, read from its own db_query_duration_seconds series.
// queries+execs are the domain statements. prepares are driver protocol
// commands: with interpolateParams=false every parameterized statement is
// prepared, executed and closed. BEGIN/COMMIT and connection setup are not
// counted, and auth/limiter SQL runs in HTTP middleware outside these calls.
type statementCounts struct{ queries, execs, prepares int }

func measuredPool(t testing.TB) *sql.DB {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN not set; requires isolated MySQL")
	}
	pool, err := platformdb.OpenRole(config.Config{DatabaseURL: dsn, DBPoolMaxAPI: 2, DBPoolMaxIdle: 2}, platformdb.RoleAPI)
	if err != nil {
		t.Fatalf("open measured pool: %v", err)
	}
	t.Cleanup(func() { pool.Close() })
	return pool
}

func measureStatements(t *testing.T, fn func() error) statementCounts {
	t.Helper()
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	err := fn()
	telemetry.DefaultRegistry = old
	if err != nil {
		t.Fatal(err)
	}
	snap := reg.Snapshot()
	count := func(operation string) int {
		total := 0
		for _, outcome := range []string{"success", "error"} {
			prefix := fmt.Sprintf(`%s_count{operation=%q,outcome=%q} `, telemetry.MQueryDur, operation, outcome)
			for _, line := range strings.Split(snap, "\n") {
				if rest, ok := strings.CutPrefix(line, prefix); ok {
					var n int
					if _, err := fmt.Sscan(rest, &n); err != nil {
						t.Fatalf("parse %q: %v", line, err)
					}
					total += n
				}
			}
		}
		return total
	}
	return statementCounts{queries: count("query"), execs: count("exec"), prepares: count("prepare")}
}

// TestSATDeliveryStatementBudgetMySQL executes the student read paths against
// a real pinned-policy SAT attempt and pins the domain statements each sends;
// it replaces a constant-only budget assertion. A changed number is a
// deliberate, measured diff: update the budget with the reason. Driver
// prepares are logged, not pinned: they depend on the DSN's interpolateParams.
//
// LifecycleState (pinned SAT recovery read): header, Student Access scope,
// one combined module/entry/boundary projection (was four reads), attempt
// control, result gate, timing, personal breaks, start policy and the
// staff-route probe — and no writes (FR-3).
func TestSATDeliveryStatementBudgetMySQL(t *testing.T) {
	// The load fixture validates server capacity for its default k6 pools;
	// this scenario holds two connections.
	t.Setenv("SAT_RECOVERY_K6_API_POOL", "4")
	t.Setenv("SAT_K6_API_INSTANCES", "1")
	fixture := seedSATRecoveryLoadFixture(t, 1, 1)
	cred := fixture.credentials[0]
	pool := measuredPool(t)
	svc := delivery.NewService(pool, tx.NewRunner(pool))
	ctx := context.Background()

	var state *delivery.Bootstrap
	lifecycle := measureStatements(t, func() error {
		var err error
		state, err = svc.LifecycleState(ctx, cred.ScheduleID, cred.AttemptID, cred.ScheduleID)
		return err
	})
	if state == nil || state.SATDeliveryPolicy == nil {
		t.Fatalf("fixture must take the pinned lifecycle path, got %+v", state)
	}
	if len(state.Attempt.ModuleAttempts) == 0 || len(state.Sections) != 0 || len(state.Attempt.Responses) != 0 {
		t.Fatalf("lifecycle state must carry module rows and no content: modules=%d sections=%d responses=%d",
			len(state.Attempt.ModuleAttempts), len(state.Sections), len(state.Attempt.Responses))
	}
	t.Logf("LifecycleState: %d queries, %d execs, %d driver prepares", lifecycle.queries, lifecycle.execs, lifecycle.prepares)
	const wantLifecycleQueries = 9 // 12 before the combined module projection
	if lifecycle.execs != 0 {
		t.Fatalf("LifecycleState must not write, sent %d execs", lifecycle.execs)
	}
	if lifecycle.queries != wantLifecycleQueries {
		t.Fatalf("LifecycleState sent %d queries, budget %d", lifecycle.queries, wantLifecycleQueries)
	}

	// Steady Bootstrap: the first call may create missing module rows; the
	// second is the repeat read every reconnect pays.
	if _, err := svc.Bootstrap(ctx, cred.ScheduleID, cred.AttemptID, cred.ScheduleID); err != nil {
		t.Fatal(err)
	}
	bootstrap := measureStatements(t, func() error {
		_, err := svc.Bootstrap(ctx, cred.ScheduleID, cred.AttemptID, cred.ScheduleID)
		return err
	})
	t.Logf("steady Bootstrap: %d queries, %d execs, %d driver prepares", bootstrap.queries, bootstrap.execs, bootstrap.prepares)
	// The steady exec is reconcile's conditional break-completion UPDATE, which
	// matches no row here; Bootstrap reconciles, LifecycleState does not.
	if bootstrap.queries != 37 || bootstrap.execs != 1 {
		t.Fatalf("steady pinned-SAT Bootstrap sent %d queries + %d execs, budget 37 + 1", bootstrap.queries, bootstrap.execs)
	}

	// One-answer save, then its exact replay (lost acknowledgement), through
	// the production resolver and runtime locker. The replay probe's ledger
	// miss is reused by the in-loop idempotency probe, and the replay reports
	// the locked attempt revision instead of re-reading it.
	saver := attempts.NewService(tx.NewRunner(pool), clock.System{}, []byte(submitTestSecret))
	save := attempts.SaveResponsesCommand{AttemptID: cred.AttemptID, LeaseEpoch: 1, ControlEpoch: 1, Commands: []attempts.ResponseCommand{{
		WriteID: "budget-w-1", QuestionID: cred.Questions[0].QuestionID, ClientVersion: 1, Response: attempts.ResponsePayload{Answer: "A"},
	}}}
	var applied, replayed attempts.SaveResult
	newWrite := measureStatements(t, func() error {
		var err error
		applied, err = saver.SaveResponses(ctx, cred.Token, save, v2Resolver{}, v2Locker{})
		return err
	})
	replay := measureStatements(t, func() error {
		var err error
		replayed, err = saver.SaveResponses(ctx, cred.Token, save, v2Resolver{}, v2Locker{})
		return err
	})
	t.Logf("new one-answer save: %d queries, %d execs, %d driver prepares", newWrite.queries, newWrite.execs, newWrite.prepares)
	t.Logf("exact replay: %d queries, %d execs, %d driver prepares", replay.queries, replay.execs, replay.prepares)
	if applied.Replayed || len(applied.Acks) != 1 || applied.Acks[0].Outcome != "applied" {
		t.Fatalf("first save must apply, got %+v", applied)
	}
	if !replayed.Replayed || replayed.ResponseRevision != applied.ResponseRevision || replayed.Acks[0].ServerRevision != applied.Acks[0].ServerRevision {
		t.Fatalf("replay must return the stored ack at the locked revision: applied=%+v replayed=%+v", applied, replayed)
	}
	if replay.execs != 0 {
		t.Fatalf("an exact replay must not write, sent %d execs", replay.execs)
	}
	// 17 and 5 before the transaction-local ledger memo.
	const wantNewWrite, wantReplay = 16, 4
	if newWrite.queries+newWrite.execs != wantNewWrite || replay.queries != wantReplay {
		t.Fatalf("save budgets: new write %d (want %d), replay %d (want %d)",
			newWrite.queries+newWrite.execs, wantNewWrite, replay.queries, wantReplay)
	}
}
