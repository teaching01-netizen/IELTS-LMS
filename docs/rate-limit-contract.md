# Rate-limit contract

This is the operator and client contract for the Go API rate limiter. The
contract applies to route tiers, handler-level export limits, and the student
entry admission gate.

## Quota semantics

- Per-minute values are the authoritative quotas. In dual mode, the MySQL/TiDB
  distributed counter owns the shared decision across API processes.
- `RATE_LIMIT_BURST` adds initial token capacity only. It never increases the
  sustained refill rate, so a long-running client still receives only the
  configured per-minute budget.
- `RATE_LIMIT_MODE=local` uses the exact configured quota in one API process.
  It is correct only when that process is the complete traffic authority.
- `RATE_LIMIT_MODE=dual` uses a local flood prefilter, then MySQL/TiDB as the
  distributed authority. The prefilter is not the quota authority.
- If the distributed counter returns a database error, the request switches
  to the bounded exact emergency local limiter. It never falls through to the
  inflated prefilter.
- A full local key store rejects the new active key with a retryable 429. It
  never evicts an active bucket to make room.

## Identity and trust boundary

Rate-limit keys are selected in this order:

1. a hash of a valid attempt bearer token;
2. the verified session user;
3. the client IP, using `X-Forwarded-For` only when the direct peer belongs to
   the explicitly configured `TRUSTED_PROXIES` CIDRs.

Raw bearer tokens, user IDs, email addresses, and IP addresses are never
Prometheus label values. The default trusted peers are loopback only.

## 429 response

Rate-limit denials use HTTP 429 and the `RateLimited` OpenAPI response. The
`Retry-After` header and `details.retryAfterSeconds` body field are integer
seconds, with a minimum of one. Tier denials also include
`X-RateLimit-Tier` and `details.tier`.

```json
{
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Rate limit exceeded.",
  "details": {
    "retryAfterSeconds": 2,
    "tier": "polling"
  },
  "requestId": "..."
}
```

Student entry is bounded admission retry, not a FIFO queue. A client may retry
after the advertised delay, but there is no ticket, queue position, ordering,
or “keep your place” guarantee.

## Supported configuration

The supported process knobs are:

- `RATE_LIMIT_MAX_KEYS`: maximum active local keys per limiter store;
- `RATE_LIMIT_BURST`: extra token capacity, independent of key capacity;
- `RATE_LIMIT_MODE`: `dual` or `local`;
- `TRUSTED_PROXIES`: comma-separated proxy CIDRs;
- per-tier budgets, expressed as requests per minute:
  `RATE_LIMIT_AUTH_CRITICAL_PER_MIN`, `RATE_LIMIT_ANON_AUTH_PER_MIN`,
  `RATE_LIMIT_AUTHED_READS_PER_MIN`, `RATE_LIMIT_POLLING_PER_MIN`,
  `RATE_LIMIT_HEARTBEAT_PER_MIN`, `RATE_LIMIT_WRITES_PER_MIN`, and
  `RATE_LIMIT_BACKSTOP_PER_MIN`.

`RATE_LIMIT_BUCKET_CAP` remains a one-release compatibility alias for
`RATE_LIMIT_MAX_KEYS` and is never burst capacity. `RATE_LIMIT_GLOBAL` is
deprecated and does not set per-tier quotas.

## Failure-mode runbook

When `http_ratelimit_db_error_total` increases, verify MySQL/TiDB health,
connection-pool wait time, and the distributed-counter table. Requests remain
bounded by the exact emergency limiter while the error persists. Do not raise
the prefilter or per-minute budget to hide a database failure; restore the
distributed authority first, then confirm the error counter stops increasing.

When `http_ratelimit_capacity_rejected_total` increases, break down by
`tier` and `key_class`. Check `RATE_LIMIT_MAX_KEYS` for the affected process,
confirm idle eviction is occurring, and investigate unexpected key churn. Do
not lower the quota or evict active state to silence the alert.

When `http_entry_gate_capacity_rejected_total` increases, inspect the entry
wave and the process-local `MaxSchedules` bound. The response is an admission
retry; it is not evidence of a durable FIFO queue. Increase capacity only
after confirming process memory and schedule-cardinality assumptions.

For 429 burn, inspect `http_ratelimit_denied_total` by `tier` and `key_class`,
then tune the matching `RATE_LIMIT_*_PER_MIN` setting. Keep bearer, user, and
IP values in logs or traces only when needed for an incident, never in metric
labels.
