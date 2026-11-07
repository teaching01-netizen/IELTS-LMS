package attempts

import (
	"context"
	"example.com/ielts-proctoring/internal/platform/tx"
	"time"
)

// RestoreStaffMovedResponseInTx reuses the canonical V2 projection and mutation
// ledger. Delivery has authenticated the writer and checked the staff-issued
// source permit and question/module ownership under the owning attempt lock.
// Newer server work always wins, even if an old offline client issued a larger
// client version. The caller owns the surrounding transaction.
func RestoreStaffMovedResponseInTx(ctx context.Context, q tx.Tx, attemptID, moduleID string, lease, epoch, cutoff uint64, c ResponseCommand, now time.Time) (bool, error) {
	io := &perCommandIO{ctx: ctx, q: q, attemptID: attemptID, rowFirst: true}
	cmd := SaveResponsesCommand{AttemptID: attemptID, LeaseEpoch: lease, ControlEpoch: epoch, Commands: []ResponseCommand{c}}
	if err := ValidateSaveEnvelope(cmd); err != nil {
		return false, err
	}
	prepared := prepareCommands(preparePayloads(cmd.Commands))[0]
	reqHash, err := prepared.request(c)
	if err != nil {
		return false, err
	}
	prior, err := io.ledgerByWrite(c.WriteID)
	if err != nil {
		return false, err
	}
	if prior != nil {
		if prior.RequestHash != reqHash {
			return false, writeIDConflict(c.WriteID)
		}
		return false, nil
	}
	current, err := io.projection(c.QuestionID)
	if err != nil {
		return false, err
	}
	if current != nil && ((current.ServerRevision != nil && *current.ServerRevision > cutoff) || (current.LeaseEpoch != nil && *current.LeaseEpoch > lease) || (current.LeaseEpoch != nil && *current.LeaseEpoch == lease && current.ClientVersion != nil && *current.ClientVersion >= c.ClientVersion)) {
		return false, nil
	}
	collision, err := io.ledgerByVersion(lease, c.QuestionID, c.ClientVersion)
	if err != nil {
		return false, err
	}
	if collision != nil {
		return false, nil
	}
	var revision uint64
	if err := q.QueryRowContext(ctx, "SELECT response_revision FROM student_attempts WHERE id=?", attemptID).Scan(&revision); err != nil {
		return false, err
	}
	revision++
	if err := io.applyProjection(projectionWrite{AttemptID: attemptID, QuestionID: c.QuestionID, ModuleID: moduleID, LeaseEpoch: lease, ControlEpoch: epoch, ClientVersion: c.ClientVersion, WriteID: c.WriteID, RequestHash: reqHash, ResponseHash: prepared.hash, ServerRevision: revision, Canonical: prepared.canonical, Payload: c.Response, Now: now}); err != nil {
		return false, err
	}
	if err := io.insertLedger(ledgerWrite{AttemptID: attemptID, WriteID: c.WriteID, LeaseEpoch: lease, ControlEpoch: epoch, QuestionID: c.QuestionID, ClientVersion: c.ClientVersion, RequestHash: reqHash, ResponseHash: prepared.hash, Outcome: "applied", ServerRevision: revision, CanonicalPayload: string(prepared.canonical), Now: now}); err != nil {
		return false, err
	}
	_, err = q.ExecContext(ctx, `UPDATE student_attempts SET response_revision=?,answer_revision=answer_revision+1,revision=revision+1,updated_at=? WHERE id=?`, revision, now, attemptID)
	return err == nil, err
}
