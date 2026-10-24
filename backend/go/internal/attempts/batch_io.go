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
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

// bulkWriteThreshold is the command count above which a batch switches to the
// set-based I/O strategy. Single-answer writes keep the per-command path; two
// or more answers use bounded set-based reads and writes so synchronized small
// batches do not hold each attempt lock across per-answer round trips.
const bulkWriteThreshold = 1

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

// perCommandIO is the interactive strategy: one statement per read/write per
// command. It is transaction-local (built by ioFor inside one saveInTx call), so
// it may remember what it has already read under the attempt lock.
type perCommandIO struct {
	ctx       context.Context
	q         tx.Tx
	attemptID string
	rowFirst  bool
	qr        QuestionResolver

	// byWrite memoizes ledgerByWrite: key presence means the probe completed,
	// a nil value is a confirmed miss. The exact-replay probe and the in-loop
	// idempotency probe then share one SELECT per write id. It never outlives
	// the transaction attempt, so a rolled-back miss is never trusted on retry;
	// the attempt row lock serializes every ledger writer for this attempt.
	byWrite map[string]*ledgerRow
}

var _ saveIO = (*perCommandIO)(nil)

func (p *perCommandIO) ledgerByWrite(writeID string) (*ledgerRow, error) {
	if row, loaded := p.byWrite[writeID]; loaded {
		return row, nil
	}
	row := &ledgerRow{WriteID: writeID}
	err := p.q.QueryRowContext(p.ctx, `SELECT request_hash, response_hash, outcome, server_revision, CAST(canonical_response AS CHAR) FROM attempt_mutations_v2 WHERE attempt_id=? AND client_write_id=? FOR UPDATE`, p.attemptID, writeID).
		Scan(&row.RequestHash, &row.ResponseHash, &row.Outcome, &row.ServerRevision, &row.CanonicalRaw)
	if err == sql.ErrNoRows {
		row = nil
	} else if err != nil {
		return nil, err
	}
	if p.byWrite == nil {
		p.byWrite = make(map[string]*ledgerRow, 1)
	}
	p.byWrite[writeID] = row
	return row, nil
}

func (p *perCommandIO) ledgerByVersion(leaseEpoch uint64, questionID string, clientVersion uint64) (*ledgerRow, error) {
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

func (p *perCommandIO) projection(questionID string) (*projectionRow, error) {
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

func (p *perCommandIO) projectionContent(questionID string) (*projectionRow, error) {
	var row projectionRow
	if err := p.q.QueryRowContext(p.ctx, `SELECT CAST(response AS CHAR), response_hash FROM attempt_responses_v2 WHERE attempt_id=? AND question_id=?`, p.attemptID, questionID).Scan(&row.CanonicalRaw, &row.ResponseHash); err != nil {
		return nil, err
	}
	return &row, nil
}

func (p *perCommandIO) owner(questionID string) (QuestionOwner, error) {
	return p.qr.Resolve(p.ctx, p.q, p.attemptID, questionID)
}

func (p *perCommandIO) applyProjection(w projectionWrite) error {
	if p.rowFirst {
		return upsertResponseRow(p.ctx, p.q, w.AttemptID, w.QuestionID, w.ModuleID, w.LeaseEpoch, w.ControlEpoch, w.ClientVersion, w.WriteID, w.RequestHash, w.Canonical, w.ResponseHash, w.ServerRevision, w.Now)
	}
	_, _, _, err := mergeProjection(p.ctx, p.q, w.AttemptID, w.QuestionID, w.Canonical, ResponseCommand{
		WriteID: w.WriteID, QuestionID: w.QuestionID, ClientVersion: w.ClientVersion, Response: w.Payload,
	}, w.Writing, w.ModuleID, w.LeaseEpoch, w.ControlEpoch, w.RequestHash, w.ServerRevision, w.ResponseHash, w.Now)
	return err
}

func (p *perCommandIO) insertLedger(w ledgerWrite) error {
	_, err := p.q.ExecContext(p.ctx, ledgerInsertPrefix+"(?,?,?,?,?,?,?,?,?,?,?,?,?)",
		uuid.NewString(), w.AttemptID, w.WriteID, w.LeaseEpoch, w.ControlEpoch, w.QuestionID, w.ClientVersion, w.RequestHash, w.ResponseHash, w.Outcome, w.ServerRevision, w.CanonicalPayload, w.Now)
	if err != nil {
		if isDup(err) {
			return writeIDConflict(w.WriteID)
		}
		return err
	}
	// Keep the memo coherent: a cached miss for this id is now a stored row.
	if _, loaded := p.byWrite[w.WriteID]; loaded {
		p.byWrite[w.WriteID] = &ledgerRow{
			WriteID: w.WriteID, QuestionID: w.QuestionID, ClientVersion: w.ClientVersion, LeaseEpoch: w.LeaseEpoch,
			RequestHash: w.RequestHash, ResponseHash: w.ResponseHash, Outcome: w.Outcome,
			ServerRevision: w.ServerRevision, CanonicalRaw: w.CanonicalPayload,
		}
	}
	return nil
}

func (*perCommandIO) flush() error { return nil }

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
	byQuestionVersion map[questionVersionKey]*ledgerRow
	// pendingVersions holds the keys staged earlier in this batch (write id),
	// the rows a sequential implementation would already have inserted.
	pendingVersions map[questionVersionKey]string

	projectionsLoaded bool
	// projections is the staged view: loaded rows, replaced by each accepted
	// command so later commands for the same question see it.
	projections map[string]*projectionRow

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

// questionVersionKey is the ledger's (lease, question, clientVersion) unique key.
type questionVersionKey struct {
	leaseEpoch    uint64
	questionID    string
	clientVersion uint64
}

// loadVersionRows is the in-loop read: the exact (question, clientVersion)
// pairs, at the batch lease, of the commands whose write id is not already
// stored. The pre-fence write-id read is reused rather than repeated; under
// the attempt row lock no other writer can add ledger rows for this attempt.
func (b *batchIO) loadVersionRows() error {
	if b.versionLoaded {
		return nil
	}
	b.versionLoaded = true
	b.byQuestionVersion = make(map[questionVersionKey]*ledgerRow)
	if err := b.loadReplayRows(); err != nil {
		return err
	}
	pairs := make([]questionVersionKey, 0, len(b.commands))
	seen := make(map[questionVersionKey]bool, len(b.commands))
	for _, c := range b.commands {
		key := questionVersionKey{b.lease, c.QuestionID, c.ClientVersion}
		if b.byWrite[c.WriteID] != nil || seen[key] {
			continue
		}
		seen[key] = true
		pairs = append(pairs, key)
	}
	if len(pairs) == 0 {
		return nil
	}
	args := make([]any, 0, 2+2*len(pairs))
	args = append(args, b.attemptID, b.lease)
	predicates := make([]string, 0, len(pairs))
	for _, key := range pairs {
		predicates = append(predicates, "(question_id=? AND client_version=?)")
		args = append(args, key.questionID, key.clientVersion)
	}
	rows, err := b.q.QueryContext(b.ctx, ledgerColumns+"lease_epoch=? AND ("+strings.Join(predicates, " OR ")+") FOR UPDATE", args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		stored, err := scanLedgerRow(rows)
		if err != nil {
			return err
		}
		key := questionVersionKey{stored.LeaseEpoch, stored.QuestionID, stored.ClientVersion}
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
	key := questionVersionKey{leaseEpoch, questionID, clientVersion}
	if row := b.byQuestionVersion[key]; row != nil {
		return row, nil
	}
	// A command earlier in this batch may already hold the key: a sequential
	// loop sees the rows it has itself inserted, so the deferred writes count.
	if writeID, ok := b.pendingVersions[key]; ok {
		return &ledgerRow{WriteID: writeID}, nil
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

// applyProjection defers the accepted response and stages it as the question's
// current projection. The legacy blob is read once (lazily, on the first
// accepted command) and merged in memory here, so the blob round trips stop
// scaling with the batch size while the merge rule stays the shared
// mergeProjectionBlob.
func (b *batchIO) applyProjection(w projectionWrite) error {
	if err := b.loadProjections(); err != nil {
		return err
	}
	lease, version, revision := w.LeaseEpoch, w.ClientVersion, w.ServerRevision
	b.projections[w.QuestionID] = &projectionRow{
		LeaseEpoch: &lease, ClientVersion: &version, ServerRevision: &revision,
		CanonicalRaw: string(w.Canonical), ResponseHash: w.ResponseHash,
	}
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
	if b.pendingVersions == nil {
		b.pendingVersions = make(map[questionVersionKey]string, len(b.commands))
	}
	key := questionVersionKey{w.LeaseEpoch, w.QuestionID, w.ClientVersion}
	if _, ok := b.pendingVersions[key]; !ok {
		b.pendingVersions[key] = w.WriteID
	}
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
		// One row per question: an accepted command is always newer than the
		// staged projection it replaced, so the last write is the final cell.
		final := make([]projectionWrite, 0, len(b.responses))
		at := make(map[string]int, len(b.responses))
		for _, w := range b.responses {
			if i, ok := at[w.QuestionID]; ok {
				final[i] = w
				continue
			}
			at[w.QuestionID] = len(final)
			final = append(final, w)
		}
		values := make([]string, 0, len(final))
		args := make([]any, 0, len(final)*12)
		for _, w := range final {
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

func anySlice(values []string) []any {
	out := make([]any, len(values))
	for i, v := range values {
		out[i] = v
	}
	return out
}
