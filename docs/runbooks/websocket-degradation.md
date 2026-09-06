# Runbook: websocket degradation

Signals: `websocket_connections` dropping, `lease_acquire_failures_total`
up, `slow_client_disconnects_total` up; proctor live-mode stale.

## Triage
1. Lease acquisition failures: check caps (600 total / 5 per user / 600
   per schedule) and heartbeat freshness (60s lease, 30s heartbeat).
2. Slow disconnects: clients slower than the 1500ms write deadline are
   dropped by design — WebSockets are notifications, not source of
   truth. Confirm REST snapshot/poll still healthy.
3. Check live-event bus lag: `live_update_events` seq cursor vs
   `LatestSequence`; poll cadence 250ms, batch cap 200.
4. Check origin filtering: own-origin rows are excluded per subscriber.

## Mitigation
- Cap hits during exam start storms: admission queue sheds load;
  clients retry with backoff, state re-syncs via snapshot.
- Single-user failures: release the stale lease (`Release`) and let
  the client re-acquire.
- Infra outage: degrade to polling; exam writes never depend on the
  socket path.
