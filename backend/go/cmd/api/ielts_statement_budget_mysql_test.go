package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/act"
	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/proctor"
	examruntime "example.com/ielts-proctoring/internal/runtime"
	"example.com/ielts-proctoring/internal/terminalization"
)

// ieltsBudgetServices is the production service wiring of internal/app.Build
// for the IELTS student/staff paths, on one measured pool.
type ieltsBudgetServices struct {
	pool   *sql.DB
	saver  *attempts.Service
	room   *examruntime.Service
	staff  *proctor.Service
	sealer terminalSealer
}

// ieltsDriverModes are the DSN binding modes qualified for IELTS: the
// driver's binary protocol (the code default) and client-side interpolation.
var ieltsDriverModes = []struct {
	name        string
	interpolate bool
}{{"binary", false}, {"interpolate", true}}

func newIELTSBudgetServices(t testing.TB, rowFirst, interpolate bool) ieltsBudgetServices {
	t.Helper()
	if interpolate {
		dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
		sep := "?"
		if strings.Contains(dsn, "?") {
			sep = "&"
		}
		t.Setenv("TEST_MYSQL_DSN", dsn+sep+"interpolateParams=true")
	}
	pool := measuredPool(t)
	runner := tx.NewRunner(pool)
	terminal := terminalization.NewService(runner, nil, nil)
	scorer := act.NewService(pool, runner)
	terminal.SetAttemptScorer(scorer)
	return ieltsBudgetServices{
		pool:   pool,
		saver:  attempts.NewService(runner, clock.System{}, []byte(submitTestSecret)).SetRowFirst(rowFirst),
		room:   examruntime.NewService(runner, nil),
		staff:  proctor.NewService(runner, pool, terminal, nil, proctor.SQLAssignmentChecker{}),
		sealer: terminalSealer{scorer: scorer, materializer: terminal},
	}
}

func ieltsBudgetCommands(prefix string, questionIDs []string, answer string) []attempts.ResponseCommand {
	commands := make([]attempts.ResponseCommand, len(questionIDs))
	for i, id := range questionIDs {
		commands[i] = attempts.ResponseCommand{
			WriteID: fmt.Sprintf("%s-%03d", prefix, i), QuestionID: id, ClientVersion: 1,
			Response: attempts.ResponsePayload{Answer: answer},
		}
	}
	return commands
}

// statementBudget is a pinned domain-statement count for one call.
type statementBudget struct{ queries, execs int }

func assertStatementBudget(t *testing.T, name string, got statementCounts, want statementBudget, interpolate bool) {
	t.Helper()
	t.Logf("%s: %d queries, %d execs, %d driver prepares", name, got.queries, got.execs, got.prepares)
	if got.queries != want.queries || got.execs != want.execs {
		t.Errorf("%s sent %d queries + %d execs, budget %d + %d", name, got.queries, got.execs, want.queries, want.execs)
	}
	// Interpolation sends each parameterized statement as one text query.
	if interpolate && got.prepares != 0 {
		t.Errorf("%s: interpolateParams=true still sent %d driver prepares", name, got.prepares)
	}
}

// TestIELTSStatementBudgetMySQL executes the IELTS personal-timing student and
// staff paths against a real snapshot-backed attempt and pins the domain
// statements each sends, with row-first writes off (the default) and on. A
// changed number is a deliberate, measured diff: update the budget with the
// reason. Driver prepares are logged, not pinned: they depend on the DSN's
// interpolateParams. Auth and limiter SQL run in HTTP middleware, outside
// these service calls. The registry swap in measureStatements is global, so
// this test must not run in parallel.
func TestIELTSStatementBudgetMySQL(t *testing.T) {
	for _, mode := range ieltsDriverModes {
		for _, rowFirst := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/rowFirst=%t", mode.name, rowFirst), func(t *testing.T) {
				testIELTSStatementBudget(t, rowFirst, mode.interpolate)
			})
		}
	}
}

func testIELTSStatementBudget(t *testing.T, rowFirst, interpolate bool) {
	f := seedIELTSLoadFixture(t, 1, 1, []string{"listening", "reading", "writing"}, 120)
	svc := newIELTSBudgetServices(t, rowFirst, interpolate)
	c := f.candidates[0]
	ctx := context.Background()
	ready := true
	signals := examruntime.IELTSReadinessSignals{ContentReady: &ready, LocalStorageReady: &ready, AudioReady: &ready}

	var first, retry examruntime.CohortReadiness
	readyFirst := measureStatements(t, func() error {
		var err error
		first, err = svc.room.ReadyCohortSection(ctx, f.scheduleID, "listening", c.AttemptID, c.UserID, nil, signals)
		return err
	})
	readyRetry := measureStatements(t, func() error {
		var err error
		retry, err = svc.room.ReadyCohortSection(ctx, f.scheduleID, "listening", c.AttemptID, c.UserID, nil, signals)
		return err
	})
	if first.Status != "active" || first.StartedAt == nil || first.DeadlineAt == nil {
		t.Fatalf("first readiness must activate Listening, got %+v", first)
	}
	if retry.Status != "active" || !retry.StartedAt.Equal(*first.StartedAt) || !retry.DeadlineAt.Equal(*first.DeadlineAt) {
		t.Fatalf("readiness retry must return the stored times: first=%+v retry=%+v", first, retry)
	}
	// Unlocked timing-model probe, then schedule -> attempt -> runtime ->
	// section -> DB time -> timeline in lock order. The first call inserts
	// the active timeline, re-reads it and audits IELTS_DELAYED_START (the
	// room opened 5 s earlier); the retry is the read-only branch. The
	// probe and the FOR SHARE runtime read are not merged: the locked read
	// must follow the attempt lock.
	assertStatementBudget(t, "readiness first", readyFirst, statementBudget{8, 2}, interpolate)
	assertStatementBudget(t, "readiness retry", readyRetry, statementBudget{7, 0}, interpolate)

	listening := f.questions["listening"]
	save := func(name string, commands []attempts.ResponseCommand) (attempts.SaveResult, statementCounts) {
		t.Helper()
		var result attempts.SaveResult
		counts := measureStatements(t, func() error {
			var err error
			result, err = svc.saver.SaveResponses(ctx, c.Token, attempts.SaveResponsesCommand{
				AttemptID: c.AttemptID, LeaseEpoch: 1, ControlEpoch: 1, Commands: commands,
			}, v2Resolver{}, v2Locker{})
			return err
		})
		for _, ack := range result.Acks {
			if ack.Outcome != "applied" {
				t.Fatalf("%s: every command must apply, got %+v", name, ack)
			}
		}
		if len(result.Acks) != len(commands) {
			t.Fatalf("%s: %d acks for %d commands", name, len(result.Acks), len(commands))
		}
		return result, counts
	}
	_, one := save("one-command save", ieltsBudgetCommands("one", listening[:1], "A"))
	twoCommands := ieltsBudgetCommands("two", listening[1:3], "B")
	two, twoCounts := save("two-command save", twoCommands)
	var replayed attempts.SaveResult
	replay := measureStatements(t, func() error {
		var err error
		replayed, err = svc.saver.SaveResponses(ctx, c.Token, attempts.SaveResponsesCommand{
			AttemptID: c.AttemptID, LeaseEpoch: 1, ControlEpoch: 1, Commands: twoCommands,
		}, v2Resolver{}, v2Locker{})
		return err
	})
	if !replayed.Replayed || replayed.ResponseRevision != two.ResponseRevision {
		t.Fatalf("exact replay must return the stored outcome: applied=%+v replayed=%+v", two, replayed)
	}
	flush, flushCounts := save("100-command flush", ieltsBudgetCommands("flush", listening[3:103], "C"))
	if flush.ResponseRevision != two.ResponseRevision+100 {
		t.Fatalf("flush revision = %d, want %d", flush.ResponseRevision, two.ResponseRevision+100)
	}
	// Every save: attempt lock, writer session, ledger probe, runtime
	// gate (runtime, DB time, section), the snapshot resolver (normalized
	// miss, provider gate, snapshot, timing model, timelines), version
	// probe and projection read; then cells, ledger, attempt metadata and
	// the batch audit. The count is independent of batch size (one
	// set-based statement per kind). Row-first off adds the compatibility
	// blob read and rewrite.
	saveBudget := statementBudget{13, 4}
	if !rowFirst {
		saveBudget = statementBudget{14, 5}
	}
	assertStatementBudget(t, "one-command save", one, saveBudget, interpolate)
	assertStatementBudget(t, "two-command save", twoCounts, saveBudget, interpolate)
	assertStatementBudget(t, "100-command flush", flushCounts, saveBudget, interpolate)
	// Attempt lock, writer session, ledger memo: no gate, resolver or write.
	assertStatementBudget(t, "exact replay", replay, statementBudget{3, 0}, interpolate)

	poll := measureStatements(t, func() error {
		_, _, err := svc.room.PollView(ctx, svc.pool, f.scheduleID, nil, time.Now().UTC())
		return err
	})
	assertStatementBudget(t, "runtime poll", poll, statementBudget{2, 0}, interpolate)
	var page proctor.RosterPage
	roster := measureStatements(t, func() error {
		var err error
		page, err = svc.staff.LoadStudentSessionsPage(ctx, f.scheduleID, proctor.RosterCursor{}, 50, "")
		return err
	})
	if len(page.Rows) != 1 || page.Rows[0].AttemptID != c.AttemptID {
		t.Fatalf("roster must list the candidate, got %+v", page.Rows)
	}
	// Schedule, runtime, runtime sections, the session page, then the
	// page-scoped IELTS hydration (runtimes, sections, timelines).
	assertStatementBudget(t, "staff roster page", roster, statementBudget{7, 0}, interpolate)

	endIELTSSectionsForSubmit(t, f.db, "a.id = ?", c.AttemptID)
	submitID := uuid.NewString()
	submit := func() (attempts.SubmitResult, error) {
		return svc.saver.Submit(ctx, c.Token, attempts.SubmitCommand{
			AttemptID: c.AttemptID, LeaseEpoch: 1, ExpectedControlEpoch: 1, SubmissionID: submitID, ActorKind: "student",
		}, v2Resolver{}, v2Locker{}, v2ProviderResolver{}, svc.sealer)
	}
	var sealed, resealed attempts.SubmitResult
	submitCounts := measureStatements(t, func() error {
		var err error
		sealed, err = submit()
		return err
	})
	// Lost acknowledgement: the same submission is recovered from the
	// committed receipt, not sealed again.
	resubmitCounts := measureStatements(t, func() error {
		var err error
		resealed, err = submit()
		return err
	})
	if sealed.Replayed || !resealed.Replayed || resealed.FinalDigest != sealed.FinalDigest {
		t.Fatalf("submit retry must replay the sealed receipt: first=%+v retry=%+v", sealed, resealed)
	}
	if resubmitCounts.execs != 0 {
		t.Errorf("a replayed submit must not write, sent %d execs", resubmitCounts.execs)
	}
	// The seal is identical in both modes: protocol 2 always rebuilds the
	// compatibility blobs from cells at seal time. Execs: timeline
	// completion, receipt, blobs, claim, outbox wakeup, digest, V2 receipt.
	assertStatementBudget(t, "submit", submitCounts, statementBudget{14, 7}, interpolate)
	assertStatementBudget(t, "submit replay", resubmitCounts, statementBudget{4, 0}, interpolate)

	want := map[string]string{listening[0]: "A", listening[1]: "B", listening[2]: "B"}
	for _, id := range listening[3:103] {
		want[id] = "C"
	}
	assertIELTSSealedAnswers(t, f, c.AttemptID, want, nil)
}

// BenchmarkIELTSSaveMySQL times one durable IELTS save through the production
// resolver and runtime locker for each qualified configuration. Every
// iteration applies a new client version (or, for replay, repeats one write),
// so the cost includes commit. Local results are configuration comparisons
// only: qualify at the deployment's engine, RTT and I/O.
func BenchmarkIELTSSaveMySQL(b *testing.B) {
	essay := strings.Repeat("The chart compares café visits — ‘quoted’ \"double\" \\path\\ 数字 123.\n", 400)
	shapes := []struct {
		name, section string
		commands      int
		replay        bool
		answer        string
	}{
		{"one", "listening", 1, false, "A"},
		{"flush100", "listening", 100, false, "B"},
		{"replay", "listening", 1, true, "C"},
		{"writingLong", "writing", 1, false, essay},
	}
	for _, mode := range ieltsDriverModes {
		for _, rowFirst := range []bool{false, true} {
			for _, shape := range shapes {
				b.Run(fmt.Sprintf("%s/rowFirst=%t/%s", mode.name, rowFirst, shape.name), func(b *testing.B) {
					f := seedIELTSLoadFixture(b, 1, 1, []string{shape.section}, 120)
					svc := newIELTSBudgetServices(b, rowFirst, mode.interpolate)
					c := f.candidates[0]
					ctx := context.Background()
					ready := true
					if _, err := svc.room.ReadyCohortSection(ctx, f.scheduleID, shape.section, c.AttemptID, c.UserID, nil,
						examruntime.IELTSReadinessSignals{ContentReady: &ready, LocalStorageReady: &ready, AudioReady: &ready}); err != nil {
						b.Fatal(err)
					}
					ids := f.questions[shape.section][:shape.commands]
					commands := func(version int) []attempts.ResponseCommand {
						out := ieltsBudgetCommands(fmt.Sprintf("bench-%d", version), ids, shape.answer)
						for i := range out {
							out[i].ClientVersion = uint64(version)
						}
						return out
					}
					save := func(cmds []attempts.ResponseCommand) {
						if _, err := svc.saver.SaveResponses(ctx, c.Token, attempts.SaveResponsesCommand{
							AttemptID: c.AttemptID, LeaseEpoch: 1, ControlEpoch: 1, Commands: cmds,
						}, v2Resolver{}, v2Locker{}); err != nil {
							b.Fatal(err)
						}
					}
					first := commands(1)
					save(first)
					b.ReportAllocs()
					b.ResetTimer()
					for i := 0; i < b.N; i++ {
						if shape.replay {
							save(first)
						} else {
							save(commands(i + 2))
						}
					}
				})
			}
		}
	}
}
