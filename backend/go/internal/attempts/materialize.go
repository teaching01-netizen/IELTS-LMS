// Materializer is the plan-B3 row-first read view. The write path persists
// only attempt_responses_v2 rows + the attempt_mutations_v2 ledger + a narrow
// student_attempts UPDATE (revisions/epochs, no blob columns); the legacy
// answers/writing_answers/flags columns become read views rebuilt from rows:
// (a) lazily on reads that still need them, (b) by worker flush for active
// attempts, (c) synchronously at seal time (correctness point — grading
// never sees staleness). CanonicalJSON/hashing stay untouched.
package attempts

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"example.com/ielts-proctoring/internal/platform/answerblobs"
)

// Blobs aliases the shared leaf triple (single codec for write + seal paths).
type Blobs = answerblobs.Blobs

// BlobQuerier is the read surface MaterializeBlobs needs (*sql.DB, *sql.Tx,
// sqlmock without new interfaces — same seam style as runtime.SnapshotQuerier).
type BlobQuerier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// MaterializeBlobs rebuilds answers/writing_answers/flags from
// attempt_responses_v2 rows. Writing-module responses (module_id containing
// "writing", case-insensitive — same rule as saveInTx) land in
// writing_answers; all others land in answers. markedForReview sets flags.
// The answer value stored is the canonical payload's "answer" field,
// matching mergeProjection's payloadAnswer extraction. Empty row sets yield
// "{}" (never NULL). Loader errors propagate.
func MaterializeBlobs(ctx context.Context, q BlobQuerier, attemptID string) (Blobs, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT question_id, module_id, CAST(response AS CHAR) FROM attempt_responses_v2 WHERE attempt_id = ? ORDER BY question_id`,
		attemptID)
	if err != nil {
		return Blobs{}, err
	}
	defer rows.Close()
	var cells []answerblobs.Cell
	for rows.Next() {
		var questionID, moduleID, raw string
		if err := rows.Scan(&questionID, &moduleID, &raw); err != nil {
			return Blobs{}, err
		}
		cells = append(cells, answerblobs.Cell{QuestionID: questionID, ModuleID: moduleID, Canonical: json.RawMessage(raw)})
	}
	if err := rows.Err(); err != nil {
		return Blobs{}, err
	}
	return answerblobs.Assemble(cells)
}

// rowAnswer aliases the leaf projected cell (test-facing wrapper kept so
// the equivalence test pins shared semantics through this package).
type rowAnswer = answerblobs.Answer

// rowFlag aliases the leaf flags cell.
type rowFlag = answerblobs.Flag

// projectRowAnswer delegates to the shared leaf codec (single source for
// write + seal paths). Stored rows are canonical payloads, so the leaf's
// raw "answer" extraction equals the old re-canonicalization byte-wise.
func projectRowAnswer(questionID, moduleID string, canonical json.RawMessage) (rowAnswer, rowFlag, error) {
	ans, flag := answerblobs.Project(moduleID, canonical)
	return ans, flag, nil
}

// isWritingModule matches saveInTx's writing-module rule (leaf-shared).
func isWritingModule(moduleID string) bool { return answerblobs.IsWritingModule(moduleID) }

// FlushDB is the read+write surface FlushStaleBlobs needs (*sql.DB).
type FlushDB interface {
	BlobQuerier
	RowWriter
}

// FlushStaleBlobs materializes + persists blob columns for up to limit
// recently-active protocol-2 attempts (plan B3.2b worker flush). Candidate
// predicate: protocol_version = 2, non-terminal delivery/phase, updated in
// the recent window — bounded, no schema change. Returns flushed count.
// Terminal attempts are excluded (seal already materialized synchronously).
func FlushStaleBlobs(ctx context.Context, db FlushDB, limit int) (int, error) {
	if limit < 1 {
		limit = 1
	}
	rows, err := db.QueryContext(ctx,
		`SELECT id FROM student_attempts WHERE protocol_version = 2 AND submitted_at IS NULL AND COALESCE(delivery_status,'running') NOT IN ('submitted','terminated','locked','cancelled') AND phase <> 'post-exam' AND updated_at > DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 5 MINUTE) ORDER BY updated_at ASC LIMIT ?`,
		limit)
	if err != nil {
		return 0, err
	}
	var ids []string
	func() {
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return
			}
			ids = append(ids, id)
		}
	}()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	flushed := 0
	for _, id := range ids {
		blobs, err := MaterializeBlobs(ctx, db, id)
		if err != nil {
			return flushed, err
		}
		if _, err := db.ExecContext(ctx, `UPDATE student_attempts SET answers=?, writing_answers=?, flags=? WHERE id=?`, blobs.Answers, blobs.WritingAnswers, blobs.Flags, id); err != nil {
			return flushed, err
		}
		flushed++
	}
	return flushed, nil
}

// RowWriter is the Exec surface upsertResponseRow needs (tx.Tx compatible).
type RowWriter interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// upsertResponseRow persists one answer cell row-first: ONLY the
// attempt_responses_v2 UPSERT (no blob SELECT, no blob UPDATE). The canonical
// payload bytes are stored verbatim so MaterializeBlobs can rebuild the
// legacy triple byte-identically. Idempotency/version fencing stays with
// the caller's probes (mutation ledger + version probe + monotonic rule).
// Column list matches migration 0049's NOT NULL set (module_id,
// control_epoch, client_write_id, request_hash, response).
func upsertResponseRow(ctx context.Context, q RowWriter, attemptID, questionID, moduleID string, leaseEpoch, controlEpoch, clientVersion uint64, writeID, reqHash string, canonical []byte, respHash string, serverRev uint64, now time.Time) error {
	_, err := q.ExecContext(ctx, `INSERT INTO attempt_responses_v2 (attempt_id, question_id, module_id, lease_epoch, control_epoch, client_version, client_write_id, request_hash, response, response_hash, server_revision, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE module_id=VALUES(module_id), lease_epoch=VALUES(lease_epoch), control_epoch=VALUES(control_epoch), client_version=VALUES(client_version), client_write_id=VALUES(client_write_id), request_hash=VALUES(request_hash), response=VALUES(response), response_hash=VALUES(response_hash), server_revision=VALUES(server_revision), updated_at=VALUES(updated_at)`, attemptID, questionID, moduleID, leaseEpoch, controlEpoch, clientVersion, writeID, reqHash, string(canonical), respHash, serverRev, now)
	return err
}
