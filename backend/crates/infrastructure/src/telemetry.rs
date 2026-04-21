use std::{
    fmt,
    sync::{atomic::AtomicI64, Arc, Mutex},
    time::Duration,
};

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
struct ServerBusyLabels {
    gate: String,
}

#[derive(Clone)]
pub struct Telemetry {
    registry: Arc<Mutex<Registry>>,
    http_request_latency: Family<HttpRequestLabels, Histogram>,
    db_operation_latency: Family<OperationLabels, Histogram>,
    publish_validation_latency: Family<OutcomeLabels, Histogram>,
    answer_commit_latency: Family<OutcomeLabels, Histogram>,
    violation_to_alert_latency: Histogram,
    websocket_connections: Gauge<i64, AtomicI64>,
    outbox_backlog_events: Gauge<i64, AtomicI64>,
    outbox_oldest_age_seconds: Gauge<i64, AtomicI64>,
    storage_budget_bytes: Gauge<i64, AtomicI64>,
    storage_budget_level: Gauge<i64, AtomicI64>,
    process_resident_memory_bytes: Gauge<i64, AtomicI64>,
    rate_limiter_buckets: Gauge<i64, AtomicI64>,
    storage_budget_threshold_hits: Family<ThresholdLabels, Counter>,
    server_busy_total: Family<ServerBusyLabels, Counter>,
    student_session_summary_requests_total: Counter,
    student_session_version_requests_total: Counter,
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
        let violation_to_alert_latency = Histogram::new(exponential_buckets(0.001, 2.0, 14));
        let websocket_connections = Gauge::<i64, AtomicI64>::default();
        let outbox_backlog_events = Gauge::<i64, AtomicI64>::default();
        let outbox_oldest_age_seconds = Gauge::<i64, AtomicI64>::default();
        let storage_budget_bytes = Gauge::<i64, AtomicI64>::default();
        let storage_budget_level = Gauge::<i64, AtomicI64>::default();
        let process_resident_memory_bytes = Gauge::<i64, AtomicI64>::default();
        let rate_limiter_buckets = Gauge::<i64, AtomicI64>::default();
        let storage_budget_threshold_hits = Family::<ThresholdLabels, Counter>::default();
        let server_busy_total = Family::<ServerBusyLabels, Counter>::default();
        let student_session_summary_requests_total = Counter::default();
        let student_session_version_requests_total = Counter::default();

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
            "backend_rate_limiter_buckets",
            "Number of active in-memory rate limiter buckets.",
            rate_limiter_buckets.clone(),
        );
        registry.register(
            "backend_storage_budget_threshold_hits_total",
            "Number of times storage budget checks have hit a given severity.",
            storage_budget_threshold_hits.clone(),
        );
        registry.register(
            "server_busy_total",
            "Number of 503 SERVER_BUSY responses, labeled by gate.",
            server_busy_total.clone(),
        );
        registry.register(
            "student_session_summary_requests_total",
            "Total requests served by the student session summary endpoint.",
            student_session_summary_requests_total.clone(),
        );
        registry.register(
            "student_session_version_requests_total",
            "Total requests served by the student session version endpoint.",
            student_session_version_requests_total.clone(),
        );

        Self {
            registry: Arc::new(Mutex::new(registry)),
            http_request_latency,
            db_operation_latency,
            publish_validation_latency,
            answer_commit_latency,
            violation_to_alert_latency,
            websocket_connections,
            outbox_backlog_events,
            outbox_oldest_age_seconds,
            storage_budget_bytes,
            storage_budget_level,
            process_resident_memory_bytes,
            rate_limiter_buckets,
            storage_budget_threshold_hits,
            server_busy_total,
            student_session_summary_requests_total,
            student_session_version_requests_total,
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

    pub fn inc_server_busy(&self, gate: &str) {
        let labels = ServerBusyLabels {
            gate: gate.to_owned(),
        };
        self.server_busy_total.get_or_create(&labels).inc();
    }

    pub fn inc_student_session_summary_requests(&self) {
        self.student_session_summary_requests_total.inc();
    }

    pub fn inc_student_session_version_requests(&self) {
        self.student_session_version_requests_total.inc();
    }

    pub fn set_rate_limiter_bucket_count(&self, buckets: usize) {
        self.rate_limiter_buckets
            .set(i64::try_from(buckets).unwrap_or(i64::MAX));
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

    pub fn render(&self) -> Result<String, fmt::Error> {
        let registry = self.registry.lock().expect("telemetry registry lock");
        let mut output = String::new();
        encode(&mut output, &registry)?;
        Ok(output)
    }
}
