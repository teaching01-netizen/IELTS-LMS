package attempts

// Set-based I/O for the V2 answer batch (audit finding 4).
//
// The V2 write algorithm is one validation loop over cmd.Commands, in order,
// with the attempt row locked FOR UPDATE for the whole batch. What differs
// between a single-question autosave and an offline flush of 100 answers is
// only how many round trips that loop needs under the lock:
//
//	perCommandIO  one statement per read/write per command  (interactive)
//	batchIO       every read is a memoized set-based statement (at most one
//	              per row set, whatever the command count), every write is
//	              deferred into one multi-row statement (flush)
//
// Both implement saveIO and are driven by the SAME loop, so error codes,
// precedence, replay/idempotency verdicts, the monotonic projection rule,
// revision/digest semantics and the per-command ack order have exactly one
// owner. The switch is a size threshold, not a mode: a batch of at most
// bulkWriteThreshold commands costs a bounded (small) number of round trips
// per command, and a flush beyond it costs a bounded number in total, so the
// attempt lock is never held for work proportional to the batch size without
// an upper bound.
//
// Observable behaviour is identical across the two — pinned by
// TestBatchIOEquivalenceWithPerCommandIO, which drives the same batches
// through both strategies (including the replay, version-collision,
// write-id-conflict, superseded and partial-accept cases) and compares the
// full SaveResult and error envelopes.

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

// bulkWriteThreshold is the command count above which a batch switches to the
// set-based I/O strategy. Interactive autosaves send one or two commands and
// stay on the per-command path, whose statements the durability contract tests
// pin one by one; offline flushes (tens to MaxBatchCommands answers) are the
// case the audit found holding the attempt lock for a round trip per command.
const bulkWriteThreshold = 8

// ledgerRow is one attempt_mutations_v2 row as the write path consumes it.
// The version-collision lookup fills only WriteID (that is all the per-command
// probe selects); the set-based read fills the identity columns too.
type ledgerRow struct {
	WriteID        string
	QuestionID     string
	ClientVersion  uint64
	LeaseEpoch     uint64
	RequestHash    string
	ResponseHash   string
	Outcome        string
	ServerRevision uint64
	CanonicalRaw   string
}

// projectionRow is one attempt_responses_v2 row: the monotonic-rule keys, plus
// (for the superseded-ack path) the canonical content backing the ack.
type projectionRow struct {
	LeaseEpoch     *uint64
	ClientVersion  *uint64
	ServerRevision *uint64
	CanonicalRaw   string
	ResponseHash   string
}

// projectionWrite is one accepted response to persist.
type projectionWrite struct {
	AttemptID      string
	QuestionID     string
	ModuleID       string
	LeaseEpoch     uint64
	ControlEpoch   uint64
	ClientVersion  uint64
	WriteID        string
	RequestHash    string
	ResponseHash   string
	ServerRevision uint64
	// Canonical is CanonicalJSON(payload) — the cell the projection stores.
	Canonical []byte
	// Payload drives the legacy blob merge (answer cell + review flag).
	Payload ResponsePayload
	// Writing marks the cell as a writing-answer (legacy blob routing).
	Writing bool
	Now     time.Time
}

// ledgerWrite is one immutable mutation-ledger row to insert.
type ledgerWrite struct {
	AttemptID        string
	WriteID          string
	LeaseEpoch       uint64
	ControlEpoch     uint64
	QuestionID       string
	ClientVersion    uint64
	RequestHash      string
	ResponseHash     string
	Outcome          string
	ServerRevision   uint64
	CanonicalPayload string
	Now              time.Time
}

// saveIO is the I/O half of the write loop. Call sites sit exactly where the
// SQL sits today, so the loop's decision order is unchanged.
type saveIO interface {
	// ledgerByWrite is the exact-replay probe and the in-tx idempotency probe.
	ledgerByWrite(writeID string) (*ledgerRow, error)
	// ledgerByVersion is the (lease,question,clientVersion) collision probe.
	ledgerByVersion(leaseEpoch uint64, questionID string, clientVersion uint64) (*ledgerRow, error)
	// projection returns the monotonic-rule keys for one question (nil if none).
	projection(questionID string) (*projectionRow, error)
	// projectionContent returns the stored canonical content for one question.
	projectionContent(questionID string) (*projectionRow, error)
	// owner resolves question -> module/section ownership.
	owner(questionID string) (QuestionOwner, error)
	// applyProjection persists one accepted response.
	applyProjection(w projectionWrite) error
	// insertLedger appends the immutable mutation row.
	insertLedger(w ledgerWrite) error
	// flush empties any deferred writes (no-op for the per-command strategy).
	flush() error
}

// writeIDConflict is the 409 raised when a write id is replayed with different
// content (ledger unique-key collision), shared so both strategies answer
// identically.
func writeIDConflict(writeID string) error {
	return &apperrors.Error{
		Code:       apperrors.CodeWriteIDConflict,
		Message:    fmt.Sprintf("Write %q was already used with different content.", writeID),
		HTTPStatus: 409,
	}
}

// perCommandIO is the interactive strategy: exactly the statements the write
// path issued before batch I/O existed, one command at a time.
type perCommandIO struct {
	ctx       context.Context
	q         tx.Tx
	attemptID string
	rowFirst  bool
	qr        QuestionResolver
}

var _ saveIO = perCommandIO{}

func (p perCommandIO) ledgerByWrite(writeID string) (*ledgerRow, error) {
	var row ledgerRow
	row.WriteID = writeID
	err := p.q.QueryRowContext(p.ctx, `SELECT request_hash, response_hash, outcome, server_revision, CAST(canonical_response AS CHAR) FROM attempt_mutations_v2 WHERE attempt_id=? AND client_write_id=? FOR UPDATE`, p.attemptID, writeID).
		Scan(&row.RequestHash, &row.ResponseHash, &row.Outcome, &row.ServerRevision, &row.CanonicalRaw)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (p perCommandIO) ledgerByVersion(leaseEpoch uint64, questionID string, clientVersion uint64) (*ledgerRow, error) {
	var writeID string
	err := p.q.QueryRowContext(p.ctx, `SELECT client_write_id FROM attempt_mutations_v2 WHERE attempt_id=? AND lease_epoch=? AND question_id=? AND client_version=? FOR UPDATE`, p.attemptID, leaseEpoch, questionID, clientVersion).Scan(&writeID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &ledgerRow{WriteID: writeID}, nil
}

func (p perCommandIO) projection(questionID string) (*projectionRow, error) {
	var row projectionRow
	err := p.q.QueryRowContext(p.ctx, `SELECT lease_epoch, client_version, server_revision FROM attempt_responses_v2 WHERE attempt_id=? AND question_id=? FOR UPDATE`, p.attemptID, questionID).
		Scan(&row.LeaseEpoch, &row.ClientVersion, &row.ServerRevision)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (p perCommandIO) projectionContent(questionID string) (*projectionRow, error) {
	var row projectionRow
	if err := p.q.QueryRowContext(p.ctx, `SELECT CAST(response AS CHAR), response_hash FROM attempt_responses_v2 WHERE attempt_id=? AND question_id=?`, p.attemptID, questionID).Scan(&row.CanonicalRaw, &row.ResponseHash); err != nil {
		return nil, err
	}
	return &row, nil
}

func (p perCommandIO) owner(questionID string) (QuestionOwner, error) {
	return p.qr.Resolve(p.ctx, p.q, p.attemptID, questionID)
}

func (p perCommandIO) applyProjection(w projectionWrite) error {
	if p.rowFirst {
		return upsertResponseRow(p.ctx, p.q, w.AttemptID, w.QuestionID, w.ModuleID, w.LeaseEpoch, w.ControlEpoch, w.ClientVersion, w.WriteID, w.RequestHash, w.Canonical, w.ResponseHash, w.ServerRevision, w.Now)
	}
	_, _, _, err := mergeProjection(p.ctx, p.q, w.AttemptID, w.QuestionID, w.Canonical, ResponseCommand{
		WriteID: w.WriteID, QuestionID: w.QuestionID, ClientVersion: w.ClientVersion, Response: w.Payload,
	}, w.Writing, w.ModuleID, w.LeaseEpoch, w.ControlEpoch, w.RequestHash, w.ServerRevision, w.ResponseHash, w.Now)
	return err
}

func (p perCommandIO) insertLedger(w ledgerWrite) error {
	_, err := p.q.ExecContext(p.ctx, ledgerInsertPrefix+"(?,?,?,?,?,?,?,?,?,?,?,?,?)",
		uuid.NewString(), w.AttemptID, w.WriteID, w.LeaseEpoch, w.ControlEpoch, w.QuestionID, w.ClientVersion, w.RequestHash, w.ResponseHash, w.Outcome, w.ServerRevision, w.CanonicalPayload, w.Now)
	if err != nil {
		if isDup(err) {
			return writeIDConflict(w.WriteID)
		}
		return err
	}
	return nil
}

func (perCommandIO) flush() error { return nil }

// batchIO is the set-based strategy for flushes above bulkWriteThreshold.
// Reads are one statement per kind, issued lazily at the first command that
// needs them (so a batch that fails its first command issues no more statements
// than the per-command path would); writes are deferred and emitted by flush as
// one statement per kind.
type batchIO struct {
	ctx       context.Context
	q         tx.Tx
	attemptID string
	lease     uint64
	rowFirst  bool
	qr        QuestionResolver
	commands  []ResponseCommand

	replayLoaded      bool
	byWrite           map[string]*ledgerRow
	versionLoaded     bool
	byQuestionVersion map[string]*ledgerRow

	projectionsLoaded bool
	projections       map[string]*projectionRow

	owners *bulkOwnerCache

	blobLoaded  bool
	blobAnswers map[string]json.RawMessage
	blobWriting map[string]json.RawMessage
	blobFlags   map[string]json.RawMessage
	blobDirty   bool

	responses []projectionWrite
	ledger    []ledgerWrite
}

var _ saveIO = (*batchIO)(nil)

// ledgerColumns is the projection every set-based ledger read shares, so the
// two reads below answer from the same row shape.
const ledgerColumns = "SELECT client_write_id, question_id, client_version, lease_epoch, request_hash, response_hash, outcome, server_revision, CAST(canonical_response AS CHAR) FROM attempt_mutations_v2 WHERE attempt_id=? AND "

// The cell projection and the mutation ledger each have ONE statement shape,
// shared by the single-row and the multi-row writer so a column added to either
// table cannot land in only one of them.
const (
	cellUpsertColumns = "(attempt_id, question_id, module_id, lease_epoch, control_epoch, client_version, client_write_id, request_hash, response, response_hash, server_revision, updated_at)"
	cellUpsertUpdates = " ON DUPLICATE KEY UPDATE module_id=VALUES(module_id), lease_epoch=VALUES(lease_epoch), control_epoch=VALUES(control_epoch), client_version=VALUES(client_version), client_write_id=VALUES(client_write_id), request_hash=VALUES(request_hash), response=VALUES(response), response_hash=VALUES(response_hash), server_revision=VALUES(server_revision), updated_at=VALUES(updated_at)"
	cellInsertPrefix  = "INSERT INTO attempt_responses_v2 " + cellUpsertColumns + " VALUES "

	ledgerInsertColumns = "(id, attempt_id, client_write_id, lease_epoch, control_epoch, question_id, client_version, request_hash, response_hash, outcome, server_revision, canonical_response, created_at)"
	ledgerInsertPrefix  = "INSERT INTO attempt_mutations_v2 " + ledgerInsertColumns + " VALUES "
)

// loadReplayRows is the PRE-FENCE read: exactly the rows the per-command
// strategy probes before fencing (the batch's write ids), in one statement. It
// is deliberately narrow so a fenced bulk batch still touches no row the
// single-command path would not touch (invariant I1).
func (b *batchIO) loadReplayRows() error {
	if b.replayLoaded {
		return nil
	}
	b.replayLoaded = true
	b.byWrite = make(map[string]*ledgerRow)
	writeIDs := uniqueStrings(b.commands, func(c ResponseCommand) string { return c.WriteID })
	if len(writeIDs) == 0 {
		return nil
	}
	rows, err := b.q.QueryContext(b.ctx, ledgerColumns+"client_write_id IN ("+placeholders(len(writeIDs))+") FOR UPDATE", append([]any{b.attemptID}, anySlice(writeIDs)...)...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		stored, err := scanLedgerRow(rows)
		if err != nil {
			return err
		}
		if _, ok := b.byWrite[stored.WriteID]; !ok {
			b.byWrite[stored.WriteID] = stored
		}
	}
	return rows.Err()
}

// loadVersionRows is the in-loop read: the write-id rows again plus the
// (lease, question, clientVersion) keys of the batch's commands. The version arm
// is deliberately a superset — question IN (...) AND client_version IN (...) —
// because the decision only ever looks up the exact triple.
func (b *batchIO) loadVersionRows() error {
	if b.versionLoaded {
		return nil
	}
	b.versionLoaded = true
	b.byQuestionVersion = make(map[string]*ledgerRow)
	if b.byWrite == nil {
		b.byWrite = make(map[string]*ledgerRow)
	}
	writeIDs := uniqueStrings(b.commands, func(c ResponseCommand) string { return c.WriteID })
	questionIDs := uniqueStrings(b.commands, func(c ResponseCommand) string { return c.QuestionID })
	versions := uniqueUint64(b.commands, func(c ResponseCommand) uint64 { return c.ClientVersion })
	if len(writeIDs) == 0 {
		return nil
	}
	query := ledgerColumns + "(client_write_id IN (" + placeholders(len(writeIDs)) + ") OR (lease_epoch=? AND question_id IN (" + placeholders(len(questionIDs)) + ") AND client_version IN (" + placeholders(len(versions)) + "))) FOR UPDATE"
	args := make([]any, 0, 2+len(writeIDs)+len(questionIDs)+len(versions))
	args = append(args, b.attemptID)
	args = append(args, anySlice(writeIDs)...)
	args = append(args, b.lease)
	args = append(args, anySlice(questionIDs)...)
	for _, v := range versions {
		args = append(args, v)
	}
	rows, err := b.q.QueryContext(b.ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		stored, err := scanLedgerRow(rows)
		if err != nil {
			return err
		}
		if _, ok := b.byWrite[stored.WriteID]; !ok {
			b.byWrite[stored.WriteID] = stored
		}
		key := ledgerKey(stored.LeaseEpoch, stored.QuestionID, stored.ClientVersion)
		if _, ok := b.byQuestionVersion[key]; !ok {
			b.byQuestionVersion[key] = stored
		}
	}
	return rows.Err()
}

func scanLedgerRow(rows *sql.Rows) (*ledgerRow, error) {
	var row ledgerRow
	if err := rows.Scan(&row.WriteID, &row.QuestionID, &row.ClientVersion, &row.LeaseEpoch, &row.RequestHash, &row.ResponseHash, &row.Outcome, &row.ServerRevision, &row.CanonicalRaw); err != nil {
		return nil, err
	}
	return &row, nil
}

func (b *batchIO) ledgerByWrite(writeID string) (*ledgerRow, error) {
	if err := b.loadReplayRows(); err != nil {
		return nil, err
	}
	return b.byWrite[writeID], nil
}

func (b *batchIO) ledgerByVersion(leaseEpoch uint64, questionID string, clientVersion uint64) (*ledgerRow, error) {
	if err := b.loadVersionRows(); err != nil {
		return nil, err
	}
	if row := b.byQuestionVersion[ledgerKey(leaseEpoch, questionID, clientVersion)]; row != nil {
		return row, nil
	}
	// A command earlier in this batch may already hold the key: today's loop
	// sees the rows it has itself inserted, so the deferred writes are checked.
	for i := range b.ledger {
		if b.ledger[i].LeaseEpoch == leaseEpoch && b.ledger[i].QuestionID == questionID && b.ledger[i].ClientVersion == clientVersion {
			return &ledgerRow{WriteID: b.ledger[i].WriteID}, nil
		}
	}
	return nil, nil
}

func (b *batchIO) loadProjections() error {
	if b.projectionsLoaded {
		return nil
	}
	b.projectionsLoaded = true
	b.projections = make(map[string]*projectionRow)
	ids := uniqueStrings(b.commands, func(c ResponseCommand) string { return c.QuestionID })
	if len(ids) == 0 {
		return nil
	}
	rows, err := b.q.QueryContext(b.ctx, "SELECT question_id, lease_epoch, client_version, server_revision, CAST(response AS CHAR), response_hash FROM attempt_responses_v2 WHERE attempt_id=? AND question_id IN ("+placeholders(len(ids))+") FOR UPDATE", append([]any{b.attemptID}, anySlice(ids)...)...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var questionID string
		var row projectionRow
		if err := rows.Scan(&questionID, &row.LeaseEpoch, &row.ClientVersion, &row.ServerRevision, &row.CanonicalRaw, &row.ResponseHash); err != nil {
			return err
		}
		stored := row
		b.projections[questionID] = &stored
	}
	return rows.Err()
}

func (b *batchIO) projection(questionID string) (*projectionRow, error) {
	if err := b.loadProjections(); err != nil {
		return nil, err
	}
	return b.projections[questionID], nil
}

func (b *batchIO) projectionContent(questionID string) (*projectionRow, error) {
	// Served from the same memoized (locking) read; the set-based load already
	// carries the canonical content.
	if err := b.loadProjections(); err != nil {
		return nil, err
	}
	row := b.projections[questionID]
	if row == nil {
		// The per-command strategy returns the driver's no-rows error here.
		return nil, sql.ErrNoRows
	}
	return row, nil
}

func (b *batchIO) owner(questionID string) (QuestionOwner, error) {
	if b.owners == nil {
		b.owners = newBulkOwnerCache(b.qr, b.attemptID, uniqueStrings(b.commands, func(c ResponseCommand) string { return c.QuestionID }))
	}
	return b.owners.owner(b.ctx, b.q, questionID)
}

// applyProjection defers the accepted response. The legacy blob is read once
// (lazily, on the first accepted command) and merged in memory here, so the
// blob round trips stop scaling with the batch size while the merge rule stays
// the shared mergeProjectionBlob.
func (b *batchIO) applyProjection(w projectionWrite) error {
	if !b.rowFirst {
		if !b.blobLoaded {
			b.blobLoaded = true
			var answersRaw, writingRaw, flagsRaw sql.NullString
			if err := b.q.QueryRowContext(b.ctx, `SELECT answers, writing_answers, flags FROM student_attempts WHERE id=? FOR UPDATE`, w.AttemptID).Scan(&answersRaw, &writingRaw, &flagsRaw); err != nil {
				return err
			}
			b.blobAnswers = mapToAny(answersRaw.String)
			b.blobWriting = mapToAny(writingRaw.String)
			b.blobFlags = mapToAny(flagsRaw.String)
		}
		if err := mergeProjectionBlob(b.blobAnswers, b.blobWriting, b.blobFlags, w.QuestionID, w.Payload, w.Writing); err != nil {
			return err
		}
		b.blobDirty = true
	}
	b.responses = append(b.responses, w)
	return nil
}

func (b *batchIO) insertLedger(w ledgerWrite) error {
	b.ledger = append(b.ledger, w)
	return nil
}

// flush emits one statement per kind for everything the loop accepted.
func (b *batchIO) flush() error {
	if b.blobDirty {
		answersJSON, err := json.Marshal(b.blobAnswers)
		if err != nil {
			return err
		}
		writingJSON, err := json.Marshal(b.blobWriting)
		if err != nil {
			return err
		}
		flagsJSON, err := json.Marshal(b.blobFlags)
		if err != nil {
			return err
		}
		if _, err := b.q.ExecContext(b.ctx, `UPDATE student_attempts SET answers=?, writing_answers=?, flags=? WHERE id=?`, string(answersJSON), string(writingJSON), string(flagsJSON), b.attemptID); err != nil {
			return err
		}
	}
	if len(b.responses) > 0 {
		values := make([]string, 0, len(b.responses))
		args := make([]any, 0, len(b.responses)*12)
		for _, w := range b.responses {
			values = append(values, "(?,?,?,?,?,?,?,?,?,?,?,?)")
			args = append(args, w.AttemptID, w.QuestionID, w.ModuleID, w.LeaseEpoch, w.ControlEpoch, w.ClientVersion, w.WriteID, w.RequestHash, string(w.Canonical), w.ResponseHash, w.ServerRevision, w.Now)
		}
		if _, err := b.q.ExecContext(b.ctx, cellInsertPrefix+strings.Join(values, ",")+cellUpsertUpdates, args...); err != nil {
			return err
		}
	}
	if len(b.ledger) > 0 {
		values := make([]string, 0, len(b.ledger))
		args := make([]any, 0, len(b.ledger)*13)
		for _, w := range b.ledger {
			values = append(values, "(?,?,?,?,?,?,?,?,?,?,?,?,?)")
			args = append(args, uuid.NewString(), w.AttemptID, w.WriteID, w.LeaseEpoch, w.ControlEpoch, w.QuestionID, w.ClientVersion, w.RequestHash, w.ResponseHash, w.Outcome, w.ServerRevision, w.CanonicalPayload, w.Now)
		}
		if _, err := b.q.ExecContext(b.ctx, ledgerInsertPrefix+strings.Join(values, ","), args...); err != nil {
			if isDup(err) {
				return writeIDConflict(b.conflictingWriteID())
			}
			return err
		}
	}
	return nil
}

// conflictingWriteID names the ledger row behind a duplicate-key error on the
// multi-row insert. Under the attempt lock the batch pre-read cannot miss such a
// row, so this is a defensive read on an error path; it keeps the 409 message
// identical to the per-command strategy's.
func (b *batchIO) conflictingWriteID() string {
	ids := make([]string, 0, len(b.ledger))
	for _, w := range b.ledger {
		ids = append(ids, w.WriteID)
	}
	if len(ids) == 0 {
		return ""
	}
	var stored string
	err := b.q.QueryRowContext(b.ctx, "SELECT client_write_id FROM attempt_mutations_v2 WHERE attempt_id=? AND client_write_id IN ("+placeholders(len(ids))+") LIMIT 1", append([]any{b.attemptID}, anySlice(ids)...)...).Scan(&stored)
	if err != nil {
		return ""
	}
	return stored
}

// bulkOwnerCache resolves every question of a batch in one statement when the
// resolver offers the set-based port, keeping the verdicts per question (an
// unresolvable question is a per-question error, not a batch failure) so the
// loop still reports each error at the command that owns it.
type bulkOwnerCache struct {
	resolver    QuestionResolver
	attemptID   string
	questionIDs []string
	loaded      bool
	verdicts    map[string]QuestionVerdict
	loadErr     error
}

func newBulkOwnerCache(qr QuestionResolver, attemptID string, questionIDs []string) *bulkOwnerCache {
	return &bulkOwnerCache{resolver: qr, attemptID: attemptID, questionIDs: questionIDs}
}

func (c *bulkOwnerCache) owner(ctx context.Context, q tx.Tx, questionID string) (QuestionOwner, error) {
	bulk, ok := c.resolver.(BulkQuestionResolver)
	if !ok {
		return c.resolver.Resolve(ctx, q, c.attemptID, questionID)
	}
	if !c.loaded {
		c.loaded = true
		c.verdicts, c.loadErr = bulk.ResolveMany(ctx, q, c.attemptID, c.questionIDs)
	}
	if c.loadErr != nil {
		return QuestionOwner{}, c.loadErr
	}
	if verdict, ok := c.verdicts[questionID]; ok {
		return verdict.Owner, verdict.Err
	}
	// No verdict for this question: fall back to the per-question contract
	// rather than inventing an answer.
	return c.resolver.Resolve(ctx, q, c.attemptID, questionID)
}

func placeholders(n int) string {
	if n <= 0 {
		return "NULL"
	}
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func ledgerKey(leaseEpoch uint64, questionID string, clientVersion uint64) string {
	return strconv.FormatUint(leaseEpoch, 10) + "\x00" + questionID + "\x00" + strconv.FormatUint(clientVersion, 10)
}

func uniqueStrings(commands []ResponseCommand, key func(ResponseCommand) string) []string {
	out := make([]string, 0, len(commands))
	seen := make(map[string]bool, len(commands))
	for _, c := range commands {
		v := key(c)
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}

func uniqueUint64(commands []ResponseCommand, key func(ResponseCommand) uint64) []uint64 {
	out := make([]uint64, 0, len(commands))
	seen := make(map[uint64]bool, len(commands))
	for _, c := range commands {
		v := key(c)
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}

func anySlice(values []string) []any {
	out := make([]any, len(values))
	for i, v := range values {
		out[i] = v
	}
	return out
}
