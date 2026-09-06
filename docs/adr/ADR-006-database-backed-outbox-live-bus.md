# ADR-006 - database-backed outbox and live bus

Status - accepted.

Context - business transactions and durable events must commit together, and notifications must survive process restarts.

Decision - outbox_events with claim leasing (100-row batches, 60s lease, bounded rounds) plus live_update_events polled bus (250ms cadence, 200-row cap, own-origin exclusion). WebSockets are notifications, never source of truth. WS leases capped 600 total, 5 per user, 60s TTL with 30s heartbeat.

Consequences - workers are replayable and idempotent. Consumers tolerate redelivery via claim tokens and idempotency keys.
