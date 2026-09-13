// Phase 06 observability: the single place that turns authoring realtime
// activity into metric series.
//
// The governing rule, stated because it is easy to violate by accident:
//
//	Observe INVARIANTS, not implementation details. Alert only on conditions
//	that require action. Never let telemetry redefine correctness.
//
// Concretely:
//
//   - No series measures a numeric cursor gap. The live bus sequence is global
//     and filtered, so `41 -> 47` is perfectly valid: a skipped value belongs to
//     another exam or kind. Gap inference is not a weaker signal, it is a WRONG
//     one, and a metric built on it would page on healthy traffic.
//   - Recovery is measured as RESYNC, labelled with the reason the contract
//     declared.
//   - Persistence health and delivery health are SEPARATE series. An append
//     failure rolls the business transaction back; a socket write failure leaves
//     canonical state correct and the client simply reconnects.
//   - Every emission goes through a named helper with a closed label set, and
//     anything outside that set normalizes to `other`, so a caller passing an
//     exam id or a revision number cannot open a cardinality hole.
//
// Ids, revisions, and anything content-shaped belong in logs and traces.
package authoringrealtime

import (
	"strings"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// ReasonOther is the sentinel every out-of-vocabulary label value collapses
// into. A nonzero `other` series means a caller passed something the contract
// did not allow, which is a bug someone can see rather than an unbounded metric.
const ReasonOther = "other"

// ConnectionResult is the closed set for authoring_ws_connections_total{result}.
type ConnectionResult string

const (
	ConnAccepted         ConnectionResult = "accepted"
	ConnRejectedAuth     ConnectionResult = "rejected_auth"
	ConnRejectedCapacity ConnectionResult = "rejected_capacity"
	ConnRejectedDraft    ConnectionResult = "rejected_draft"
)

// ReconnectOutcome is the closed set for authoring_reconnects_total{outcome}.
type ReconnectOutcome string

const (
	ReconnectResumed          ReconnectOutcome = "resumed"
	ReconnectSnapshotRequired ReconnectOutcome = "snapshot_required"
	ReconnectRejected         ReconnectOutcome = "rejected"
)

// DisconnectReason is the closed set for authoring_ws_disconnects_total{reason}.
type DisconnectReason string

const (
	DisconnectClean             DisconnectReason = "clean"
	DisconnectHeartbeatTimeout  DisconnectReason = "heartbeat_timeout"
	DisconnectSlowClient        DisconnectReason = "slow_client"
	DisconnectDeployDrain       DisconnectReason = "deploy_drain"
	DisconnectError             DisconnectReason = "error"
	DisconnectBarrierUnavail    DisconnectReason = "barrier_unavailable"
	DisconnectReplayUnavail     DisconnectReason = "replay_unavailable"
	DisconnectLeaseExpired      DisconnectReason = "lease_expired"
	DisconnectDraftReplaced     DisconnectReason = "draft_replaced"
	DisconnectPublished         DisconnectReason = "exam_published"
	DisconnectUnsupportedClient DisconnectReason = "unsupported_frame"
)

// DropStage is the closed set for the dropped-frame stage label. It says WHERE
// a frame was shed, which is what routes the ticket.
type DropStage string

const (
	DropHubQueueFull   DropStage = "hub_queue_full"
	DropForwardPollErr DropStage = "forward_poll_error"
	DropUnparseable    DropStage = "unparseable"
)

// ReplayOutcome is the closed set for authoring_replay_total{outcome}.
type ReplayOutcome string

const (
	ReplayServed           ReplayOutcome = "served"
	ReplaySnapshotRequired ReplayOutcome = "snapshot_required"
	ReplayFailed           ReplayOutcome = "failed"
)

// ResyncReason is the closed set for authoring_resync_total{reason}: WHY a
// client had to fall back to authoritative HTTP state.
//
// This replaces gap metrics entirely. Notice what is absent: there is no
// "reconnect" reason, because a reconnect is only a resync once something
// specific forced it, and the specific reason is the actionable one.
type ResyncReason string

const (
	ResyncCursorExpired    ResyncReason = "cursor_expired"
	ResyncReplayTooLarge   ResyncReason = "replay_too_large"
	ResyncDeliveryOverflow ResyncReason = "delivery_overflow"
	ResyncUnsupported      ResyncReason = "unsupported_event"
	ResyncLifecycleRebind  ResyncReason = "lifecycle_rebind"
)

// ResyncReasonFor maps a frozen protocol SnapshotReason onto a resync reason.
// The mapping is explicit so a server reason can never emit an unlisted value.
func ResyncReasonFor(reason SnapshotReason) ResyncReason {
	switch reason {
	case ReasonCursorTooOld:
		return ResyncCursorExpired
	case ReasonReplayTooLarge:
		return ResyncReplayTooLarge
	case ReasonDeliveryGap:
		return ResyncDeliveryOverflow
	case ReasonUnsupportedEvent:
		return ResyncUnsupported
	default:
		// Fail to the most conservative reason rather than inventing a label.
		return ResyncDeliveryOverflow
	}
}

// DeliveryFailureStage is the closed set for
// authoring_delivery_failures_total{stage}.
//
// Deliberately NOT including `append`: an append failure is a PERSISTENCE
// failure that rolls the mutation back and is counted separately. Mixing the two
// would make one alert cover both "saves are failing" and "a socket hiccuped",
// which need different severities and different responses.
type DeliveryFailureStage string

const (
	DeliveryStageForwarder DeliveryFailureStage = "forwarder"
	DeliveryStageSocket    DeliveryFailureStage = "socket"
)

// ConflictOperation is the closed set for authoring_revision_conflicts_total.
type ConflictOperation string

const (
	ConflictSave      ConflictOperation = "save"
	ConflictCreate    ConflictOperation = "create"
	ConflictDuplicate ConflictOperation = "duplicate"
	ConflictBulk      ConflictOperation = "bulk"
	ConflictCommit    ConflictOperation = "commit"
	ConflictPublish   ConflictOperation = "publish"
)

// ConflictOperationFor maps the API's handler operation name onto the coarse
// conflict vocabulary: handler names are finer-grained than the label should be.
func ConflictOperationFor(operation string) ConflictOperation {
	switch strings.TrimSpace(operation) {
	case "save_revision":
		return ConflictSave
	case "create_question", "batch_create":
		return ConflictCreate
	case "duplicate_question":
		return ConflictDuplicate
	case "bulk":
		return ConflictBulk
	case "workbook_commit":
		return ConflictCommit
	case "publish":
		return ConflictPublish
	default:
		return ConflictOperation(ReasonOther)
	}
}

// InvariantViolation is the closed set for
// authoring_invariant_violations_total{invariant}.
//
// DETECTION-ONLY. This series records invariants that code actually observed
// being broken. It is not, and must not be treated as, proof that correctness
// holds: the dangerous failure mode — a stale write winning — is dangerous
// precisely because buggy code may not know it happened. The guarantee comes
// from revision fencing, database constraints, post-condition checks, and the
// concurrency/property suites. This series exists so a DETECTED violation is
// visible instead of swallowed.
type InvariantViolation string

const (
	// InvariantStaleWriteWon: a write whose base revision was already superseded
	// was observed to succeed. Emit it only from a place that checked the
	// post-condition and found it violated.
	InvariantStaleWriteWon InvariantViolation = "stale_write_won"
	// InvariantEventWithoutCommit: an authoring event row was observed without a
	// committed mutation behind it.
	InvariantEventWithoutCommit InvariantViolation = "event_without_commit"
)

// DeliveryLatencyBucketLE is the fixed bucket set for
// authoring_delivery_latency_seconds, in seconds, Prometheus histogram style.
//
// Buckets rather than a gauge because the rollout gate is a p95: a last-sample
// gauge cannot produce a percentile at all, and a "pseudo-p50 gauge" would be a
// number nobody could defend. The repo vendors no histogram client, so the
// buckets are emitted as counters, which the existing registry supports.
var DeliveryLatencyBucketLE = []string{"0.1", "0.25", "0.5", "1", "2", "5", "+Inf"}

// latencyBucketBoundsMS mirrors DeliveryLatencyBucketLE numerically.
var latencyBucketBoundsMS = []float64{100, 250, 500, 1000, 2000, 5000}

func setOf(values ...string) map[string]bool {
	out := make(map[string]bool, len(values))
	for _, v := range values {
		out[v] = true
	}
	return out
}

var (
	connectionResults = setOf(string(ConnAccepted), string(ConnRejectedAuth), string(ConnRejectedCapacity), string(ConnRejectedDraft))
	reconnectOutcomes = setOf(string(ReconnectResumed), string(ReconnectSnapshotRequired), string(ReconnectRejected))
	disconnectReasons = setOf(
		string(DisconnectClean), string(DisconnectHeartbeatTimeout), string(DisconnectSlowClient),
		string(DisconnectDeployDrain), string(DisconnectError), string(DisconnectBarrierUnavail),
		string(DisconnectReplayUnavail), string(DisconnectLeaseExpired), string(DisconnectDraftReplaced),
		string(DisconnectPublished), string(DisconnectUnsupportedClient),
	)
	dropStages         = setOf(string(DropHubQueueFull), string(DropForwardPollErr), string(DropUnparseable))
	replayOutcomes     = setOf(string(ReplayServed), string(ReplaySnapshotRequired), string(ReplayFailed))
	resyncReasons      = setOf(string(ResyncCursorExpired), string(ResyncReplayTooLarge), string(ResyncDeliveryOverflow), string(ResyncUnsupported), string(ResyncLifecycleRebind))
	deliveryStages     = setOf(string(DeliveryStageForwarder), string(DeliveryStageSocket))
	conflictOperations = setOf(
		string(ConflictSave), string(ConflictCreate), string(ConflictDuplicate),
		string(ConflictBulk), string(ConflictCommit), string(ConflictPublish),
	)
	invariantViolations = setOf(string(InvariantStaleWriteWon), string(InvariantEventWithoutCommit))
	latencyBuckets      = setOf(DeliveryLatencyBucketLE...)
)

// CardinalityAllowList exposes the closed label sets for the guard test, so the
// test cannot drift from the vocabularies above by re-listing them.
func CardinalityAllowList() map[string][]string {
	return map[string][]string{
		"connection_result":   keysOf(connectionResults),
		"reconnect_outcome":   keysOf(reconnectOutcomes),
		"disconnect_reason":   keysOf(disconnectReasons),
		"drop_stage":          keysOf(dropStages),
		"replay_outcome":      keysOf(replayOutcomes),
		"resync_reason":       keysOf(resyncReasons),
		"delivery_stage":      keysOf(deliveryStages),
		"conflict_operation":  keysOf(conflictOperations),
		"invariant_violation": keysOf(invariantViolations),
		"latency_bucket":      keysOf(latencyBuckets),
	}
}

func keysOf(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func normalize(raw string, allowed map[string]bool) string {
	trimmed := strings.TrimSpace(raw)
	if allowed[trimmed] {
		return trimmed
	}
	return ReasonOther
}

// EmitConnection records one subscribe/upgrade decision.
func EmitConnection(result ConnectionResult) {
	telemetry.IncCounter(telemetry.MAuthoringWSConnectionsTotal, "result", normalize(string(result), connectionResults))
}

// SetConnections publishes how many authoring sockets are live right now: a
// level, not a rate.
func SetConnections(n int) {
	telemetry.SetGauge(telemetry.MAuthoringWSConnectionsCurrent, float64(n))
}

// EmitReconnect records how a resubscribe was served.
func EmitReconnect(outcome ReconnectOutcome) {
	telemetry.IncCounter(telemetry.MAuthoringReconnectsTotal, "outcome", normalize(string(outcome), reconnectOutcomes))
}

// EmitDisconnect records why a socket ended. A burst of one reason is the
// fastest way to tell a deploy from a capacity problem.
func EmitDisconnect(reason DisconnectReason) {
	telemetry.IncCounter(telemetry.MAuthoringWSDisconnectsTotal, "reason", normalize(string(reason), disconnectReasons))
}

// EmitDropped records a frame that was shed rather than delivered.
func EmitDropped(stage DropStage) {
	telemetry.IncCounter(telemetry.MAuthoringWSEventsDroppedTotal, "stage", normalize(string(stage), dropStages))
}

// EmitReplay records how one replay request resolved. This is the transport
// half of the freshness SLI: `served` means the cursor was honored.
func EmitReplay(outcome ReplayOutcome) {
	telemetry.IncCounter(telemetry.MAuthoringReplayTotal, "outcome", normalize(string(outcome), replayOutcomes))
}

// EmitResync records one authoritative-refetch recovery, labelled with the
// reason the contract declared. THE freshness SLI.
func EmitResync(reason ResyncReason) {
	telemetry.IncCounter(telemetry.MAuthoringResyncTotal, "reason", normalize(string(reason), resyncReasons))
}

// EmitDeliveryFailure records a failure to get an event to a client. Canonical
// state is still correct when these move, so this is a delivery alert, not a
// data-integrity one.
func EmitDeliveryFailure(stage DeliveryFailureStage) {
	telemetry.IncCounter(telemetry.MAuthoringDeliveryFailuresTotal, "stage", normalize(string(stage), deliveryStages))
}

// ObserveDeliveryLatency records one delivery sample into the fixed buckets.
// Every bucket at or above the sample increments, plus `+Inf`, which is the
// cumulative shape a histogram consumer expects.
func ObserveDeliveryLatency(ms float64) {
	if ms < 0 {
		ms = 0
	}
	for i, bound := range latencyBucketBoundsMS {
		if ms <= bound {
			telemetry.IncCounter(telemetry.MAuthoringDeliveryLatencySeconds, "le", DeliveryLatencyBucketLE[i])
		}
	}
	telemetry.IncCounter(telemetry.MAuthoringDeliveryLatencySeconds, "le", "+Inf")
}

// EmitConflict records a fence rejection. Fencing is the correctness control;
// this series is the pressure signal operators use to see collaboration load.
func EmitConflict(operation ConflictOperation) {
	telemetry.IncCounter(
		telemetry.MAuthoringRevisionConflictsTotal,
		"operation", normalize(string(operation), conflictOperations),
	)
}

// EmitInvariantViolation records a DETECTED invariant break. See
// InvariantViolation: this is detection, never proof.
func EmitInvariantViolation(invariant InvariantViolation) {
	telemetry.IncCounter(
		telemetry.MAuthoringInvariantViolationsTotal,
		"invariant", normalize(string(invariant), invariantViolations),
	)
}

// SetPresence publishes the current visible-collaborator count. The caller
// counts SERVER-side entries after TTL processing, never browser-declared
// identities.
func SetPresence(n int) {
	telemetry.SetGauge(telemetry.MAuthoringPresenceCurrent, float64(n))
}
