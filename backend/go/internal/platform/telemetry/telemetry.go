// Package telemetry defines metric/log/trace conventions (plan 68-71).
// High-cardinality IDs stay in logs/traces, never in Prometheus labels.
package telemetry

var metricHelpText = map[string]string{
	MHTTPRequestsTotal: "Total HTTP requests by method, route, and status class.",
	MHTTPRequestDur:    "HTTP request duration in seconds.",
	MHTTPInFlight:      "Current number of in-flight HTTP requests.",
	MPoolOpen:          "Number of open database connections.",
	MPoolInUse:         "Number of database connections currently in use.",
	MPoolWait:          "Total number of waits for a database connection.",
	MQueryDur:          "Database query duration in seconds.",
	MTxDur:             "Database transaction duration in seconds.",
	MDeadlocks:         "Total number of database deadlocks.",
	MV2BatchTotal:      "Total v2 response batches by outcome.",
	MV2CommandsTotal:   "Total v2 response commands by outcome.",
	MV1MutationTotal:   "Total v1 mutation requests by outcome.",
	MV1SubmitTotal:     "Total v1 submit requests by outcome.",
	MLeaseFencedTotal:  "Total v2 responses rejected by lease fencing.",
	MControlStaleTotal: "Total v2 responses rejected for a stale control epoch.",
	MVersionCollTotal:  "Total v2 responses rejected for a version collision.",
	MSubmitReplayTotal: "Total replayed v2 submissions.",
	MTerminalCreated:   "Total terminalization receipts created.",
	MTerminalReplay:    "Total terminalization replays.",
	MTerminalConflict:  "Total terminalization conflicts.",
	MRepairMissing:     "Total missing terminal receipts repaired.",
	MInvariantViol:     "Total terminal-state invariant violations observed.",
	MOutboxPending:     "Current number of pending outbox events.",
	MOutboxOldestAge:   "Age in seconds of the oldest pending outbox event.",
	MJobDuration:       "Worker job duration in seconds.",
	MJobFailures:       "Total worker job failures.",
	MSATPendingAge:     "Age in seconds of the oldest provisional SAT result.",
	MProjectionLag:     "Grading projection lag in seconds.",
	MRatelimitDeniedTotal: "Total rate-limit denials by tier and key class.",
	MWSConnections:        "Current number of WebSocket connections.",
	MWSLeaseFailures:   "Total WebSocket lease acquisition failures.",
	MWSSlowDisconnect:  "Total WebSocket disconnects caused by slow clients.",
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

	MV2BatchTotal      = "v2_response_batch_total"
	MV2CommandsTotal   = "v2_response_commands_total"
	MV1MutationTotal   = "v1_mutation_requests_total"
	MV1SubmitTotal     = "v1_submit_requests_total"
	MLeaseFencedTotal  = "v2_lease_fenced_total"
	MControlStaleTotal = "v2_control_epoch_stale_total"
	MVersionCollTotal  = "v2_version_collision_total"
	MSubmitReplayTotal = "v2_submit_replay_total"

	MTerminalCreated  = "terminalization_created_total"
	MTerminalReplay   = "terminalization_replay_total"
	MTerminalConflict = "terminalization_conflict_total"
	MRepairMissing    = "missing_receipt_repair_total"
	MInvariantViol    = "terminal_invariant_violation_total"

	MOutboxPending   = "outbox_pending"
	MOutboxOldestAge = "outbox_oldest_age_seconds"
	MJobDuration     = "worker_job_duration_seconds"
	MJobFailures     = "worker_job_failures_total"
	MSATPendingAge   = "sat_provisional_pending_age_seconds"
	MProjectionLag   = "grading_projection_lag_seconds"

	MWSConnections    = "websocket_connections"
	MWSLeaseFailures  = "websocket_lease_acquire_failures_total"
	MWSSlowDisconnect = "websocket_slow_client_disconnects_total"

	MRatelimitDeniedTotal = "http_ratelimit_denied_total"
)

// V2 batch outcome label values.
const (
	OutcomeAccepted        = "accepted"
	OutcomeExactReplay     = "exact_replay"
	OutcomeLeaseFenced     = "lease_fenced"
	OutcomeControlStale    = "control_epoch_stale"
	OutcomeVersionConflict = "version_collision"
	OutcomeWriteConflict   = "write_id_conflict"
	OutcomeNotWritable     = "not_writable"
	OutcomeRejected        = "rejected"
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
