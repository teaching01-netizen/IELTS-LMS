# SAT Authoring Realtime — Rollout Runbook

**This file is the single source of truth for the rollout.** Flag state, cohort,
entry conditions, SLOs, halt conditions, rollback commands, and verification
queries live here and nowhere else. Alert rules reference this document rather
than restating it; if a rule and this table disagree, this table is wrong and
should be fixed in the same change.

Scope: the SAT **question part** — create / save / duplicate / delete / reorder /
bulk, plus workbook commit and undo as one coarse bulk event, plus the draft
lifecycle signals that keep editors safe. Delivery settings, release UI,
access-links, and the student runtime are out of scope.

## 0. The production bar

```text
CORRECT      No stale overwrite. No event without committed state.
             No committed realtime mutation missing its durable event.
RECOVERABLE  Loss, expiry, deploy, offline, and overflow all converge through
             authoritative HTTP state.
OBSERVABLE   Every important failure has one truthful metric and a log trail.
ACTIONABLE   Every page maps to an operator action or a rollback.
BOUNDED      Connections, queues, replay, retention, labels, logs, load.
REVERSIBLE   Every stage disables without schema rollback or data loss.
QUIET        Expected collaboration does not page.
```

## 1. Flags

Four independent booleans, all shipping `false`, read by
`internal/platform/config` and pinned by `config/runbookflags_test.go`.

| Flag (exact env var) | Gate |
|---|---|
| `AUTHORING_REALTIME_EVENTS` | durable event rows written in-tx with each mutation |
| `AUTHORING_REALTIME_DELIVERY` | authoring WebSocket endpoint (subscribe / replay / forward) |
| `AUTHORING_REALTIME_PRESENCE` | ephemeral presence relay (requires delivery) |
| `AUTHORING_REALTIME_CONFLICT_COMPARE` | three-way Compare UI (requires delivery) |

> **Do not use the older short names.** `AUTHORING_PRESENCE` and
> `AUTHORING_CONFLICT_COMPARE` were removed from
> `internal/authoringrealtime/flags.go`: nothing read them, so flipping one
> looked exactly like the right command while doing nothing.

Frontend kill switches (can only DISABLE a server-granted capability):
`VITE_AUTHORING_REALTIME_EVENTS`, `VITE_AUTHORING_REALTIME_DELIVERY`,
`VITE_AUTHORING_PRESENCE`, `VITE_AUTHORING_CONFLICT_COMPARE`.
Effective = server capability ∧ local switch.

### Dependency graph

```text
EVENTS
   ↓
DELIVERY
   ├──→ PRESENCE
   └──→ CONFLICT_COMPARE   (presentation only)
```

`CONFLICT_COMPARE=off` removes the richer Review UI and **nothing else**. It must
never disable dirty-state preservation, the pause on automatic network autosave
after a known divergence, GET-before-POST recovery, or revision fencing. That is
enforced by construction — the safety path takes no capability input — and pinned
by `realtime/__tests__/capabilityDependencies.test.ts`.

## 2. SLOs (frozen BEFORE stage 2)

Load tests and rollout gates use these same numbers. Do not invent thresholds at
the end of a load run.

| SLI | Series | Objective |
|---|---|---|
| Event freshness | `authoring_delivery_latency_seconds` (buckets) | p95 < 2s internal, 5s worst case |
| Freshness pressure | `authoring_resync_total` / subscriptions | < 5% of subscriptions require a resync |
| Authoring availability | `authoring_event_publish_failures_total` vs `authoring_operation_total` | append failure rate 0 |
| Realtime availability | `authoring_ws_connections_total{result="accepted"}` vs total | > 99% of authorized subscriptions established |

## 3. Metric surface

Kept deliberately small: one question per series.

```text
PERSISTENCE
  authoring_event_publish_total{operation,outcome}
  authoring_event_publish_failures_total{operation}

TRANSPORT
  authoring_ws_connections_current
  authoring_ws_connections_total{result}
  authoring_ws_disconnects_total{reason}
  authoring_reconnects_total{outcome}
  authoring_ws_events_dropped_total{stage}
  authoring_delivery_failures_total{stage}          forwarder | socket
  authoring_delivery_latency_seconds{le}            fixed buckets

RECOVERY
  authoring_replay_total{outcome}                   served | snapshot_required | failed
  authoring_resync_total{reason}                    THE freshness SLI

CORRECTNESS / PRODUCT
  authoring_revision_conflicts_total{operation}
  authoring_invariant_violations_total{invariant}   detection-only
  authoring_presence_current
```

Two Phase 06 names from the plan are intentionally **not** duplicated
(`authoring_events_published_total{kind,outcome}` → `authoring_event_publish_total`;
`authoring_events_dropped_total{stage}` → `authoring_ws_events_dropped_total`).

### There is no gap metric, by design

The live bus sequence is **global and filtered**, so `41 → 47` is completely
valid: a skipped value belongs to another exam or kind. Gap inference is not a
weaker signal, it is a wrong one, and a series built on it would page on healthy
traffic. Recovery is measured as `authoring_resync_total{reason}` with reasons
`cursor_expired | replay_too_large | delivery_overflow | unsupported_event |
lifecycle_rebind`. `authoring_sequence_gap_total` must not exist, and a test
asserts that it doesn't.

### Latency is buckets, not a gauge

`authoring_delivery_latency_seconds{le}` is emitted as cumulative counters over
`0.1 / 0.25 / 0.5 / 1 / 2 / 5 / +Inf` seconds. The gate is a p95, and a
last-sample gauge cannot produce a percentile. The repo vendors no histogram
client, so the buckets are plain counters on the existing registry.

### Label cardinality is enforced in code

Every label value passes through the closed sets in
`internal/authoringrealtime/metrics.go`; anything else becomes `other`.
`TestNoIdLikeValueEverBecomesALabel` feeds ids, revisions, uuids, and a
content-shaped blob through every helper and fails if one reaches a series.

## 4. Alerts and the action each demands

| Alert | Severity | Action |
|---|---|---|
| `AuthoringEventAppendFailing` | page | Persistence: mutations are rolling back. Correlate `authoring_operation_total{outcome="rejected"}`, then flip `AUTHORING_REALTIME_EVENTS` off. |
| `AuthoringInvariantViolation` | page | A post-condition check observed an impossible state. Halt delivery + events; data-integrity incident. Silence here is **not** proof of correctness. |
| `AuthoringReconnectStorm` | page | Deploy-restart signature. Halt the stage 7 ramp; verify clients resume via cursor rather than snapshot. |
| `AuthoringResyncPressureHigh` | ticket | Freshness SLI degraded. Break down by reason: `delivery_overflow` → capacity, `replay_too_large` → replay bound, `unsupported_event` → version skew, `lifecycle_rebind` → publish/undo churn. |
| `AuthoringDeliveryOverflow` | ticket | Capacity review. Shed frames are counted, writers were never blocked, clients resync. |
| `AuthoringCursorExpiredSustained` | ticket | Retention vs offline duration. Confirm `AuthoringRetentionHours` still equals the wired live-bus window. |
| `AuthoringDeliveryFailures` | ticket | Transport only; canonical state is correct. Break down by stage. |
| `AuthoringDeliveryLatencyP95High` | ticket | Check forwarder cadence, event-table growth, `db_pool_wait` before widening the budget. |
| `AuthoringRevisionConflictSpike` | ticket | Expected under collaboration; a spike is UX pressure or a fencing regression to triage in logs. |

## 5. Stages

Stage 0 exists because observability and a rehearsed rollback are prerequisites,
not deliverables: nothing is enabled until the series render and a flag flip has
been demonstrated on staging.

| Stage | Flag state | Cohort | Entry condition | Halt condition |
|---|---|---|---|---|
| 0 — observability | all OFF | none | dashboards render; rollback flip rehearsed on staging | — |
| 1 — durable events dark | `EVENTS` | prod writes, nobody reads | stage 0 green | any append failure |
| 2 — internal subscribe | + `DELIVERY` | internal exams, observe only | SLOs frozen; series sane | resync storm, latency p95 over SLO |
| 3 — clean reconcile **+ dirty safety** | same | internal | see below | any dirty-draft loss report |
| 4 — presence | + `PRESENCE` | internal staff | presence payload audit clean | presence churn, throttle breached |
| 5 — divergence UX | + `CONFLICT_COMPARE` | internal first | conflict funnel sane; a11y live-region check | — |
| 6 — broader cohort | all on | wider cohort | load gates recorded | latency p95 over SLO |
| 7 — gradual prod | all on, ramp | % of prod | all monitors green | auto-halt on reconnect storm or error-budget burn |

**Stage 3 carries a hard requirement.** Safe divergence behavior must already be
live before clean-client reconciliation reaches production:

```text
dirty client + remote save
    → preserve the local draft
    → pause automatic NETWORK autosave (durable local write continues)
    → GET before POST on any reconnect
```

The rich Compare UI can arrive in stage 5. The safely-freeze-and-preserve
behavior cannot wait for it.

## 6. Rollback

Flag flip plus verify. Never a schema rollback: the event table and indexes stay,
and the single retention job keeps running.

| Flip | Effect |
|---|---|
| `AUTHORING_REALTIME_EVENTS=off` | stops row writes; HTTP editing and fencing unchanged |
| `AUTHORING_REALTIME_DELIVERY=off` | stops subscribe/forward; clients degrade to HTTP-only editing |
| `AUTHORING_REALTIME_PRESENCE=off` | stops presence beats; nothing depends on them |
| `AUTHORING_REALTIME_CONFLICT_COMPARE=off` | hides Compare UI; dirty-editor *safety* is unaffected |

Verify after the flip: the authoring series go quiet, `authoring_operation_total`
outcome mix stays green, and a save still succeeds over HTTP.

## 7. Capacity gates

Express gates relative to expected peak, not as absolute-sounding numbers:

```text
gate load = expected peak concurrency × safety factor (2–3×)
          + reconnect-storm scenario (all sockets dropped at once post-deploy)
```

Record per gate: p95 `authoring_delivery_latency_seconds` under the SLO, DB pool
headroom > 30%, event-table growth linear-then-purged across three purge cycles,
zero `authoring_event_publish_failures_total`.

## 8. Retention

**One retention owner.** `maintenance.RunRetention` runs a single bounded,
oldest-first, windowed DELETE over `live_update_events`, and every family ages out
together (72h, batch-scaled, worker slow cycle). Authoring rows are covered by it;
there is deliberately no second authoring DELETE, because double-purging one
table reports two numbers while one statement may delete more than it claims.

`internal/authoringrealtime/retention.go` holds the fallback for the day
authoring genuinely needs a different window — correct and tested, unwired.

**Column semantics matter here.** `live_update_events` carries TWO kind columns:
`event_kind` is the bus family (`'authoring'`) and `event_name` is the domain kind
(`'question.changed'`). A purge predicate matching domain kinds against
`event_kind` would match zero rows — never purging anything while reading as
entirely plausible. `TestPurgeScopesOnTheBusKindColumnNotDomainKinds` makes that
mistake impossible to land.

Retention is deliberately **not** extended for long-offline clients. The cover is
the resync path: `cursor_expired` → `authoring.snapshot_required` → refetch.

## 9. Logs and tracing

Allow-listed fields (`internal/authoringrealtime/logging.go`):
`component`, `event`, `request_id`, `connection_id`, `organization_id`, `exam_id`,
`draft_version_id`, `event_kind`, `cursor`, `revision`, `result`, `duration_ms`.
Values pass a **shape guard**: identifier-shaped tokens only. Prose, JSON, an
email, a URL, an over-long value, and bare numbers all collapse to `other`.
There is no free-form `message`/`details` field. `logging_test.go` pushes a full
question draft through every field and fails if a token survives.

Tracing is **server-side and complete**: `X-Trace-Id` is echoed by the existing
HTTP middleware, the pair rides the context, the event row carries it in the
existing frozen `causationId`, and the forwarder and delivery paths log it — so
one id greps mutation → tx → row → forwarder → frame. Inbound ids are
**validated** (length, charset) and replaced with a server-generated id when they
fail, so a crafted header cannot forge log lines.

Two limits, stated rather than hidden:

- A browser `WebSocket` handshake cannot carry custom headers, so the frozen
  subscribe frame is not a correlation carrier.
- There is **no client-side metric or trace module**. This repo has no client
  telemetry ingestion path, so browser counters would be an in-memory subsystem
  no operator reads. Freshness is measured server-side, at the point the resync
  is decided.

## 10. Evidence still to collect before stage 6/7

Not claimed as done; these need infrastructure outside a normal CI run.

- k6 soak / burst-import / reconnect-storm at peak × 2–3, with the resource gates
  in §7 recorded.
- Playwright two-browser Alice/Bob scenarios 1–5 plus offline/reconnect.
- Multi-instance forwarding (two API processes, one DB) against the real bus poll.
- `EXPLAIN` for replay / forwarder-poll / purge on prod-like seeded row counts.
