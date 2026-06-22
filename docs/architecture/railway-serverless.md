# Railway Serverless runtime

Railway considers a service inactive only after it emits no outbound packets for more than ten
minutes ([Railway Serverless documentation](https://docs.railway.com/deployments/serverless)). The
normal backend topology deliberately emits outbound traffic: the API polls runtime and live-update
tables, the worker polls outbox/projection tables, connection pools keep database sessions open, OTLP
exports telemetry, and the old image healthcheck curled the API every 30 seconds.

## Runtime modes

`BACKGROUND_RUNTIME_MODE=continuous` is the default and rollback mode. It preserves the separate API
and worker processes and their continuous polling loops.

`BACKGROUND_RUNTIME_MODE=activity_driven` is the Railway Serverless mode. The container starts only
the API process. A coordinator inside that process owns runtime auto-advance, live updates, outbox
delivery, grading projection, and maintenance. It runs while an HTTP request or WebSocket is active,
then performs a final recovery pass after `BACKGROUND_IDLE_GRACE_SECS` (default 60) and becomes
quiescent. Idle database connections close after `DB_POOL_IDLE_TIMEOUT_SECS` (default 60).

The first non-probe request after an application-level idle period waits for recovery before route
handling. Runtime recovery uses persisted section deadlines and can advance across multiple elapsed
sections. This preserves timer fairness across sleep and cold boot rather than restarting a section
timer from wake time. Each recovered transition remains an append-only audit event with an
`effectiveAt` timestamp.

OTLP export is disabled automatically in activity-driven mode because exporter traffic prevents
sleep. The Docker image no longer has a recurring `HEALTHCHECK`; Railway's deployment healthcheck in
`railway.json` remains.

## Railway configuration

Set these variables on the combined backend service and enable Serverless in Railway:

```dotenv
BACKGROUND_RUNTIME_MODE=activity_driven
BACKGROUND_IDLE_GRACE_SECS=60
DB_POOL_IDLE_TIMEOUT_SECS=60
DB_POOL_MIN_CONNECTIONS=0
API_OTEL_EXPORTER_OTLP_ENDPOINT=
OTEL_EXPORTER_OTLP_ENDPOINT=
```

Do not continuously scrape `/readyz` or `/metrics`, run an uptime monitor, or keep a WebSocket open.
Those are inbound activity and/or cause outbound database work, so the service correctly remains
awake. `/healthz`, `/readyz`, and `/metrics` do not extend the application coordinator's grace window,
but external requests to them still wake Railway.

## Verification and rollback

After deployment, stop all clients and monitors. The log line `background runtime quiescent` should
appear after the grace interval. Allow the DB pool's idle timeout to close its connections; after that,
Railway should show no further outbound traffic and sleep the service after its ten-minute inactivity
threshold. Then send a request and verify timer state, pending outbox work, live updates, and grading
projections are reconciled before normal handling resumes. Railway may return a 502 for the first
platform-level wake request; clients must retry idempotent requests.

Rollback does not require a code rollback: set `BACKGROUND_RUNTIME_MODE=continuous` and redeploy.
