use std::{
    fmt,
    sync::{atomic::AtomicI64, Arc, Mutex},
    time::Duration,
};

use crate::database_monitor::GradingProjectionSnapshot;
use prometheus_client::{
    encoding::{text::encode, EncodeLabelSet},
    metrics::{
        counter::Counter,
        family::Family,
        gauge::Gauge,
        histogram::{exponential_buckets, Histogram},
    },
    registry::Registry,
};

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
struct HttpRequestLabels {
    method: String,
    route: String,
    status: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
struct OperationLabels {
    operation: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
struct OutcomeLabels {
    outcome: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
struct ThresholdLabels {
    level: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
struct ProjectionEntityLabels {
    entity: String,
}

#[derive(Debug, Clone, Default)]
struct ProjectionTotals {
    schedule: u64,
    submission: u64,
    section: u64,
    writing_task: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProcessMemoryProfile {
    pub resident_bytes: u64,
    pub resident_high_water_mark_bytes: u64,
    pub virtual_memory_bytes: u64,
    pub heap_bytes: u64,
    pub swap_bytes: u64,
}

#[derive(Clone)]
pub struct Telemetry {
    registry: Arc<Mutex<Registry>>,
    http_request_latency: Family<HttpRequestLabels, Histogram>,
    db_operation_latency: Family<OperationLabels, Histogram>,
    publish_validation_latency: Family<OutcomeLabels, Histogram>,
    answer_commit_latency: Family<OutcomeLabels, Histogram>,
    mutation_batch_requested_count: Histogram,
    mutation_batch_applied_count: Histogram,
    mutation_batch_persisted_count: Histogram,
    mutation_batch_zero_persistence_total: Counter,
    submit_final_patch_applied_total: Counter,
    submit_missing_seq_total: Counter,
    final_snapshot_hash_mismatch_total: Counter,
    student_answer_loss_risk_total: Family<OutcomeLabels, Counter>,
    submit_replay_incomplete_total: Counter,
    post_submit_grace_accepted_total: Counter,
    post_submit_grace_rejected_total: Counter,
    violation_to_alert_latency: Histogram,
    websocket_connections: Gauge<i64, AtomicI64>,
    outbox_backlog_events: Gauge<i64, AtomicI64>,
    outbox_oldest_age_seconds: Gauge<i64, AtomicI64>,
    storage_budget_bytes: Gauge<i64, AtomicI64>,
    storage_budget_level: Gauge<i64, AtomicI64>,
    process_resident_memory_bytes: Gauge<i64, AtomicI64>,
    process_resident_memory_high_water_mark_bytes: Gauge<i64, AtomicI64>,
    process_virtual_memory_bytes: Gauge<i64, AtomicI64>,
    process_heap_memory_bytes: Gauge<i64, AtomicI64>,
    process_swap_memory_bytes: Gauge<i64, AtomicI64>,
    process_memory_profile_collection_failures: Counter,
    rate_limiter_buckets: Gauge<i64, AtomicI64>,
    request_route_fallback_total: Counter,
    background_wake_duration: Family<OutcomeLabels, Histogram>,
    background_wake_failures: Family<OutcomeLabels, Counter>,
    storage_budget_threshold_hits: Family<ThresholdLabels, Counter>,
    grading_projection_lag_seconds: Gauge<i64, AtomicI64>,
    grading_projection_cycle_duration_seconds: Histogram,
    grading_projection_rows_processed_total: Family<ProjectionEntityLabels, Counter>,
    grading_projection_failures_total: Counter,
    projection_last_totals: Arc<Mutex<ProjectionTotals>>,
    projection_last_failures_total: Arc<Mutex<u64>>,
}

impl fmt::Debug for Telemetry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_struct("Telemetry").finish_non_exhaustive()
    }
}

impl Default for Telemetry {
    fn default() -> Self {
        Self::new()
    }
}

impl Telemetry {
    pub fn new() -> Self {
        let http_request_latency =
            Family::<HttpRequestLabels, Histogram>::new_with_constructor(|| {
                Histogram::new(exponential_buckets(0.005, 2.0, 16))
            });
        let db_operation_latency =
            Family::<OperationLabels, Histogram>::new_with_constructor(|| {
                Histogram::new(exponential_buckets(0.001, 2.0, 16))
            });
        let publish_validation_latency =
            Family::<OutcomeLabels, Histogram>::new_with_constructor(|| {
                Histogram::new(exponential_buckets(0.001, 2.0, 14))
            });
        let answer_commit_latency =
            Family::<OutcomeLabels, Histogram>::new_with_constructor(|| {
                Histogram::new(exponential_buckets(0.001, 2.0, 14))
            });
        let mutation_batch_requested_count = Histogram::new(exponential_buckets(1.0, 2.0, 10));
        let mutation_batch_applied_count = Histogram::new(exponential_buckets(1.0, 2.0, 10));
        let mutation_batch_persisted_count = Histogram::new(exponential_buckets(1.0, 2.0, 10));
        let mutation_batch_zero_persistence_total = Counter::default();
        let submit_final_patch_applied_total = Counter::default();
        let submit_missing_seq_total = Counter::default();
        let final_snapshot_hash_mismatch_total = Counter::default();
        let student_answer_loss_risk_total = Family::<OutcomeLabels, Counter>::default();
        let submit_replay_incomplete_total = Counter::default();
        let post_submit_grace_accepted_total = Counter::default();
        let post_submit_grace_rejected_total = Counter::default();
        let violation_to_alert_latency = Histogram::new(exponential_buckets(0.001, 2.0, 14));
        let websocket_connections = Gauge::<i64, AtomicI64>::default();
        let outbox_backlog_events = Gauge::<i64, AtomicI64>::default();
        let outbox_oldest_age_seconds = Gauge::<i64, AtomicI64>::default();
        let storage_budget_bytes = Gauge::<i64, AtomicI64>::default();
        let storage_budget_level = Gauge::<i64, AtomicI64>::default();
        let process_resident_memory_bytes = Gauge::<i64, AtomicI64>::default();
        let process_resident_memory_high_water_mark_bytes = Gauge::<i64, AtomicI64>::default();
        let process_virtual_memory_bytes = Gauge::<i64, AtomicI64>::default();
        let process_heap_memory_bytes = Gauge::<i64, AtomicI64>::default();
        let process_swap_memory_bytes = Gauge::<i64, AtomicI64>::default();
        let process_memory_profile_collection_failures = Counter::default();
        let rate_limiter_buckets = Gauge::<i64, AtomicI64>::default();
        let request_route_fallback_total = Counter::default();
        let background_wake_duration =
            Family::<OutcomeLabels, Histogram>::new_with_constructor(|| {
                Histogram::new(exponential_buckets(0.001, 2.0, 16))
            });
        let background_wake_failures = Family::<OutcomeLabels, Counter>::default();
        let storage_budget_threshold_hits = Family::<ThresholdLabels, Counter>::default();
        let grading_projection_lag_seconds = Gauge::<i64, AtomicI64>::default();
        let grading_projection_cycle_duration_seconds =
            Histogram::new(exponential_buckets(0.001, 2.0, 14));
        let grading_projection_rows_processed_total =
            Family::<ProjectionEntityLabels, Counter>::default();
        let grading_projection_failures_total = Counter::default();

        let mut registry = Registry::default();
        registry.register(
            "backend_http_request_duration_seconds",
            "HTTP request latency by method, normalized route, and status code.",
            http_request_latency.clone(),
        );
        registry.register(
            "backend_db_operation_duration_seconds",
            "Measured database-backed operation latency.",
            db_operation_latency.clone(),
        );
        registry.register(
            "backend_publish_validation_duration_seconds",
            "Publish validation latency grouped by outcome.",
            publish_validation_latency.clone(),
        );
        registry.register(
            "backend_answer_commit_duration_seconds",
            "Answer mutation and submit durability latency grouped by outcome.",
            answer_commit_latency.clone(),
        );
        registry.register(
            "backend_mutation_batch_requested_count",
            "Requested mutation command count per accepted student mutation batch.",
            mutation_batch_requested_count.clone(),
        );
        registry.register(
            "backend_mutation_batch_applied_count",
            "Applied mutation count per accepted student mutation batch.",
            mutation_batch_applied_count.clone(),
        );
        registry.register(
            "backend_mutation_batch_persisted_count",
            "Persisted mutation-row count per accepted student mutation batch.",
            mutation_batch_persisted_count.clone(),
        );
        registry.register(
            "backend_mutation_batch_zero_persistence_total",
            "Count of accepted mutation batches where applied mutations were non-zero but persisted rows were zero.",
            mutation_batch_zero_persistence_total.clone(),
        );
        registry.register(
            "backend_submit_final_patch_applied_total",
            "Count of submit requests that carried and applied a final answer patch.",
            submit_final_patch_applied_total.clone(),
        );
        registry.register(
            "backend_submit_missing_seq_total",
            "Count of submit conflicts caused by missing final flush sequence metadata.",
            submit_missing_seq_total.clone(),
        );
        registry.register(
            "backend_final_snapshot_hash_mismatch_total",
            "Count of submit conflicts caused by final snapshot hash mismatch.",
            final_snapshot_hash_mismatch_total.clone(),
        );
        registry.register(
            "student_answer_loss_risk_total",
            "Count of submit-time answer loss risk signals grouped by reason.",
            student_answer_loss_risk_total.clone(),
        );
        registry.register(
            "backend_submit_replay_incomplete_total",
            "Count of submits where client-final sequence exceeded server-accepted sequence at seal time.",
            submit_replay_incomplete_total.clone(),
        );
        registry.register(
            "backend_post_submit_grace_accepted_total",
            "Count of mutation batches accepted during the post-submit grace window.",
            post_submit_grace_accepted_total.clone(),
        );
        registry.register(
            "backend_post_submit_grace_rejected_total",
            "Count of mutation batches rejected because the post-submit grace window elapsed.",
            post_submit_grace_rejected_total.clone(),
        );
        registry.register(
            "backend_violation_to_alert_duration_seconds",
            "Observed latency between alert-worthy audit timestamps and proctor alert reads.",
            violation_to_alert_latency.clone(),
        );
        registry.register(
            "backend_websocket_connections",
            "Active websocket connections tracked by this process.",
            websocket_connections.clone(),
        );
        registry.register(
            "backend_outbox_backlog_events",
            "Number of unpublished outbox rows pending fan-out.",
            outbox_backlog_events.clone(),
        );
        registry.register(
            "backend_outbox_oldest_age_seconds",
            "Age in seconds of the oldest unpublished outbox row.",
            outbox_oldest_age_seconds.clone(),
        );
        registry.register(
            "backend_storage_budget_bytes",
            "Current database size in bytes.",
            storage_budget_bytes.clone(),
        );
        registry.register(
            "backend_storage_budget_level",
            "Storage budget severity encoded as 0=normal, 1=warning, 2=high_water, 3=critical.",
            storage_budget_level.clone(),
        );
        registry.register(
            "backend_process_resident_memory_bytes",
            "Resident memory (RSS) in bytes for this process.",
            process_resident_memory_bytes.clone(),
        );
        registry.register(
            "backend_process_resident_memory_high_water_mark_bytes",
            "Peak resident memory (VmHWM) in bytes for this process.",
            process_resident_memory_high_water_mark_bytes.clone(),
        );
        registry.register(
            "backend_process_virtual_memory_bytes",
            "Virtual memory size (VmSize) in bytes for this process.",
            process_virtual_memory_bytes.clone(),
        );
        registry.register(
            "backend_process_heap_memory_bytes",
            "Data segment memory (VmData) in bytes for this process.",
            process_heap_memory_bytes.clone(),
        );
        registry.register(
            "backend_process_swap_memory_bytes",
            "Swap memory usage (VmSwap) in bytes for this process.",
            process_swap_memory_bytes.clone(),
        );
        registry.register(
            "backend_process_memory_profile_collection_failures_total",
            "Count of process memory profile collection failures.",
            process_memory_profile_collection_failures.clone(),
        );
        registry.register(
            "backend_rate_limiter_buckets",
            "Number of active in-memory rate limiter buckets.",
            rate_limiter_buckets.clone(),
        );
        registry.register(
            "backend_request_route_fallback_total",
            "Count of requests where metrics route labeling fell back to path bucketing.",
            request_route_fallback_total.clone(),
        );
        registry.register(
            "backend_background_wake_duration_seconds",
            "Time spent waiting for activity-driven critical recovery, grouped by outcome.",
            background_wake_duration.clone(),
        );
        registry.register(
            "backend_background_wake_failures",
            "Count of activity-driven wake failures, grouped by outcome.",
            background_wake_failures.clone(),
        );
        registry.register(
            "backend_storage_budget_threshold_hits_total",
            "Number of times storage budget checks have hit a given severity.",
            storage_budget_threshold_hits.clone(),
        );
        registry.register(
            "backend_grading_projection_lag_seconds",
            "Observed lag between source attempt updates and grading projection watermark.",
            grading_projection_lag_seconds.clone(),
        );
        registry.register(
            "backend_grading_projection_cycle_duration_seconds",
            "Observed grading projection cycle duration.",
            grading_projection_cycle_duration_seconds.clone(),
        );
        registry.register(
            "backend_grading_projection_rows_processed_total",
            "Total projected rows processed, grouped by entity.",
            grading_projection_rows_processed_total.clone(),
        );
        registry.register(
            "backend_grading_projection_failures_total",
            "Total grading projection cycle failures.",
            grading_projection_failures_total.clone(),
        );

        Self {
            registry: Arc::new(Mutex::new(registry)),
            http_request_latency,
            db_operation_latency,
            publish_validation_latency,
            answer_commit_latency,
            mutation_batch_requested_count,
            mutation_batch_applied_count,
            mutation_batch_persisted_count,
            mutation_batch_zero_persistence_total,
            submit_final_patch_applied_total,
            submit_missing_seq_total,
            final_snapshot_hash_mismatch_total,
            student_answer_loss_risk_total,
            submit_replay_incomplete_total,
            post_submit_grace_accepted_total,
            post_submit_grace_rejected_total,
            violation_to_alert_latency,
            websocket_connections,
            outbox_backlog_events,
            outbox_oldest_age_seconds,
            storage_budget_bytes,
            storage_budget_level,
            process_resident_memory_bytes,
            process_resident_memory_high_water_mark_bytes,
            process_virtual_memory_bytes,
            process_heap_memory_bytes,
            process_swap_memory_bytes,
            process_memory_profile_collection_failures,
            rate_limiter_buckets,
            request_route_fallback_total,
            background_wake_duration,
            background_wake_failures,
            storage_budget_threshold_hits,
            grading_projection_lag_seconds,
            grading_projection_cycle_duration_seconds,
            grading_projection_rows_processed_total,
            grading_projection_failures_total,
            projection_last_totals: Arc::new(Mutex::new(ProjectionTotals::default())),
            projection_last_failures_total: Arc::new(Mutex::new(0)),
        }
    }

    pub fn observe_request(&self, method: &str, route: &str, status: u16, duration: Duration) {
        let labels = HttpRequestLabels {
            method: method.to_owned(),
            route: route.to_owned(),
            status: status.to_string(),
        };
        self.http_request_latency
            .get_or_create(&labels)
            .observe(duration.as_secs_f64());
    }

    pub fn observe_db_operation(&self, operation: &str, duration: Duration) {
        let labels = OperationLabels {
            operation: operation.to_owned(),
        };
        self.db_operation_latency
            .get_or_create(&labels)
            .observe(duration.as_secs_f64());
    }

    pub fn observe_publish_validation(&self, outcome: &str, duration: Duration) {
        let labels = OutcomeLabels {
            outcome: outcome.to_owned(),
        };
        self.publish_validation_latency
            .get_or_create(&labels)
            .observe(duration.as_secs_f64());
    }

    pub fn observe_answer_commit(&self, outcome: &str, duration: Duration) {
        let labels = OutcomeLabels {
            outcome: outcome.to_owned(),
        };
        self.answer_commit_latency
            .get_or_create(&labels)
            .observe(duration.as_secs_f64());
    }

    pub fn observe_mutation_batch_persistence(
        &self,
        requested_count: usize,
        applied_count: usize,
        persisted_count: usize,
    ) {
        self.mutation_batch_requested_count
            .observe(requested_count as f64);
        self.mutation_batch_applied_count
            .observe(applied_count as f64);
        self.mutation_batch_persisted_count
            .observe(persisted_count as f64);

        if requested_count > 0 && applied_count > 0 && persisted_count == 0 {
            self.mutation_batch_zero_persistence_total.inc();
        }
    }

    pub fn observe_submit_final_patch_applied(&self) {
        self.submit_final_patch_applied_total.inc();
    }

    pub fn observe_submit_missing_seq(&self) {
        self.submit_missing_seq_total.inc();
    }

    pub fn observe_submit_final_snapshot_hash_mismatch(&self) {
        self.final_snapshot_hash_mismatch_total.inc();
    }

    pub fn observe_student_answer_loss_risk(&self, reason: &str) {
        self.student_answer_loss_risk_total
            .get_or_create(&OutcomeLabels {
                outcome: reason.to_owned(),
            })
            .inc();
    }

    pub fn observe_submit_replay_incomplete(&self) {
        self.submit_replay_incomplete_total.inc();
    }

    pub fn observe_post_submit_grace_accepted(&self) {
        self.post_submit_grace_accepted_total.inc();
    }

    pub fn observe_post_submit_grace_rejected(&self) {
        self.post_submit_grace_rejected_total.inc();
    }

    pub fn observe_violation_to_alert(&self, duration: Duration) {
        self.violation_to_alert_latency
            .observe(duration.as_secs_f64());
    }

    pub fn set_websocket_connections(&self, count: i64) {
        self.websocket_connections.set(count.max(0));
    }

    pub fn observe_outbox_backlog(&self, pending_count: u64, oldest_age_seconds: i64) {
        self.outbox_backlog_events
            .set(i64::try_from(pending_count).unwrap_or(i64::MAX));
        self.outbox_oldest_age_seconds
            .set(oldest_age_seconds.max(0));
    }

    pub fn set_process_resident_memory_bytes(&self, resident_bytes: u64) {
        self.process_resident_memory_bytes
            .set(i64::try_from(resident_bytes).unwrap_or(i64::MAX));
    }

    pub fn set_process_memory_profile(&self, profile: &ProcessMemoryProfile) {
        self.set_process_resident_memory_bytes(profile.resident_bytes);
        self.process_resident_memory_high_water_mark_bytes
            .set(i64::try_from(profile.resident_high_water_mark_bytes).unwrap_or(i64::MAX));
        self.process_virtual_memory_bytes
            .set(i64::try_from(profile.virtual_memory_bytes).unwrap_or(i64::MAX));
        self.process_heap_memory_bytes
            .set(i64::try_from(profile.heap_bytes).unwrap_or(i64::MAX));
        self.process_swap_memory_bytes
            .set(i64::try_from(profile.swap_bytes).unwrap_or(i64::MAX));
    }

    pub fn observe_process_memory_profile_collection_failure(&self) {
        self.process_memory_profile_collection_failures.inc();
    }

    pub fn set_rate_limiter_bucket_count(&self, buckets: usize) {
        self.rate_limiter_buckets
            .set(i64::try_from(buckets).unwrap_or(i64::MAX));
    }

    pub fn observe_request_route_fallback(&self) {
        self.request_route_fallback_total.inc();
    }

    pub fn observe_background_wake(&self, outcome: &str, duration: Duration) {
        let labels = OutcomeLabels {
            outcome: outcome.to_owned(),
        };
        self.background_wake_duration
            .get_or_create(&labels)
            .observe(duration.as_secs_f64());
        if outcome != "success" {
            self.background_wake_failures.get_or_create(&labels).inc();
        }
    }

    pub fn observe_storage_budget(&self, total_bytes: u64, level_label: &str, severity_code: i64) {
        self.storage_budget_bytes
            .set(i64::try_from(total_bytes).unwrap_or(i64::MAX));
        self.storage_budget_level.set(severity_code.max(0));
        self.storage_budget_threshold_hits
            .get_or_create(&ThresholdLabels {
                level: level_label.to_owned(),
            })
            .inc();
    }

    pub fn sync_grading_projection_metrics(&self, snapshot: &GradingProjectionSnapshot) {
        self.grading_projection_lag_seconds
            .set(snapshot.lag_seconds.max(0));
        self.grading_projection_cycle_duration_seconds
            .observe(snapshot.cycle_duration_seconds.max(0.0));

        let mut last_totals = self
            .projection_last_totals
            .lock()
            .expect("projection totals lock");
        increment_counter_by(
            &self.grading_projection_rows_processed_total,
            "schedule",
            snapshot.schedule_rows_processed_total,
            &mut last_totals.schedule,
        );
        increment_counter_by(
            &self.grading_projection_rows_processed_total,
            "submission",
            snapshot.submission_rows_processed_total,
            &mut last_totals.submission,
        );
        increment_counter_by(
            &self.grading_projection_rows_processed_total,
            "section",
            snapshot.section_rows_processed_total,
            &mut last_totals.section,
        );
        increment_counter_by(
            &self.grading_projection_rows_processed_total,
            "writing_task",
            snapshot.writing_task_rows_processed_total,
            &mut last_totals.writing_task,
        );
        drop(last_totals);

        let mut last_failures = self
            .projection_last_failures_total
            .lock()
            .expect("projection failures lock");
        if snapshot.failures_total >= *last_failures {
            for _ in 0..(snapshot.failures_total - *last_failures) {
                self.grading_projection_failures_total.inc();
            }
            *last_failures = snapshot.failures_total;
        } else {
            *last_failures = snapshot.failures_total;
        }
    }

    pub fn render(&self) -> Result<String, fmt::Error> {
        let registry = self.registry.lock().expect("telemetry registry lock");
        let mut output = String::new();
        encode(&mut output, &registry)?;
        Ok(output)
    }
}

fn increment_counter_by(
    family: &Family<ProjectionEntityLabels, Counter>,
    entity: &str,
    next_total: u64,
    last_total: &mut u64,
) {
    if next_total >= *last_total {
        let delta = next_total - *last_total;
        if delta > 0 {
            let counter = family.get_or_create(&ProjectionEntityLabels {
                entity: entity.to_owned(),
            });
            for _ in 0..delta {
                counter.inc();
            }
        }
    }
    *last_total = next_total;
}

#[cfg(test)]
mod tests {
    use super::{ProcessMemoryProfile, Telemetry};

    #[test]
    fn render_includes_process_memory_profile_metrics() {
        let telemetry = Telemetry::new();
        telemetry.set_process_memory_profile(&ProcessMemoryProfile {
            resident_bytes: 1024,
            resident_high_water_mark_bytes: 2048,
            virtual_memory_bytes: 4096,
            heap_bytes: 512,
            swap_bytes: 256,
        });

        let rendered = telemetry.render().expect("render metrics");
        assert!(rendered.contains("backend_process_resident_memory_bytes 1024"));
        assert!(rendered.contains("backend_process_resident_memory_high_water_mark_bytes 2048"));
        assert!(rendered.contains("backend_process_virtual_memory_bytes 4096"));
        assert!(rendered.contains("backend_process_heap_memory_bytes 512"));
        assert!(rendered.contains("backend_process_swap_memory_bytes 256"));
    }

    #[test]
    fn render_includes_memory_profile_failure_counter() {
        let telemetry = Telemetry::new();
        telemetry.observe_process_memory_profile_collection_failure();
        telemetry.observe_process_memory_profile_collection_failure();

        let rendered = telemetry.render().expect("render metrics");
        assert!(rendered.contains("backend_process_memory_profile_collection_failures_total"));
        let metric_value = metric_value(
            &rendered,
            "backend_process_memory_profile_collection_failures_total",
        )
        .expect("failure counter value");
        assert_eq!(metric_value, 2.0);
    }

    #[test]
    fn render_includes_background_wake_metrics_by_outcome() {
        let telemetry = Telemetry::new();
        telemetry.observe_background_wake("success", std::time::Duration::from_millis(4));
        telemetry.observe_background_wake("queue_full", std::time::Duration::from_millis(1));

        let rendered = telemetry.render().expect("render metrics");
        assert!(rendered.contains("backend_background_wake_duration_seconds"));
        assert!(
            rendered.contains("backend_background_wake_failures_total{outcome=\"queue_full\"} 1"),
            "{rendered}"
        );
    }

    #[test]
    fn render_includes_mutation_batch_persistence_metrics() {
        let telemetry = Telemetry::new();
        telemetry.observe_mutation_batch_persistence(3, 2, 2);
        telemetry.observe_mutation_batch_persistence(2, 1, 0);

        let rendered = telemetry.render().expect("render metrics");
        assert!(rendered.contains("backend_mutation_batch_requested_count_bucket"));
        assert!(rendered.contains("backend_mutation_batch_applied_count_bucket"));
        assert!(rendered.contains("backend_mutation_batch_persisted_count_bucket"));
        let anomaly_value =
            metric_value(&rendered, "backend_mutation_batch_zero_persistence_total")
                .expect("zero persistence metric value");
        assert_eq!(anomaly_value, 1.0);
    }

    #[test]
    fn render_includes_answer_loss_and_post_submit_grace_metrics() {
        let telemetry = Telemetry::new();
        telemetry.observe_student_answer_loss_risk("pending_seq_gap");
        telemetry.observe_submit_replay_incomplete();
        telemetry.observe_post_submit_grace_accepted();
        telemetry.observe_post_submit_grace_rejected();

        let rendered = telemetry.render().expect("render metrics");
        assert!(rendered.contains("student_answer_loss_risk_total"));
        assert!(rendered.contains("outcome=\"pending_seq_gap\""));
        assert_eq!(
            metric_value(&rendered, "backend_submit_replay_incomplete_total")
                .expect("submit replay incomplete value"),
            1.0
        );
        assert_eq!(
            metric_value(&rendered, "backend_post_submit_grace_accepted_total")
                .expect("post submit grace accepted value"),
            1.0
        );
        assert_eq!(
            metric_value(&rendered, "backend_post_submit_grace_rejected_total")
                .expect("post submit grace rejected value"),
            1.0
        );
    }

    fn metric_value(rendered: &str, metric_name: &str) -> Option<f64> {
        rendered.lines().find_map(|line| {
            if line.starts_with('#') || !line.starts_with(metric_name) {
                return None;
            }
            let (_, value) = line.split_once(' ')?;
            value.trim().parse::<f64>().ok()
        })
    }
}
