# Student exam-session architecture

This feature is being migrated as a behavior-preserving refactor. The existing student
workflow remains the compatibility surface while the exam protocol moves behind explicit
domain, application, contract, and infrastructure boundaries.

## Ownership map

- `domain/exam-session/` owns pure phase, blocking, runtime reconciliation, answer, and
  submission-barrier rules. It must not import React, browser globals, UI components, or
  service implementations.
- `application/exam-session/` owns the scoped session store and commands. Answer commands
  update the store before enqueueing a mutation; submission commands commit drafts, flush
  durability, flush the outbox, and only then call submission transport.
- `contracts/exam-session/` defines the durable-attempt, draft, realtime, platform, and
  transport ports. These are the stable seams used by tests and adapters.
- `infrastructure/exam-session/` owns Query/realtime coordination, browser monitors, and
  service-backed durability/outbox adapters.
- `hooks/exam-session/` is the React bridge. Selector hooks subscribe to narrow store slices;
  they do not own persistence or server protocol.

## Invariants retained during migration

- Submitted answers remain immutable.
- Local answer changes win over an older acknowledgement or snapshot.
- Autosave and replay remain idempotent through the existing mutation/outbox algorithms.
- A visible saved state is set only by the persistence path, not by a UI event.
- `offline`, reconnect heartbeat loss, and device mismatch remain log-only runtime signals;
  `storage_unavailable` remains the hard stop.
- Submission is completion-first: a failed network submit can enter the existing background
  retry path, but a failed durability barrier cannot report verified completion.

## Compatibility boundary

`components/student/providers/StudentAttemptProvider.tsx` is intentionally still a
compatibility adapter. It contains the production-tested pending-mutation durability mirror,
credential refresh, conflict handling, heartbeat persistence, and background-submit retry
algorithm. New code reaches the scoped store and submission ports first; the provider is not
allowed to become a new dependency of the domain/application layers.

The next safe extraction is to move that provider's lifecycle wiring into
`StudentAttemptController` and the durability/outbox adapters while keeping the algorithms
unchanged. Do not duplicate the mutation queue or replace the repository algorithm with a
second implementation.

## Remote snapshot rule

Static and live session data are Query-backed. Fresh bootstrap requests use unique request keys
and then publish the result to the canonical static/live key, so a stale in-flight request cannot
silently satisfy a later bootstrap. Realtime frames are identity- and revision-checked before
the live cache is updated or invalidated; socket loss accelerates safety polling, and reconnect
triggers immediate reconciliation.
