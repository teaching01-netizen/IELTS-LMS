# Database pooling + exam concurrency (MySQL)

This backend uses a single shared `sqlx::MySqlPool` for API requests and background tasks.
Pool sizing must respect MySQL `max_connections`, especially during exam autosave and submit storms.

## Where pool size is configured

- Pool construction: `backend/crates/api/src/state.rs`
  - `MySqlPoolOptions::new().max_connections(config.db_pool_max_connections)`
- Env wiring + defaults: `backend/crates/infrastructure/src/config.rs`
  - `DB_POOL_MAX_CONNECTIONS` (default `20`)
  - `DB_POOL_ACQUIRE_TIMEOUT_MS` (default `3000`)
  - `RESOURCE_PROFILE=low` clamps pool connections to `min(DB_POOL_MAX_CONNECTIONS, 3)`

## Invariant

If the app pool is larger than MySQL `max_connections`, the backend will intermittently fail requests
under load when the pool tries to open more sessions than MySQL allows.

For exam traffic, **pool exhaustion is user-visible** (timeouts / 5xx) and can cause the UI to show
misleading "saved" state if clients don't retry correctly.

## Practical sizing rule

For a single API instance:

- Keep `DB_POOL_MAX_CONNECTIONS <= max_connections - 1` (reserve at least 1 connection for admin/ops).
- If you run any separate worker/migrator processes, reserve more headroom.

Example for `max_connections = 5`:

- Recommended: `DB_POOL_MAX_CONNECTIONS=3` or `4`
- Avoid: `DB_POOL_MAX_CONNECTIONS=5` (no headroom) and `>5` (will error)

## What this means for “how many students?”

Connection count limits **simultaneous DB work**, not “users”.
In our system, the relevant driver is autosave-like traffic:

- `k6/prod-exam-day.js` models a student as:
  - `POST /api/v1/student/sessions/:scheduleId/mutations:batch` every **2s** (~0.5 rps)
  - `POST /api/v1/student/sessions/:scheduleId/heartbeat` every **10s** (~0.1 rps)

So a realistic steady-state baseline is ~**0.6 requests/second/student**.

With only **5** MySQL connections, the real student capacity depends heavily on how long each request
holds a DB connection (query + transaction duration). A helpful approximation:

```
students ≈ connections / (rps_per_student * db_seconds_per_request)
```

If mutation-batch DB time is ~150–250ms and heartbeat DB time is ~50ms, then:

- Typical range: **~40–70 concurrent students** at steady state.

Submit storms are worse (many students submit at once); the `DB_POOL_ACQUIRE_TIMEOUT_MS` default
(`3000`) means requests can fail quickly if the pool is saturated.

## Recommended validation

Use the existing prod-like load scripts to measure your current environment:

- Start small: `K6_STUDENTS=25`, then `50`, then `100`.
- Watch p95 latency and error rate, especially for:
  - `mutations:batch`
  - `submit`

If you need to support 200+ students reliably, raise MySQL `max_connections` and size the pool
accordingly (or introduce a pooling proxy like transaction-level pooling) rather than relying on a
tiny `max_connections`.

