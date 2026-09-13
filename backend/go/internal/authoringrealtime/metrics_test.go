package authoringrealtime

import (
	"testing"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// withRegistry swaps the process registry for an isolated one, mirroring the
// established emit-test pattern in this repo.
func withRegistry(t *testing.T) *telemetry.Registry {
	t.Helper()
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	t.Cleanup(func() { telemetry.DefaultRegistry = old })
	return reg
}

func counter(reg *telemetry.Registry, name string, pairs ...string) float64 {
	return telemetry.CounterValueForTest(reg, name, pairs...)
}

func gauge(reg *telemetry.Registry, name string, pairs ...string) float64 {
	return telemetry.GaugeValueForTest(reg, name, pairs...)
}

func TestEmitConnectionUsesResultLabel(t *testing.T) {
	reg := withRegistry(t)
	for _, result := range []ConnectionResult{ConnAccepted, ConnRejectedAuth, ConnRejectedCapacity, ConnRejectedDraft} {
		EmitConnection(result)
		if got := counter(reg, telemetry.MAuthoringWSConnectionsTotal, "result", string(result)); got != 1 {
			t.Fatalf("result %q counted %v times, want 1", result, got)
		}
	}
}

func TestEmitReconnectAndDisconnectAndDropped(t *testing.T) {
	reg := withRegistry(t)

	EmitReconnect(ReconnectResumed)
	if got := counter(reg, telemetry.MAuthoringReconnectsTotal, "outcome", string(ReconnectResumed)); got != 1 {
		t.Fatalf("reconnect resumed = %v, want 1", got)
	}

	EmitDisconnect(DisconnectSlowClient)
	if got := counter(reg, telemetry.MAuthoringWSDisconnectsTotal, "reason", string(DisconnectSlowClient)); got != 1 {
		t.Fatalf("disconnect slow_client = %v, want 1", got)
	}

	EmitDropped(DropHubQueueFull)
	// ONE label name per series: the dropped series must not also carry a
	// `reason` label from an older call site, or the two would never be summed
	// together by a dashboard.
	if got := counter(reg, telemetry.MAuthoringWSEventsDroppedTotal, "stage", string(DropHubQueueFull)); got != 1 {
		t.Fatalf("dropped hub_queue_full = %v, want 1", got)
	}
	if got := counter(reg, telemetry.MAuthoringWSEventsDroppedTotal, "reason", string(DropHubQueueFull)); got != 0 {
		t.Fatalf("dropped series must not carry a second label name, got %v", got)
	}
}

func TestGaugesAreLevelsNotCounters(t *testing.T) {
	reg := withRegistry(t)
	SetConnections(7)
	SetConnections(3)
	if got := gauge(reg, telemetry.MAuthoringWSConnectionsCurrent); got != 3 {
		t.Fatalf("connections gauge = %v, want the latest value 3", got)
	}
	SetPresence(2)
	if got := gauge(reg, telemetry.MAuthoringPresenceCurrent); got != 2 {
		t.Fatalf("presence gauge = %v, want 2", got)
	}
}

// The freshness SLI is resync-by-reason. Every protocol reason must map onto a
// listed reason, and the four protocol reasons must stay distinguishable (a
// collapse would hide the cause behind the wrong label).
func TestResyncReasonsAreListedAndDistinct(t *testing.T) {
	reg := withRegistry(t)
	seen := map[ResyncReason]bool{}
	for _, reason := range []SnapshotReason{
		ReasonCursorTooOld, ReasonReplayTooLarge, ReasonDeliveryGap, ReasonUnsupportedEvent,
	} {
		mapped := ResyncReasonFor(reason)
		if !resyncReasons[string(mapped)] {
			t.Fatalf("protocol reason %q mapped to unlisted resync reason %q", reason, mapped)
		}
		if seen[mapped] {
			t.Fatalf("resync reason %q is used by more than one protocol reason", mapped)
		}
		seen[mapped] = true
		EmitResync(mapped)
		if got := counter(reg, telemetry.MAuthoringResyncTotal, "reason", string(mapped)); got != 1 {
			t.Fatalf("resync %q = %v, want 1", mapped, got)
		}
	}
	// The cursor-expiry case must be labelled as EXPIRY, not as a gap.
	if ResyncReasonFor(ReasonCursorTooOld) != ResyncCursorExpired {
		t.Fatalf("cursor_too_old must map to %q", ResyncCursorExpired)
	}
	// A lifecycle rebind is a reason in its own right.
	EmitResync(ResyncLifecycleRebind)
	if got := counter(reg, telemetry.MAuthoringResyncTotal, "reason", string(ResyncLifecycleRebind)); got != 1 {
		t.Fatalf("lifecycle rebind resync = %v, want 1", got)
	}
}

func TestEmitReplayOutcomes(t *testing.T) {
	reg := withRegistry(t)
	for _, outcome := range []ReplayOutcome{ReplayServed, ReplaySnapshotRequired, ReplayFailed} {
		EmitReplay(outcome)
		if got := counter(reg, telemetry.MAuthoringReplayTotal, "outcome", string(outcome)); got != 1 {
			t.Fatalf("replay %q = %v, want 1", outcome, got)
		}
	}
}

func TestEmitConflictHasNoOutcomeLabel(t *testing.T) {
	reg := withRegistry(t)
	EmitConflict(ConflictSave)
	if got := counter(reg, telemetry.MAuthoringRevisionConflictsTotal, "operation", "save"); got != 1 {
		t.Fatalf("conflict save = %v, want 1", got)
	}
	// There is deliberately no outcome dimension: an "overwritten_never" style
	// counter would imply that not incrementing it proves correctness, which it
	// cannot. Detected violations go to their own series instead.
	if got := counter(reg, telemetry.MAuthoringRevisionConflictsTotal, "operation", "save", "outcome", "fenced"); got != 0 {
		t.Fatalf("conflict series must not carry an outcome label, got %v", got)
	}
}

func TestEmitInvariantViolation(t *testing.T) {
	reg := withRegistry(t)
	EmitInvariantViolation(InvariantStaleWriteWon)
	if got := counter(reg, telemetry.MAuthoringInvariantViolationsTotal, "invariant", string(InvariantStaleWriteWon)); got != 1 {
		t.Fatalf("stale_write_won = %v, want 1", got)
	}
}

// Delivery failures cover transport only: `append` is a PERSISTENCE failure and
// must not be expressible here, because the two need different alerts.
func TestDeliveryFailureStagesExcludeAppend(t *testing.T) {
	reg := withRegistry(t)
	EmitDeliveryFailure(DeliveryStageForwarder)
	EmitDeliveryFailure(DeliveryStageSocket)
	if got := counter(reg, telemetry.MAuthoringDeliveryFailuresTotal, "stage", "forwarder"); got != 1 {
		t.Fatalf("forwarder failure = %v, want 1", got)
	}
	if got := counter(reg, telemetry.MAuthoringDeliveryFailuresTotal, "stage", "socket"); got != 1 {
		t.Fatalf("socket failure = %v, want 1", got)
	}
	EmitDeliveryFailure(DeliveryFailureStage("append"))
	if got := counter(reg, telemetry.MAuthoringDeliveryFailuresTotal, "stage", "append"); got != 0 {
		t.Fatalf("append must not be a delivery stage, got %v", got)
	}
	if got := counter(reg, telemetry.MAuthoringDeliveryFailuresTotal, "stage", ReasonOther); got != 1 {
		t.Fatalf("an append stage value must normalize to other, got %v", got)
	}
}

// Buckets, not a gauge: the rollout gate is a p95, which a last-sample gauge
// cannot produce.
func TestDeliveryLatencyIsCumulativeBuckets(t *testing.T) {
	reg := withRegistry(t)
	ObserveDeliveryLatency(120) // 120ms: over 0.1s, inside 0.25s
	for _, le := range DeliveryLatencyBucketLE {
		want := 0.0
		if le == "0.25" || le == "0.5" || le == "1" || le == "2" || le == "5" || le == "+Inf" {
			want = 1
		}
		if got := counter(reg, telemetry.MAuthoringDeliveryLatencySeconds, "le", le); got != want {
			t.Fatalf("120ms bucket le=%s = %v, want %v (cumulative)", le, got, want)
		}
	}

	ObserveDeliveryLatency(7000) // over the largest bound: only +Inf
	if got := counter(reg, telemetry.MAuthoringDeliveryLatencySeconds, "le", "5"); got != 1 {
		t.Fatalf("a 7s sample must NOT land in the 5s bucket, got %v", got)
	}
	if got := counter(reg, telemetry.MAuthoringDeliveryLatencySeconds, "le", "+Inf"); got != 2 {
		t.Fatalf("+Inf must catch every sample, got %v", got)
	}

	// A negative sample is clamped to 0 rather than dropped, so it lands in the
	// fastest bucket instead of silently vanishing from the distribution.
	ObserveDeliveryLatency(-5)
	if got := counter(reg, telemetry.MAuthoringDeliveryLatencySeconds, "le", "0.1"); got != 1 {
		t.Fatalf("clamped negative sample = %v, want 1", got)
	}
}

// The cardinality guard. Every helper is handed values that would open a hole
// if they reached a label: ids, revisions, uuids, and a content-shaped blob.
func TestNoIdLikeValueEverBecomesALabel(t *testing.T) {
	reg := withRegistry(t)
	leaks := []string{
		"exam-9f2b41",
		"user-42",
		"conn-abc123",
		"rev-77",
		"12345",
		"4f8a2c1e-9d3b-4a71-8c2f-7e6d5a4b3c2d",
		`{"prompt":"What is 2+2?","answer":"4"}`,
		"Alice Smith saved the question",
	}
	for _, leak := range leaks {
		EmitConnection(ConnectionResult(leak))
		EmitReconnect(ReconnectOutcome(leak))
		EmitDisconnect(DisconnectReason(leak))
		EmitDropped(DropStage(leak))
		EmitReplay(ReplayOutcome(leak))
		EmitResync(ResyncReason(leak))
		EmitDeliveryFailure(DeliveryFailureStage(leak))
		EmitConflict(ConflictOperation(leak))
		EmitInvariantViolation(InvariantViolation(leak))
	}

	for _, leak := range leaks {
		for _, series := range []struct {
			name  string
			pairs []string
		}{
			{telemetry.MAuthoringWSConnectionsTotal, []string{"result", leak}},
			{telemetry.MAuthoringReconnectsTotal, []string{"outcome", leak}},
			{telemetry.MAuthoringWSDisconnectsTotal, []string{"reason", leak}},
			{telemetry.MAuthoringWSEventsDroppedTotal, []string{"stage", leak}},
			{telemetry.MAuthoringReplayTotal, []string{"outcome", leak}},
			{telemetry.MAuthoringResyncTotal, []string{"reason", leak}},
			{telemetry.MAuthoringDeliveryFailuresTotal, []string{"stage", leak}},
			{telemetry.MAuthoringRevisionConflictsTotal, []string{"operation", leak}},
			{telemetry.MAuthoringInvariantViolationsTotal, []string{"invariant", leak}},
		} {
			if got := counter(reg, series.name, series.pairs...); got != 0 {
				t.Fatalf("series %s%v leaked a raw value (%v)", series.name, series.pairs, got)
			}
			if got := gauge(reg, series.name, series.pairs...); got != 0 {
				t.Fatalf("gauge %s%v leaked a raw value (%v)", series.name, series.pairs, got)
			}
		}
	}

	if got := counter(reg, telemetry.MAuthoringResyncTotal, "reason", ReasonOther); got != float64(len(leaks)) {
		t.Fatalf("resync other = %v, want %d (one per leak)", got, len(leaks))
	}
}

// The allow-list and the normalization sets are the same data; if they drift,
// the guard above silently stops guarding.
func TestCardinalityAllowListMatchesNormalization(t *testing.T) {
	sets := map[string]map[string]bool{
		"connection_result":   connectionResults,
		"reconnect_outcome":   reconnectOutcomes,
		"disconnect_reason":   disconnectReasons,
		"drop_stage":          dropStages,
		"replay_outcome":      replayOutcomes,
		"resync_reason":       resyncReasons,
		"delivery_stage":      deliveryStages,
		"conflict_operation":  conflictOperations,
		"invariant_violation": invariantViolations,
		"latency_bucket":      latencyBuckets,
	}
	allow := CardinalityAllowList()
	for name, values := range allow {
		set, ok := sets[name]
		if !ok {
			t.Fatalf("allow-list names unknown set %q", name)
		}
		if len(values) != len(set) {
			t.Fatalf("set %q has %d values but the allow-list has %d", name, len(set), len(values))
		}
		if len(values) == 0 {
			t.Fatalf("set %q is empty", name)
		}
		for _, v := range values {
			if !set[v] {
				t.Fatalf("allow-list value %q is not in set %q", v, name)
			}
			if normalize(v, set) != v {
				t.Fatalf("allow-listed value %q normalizes away", v)
			}
		}
	}
}

// Every authoring mutation the API observes must land in the conflict
// vocabulary, or a fence on that operation would be counted as `other`.
func TestConflictOperationForCoversEveryHandlerOperation(t *testing.T) {
	for _, operation := range []string{
		"publish", "workbook_commit", "create_question", "batch_create",
		"duplicate_question", "bulk", "save_revision",
	} {
		got := ConflictOperationFor(operation)
		if !conflictOperations[string(got)] || got == ConflictOperation(ReasonOther) {
			t.Fatalf("handler operation %q mapped to unlisted conflict operation %q", operation, got)
		}
	}
	if got := ConflictOperationFor("some_future_operation"); got != ConflictOperation(ReasonOther) {
		t.Fatalf("unknown operation must normalize to other, got %q", got)
	}
}

// Every Phase 06 series must be registered in telemetry.Names(), which is what
// the alert-parity test checks the rules against. A series that is emitted but
// unregistered cannot be alerted on.
func TestPhase06SeriesAreRegistered(t *testing.T) {
	registered := map[string]bool{}
	for _, name := range telemetry.Names() {
		registered[name] = true
	}
	for _, series := range []string{
		telemetry.MAuthoringWSConnectionsCurrent,
		telemetry.MAuthoringReconnectsTotal,
		telemetry.MAuthoringReplayTotal,
		telemetry.MAuthoringResyncTotal,
		telemetry.MAuthoringDeliveryFailuresTotal,
		telemetry.MAuthoringDeliveryLatencySeconds,
		telemetry.MAuthoringRevisionConflictsTotal,
		telemetry.MAuthoringInvariantViolationsTotal,
		telemetry.MAuthoringPresenceCurrent,
	} {
		if !registered[series] {
			t.Fatalf("series %q is emitted but not registered in telemetry.Names()", series)
		}
	}
}

// The retired gap series must be gone: leaving it registered would let someone
// alert on a series nothing emits, and reintroducing numeric-gap semantics is
// exactly the mistake this phase corrects.
func TestNoSequenceGapSeriesRemains(t *testing.T) {
	for _, name := range telemetry.Names() {
		if name == "authoring_sequence_gap_total" {
			t.Fatal("authoring_sequence_gap_total must not exist: cursors are not contiguous and gaps are not measured")
		}
		if name == "authoring_delivery_latency_ms" {
			t.Fatal("the latency gauge must not exist: a last-sample gauge cannot produce the p95 the rollout gate needs")
		}
	}
}
