// Package telemetry defines metric/log/trace conventions (plan 68-71).
// High-cardinality IDs stay in logs/traces, never in Prometheus labels.
package telemetry

var metricHelpText = map[string]string{
	MHTTPRequestsTotal:              "Total HTTP requests by method, route, and status class.",
	MHTTPRequestDur:                 "HTTP request duration in seconds.",
	MHTTPInFlight:                   "Current number of in-flight HTTP requests.",
	MPoolOpen:                       "Number of open database connections.",
	MPoolInUse:                      "Number of database connections currently in use.",
	MPoolWait:                       "Total number of waits for a database connection.",
	MQueryDur:                       "Database query duration in seconds.",
	MTxDur:                          "Database transaction duration in seconds.",
	MDeadlocks:                      "Total number of database deadlocks.",
	MV2BatchTotal:                   "Total v2 response batches by outcome.",
	MV2CommandsTotal:                "Total v2 response commands by outcome.",
	MSATScoreSource:                 "Total SAT scoring passes by response source (v2 vs legacy fallback).",
	MSATScoreFallbackRows:           "Total SAT scoring rows answered from legacy gaps inside V2-owned passes.",
	MSATFinalizeTotal:               "Total SAT terminal finalizations by outcome (completed vs replayed vs rejected).",
	MSATHeartbeatTotal:              "Total SAT student heartbeats recorded by path (memory vs inline).",
	MSATStudentModuleSubmitRejected: "Total legacy SAT student module-submit calls rejected by server policy.",
	MSATResponseWriteAfterTerminal:  "Total fresh SAT response writes refused at or after a terminal deadline.",
	MSATResultQuestionDetailFailure: "Total SAT result question-detail reads that failed instead of returning an empty list.",
	MSATTimeoutFinalize:             "Total SAT modules finalized by authoritative timeout reconciliation.",
	MSATResponseReplayAfterTerminal: "Total exact SAT response replays served at or after the authoritative deadline.",
	MV1MutationTotal:                "Total v1 mutation requests by outcome.",
	MV1SubmitTotal:                  "Total v1 submit requests by outcome.",
	MLeaseFencedTotal:               "Total v2 responses rejected by lease fencing.",
	MControlStaleTotal:              "Total v2 responses rejected for a stale control epoch.",
	MVersionCollTotal:               "Total v2 responses rejected for a version collision.",
	MSubmitReplayTotal:              "Total replayed v2 submissions.",
	MTerminalCreated:                "Total terminalization receipts created.",
	MTerminalReplay:                 "Total terminalization replays.",
	MTerminalConflict:               "Total terminalization conflicts.",
	MRepairMissing:                  "Total missing terminal receipts repaired.",
	MInvariantViol:                  "Total terminal-state invariant violations observed.",
	MOutboxPending:                  "Current number of pending outbox events.",
	MOutboxOldestAge:                "Age in seconds of the oldest pending outbox event.",
	MJobDuration:                    "Worker job duration in seconds.",
	MJobFailures:                    "Total worker job failures.",
	MSATPendingAge:                  "Age in seconds of the oldest provisional SAT result.",
	MProjectionLag:                  "Grading projection lag in seconds.",
	MGradingProjectionCorrupt:       "Total corrupt grading result projections by column.",
	MRatelimitDeniedTotal:           "Total rate-limit denials by tier and key class.",
	MRatelimitDBErrorTotal:          "Total distributed rate-limit database errors by tier and key class.",
	MRatelimitCapacityTotal:         "Total rate-limit capacity rejections by tier and key class.",
	MAuthoringOpTotal:               "Total authoring mutations by operation and outcome (save, create, batch, bulk, commit, publish).",
	MAuthoringShellReadTotal:        "Total authoring shell reads by lifecycle state (ready, no_draft, exam_not_found, integrity_violation, failed). A no_draft read is a normal answer, not a fault.",
	MAuthoringDraftOpenTotal:        "Total explicit draft-open commands by outcome (opened, exam_not_found, conflict, no_source, integrity_violation, failed).",
	MAuthoringEventPublishTotal:     "Total authoring realtime events appended in-tx by operation and outcome.",
	MAuthoringEventPublishFailures:  "Total authoring realtime event append failures by operation (rolls the mutation back).", MAuthoringWSConnectionsCurrent: "Authoring sockets currently subscribed, sampled at every accept and close.",
	MAuthoringReconnectsTotal:          "Authoring resubscribe outcomes: resumed, snapshot_required, or rejected.",
	MAuthoringReplayTotal:              "Authoring replay requests by outcome: served, snapshot_required, or failed.",
	MAuthoringResyncTotal:              "Authoring resyncs by declared reason. This is the freshness SLI: the cursor model is global and filtered, so a skipped sequence value is NOT a loss and no numeric gap is ever measured.",
	MAuthoringDeliveryFailuresTotal:    "Authoring DELIVERY failures by stage: forwarder or socket. Canonical state is still correct when these move; a client reconnects and resyncs.",
	MAuthoringDeliveryLatencySeconds:   "Authoring event delivery latency as fixed-bucket counters (le label), so a p95 rollout gate is computable. Buckets are the question; a last-sample gauge could not answer it.",
	MAuthoringRevisionConflictsTotal:   "Authoring revision fences that rejected a write, by operation. Fencing is the correctness control; this is the pressure signal.",
	MAuthoringInvariantViolationsTotal: "Authoring correctness invariants that code DETECTED being violated, by invariant. Detection-only: absence of an increment is not proof of correctness, which is why fencing, constraints, and property tests carry the guarantee.",
	MAuthoringPresenceCurrent:          "Collaborators currently visible in authoring presence, counted server-side after TTL processing.",
	MWSConnections:                     "Current number of WebSocket connections.",
	MWSLeaseFailures:                   "Total WebSocket lease acquisition failures.",
	MWSSlowDisconnect:                  "Total WebSocket disconnects caused by slow clients.",
	MVersionCacheHit:                   "Total version-cache hits (D1 bootstrap fast path).",
	MVersionCacheMiss:                  "Total version-cache misses (D1 full N+1 loads).",
	MPresenceTouch:                     "Total presence memory touches (D2 zero-SQL beats).",
	MPresenceFlush:                     "Total presence flush batches (D2 60s drain).",
	MEntryGateAdmit:                    "Total entry-gate admissions (D3 check-ins).",
	MEntryGateQueued:                   "Total entry-gate bounded-retry 429s (D3).",
	MEntryGateCapacityTotal:            "Total entry-gate capacity rejections by tier and key class.",
	MStudentResumeProbeTotal:           "Authenticated SAT resume probes reaching the server session resolver.",
	MStudentResumeSuccessTotal:         "SAT resume probes resolved to a canonical student attempt.",
	MStudentResumeFailureTotal:         "SAT resume probe failures by bounded reason.",
	MStudentResumeRecoveryMS:           "Duration in milliseconds of the most recent SAT resume probe.",
	MRollupRefresh:                     "Total proctor rollup refreshes (D4 worker).",
	MRollupLag:                         "Freshness in seconds of the proctor rollup row (D4 lag).",
	MShedExam:                          "Total requests served under exam shed budgets (E2).",
	MQueryTimeout:                      "Total hot-path budget short-circuits (E1 503s).",
	MSessionCacheHit:                   "Total session-cache hits (A2 DB-touch skip).",
	MSessionCacheMiss:                  "Total session-cache misses (A2 DB reload).",
	MSnapshotCacheHit:                  "Total runtime-snapshot cache hits (B2 zero-SQL gate).",
	MSnapshotCacheMiss:                 "Total runtime-snapshot cache misses (B2 DB load).",
	MRuntimePollTotal:                  "Total runtime polls by result (200 delta vs 304 not-modified).",
	MAttemptVerify:                     "Total attempt-bearer verifications by mode and result.",
	MDupAttemptReplay:                  "Total check-in replays served from the existing attempt row (D3).",
	MPresenceDedupeHit:                 "Total presence in-memory mutation dedupe hits (D2).",
	MPresenceFlushRows:                 "Total presence rows flushed to the DB (D2 drain size).",
	MOutboxClaimed:                     "Total outbox events claimed by the worker.",
	MOutboxAcked:                       "Total outbox events acknowledged by the worker.",
	MCoeditGoFreezeRecovery:            "Total co-edit freezing rows recovered after their lifecycle lease expired.",
}

// Metric name constants (plan 69).
const (
	MHTTPRequestsTotal = "http_requests_total"
	MHTTPRequestDur    = "http_request_duration_seconds"
	MHTTPInFlight      = "http_in_flight"

	MPoolOpen  = "db_pool_open"
	MPoolInUse = "db_pool_in_use"
	MPoolWait  = "db_pool_wait_count"
	MQueryDur  = "db_query_duration_seconds"
	MTxDur     = "db_tx_duration_seconds"
	MDeadlocks = "db_deadlocks_total"

	MV2BatchTotal    = "v2_response_batch_total"
	MV2CommandsTotal = "v2_response_commands_total"
	MSATScoreSource  = "sat_score_source_total"
	// Exam-day re-audit defect 5: per-row legacy-gap counter so mixed
	// V2/legacy passes page instead of hiding under the v2 pass series.
	MSATScoreFallbackRows = "sat_score_fallback_rows_total"
	// Backend finalize/heartbeat series (exam-day re-audit observability
	// residual): the release must page on server-observed terminal outcomes,
	// not on frontend-emitted beacons that never arrive during an outage.
	MSATFinalizeTotal               = "sat_finalize_total"
	MSATHeartbeatTotal              = "sat_heartbeat_total"
	MSATStudentModuleSubmitRejected = "sat_student_module_submit_rejected_total"
	MSATResponseWriteAfterTerminal  = "sat_response_write_after_terminal_total"
	MSATResultQuestionDetailFailure = "sat_result_question_detail_failure_total"
	MSATTimeoutFinalize             = "sat_timeout_finalize_total"
	MSATResponseReplayAfterTerminal = "sat_response_replay_after_terminal_total"
	MV1MutationTotal                = "v1_mutation_requests_total"
	MV1SubmitTotal                  = "v1_submit_requests_total"
	MLeaseFencedTotal               = "v2_lease_fenced_total"
	MControlStaleTotal              = "v2_control_epoch_stale_total"
	MVersionCollTotal               = "v2_version_collision_total"
	MSubmitReplayTotal              = "v2_submit_replay_total"

	MTerminalCreated  = "terminalization_created_total"
	MTerminalReplay   = "terminalization_replay_total"
	MTerminalConflict = "terminalization_conflict_total"
	MRepairMissing    = "missing_receipt_repair_total"
	MInvariantViol    = "terminal_invariant_violation_total"

	MOutboxPending            = "outbox_pending"
	MOutboxOldestAge          = "outbox_oldest_age_seconds"
	MJobDuration              = "worker_job_duration_seconds"
	MJobFailures              = "worker_job_failures_total"
	MSATPendingAge            = "sat_provisional_pending_age_seconds"
	MProjectionLag            = "grading_projection_lag_seconds"
	MGradingProjectionCorrupt = "grading_projection_corrupt_total"

	MWSConnections    = "websocket_connections"
	MWSLeaseFailures  = "websocket_lease_acquire_failures_total"
	MWSSlowDisconnect = "websocket_slow_client_disconnects_total"

	MVersionCacheHit           = "version_cache_hit_total"
	MVersionCacheMiss          = "version_cache_miss_total"
	MPresenceTouch             = "presence_touch_total"
	MPresenceFlush             = "presence_flush_total"
	MEntryGateAdmit            = "entry_gate_admit_total"
	MEntryGateQueued           = "entry_gate_queued_total"
	MEntryGateCapacityTotal    = "http_entry_gate_capacity_rejected_total"
	MStudentResumeProbeTotal   = "student_resume_probe_total"
	MStudentResumeSuccessTotal = "student_resume_success_total"
	MStudentResumeFailureTotal = "student_resume_failure_total"
	MStudentResumeRecoveryMS   = "student_resume_recovery_ms"
	MRollupRefresh             = "proctor_rollup_refresh_total"
	MRollupLag                 = "proctor_rollup_lag_seconds"
	MShedExam                  = "shed_exam_requests_total"
	MQueryTimeout              = "query_budget_exhausted_total"

	MSessionCacheHit = "session_cache_hit_total"
	// MAssessmentConflict counts structured SAT delivery conflicts by their
	// stable reason code (RUNTIME_NOT_LIVE, DEADLINE_EXPIRED,
	// SECTION_NOT_ACTIVE, ...). Exam-day reading: a waiting room that spams a
	// control flow produces this series, so a read/write state contract that
	// diverges again is visible as a metric instead of only in logs. Label is
	// the reason vocabulary only — never ids, never messages.
	MAssessmentConflict = "assessment_conflict_total"

	MSessionCacheMiss  = "session_cache_miss_total"
	MSnapshotCacheHit  = "runtime_snapshot_hit_total"
	MSnapshotCacheMiss = "runtime_snapshot_miss_total"
	MRuntimePollTotal  = "runtime_poll_total"
	MAttemptVerify     = "attempt_verify_total"
	MDupAttemptReplay  = "duplicate_attempt_replay_total"
	MPresenceDedupeHit = "presence_dedupe_hit_total"
	MPresenceFlushRows = "presence_flush_rows_total"
	MOutboxClaimed     = "outbox_claimed_total"
	MOutboxAcked       = "outbox_acked_total"

	MRatelimitDeniedTotal   = "http_ratelimit_denied_total"
	MRatelimitDBErrorTotal  = "http_ratelimit_db_error_total"
	MRatelimitCapacityTotal = "http_ratelimit_capacity_rejected_total"

	MAuthoringOpTotal = "authoring_operation_total"
	// Shell lifecycle series. `state` is the answer the read returned and
	// `outcome` is how the explicit open ended; both are closed vocabularies
	// (see the ShellState* / DraftOpen* label values below). A NO_DRAFT read is
	// counted here as the normal lifecycle answer it is — it must never reach
	// an error series, a console error, or a server exception log.
	MAuthoringShellReadTotal  = "authoring_shell_reads_total"
	MAuthoringDraftOpenTotal  = "authoring_draft_open_total"
	MAuthoringExamNotFound    = "exam_not_found"
	MAuthoringIntegrityFailed = "integrity_violation"
	// Phase 02 publish-side series: outcome rate of the in-tx event append,
	// independent of the mutation outcome mix. Low-cardinality labels
	// (operation + outcome) only; ids stay in logs/traces.
	MAuthoringEventPublishTotal    = "authoring_event_publish_total"
	MAuthoringEventPublishFailures = "authoring_event_publish_failures_total"

	// Phase 03 authoring realtime delivery. Low-cardinality labels only:
	// operation/path/reason. Exam, draft, user, and event ids stay in logs
	// and traces, never in a series label.
	MAuthoringWSConnectionsTotal     = "authoring_ws_connections_total"
	MAuthoringWSEventsPublishedTotal = "authoring_ws_events_published_total"
	MAuthoringWSEventsReceivedTotal  = "authoring_ws_events_received_total"
	MAuthoringWSEventsDroppedTotal   = "authoring_ws_events_dropped_total"
	MAuthoringWSDisconnectsTotal     = "authoring_ws_disconnects_total"
	MAuthoringWSFramesIgnoredTotal   = "authoring_ws_frames_ignored_total"

	// Phase 05 authoring presence. Presence is advisory, so these counters are
	// the only way to notice a silently dead channel: published counts frames
	// fanned out, dropped counts frames shed for congested peers, peers counts
	// admitted connections, and rejected counts frames refused because
	// presence was not negotiated.
	MAuthoringPresencePublishedTotal = "authoring_presence_published_total"
	MAuthoringPresenceDroppedTotal   = "authoring_presence_dropped_total"
	MAuthoringPresencePeersTotal     = "authoring_presence_peers_total"
	MAuthoringPresenceRejectedTotal  = "authoring_presence_rejected_total"

	// Phase 06 verification plus observability. These close the gaps the
	// earlier phases left: they had counters for what happened but no gauge for
	// how much is live, no latency sample, and no dedicated series for the
	// correctness-adjacent events (a fence rejection or a failed in-tx append)
	// that must be alertable on their own.
	//
	// Two Phase 06 series names from the plan are deliberately NOT duplicated
	// here, because an equivalent series already exists and a second one would
	// only fork dashboards: `authoring_events_published_total` is covered by
	// MAuthoringEventPublishTotal, and `authoring_events_dropped_total{stage}`
	// by MAuthoringWSEventsDroppedTotal{reason}. The runbook carries the mapping
	// table. Labels stay bounded exactly as everywhere else: an id-ish label
	// value is normalized to `other` by authoringrealtime/metrics.go rather than
	// ever being emitted.
	MAuthoringWSConnectionsCurrent     = "authoring_ws_connections_current"
	MAuthoringReconnectsTotal          = "authoring_reconnects_total"
	MAuthoringReplayTotal              = "authoring_replay_total"
	MAuthoringResyncTotal              = "authoring_resync_total"
	MAuthoringDeliveryFailuresTotal    = "authoring_delivery_failures_total"
	MAuthoringDeliveryLatencySeconds   = "authoring_delivery_latency_seconds"
	MAuthoringRevisionConflictsTotal   = "authoring_revision_conflicts_total"
	MAuthoringInvariantViolationsTotal = "authoring_invariant_violations_total"
	MAuthoringPresenceCurrent          = "authoring_presence_current"

	// Phase 02 ACT observability (AT02-07/AT02-10/AT02-11): provider-tagged
	// ACT counters. Tag values stay low-cardinality (provider="act",
	// section="science", outcome labels from the block below); attempt,
	// schedule, user, and question ids belong in logs/traces, never here.
	MACTScoreTotal    = "act_score_total"
	MACTScoreFailure  = "act_score_failure_total"
	MACTResultTotal   = "act_result_total"
	MACTResultFailure = "act_result_failure_total"

	// SAT prompt co-editing (2026-09-13 design). The Go side owns token
	// issuance, the atomic store endpoint, the partial field patch path, and
	// the publish freeze/manifest verification. The Hocuspocus service exposes
	// the authoring_coedit_* process metrics (lock, connections, documents,
	// store, freeze, shutdown) plus its own auth prefix. Labels here stay a
	// closed vocabulary (outcome, reason); ids, hashes, revisions, and content
	// never become labels.
	MCoeditTokenTotal          = "authoring_coedit_token_total"
	MCoeditGoStoreTotal        = "authoring_coedit_go_store_total"
	MCoeditGoFieldPatchTotal   = "authoring_coedit_go_field_patch_total"
	MCoeditGoGuardTotal        = "authoring_coedit_go_guard_total"
	MCoeditGoLifecycleTotal    = "authoring_coedit_go_lifecycle_total"
	MCoeditGoFreezeManifestMis = "authoring_coedit_go_manifest_mismatch_total"
	MCoeditGoFreezeRecovery    = "authoring_coedit_go_freeze_recovery_total"
)

// V2 batch outcome label values.
const (
	SATScoreV2        = "v2"
	SATScoreLegacy    = "legacy"
	FinalizeCompleted = "completed"
	FinalizeReplayed  = "replayed"
	FinalizeRejected  = "rejected"
	HeartbeatMemory   = "memory"
	HeartbeatInline   = "inline"
	// SATScoreZero labels zero-answer scoring silence: a pass with questions
	// but no response row from either source. Pages on the same fallback
	// series so one alert covers both gap classes.
	SATScoreZero = "zero"

	OutcomeAccepted        = "accepted"
	OutcomeExactReplay     = "exact_replay"
	OutcomeLeaseFenced     = "lease_fenced"
	OutcomeControlStale    = "control_epoch_stale"
	OutcomeVersionConflict = "version_collision"
	OutcomeWriteConflict   = "write_id_conflict"
	OutcomeNotWritable     = "not_writable"
	OutcomeRejected        = "rejected"
	// OutcomeRetriedAccepted marks a batch that absorbed >=1 transient
	// (deadlock/lock-wait, counted on db_deadlocks_total{kind}) then
	// committed. Without it a contended wave looks identical to a clean
	// one on v2_response_batch_total{outcome}. Low-cardinality (I5).
	OutcomeRetriedAccepted = "retried_accepted"
)

// LogField keys for structured JSON logs (plan 70). Secrets, bearer tokens,
// answers and writing bodies must never be logged.
const (
	FRequestID = "request_id"
	FTraceID   = "trace_id"
	FRoute     = "route"
	FMethod    = "method"
	FStatus    = "status"
	FLatencyMs = "latency_ms"
	FActor     = "actor_class"
)

// Names returns every metric series name the backend can emit (WS-10a:
// alert-parity registry of record). The alert-parity test asserts every
// metric referenced in backend/monitoring/prometheus-alert-rules.yml
// appears here, so a rule can never again point at a series nothing
// emits. Keep in sync when adding a series: declare the M* constant
// above AND append it here (the test fails otherwise).
func Names() []string {
	return []string{
		MHTTPRequestsTotal,
		MHTTPRequestDur,
		MHTTPInFlight,
		MPoolOpen,
		MPoolInUse,
		MPoolWait,
		MQueryDur,
		MTxDur,
		MDeadlocks,
		MV2BatchTotal,
		MV2CommandsTotal,
		MSATScoreSource,
		MSATScoreFallbackRows,
		MSATFinalizeTotal,
		MSATHeartbeatTotal,
		MSATStudentModuleSubmitRejected,
		MSATResponseWriteAfterTerminal,
		MSATResultQuestionDetailFailure,
		MSATTimeoutFinalize,
		MSATResponseReplayAfterTerminal,
		MV1MutationTotal,
		MV1SubmitTotal,
		MLeaseFencedTotal,
		MControlStaleTotal,
		MVersionCollTotal,
		MSubmitReplayTotal,
		MTerminalCreated,
		MTerminalReplay,
		MTerminalConflict,
		MRepairMissing,
		MInvariantViol,
		MOutboxPending,
		MOutboxOldestAge,
		MJobDuration,
		MJobFailures,
		MSATPendingAge,
		MProjectionLag,
		MGradingProjectionCorrupt,
		MWSConnections,
		MWSLeaseFailures,
		MWSSlowDisconnect,
		MVersionCacheHit,
		MVersionCacheMiss,
		MPresenceTouch,
		MPresenceFlush,
		MEntryGateAdmit,
		MEntryGateQueued,
		MEntryGateCapacityTotal,
		MStudentResumeProbeTotal,
		MStudentResumeSuccessTotal,
		MStudentResumeFailureTotal,
		MStudentResumeRecoveryMS,
		MRollupRefresh,
		MRollupLag,
		MShedExam,
		MQueryTimeout,
		MSessionCacheHit,
		MSessionCacheMiss,
		MSnapshotCacheHit,
		MSnapshotCacheMiss,
		MRuntimePollTotal,
		MAttemptVerify,
		MDupAttemptReplay,
		MPresenceDedupeHit,
		MPresenceFlushRows,
		MOutboxClaimed,
		MOutboxAcked,
		MRatelimitDeniedTotal,
		MRatelimitDBErrorTotal,
		MRatelimitCapacityTotal,
		MAuthoringOpTotal,
		MAuthoringShellReadTotal,
		MAuthoringDraftOpenTotal,
		MAuthoringEventPublishTotal,
		MAuthoringEventPublishFailures,
		MAuthoringWSConnectionsTotal,
		MAuthoringWSEventsPublishedTotal,
		MAuthoringWSEventsReceivedTotal,
		MAuthoringWSEventsDroppedTotal,
		MAuthoringWSDisconnectsTotal,
		MAuthoringWSFramesIgnoredTotal,
		MAuthoringPresencePublishedTotal,
		MAuthoringPresenceDroppedTotal,
		MAuthoringPresencePeersTotal,
		MAuthoringPresenceRejectedTotal,
		MAuthoringWSConnectionsCurrent,
		MAuthoringReconnectsTotal,
		MAuthoringReplayTotal,
		MAuthoringResyncTotal,
		MAuthoringDeliveryFailuresTotal,
		MAuthoringDeliveryLatencySeconds,
		MAuthoringRevisionConflictsTotal,
		MAuthoringInvariantViolationsTotal,
		MAuthoringPresenceCurrent,
		MACTScoreTotal,
		MACTScoreFailure,
		MACTResultTotal,
		MACTResultFailure,
		MCoeditTokenTotal,
		MCoeditGoStoreTotal,
		MCoeditGoFieldPatchTotal,
		MCoeditGoGuardTotal,
		MCoeditGoLifecycleTotal,
		MCoeditGoFreezeManifestMis,
		MCoeditGoFreezeRecovery,
	}
}
