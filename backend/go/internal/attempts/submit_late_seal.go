package attempts

import (
	"context"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// TimeExpiredSealer is an optional Sealer capability: seal an attempt whose
// room time has run out with the same receipt the auto-submit worker writes
// (outcome submitted, reason time_expired, system actor). A Sealer that does
// not implement it keeps today's refusal.
type TimeExpiredSealer interface {
	SealTimeExpired(ctx context.Context, q tx.Tx, attemptID, scheduleID, requestID string) error
}

// sealLateSubmitInTx finalizes the saved answers under the attempt lock the
// submit already holds, then records the submit receipt so a retry replays
// instead of refusing. The worker's later seal of the same attempt is an
// outcome-compatible replay (both are "submitted"), so exactly one
// terminalization exists whichever side wins the lock.
func (s *Service) sealLateSubmitInTx(ctx context.Context, q tx.Tx, cmd SubmitCommand, attempt AttemptState, reqHash string, now time.Time, sealer TimeExpiredSealer) (SubmitResult, error) {
	digest, err := ComputeDigestInTx(ctx, q, cmd.AttemptID)
	if err != nil {
		return SubmitResult{}, err
	}
	if err := sealer.SealTimeExpired(ctx, q, cmd.AttemptID, attempt.ScheduleID, cmd.SubmissionID); err != nil {
		return SubmitResult{}, err
	}
	if _, err := q.ExecContext(ctx, `UPDATE student_attempts SET response_revision=?, final_response_digest=? WHERE id=?`, attempt.ResponseRevision, digest, cmd.AttemptID); err != nil {
		return SubmitResult{}, err
	}
	result := SubmitResult{SubmissionID: cmd.SubmissionID, FinalDigest: digest, ServerTime: now}
	if err := insertSubmissionReceipt(ctx, q, cmd, attempt, reqHash, digest, result, now); err != nil {
		return SubmitResult{}, err
	}
	telemetry.IncCounter(telemetry.MSubmitLateSealTotal)
	return result, nil
}

// ieltsRoomTimeExpired reports whether a refused IELTS submit arrived after
// the whole room's time ran out on an attempt the worker would still seal.
// Collection is closed at that point, so the submit may finalize what is
// already saved; it never admits a new answer. Personal timing finalizes
// through the normal path (ensureWritable admits its natural room end), and
// a proctor end, pause, termination, or device recovery keeps its own owner.
func ieltsRoomTimeExpired(provider Provider, a AttemptState, gate RuntimeGate, now time.Time) bool {
	if provider != ProviderIELTS || isPersonalIELSTimingModel(gate.TimingModel) || isPersonalIELSTimingModel(a.TimingModel) {
		return false
	}
	if a.SubmittedAt != nil || a.Phase == "post-exam" || a.RecoveryControl != nil {
		return false
	}
	switch a.DeliveryStatus {
	case "submitted", "terminated", "locked", "cancelled", "paused":
		return false
	}
	if a.ProctorStatus == "terminated" || a.ProctorStatus == "paused" {
		return false
	}
	if gate.Status == "completed" {
		return gate.CompletionReason == "time_expired"
	}
	// Shared timetable: the committed schedule ends the room at database time,
	// before the worker flips the runtime row to completed.
	if gate.Status == "live" && usesSharedSchedule(gate) && gate.SharedSchedule != nil {
		pos, err := examruntime.ResolveIELTSSharedWindow(*gate.SharedSchedule, now)
		return err == nil && pos.Kind == examruntime.SharedComplete
	}
	return false
}
