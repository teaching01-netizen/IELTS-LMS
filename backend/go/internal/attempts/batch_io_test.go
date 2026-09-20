package attempts

// Audit finding 4: the V2 batch used to hold the attempt row lock for a fixed
// number of round trips PER COMMAND, so an offline flush of 100 answers queued
// module submits and runtime control behind hundreds of statements. These tests
// drive the real SaveResponses path with sqlmock and pin two properties:
//
//  1. the set-based strategy issues a CONSTANT number of statements for a
//     max-size batch — the same count as a batch one command over the
//     threshold — and sqlmock rejects any unexpected or unmet statement, so a
//     single per-command statement left in the hot path fails this run;
//  2. both strategies produce identical observable results (acks, revisions,
//     error code/status/details) for the same committed state, which is what
//     keeps the threshold a pure I/O decision rather than a behaviour switch.
import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"reflect"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

const (
	batchSecret   = "test-secret-32-bytes-long--------"
	storedRawJSON = `{"answer":"B","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`
)

// cmdPlan is the committed state one command sees, expressed once and staged
// into both strategies' statement shapes.
type cmdPlan struct {
	// dup is the ledger row already stored for this write id (nil = unseen).
	dup *storedLedger
	// collision is the write id already holding this (lease, question,
	// clientVersion) key ("" = free).
	collision string
	// storedProjection is the projection row that wins the monotonic rule
	// (nil = the command applies).
	storedProjection *storedProjection
}

type storedLedger struct {
	reqHash  string
	hash     string
	revision uint64
}

type storedProjection struct {
	lease     uint64
	version   uint64
	revision  uint64
	hash      string
	canonical string
}

// saveExpectation is one batch plus the committed state it meets.
type saveExpectation struct {
	commands []ResponseCommand
	plans    []cmdPlan
	attempt  func() *sqlmock.Rows
	// rowFirst selects the B3 cell projection; false drives the legacy answer
	// blob (the second shape the strategies must answer identically).
	rowFirst   bool
	unwritable bool
}

func bulkCommands(n int) []ResponseCommand {
	cmds := make([]ResponseCommand, 0, n)
	for i := 0; i < n; i++ {
		cmds = append(cmds, ResponseCommand{
			WriteID:       fmt.Sprintf("w-%d", i),
			QuestionID:    fmt.Sprintf("q-%d", i),
			ClientVersion: uint64(1 + i),
			Response:      ResponsePayload{Answer: "A"},
		})
	}
	return cmds
}

// commandWriteIDs / commandQuestionIDs / commandVersions are the read keys the
// set-based strategy builds from a batch: unique, in first-seen order (so a
// batch that repeats a question reads it once, as the code does).
func commandWriteIDs(commands []ResponseCommand) []string {
	out := make([]string, 0, len(commands))
	seen := make(map[string]bool, len(commands))
	for _, c := range commands {
		if !seen[c.WriteID] {
			seen[c.WriteID] = true
			out = append(out, c.WriteID)
		}
	}
	return out
}

func commandQuestionIDs(commands []ResponseCommand) []string {
	out := make([]string, 0, len(commands))
	seen := make(map[string]bool, len(commands))
	for _, c := range commands {
		if !seen[c.QuestionID] {
			seen[c.QuestionID] = true
			out = append(out, c.QuestionID)
		}
	}
	return out
}

func commandVersions(commands []ResponseCommand) []uint64 {
	out := make([]uint64, 0, len(commands))
	seen := make(map[uint64]bool, len(commands))
	for _, c := range commands {
		if !seen[c.ClientVersion] {
			seen[c.ClientVersion] = true
			out = append(out, c.ClientVersion)
		}
	}
	return out
}

func anyStrings(values []string) []driver.Value {
	out := make([]driver.Value, 0, len(values))
	for _, v := range values {
		out = append(out, v)
	}
	return out
}

// appliedRevisions assigns each applied command its server revision: the
// attempt's revision 9 plus its position among the applied commands.
func appliedRevisions(plans []cmdPlan) map[int]uint64 {
	out := make(map[int]uint64)
	next := uint64(10)
	for i, p := range plans {
		if p.dup != nil || p.storedProjection != nil {
			continue
		}
		out[i] = next
		next++
	}
	return out
}

// replayConflictAt returns the index of a command whose stored ledger row has
// different content while every earlier command matched (the batch fails inside
// the exact-replay phase, before the fences). -1 when there is none.
func replayConflictAt(exp saveExpectation) int {
	for i, c := range exp.commands {
		plan := exp.plans[i]
		if plan.dup == nil {
			return -1
		}
		hash, err := commandHash(c)
		if err != nil {
			return -1
		}
		if plan.dup.reqHash != hash {
			return i
		}
	}
	return -1
}

// allReplayed reports whether every command is already in the ledger with
// matching content — the exact-replay fast path, which mutates nothing.
func allReplayed(exp saveExpectation) bool {
	if len(exp.commands) == 0 {
		return false
	}
	for i, c := range exp.commands {
		plan := exp.plans[i]
		if plan.dup == nil {
			return false
		}
		hash, err := commandHash(c)
		if err != nil || plan.dup.reqHash != hash {
			return false
		}
	}
	return true
}

// collisionAt returns the index of the first command with a version collision.
func collisionAt(plans []cmdPlan) int {
	for i, p := range plans {
		if p.collision != "" {
			return i
		}
	}
	return -1
}

// stageSingle stages the per-command strategy: exactly the statement chain the
// write path issued before batch I/O existed, one statement per read/write per
// command, stopping at the point this state makes it fail.
func stageSingle(mock sqlmock.Sqlmock, exp saveExpectation) int {
	staged := 0
	count := func() { staged++ }
	mock.ExpectBegin()
	count()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	count()
	mock.ExpectQuery("FROM student_attempts WHERE id").WithArgs("att-1").WillReturnRows(exp.attempt())
	count()
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WillReturnRows(sessionRows())
	count()

	ledgerRows := func(row storedLedger) *sqlmock.Rows {
		return sqlmock.NewRows([]string{"request_hash", "response_hash", "outcome", "server_revision", "canonical_response"}).
			AddRow(row.reqHash, row.hash, "applied", row.revision, storedRawJSON)
	}
	missRows := func() *sqlmock.Rows {
		return sqlmock.NewRows([]string{"request_hash", "response_hash", "outcome", "server_revision", "canonical_response"})
	}
	// Replay phase: probe each write id until the first unseen one; a stored row
	// with different content fails the batch here (its own 409, no details).
	for i, c := range exp.commands {
		plan := exp.plans[i]
		if plan.dup == nil {
			mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").WithArgs("att-1", c.WriteID).WillReturnRows(missRows())
			count()
			break
		}
		mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").WithArgs("att-1", c.WriteID).WillReturnRows(ledgerRows(*plan.dup))
		count()
		if plan.dup.reqHash != reqHashOf(exp.commands[i]) {
			mock.ExpectRollback()
			return staged
		}
	}
	if allReplayed(exp) {
		// The batch is entirely stored: stored acks plus the attempt revision.
		mock.ExpectQuery("SELECT response_revision FROM student_attempts").WithArgs("att-1").
			WillReturnRows(sqlmock.NewRows([]string{"response_revision"}).AddRow(uint64(9)))
		count()
		mock.ExpectCommit()
		return staged
	}
	mock.ExpectQuery("SELECT active_client_session_id").WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	count()

	revisions := appliedRevisions(exp.plans)
	for i, c := range exp.commands {
		plan := exp.plans[i]
		if plan.dup != nil {
			mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").WithArgs("att-1", c.WriteID).WillReturnRows(ledgerRows(*plan.dup))
			count()
			continue
		}
		mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").WithArgs("att-1", c.WriteID).WillReturnRows(missRows())
		count()
		if exp.unwritable {
			// ensureWritable refuses the first new write; nothing is written.
			mock.ExpectRollback()
			return staged
		}
		if plan.collision != "" {
			mock.ExpectQuery("SELECT client_write_id FROM attempt_mutations_v2 WHERE attempt_id").WithArgs("att-1", uint64(3), c.QuestionID, c.ClientVersion).
				WillReturnRows(sqlmock.NewRows([]string{"client_write_id"}).AddRow(plan.collision))
			count()
			mock.ExpectRollback()
			return staged
		}
		mock.ExpectQuery("SELECT client_write_id FROM attempt_mutations_v2 WHERE attempt_id").WithArgs("att-1", uint64(3), c.QuestionID, c.ClientVersion).WillReturnError(sql.ErrNoRows)
		count()
		if sp := plan.storedProjection; sp != nil {
			mock.ExpectQuery("SELECT lease_epoch, client_version, server_revision FROM attempt_responses_v2").WithArgs("att-1", c.QuestionID).
				WillReturnRows(sqlmock.NewRows([]string{"lease_epoch", "client_version", "server_revision"}).AddRow(sp.lease, sp.version, sp.revision))
			count()
			mock.ExpectQuery("response_hash FROM attempt_responses_v2").WithArgs("att-1", c.QuestionID).
				WillReturnRows(sqlmock.NewRows([]string{"response", "response_hash"}).AddRow(sp.canonical, sp.hash))
			count()
			mock.ExpectExec("INSERT INTO attempt_mutations_v2").WithArgs(
				sqlmock.AnyArg(), "att-1", c.WriteID, uint64(3), uint64(7), c.QuestionID, c.ClientVersion,
				sqlmock.AnyArg(), sp.hash, "superseded", sp.revision, sqlmock.AnyArg(), sqlmock.AnyArg(),
			).WillReturnResult(sqlmock.NewResult(1, 1))
			count()
			continue
		}
		mock.ExpectQuery("SELECT lease_epoch, client_version, server_revision FROM attempt_responses_v2").WithArgs("att-1", c.QuestionID).WillReturnError(sql.ErrNoRows)
		count()
		if !exp.rowFirst {
			// Legacy blob: read + write per accepted command, then the cell.
			mock.ExpectQuery("SELECT answers, writing_answers, flags FROM student_attempts").WithArgs("att-1").
				WillReturnRows(sqlmock.NewRows([]string{"answers", "writing_answers", "flags"}).AddRow("{}", "{}", "{}"))
			count()
			mock.ExpectExec("UPDATE student_attempts SET answers=").WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "att-1").WillReturnResult(sqlmock.NewResult(0, 1))
			count()
		}
		rev := revisions[i]
		mock.ExpectExec("INSERT INTO attempt_responses_v2").WithArgs(
			"att-1", c.QuestionID, "m-listening", uint64(3), uint64(7), c.ClientVersion, c.WriteID,
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), rev, sqlmock.AnyArg(),
		).WillReturnResult(sqlmock.NewResult(1, 1))
		count()
		mock.ExpectExec("INSERT INTO attempt_mutations_v2").WithArgs(
			sqlmock.AnyArg(), "att-1", c.WriteID, uint64(3), uint64(7), c.QuestionID, c.ClientVersion,
			sqlmock.AnyArg(), sqlmock.AnyArg(), "applied", rev, sqlmock.AnyArg(), sqlmock.AnyArg(),
		).WillReturnResult(sqlmock.NewResult(1, 1))
		count()
	}
	if len(revisions) > 0 {
		mock.ExpectExec("UPDATE student_attempts SET response_revision").WillReturnResult(sqlmock.NewResult(0, 1))
		count()
	}
	mock.ExpectExec("INSERT INTO session_audit_logs").WillReturnResult(sqlmock.NewResult(1, 1))
	count()
	mock.ExpectCommit()
	return staged
}

// stageBatch stages the set-based strategy for the same expectation: one
// pre-fence ledger read (the rows the per-command path probes write id by write
// id), one in-loop ledger read, one projection read and one statement per kind
// for the accepted writes, regardless of the command count.
func stageBatch(mock sqlmock.Sqlmock, exp saveExpectation) int {
	staged := 0
	count := func() { staged++ }
	mock.ExpectBegin()
	count()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	count()
	mock.ExpectQuery("FROM student_attempts WHERE id").WithArgs("att-1").WillReturnRows(exp.attempt())
	count()
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WillReturnRows(sessionRows())
	count()

	// The pre-fence probe is exactly the row set the per-command strategy
	// probes one write id at a time — the batch's own write ids, one statement.
	narrowArgs := append([]driver.Value{"att-1"}, anyStrings(commandWriteIDs(exp.commands))...)
	dups := sqlmock.NewRows(ledgerColumnNames())
	for i, c := range exp.commands {
		if plan := exp.plans[i]; plan.dup != nil {
			dups.AddRow(c.WriteID, c.QuestionID, c.ClientVersion, uint64(3), plan.dup.reqHash, plan.dup.hash, "applied", plan.dup.revision, storedRawJSON)
		}
	}
	mock.ExpectQuery(regexp.QuoteMeta("WHERE attempt_id=? AND client_write_id IN (")).WithArgs(narrowArgs...).WillReturnRows(dups)
	count()

	if replayConflictAt(exp) >= 0 {
		// The replay phase fails before the fences: no session probe, no reads.
		mock.ExpectRollback()
		return staged
	}
	if allReplayed(exp) {
		// A whole-batch replay mutates nothing: the stored acks come back with
		// the attempt's current revision, and the loop never runs.
		mock.ExpectQuery("SELECT response_revision FROM student_attempts").WithArgs("att-1").
			WillReturnRows(sqlmock.NewRows([]string{"response_revision"}).AddRow(uint64(9)))
		count()
		mock.ExpectCommit()
		return staged
	}
	mock.ExpectQuery("SELECT active_client_session_id").WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	count()
	if exp.unwritable {
		// ensureWritable refuses the first new write, before any projection read
		// or deferred write is issued.
		mock.ExpectRollback()
		return staged
	}
	// The in-loop read re-reads those rows and adds the version keys; the loop
	// asks for it at the first command that clears the fences, once.
	versionRows := sqlmock.NewRows(ledgerColumnNames())
	for i, c := range exp.commands {
		plan := exp.plans[i]
		if plan.dup != nil {
			versionRows.AddRow(c.WriteID, c.QuestionID, c.ClientVersion, uint64(3), plan.dup.reqHash, plan.dup.hash, "applied", plan.dup.revision, storedRawJSON)
		}
		if plan.collision != "" {
			versionRows.AddRow(plan.collision, c.QuestionID, c.ClientVersion, uint64(3), "other", "other", "applied", uint64(4), storedRawJSON)
		}
	}
	versionArgs := []driver.Value{"att-1"}
	versionArgs = append(versionArgs, anyStrings(commandWriteIDs(exp.commands))...)
	versionArgs = append(versionArgs, uint64(3))
	versionArgs = append(versionArgs, anyStrings(commandQuestionIDs(exp.commands))...)
	for _, v := range commandVersions(exp.commands) {
		versionArgs = append(versionArgs, v)
	}
	mock.ExpectQuery(regexp.QuoteMeta("WHERE attempt_id=? AND (client_write_id IN (")).WithArgs(versionArgs...).WillReturnRows(versionRows)
	count()
	projectionRows := sqlmock.NewRows([]string{"question_id", "lease_epoch", "client_version", "server_revision", "response", "response_hash"})
	for i, c := range exp.commands {
		if sp := exp.plans[i].storedProjection; sp != nil {
			projectionRows.AddRow(c.QuestionID, sp.lease, sp.version, sp.revision, sp.canonical, sp.hash)
		}
	}
	// The projection read is issued at the first command that reaches the
	// monotonic rule, i.e. before any later command can collide.
	if failAt := collisionAt(exp.plans); failAt != 0 {
		projectionArgs := []driver.Value{"att-1"}
		projectionArgs = append(projectionArgs, anyStrings(commandQuestionIDs(exp.commands))...)
		mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_responses_v2 WHERE attempt_id=? AND question_id IN (")).WithArgs(projectionArgs...).WillReturnRows(projectionRows)
		count()
	}
	if collisionAt(exp.plans) >= 0 {
		mock.ExpectRollback()
		return staged
	}

	revisions := appliedRevisions(exp.plans)
	if !exp.rowFirst && len(revisions) > 0 {
		// One blob read for the whole batch, then one blob write at flush.
		mock.ExpectQuery("SELECT answers, writing_answers, flags FROM student_attempts").WithArgs("att-1").
			WillReturnRows(sqlmock.NewRows([]string{"answers", "writing_answers", "flags"}).AddRow("{}", "{}", "{}"))
		count()
	}
	if !exp.rowFirst && len(revisions) > 0 {
		// flush() writes the merged blob before the cell rows.
		mock.ExpectExec("UPDATE student_attempts SET answers=").WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "att-1").WillReturnResult(sqlmock.NewResult(0, 1))
		count()
	}
	if len(revisions) > 0 {
		responseArgs := make([]driver.Value, 0, len(revisions)*12)
		for i, c := range exp.commands {
			rev, ok := revisions[i]
			if !ok {
				continue
			}
			responseArgs = append(responseArgs,
				"att-1", c.QuestionID, "m-listening", uint64(3), uint64(7), c.ClientVersion, c.WriteID,
				sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), rev, sqlmock.AnyArg())
		}
		mock.ExpectExec("INSERT INTO attempt_responses_v2").WithArgs(responseArgs...).WillReturnResult(sqlmock.NewResult(1, int64(len(revisions))))
		count()
	}
	ledgerWriteArgs := make([]driver.Value, 0, len(exp.commands)*13)
	for i, c := range exp.commands {
		if exp.plans[i].dup != nil {
			continue
		}
		outcome := "applied"
		rev := revisions[i]
		if sp := exp.plans[i].storedProjection; sp != nil {
			outcome = "superseded"
			rev = sp.revision
		}
		ledgerWriteArgs = append(ledgerWriteArgs,
			sqlmock.AnyArg(), "att-1", c.WriteID, uint64(3), uint64(7), c.QuestionID, c.ClientVersion,
			sqlmock.AnyArg(), sqlmock.AnyArg(), outcome, rev, sqlmock.AnyArg(), sqlmock.AnyArg())
	}
	if len(ledgerWriteArgs) > 0 {
		mock.ExpectExec("INSERT INTO attempt_mutations_v2").WithArgs(ledgerWriteArgs...).WillReturnResult(sqlmock.NewResult(1, int64(len(ledgerWriteArgs)/13)))
		count()
	}
	if len(revisions) > 0 {
		mock.ExpectExec("UPDATE student_attempts SET response_revision").WillReturnResult(sqlmock.NewResult(0, 1))
		count()
	}
	mock.ExpectExec("INSERT INTO session_audit_logs").WillReturnResult(sqlmock.NewResult(1, 1))
	count()
	mock.ExpectCommit()
	return staged
}

func ledgerColumnNames() []string {
	return []string{"client_write_id", "question_id", "client_version", "lease_epoch", "request_hash", "response_hash", "outcome", "server_revision", "canonical_response"}
}

func reqHashOf(c ResponseCommand) string {
	hash, err := commandHash(c)
	if err != nil {
		return ""
	}
	return hash
}

// runSave drives one expectation through one strategy and returns the result,
// the error and the number of statements the stager expected. The threshold
// forces the strategy: neither value is a deployment knob.
func runSave(t *testing.T, exp saveExpectation, stage func(mock sqlmock.Sqlmock, exp saveExpectation) int, threshold int) (SaveResult, error, int) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := testService(db, []byte(batchSecret)).SetRowFirst(exp.rowFirst).SetBulkThresholdForTest(threshold)
	staged := stage(mock, exp)
	bearer := mintToken(t, []byte(batchSecret), baseClaims())
	// A fixed gate timestamp: both strategies must report the same ServerTime.
	qr, _ := liveStubs()
	rl := stubLocker{gate: RuntimeGate{Status: "live", ActiveSectionKey: "*", SectionLive: true, SectionStarted: true, Now: fixedGateTime}}
	res, saveErr := svc.SaveResponses(context.Background(), bearer, SaveResponsesCommand{
		AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7, Commands: exp.commands,
	}, qr, rl)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	return res, saveErr, staged
}

func plansFor(n int) []cmdPlan { return make([]cmdPlan, n) }

// fixedGateTime is the gate timestamp both strategies are driven with, so the
// compared SaveResults cannot differ by wall clock.
var fixedGateTime = time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)

// Test-only thresholds that force one strategy for any batch used here
// (including a flush at MaxBatchCommands, so both strategies can be measured on
// the same batch).
const (
	batchStrategyThreshold      = 4
	perCommandStrategyThreshold = MaxBatchCommands + 1
)

// TestBulkBatchStatementCountIsConstant is the finding's acceptance test: a
// max-size flush (100 answers) issues exactly the same number of statements as
// a batch one command over the threshold, and that set contains no per-command
// statement at all.
func TestBulkBatchStatementCountIsConstant(t *testing.T) {
	run := func(n int) (SaveResult, int) {
		exp := saveExpectation{commands: bulkCommands(n), plans: plansFor(n), attempt: attemptRows, rowFirst: true}
		res, saveErr, staged := runSave(t, exp, stageBatch, batchStrategyThreshold)
		if saveErr != nil {
			t.Fatalf("bulk batch of %d must commit, got %v", n, saveErr)
		}
		return res, staged
	}
	small, large := bulkWriteThreshold+1, MaxBatchCommands
	smallRes, smallStaged := run(small)
	largeRes, largeStaged := run(large)

	if smallStaged != largeStaged {
		t.Fatalf("statement count must not scale with the batch size: %d commands staged %d statements, %d commands staged %d",
			small, smallStaged, large, largeStaged)
	}
	if largeStaged > 14 {
		t.Fatalf("max-size batch staged %d statements; the set-based path should stay bounded", largeStaged)
	}
	// The comparison that makes the claim about the lock: the same max-size
	// batch on the per-command strategy, which is what the attempt row used to
	// be held for. If the batch ever regresses to per-command work this ratio
	// collapses and the test fails with the two counts.
	exp := saveExpectation{commands: bulkCommands(large), plans: plansFor(large), attempt: attemptRows, rowFirst: true}
	_, eachErr, eachStaged := runSave(t, exp, stageSingle, perCommandStrategyThreshold)
	if eachErr != nil {
		t.Fatalf("max-size batch of %d must commit per-command too, got %v", large, eachErr)
	}
	if eachStaged < largeStaged*10 {
		t.Fatalf("set-based path must collapse the per-command round trips: %d statements for %d commands vs %d set-based",
			eachStaged, large, largeStaged)
	}
	t.Logf("statements under the attempt lock: %d commands -> %d set-based, %d per-command", large, largeStaged, eachStaged)
	if len(largeRes.Acks) != large || largeRes.ResponseRevision != uint64(9+large) {
		t.Fatalf("expected %d acks at revision %d, got %d acks at %d", large, 9+large, len(largeRes.Acks), largeRes.ResponseRevision)
	}
	if smallRes.ResponseRevision != uint64(9+small) {
		t.Fatalf("small batch revision = %d, want %d", smallRes.ResponseRevision, 9+small)
	}
	if largeRes.Replayed {
		t.Fatalf("an all-new batch is not a replay")
	}
	for i, ack := range largeRes.Acks {
		if ack.Outcome != "applied" || ack.ServerRevision != uint64(10+i) {
			t.Fatalf("ack %d = %+v, want applied at revision %d", i, ack, 10+i)
		}
		if ack.WriteID != fmt.Sprintf("w-%d", i) || ack.QuestionID != fmt.Sprintf("q-%d", i) {
			t.Fatalf("ack %d must follow command order, got %+v", i, ack)
		}
	}
}

// TestBulkBatchReplayIssuesConstantStatements covers the other path a real
// offline flush takes: every answer is already in the ledger (the client
// retried after a lost response). The batch must answer the same stored acks
// the per-command strategy answers, with a statement count that does not grow
// with the number of replayed answers — the probes are one statement, not one
// per answer.
func TestBulkBatchReplayIssuesConstantStatements(t *testing.T) {
	run := func(n int, stage func(sqlmock.Sqlmock, saveExpectation) int, threshold int) (SaveResult, int) {
		commands := bulkCommands(n)
		plans := plansFor(n)
		for i, c := range commands {
			plans[i].dup = &storedLedger{reqHash: reqHashOf(c), hash: fmt.Sprintf("hash-%d", i), revision: uint64(4 + i)}
		}
		exp := saveExpectation{commands: commands, plans: plans, attempt: attemptRows, rowFirst: true}
		res, saveErr, staged := runSave(t, exp, stage, threshold)
		if saveErr != nil {
			t.Fatalf("replay of %d must succeed, got %v", n, saveErr)
		}
		return res, staged
	}
	small, large := bulkWriteThreshold+1, MaxBatchCommands
	smallRes, smallStaged := run(small, stageBatch, batchStrategyThreshold)
	largeRes, largeStaged := run(large, stageBatch, batchStrategyThreshold)
	eachRes, eachStaged := run(large, stageSingle, perCommandStrategyThreshold)

	// ServerTime is the wall clock on the replay path (no gate is read), so the
	// comparison is over the acks and the revision semantics.
	if !reflect.DeepEqual(largeRes.Acks, eachRes.Acks) || largeRes.ResponseRevision != eachRes.ResponseRevision || largeRes.Replayed != eachRes.Replayed {
		t.Fatalf("replay mismatch: set-based acks=%d rev=%d replayed=%v, per-command acks=%d rev=%d replayed=%v",
			len(largeRes.Acks), largeRes.ResponseRevision, largeRes.Replayed,
			len(eachRes.Acks), eachRes.ResponseRevision, eachRes.Replayed)
	}
	if len(smallRes.Acks) != small || smallRes.ResponseRevision != 9 {
		t.Fatalf("small replay must return %d acks at revision 9, got %d acks at %d", small, len(smallRes.Acks), smallRes.ResponseRevision)
	}
	if !largeRes.Replayed || len(largeRes.Acks) != large || largeRes.ResponseRevision != 9 {
		t.Fatalf("replay must return %d stored acks at the attempt revision, got replayed=%v acks=%d rev=%d",
			large, largeRes.Replayed, len(largeRes.Acks), largeRes.ResponseRevision)
	}
	for i, ack := range largeRes.Acks {
		if ack.Outcome != "duplicate" || !ack.Replayed || ack.ServerRevision != uint64(4+i) || ack.WriteID != fmt.Sprintf("w-%d", i) {
			t.Fatalf("ack %d = %+v, want the stored duplicate at revision %d", i, ack, 4+i)
		}
	}
	if smallStaged != largeStaged {
		t.Fatalf("replay probe count must not scale: %d commands staged %d statements, %d staged %d",
			small, smallStaged, large, largeStaged)
	}
	if eachStaged < largeStaged*10 {
		t.Fatalf("per-command replay must probe once per answer: %d vs %d set-based", eachStaged, largeStaged)
	}
	t.Logf("replay statements under the attempt lock: %d answers -> %d set-based, %d per-command", large, largeStaged, eachStaged)
}

// TestBatchIOEquivalenceWithPerCommandIO requires both strategies to answer
// identically for the same committed state, across the applied, duplicate,
// superseded, collision and unwritable shapes.
func TestBatchIOEquivalenceWithPerCommandIO(t *testing.T) {
	const n = 12
	commands := bulkCommands(n)

	scenarios := []struct {
		name       string
		plans      []cmdPlan
		commands   []ResponseCommand
		attempt    func() *sqlmock.Rows
		rowFirst   bool
		unwritable bool
	}{
		{name: "all applied", plans: plansFor(n), rowFirst: true},
		{
			name:     "duplicates mixed with new writes",
			rowFirst: true,
			plans: func() []cmdPlan {
				plans := plansFor(n)
				plans[0].dup = &storedLedger{reqHash: reqHashOf(commands[0]), hash: "hash-0", revision: 4}
				plans[1].dup = &storedLedger{reqHash: reqHashOf(commands[1]), hash: "hash-1", revision: 5}
				return plans
			}(),
		},
		{
			name:     "older lease supersedes",
			rowFirst: true,
			plans: func() []cmdPlan {
				plans := plansFor(n)
				plans[0].storedProjection = &storedProjection{lease: 4, version: 1, revision: 99, hash: "hash-current", canonical: storedRawJSON}
				return plans
			}(),
		},
		{
			name:     "version collision",
			rowFirst: true,
			plans: func() []cmdPlan {
				plans := plansFor(n)
				plans[3].collision = "w-other"
				return plans
			}(),
		},
		{
			name:     "write id conflict",
			rowFirst: true,
			plans: func() []cmdPlan {
				plans := plansFor(n)
				plans[0].dup = &storedLedger{reqHash: "different-hash", hash: "hash-0", revision: 4}
				return plans
			}(),
		},
		{
			// A flush that repeats a question (two answers for the same cell in
			// one batch): both commands apply in order and the later one is the
			// cell's final content, in both strategies.
			name:     "same question twice",
			rowFirst: true,
			plans:    plansFor(n),
			commands: func() []ResponseCommand {
				cmds := bulkCommands(n)
				cmds[1].QuestionID = cmds[0].QuestionID
				return cmds
			}(),
		},
		{name: "attempt not writable", plans: plansFor(n), attempt: func() *sqlmock.Rows { return durabilityAttemptRowsAs("submitted") }, rowFirst: true, unwritable: true},
		{
			name: "legacy blob: applied and superseded",
			plans: func() []cmdPlan {
				plans := plansFor(n)
				plans[0].storedProjection = &storedProjection{lease: 4, version: 1, revision: 99, hash: "hash-current", canonical: storedRawJSON}
				return plans
			}(),
		},
	}

	for _, s := range scenarios {
		t.Run(s.name, func(t *testing.T) {
			attempt := s.attempt
			if attempt == nil {
				attempt = attemptRows
			}
			batchCommands := s.commands
			if batchCommands == nil {
				batchCommands = commands
			}
			exp := saveExpectation{commands: batchCommands, plans: s.plans, attempt: attempt, rowFirst: s.rowFirst, unwritable: s.unwritable}
			batchRes, batchErr, batchStaged := runSave(t, exp, stageBatch, batchStrategyThreshold)
			eachRes, eachErr, eachStaged := runSave(t, exp, stageSingle, perCommandStrategyThreshold)

			if !reflect.DeepEqual(batchErr, eachErr) {
				t.Fatalf("error mismatch: set-based=%v per-command=%v", batchErr, eachErr)
			}
			if !reflect.DeepEqual(batchRes, eachRes) {
				t.Fatalf("result mismatch:\n set-based   = %+v\n per-command = %+v", batchRes, eachRes)
			}
			if len(batchRes.Acks) != n && batchErr == nil {
				t.Fatalf("expected %d acks, got %d", n, len(batchRes.Acks))
			}
			// A batch that dies on its first command issues the same minimal set
			// in both strategies; one that gets to work must issue fewer.
			if batchStaged > eachStaged {
				t.Fatalf("set-based strategy must never issue more statements: %d vs %d", batchStaged, eachStaged)
			}
			if batchErr == nil && batchStaged >= eachStaged {
				t.Fatalf("a committed batch must issue fewer statements than per-command: %d vs %d", batchStaged, eachStaged)
			}
		})
	}
}

// TestBatchIOErrorEnvelopes pins the set-based strategy's failures to the same
// envelopes the per-command path's contract tests require, so the batch path
// cannot answer a different code, status or detail set for the same fault.
func TestBatchIOErrorEnvelopes(t *testing.T) {
	const n = 12
	commands := bulkCommands(n)

	cases := []struct {
		name        string
		plans       []cmdPlan
		attempt     func() *sqlmock.Rows
		rowFirst    bool
		unwritable  bool
		wantCode    apperrors.Code
		wantStatus  int
		wantDetails map[string]any
	}{
		{
			name:     "version collision",
			rowFirst: true,
			plans: func() []cmdPlan {
				plans := plansFor(n)
				plans[3].collision = "w-other"
				return plans
			}(),
			attempt:     attemptRows,
			wantCode:    apperrors.CodeVersionCollision,
			wantStatus:  409,
			wantDetails: map[string]any{"questionId": "q-3", "clientVersion": uint64(4), "existingWriteId": "w-other"},
		},
		{
			name:     "write id conflict",
			rowFirst: true,
			plans: func() []cmdPlan {
				plans := plansFor(n)
				plans[0].dup = &storedLedger{reqHash: "different-hash", hash: "hash-0", revision: 4}
				return plans
			}(),
			attempt:     attemptRows,
			wantCode:    apperrors.CodeWriteIDConflict,
			wantStatus:  409,
			wantDetails: map[string]any{"writeId": "w-0"},
		},
		{
			name:       "attempt not writable",
			plans:      plansFor(n),
			attempt:    func() *sqlmock.Rows { return durabilityAttemptRowsAs("submitted") },
			rowFirst:   true,
			unwritable: true,
			wantCode:   apperrors.CodeAttemptNotWritable,
			wantStatus: 422,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			exp := saveExpectation{commands: commands, plans: tc.plans, attempt: tc.attempt, rowFirst: tc.rowFirst, unwritable: tc.unwritable}
			_, saveErr, _ := runSave(t, exp, stageBatch, batchStrategyThreshold)
			appErr, ok := apperrors.As(saveErr)
			if !ok {
				t.Fatalf("expected a typed error, got %v", saveErr)
			}
			if appErr.Code != tc.wantCode || appErr.HTTPStatus != tc.wantStatus {
				t.Fatalf("want %s/%d, got %s/%d (%s)", tc.wantCode, tc.wantStatus, appErr.Code, appErr.HTTPStatus, appErr.Message)
			}
			for key, want := range tc.wantDetails {
				if appErr.Details[key] != want {
					t.Fatalf("details[%q] = %v, want %v", key, appErr.Details[key], want)
				}
			}
		})
	}
}

// TestBatchIOUsesOneResolverStatement pins the third per-command round trip the
// batch used to pay: question ownership. A resolver that offers the set-based
// port is asked once for the whole batch, not once per answer.
func TestBatchIOUsesOneResolverStatement(t *testing.T) {
	const n = 12
	commands := bulkCommands(n)
	resolver := &countingBulkResolver{}
	exp := saveExpectation{commands: commands, plans: plansFor(n), attempt: attemptRows, rowFirst: true}

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := testService(db, []byte(batchSecret)).SetRowFirst(true)
	stageBatch(mock, exp)
	bearer := mintToken(t, []byte(batchSecret), baseClaims())
	_, rl := liveStubs()
	if _, err := svc.SaveResponses(context.Background(), bearer, SaveResponsesCommand{
		AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7, Commands: commands,
	}, resolver, rl); err != nil {
		t.Fatalf("batch must commit, got %v", err)
	}
	if resolver.manyCalls != 1 || resolver.eachCalls != 0 {
		t.Fatalf("resolver must be asked once for the batch, got ResolveMany=%d Resolve=%d", resolver.manyCalls, resolver.eachCalls)
	}
	if resolver.asked != n {
		t.Fatalf("ResolveMany must receive all %d questions, got %d", n, resolver.asked)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

type countingBulkResolver struct {
	manyCalls int
	eachCalls int
	asked     int
}

func (c *countingBulkResolver) Resolve(_ context.Context, _ tx.Tx, _, _ string) (QuestionOwner, error) {
	c.eachCalls++
	return QuestionOwner{ModuleID: "m-listening", SectionKey: "*", ModuleState: "active"}, nil
}

func (c *countingBulkResolver) ResolveMany(_ context.Context, _ tx.Tx, _ string, questionIDs []string) (map[string]QuestionVerdict, error) {
	c.manyCalls++
	c.asked = len(questionIDs)
	verdicts := make(map[string]QuestionVerdict, len(questionIDs))
	for _, id := range questionIDs {
		verdicts[id] = QuestionVerdict{Owner: QuestionOwner{ModuleID: "m-listening", SectionKey: "*", ModuleState: "active"}}
	}
	return verdicts, nil
}
